import { useEffect, useRef, useState, useCallback } from 'react'
import { OasClient, type LogSink } from '../api/oasClient'

/**
 * ScriptState 镜像：来自 module/server/script_process.py
 *   0 INACTIVE / 1 RUNNING / 2 WARNING / 3 UPDATING
 */
export const ScriptStateLabel: Record<number, string> = {
  0: '未运行 (INACTIVE)',
  1: '运行中 (RUNNING)',
  2: '警告 (WARNING)',
  3: '更新中 (UPDATING)',
}

export interface ScheduleSummary {
  current?: string
  next?: string
  raw?: unknown
}

export interface OasStatus {
  wsConnected: boolean
  scriptState: number | null
  schedule: ScheduleSummary | null
  lastMessage: string | null
  /** 让后端立刻广播一次 state / schedule —— 不重建连接 */
  requestState: () => void
  requestSchedule: () => void
}

/**
 * 订阅 OAS 的 ws://host/ws/{script} 状态通道。
 *
 * 设计要点：
 * 1. script 为 null 时不连接
 * 2. **自动重连**：连接断开后按指数退避 1→2→4→...→30s 自动重试，无需用户点按钮
 * 3. **非破坏性刷新**：requestState/requestSchedule 直接复用现有 socket 发命令，
 *    不会 teardown + 重建（早期版本每次 refresh 都重建是 bug）
 * 4. **明确重连**：父组件递增 reconnectKey 可强制立刻 teardown 重连
 *    （用于 "重连" 按钮 —— 通常自动重连已够用）
 * 5. **心跳 + 僵尸检测**：连接期间每 30s 发一次 get_state 既作心跳又顺便刷新状态。
 *    若连续 90s 没收到任何消息（包括心跳回应），就主动 teardown 触发重连 ——
 *    避免 TCP 层连接还在但实际已死（"半关闭"/NAT 超时）的僵尸状态。
 */
const HEARTBEAT_INTERVAL_MS = 30_000
const SILENCE_TIMEOUT_MS    = 90_000  // 3 倍心跳周期
export function useOasStatus(
  client: OasClient,
  scriptName: string | null,
  reconnectKey: number,
  logSink?: LogSink,
): OasStatus {
  const [status, setStatus] = useState<{
    wsConnected: boolean
    scriptState: number | null
    schedule: ScheduleSummary | null
    lastMessage: string | null
  }>({
    wsConnected: false,
    scriptState: null,
    schedule: null,
    lastMessage: null,
  })
  const wsRef = useRef<WebSocket | null>(null)

  const sinkRef = useRef<LogSink | undefined>(logSink)
  useEffect(() => { sinkRef.current = logSink }, [logSink])
  const log = useCallback((msg: string, level: 'info' | 'warn' | 'error' = 'info') => {
    sinkRef.current?.({ ts: Date.now(), level, message: msg })
  }, [])

  useEffect(() => {
    if (!scriptName) {
      setStatus(s => ({ ...s, wsConnected: false }))
      return
    }

    let cancelled = false
    let attempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    let lastMessageAt = 0

    const cleanupTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    const cleanupHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    }

    const scheduleReconnect = () => {
      if (cancelled) return
      cleanupTimer()
      const delayMs = Math.min(30_000, 1000 * Math.pow(2, attempt))
      attempt += 1
      log(`WS 将在 ${Math.round(delayMs / 1000)}s 后自动重连（第 ${attempt} 次尝试）`)
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, delayMs)
    }

    const startHeartbeat = () => {
      cleanupHeartbeat()
      lastMessageAt = Date.now()
      heartbeatTimer = setInterval(() => {
        if (cancelled) return
        const ws = wsRef.current
        // 沉默检测：连续 SILENCE_TIMEOUT_MS 没收到任何东西 → 视为僵尸连接
        if (Date.now() - lastMessageAt > SILENCE_TIMEOUT_MS) {
          log(`WS 静默超过 ${SILENCE_TIMEOUT_MS / 1000}s，强制重连`, 'warn')
          cleanupHeartbeat()
          if (ws) {
            try { ws.close() } catch {}
          }
          // ws.close() 会触发 onclose → scheduleReconnect
          return
        }
        // 否则发心跳（顺便刷新一次 state）
        if (ws && ws.readyState === WebSocket.OPEN) {
          try { ws.send('get_state') } catch {
            log('WS 心跳发送失败，可能是僵尸连接', 'warn')
          }
        }
      }, HEARTBEAT_INTERVAL_MS)
    }

    const connect = () => {
      if (cancelled) return
      let ws: WebSocket
      try {
        ws = client.createStatusWebSocket(scriptName)
      } catch (err) {
        log(`WS 创建失败：${String(err)}`, 'error')
        scheduleReconnect()
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        if (cancelled) return
        attempt = 0  // 成功 → 重置退避
        lastMessageAt = Date.now()
        setStatus(s => ({ ...s, wsConnected: true }))
        log(`WS 已连接 (${scriptName})`)
        try { ws.send('get_state') } catch {}
        try { ws.send('get_schedule') } catch {}
        startHeartbeat()
      }

      ws.onmessage = (ev) => {
        if (cancelled) return
        lastMessageAt = Date.now()  // 任何消息都视为存活
        const raw = typeof ev.data === 'string' ? ev.data : '[binary]'
        let parsed: any = null
        try { parsed = JSON.parse(raw) } catch { /* keep raw */ }

        setStatus(s => {
          const next = { ...s, lastMessage: raw }
          if (parsed && typeof parsed === 'object') {
            if ('state' in parsed && typeof parsed.state === 'number') {
              next.scriptState = parsed.state
            }
            if ('schedule' in parsed) {
              next.schedule = summarizeSchedule(parsed.schedule)
            }
          }
          return next
        })
      }

      ws.onerror = () => {
        if (cancelled) return
        log(`WS 错误 (${scriptName})`, 'warn')
      }

      ws.onclose = () => {
        if (cancelled) return
        cleanupHeartbeat()
        setStatus(s => ({ ...s, wsConnected: false }))
        wsRef.current = null
        scheduleReconnect()
      }
    }

    connect()

    return () => {
      cancelled = true
      cleanupTimer()
      cleanupHeartbeat()
      const ws = wsRef.current
      wsRef.current = null
      if (ws) {
        try { ws.close() } catch {}
      }
    }
    // client 是单例不会变；script / reconnectKey 变化时重建连接
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptName, reconnectKey])

  // —— 给父组件用的命令 —— 直接复用现有 socket，不 teardown
  const sendIfOpen = useCallback((cmd: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log(`WS 未连接，无法发送 ${cmd}`, 'warn')
      return
    }
    try { ws.send(cmd) } catch (err) {
      log(`WS 发送 ${cmd} 失败：${String(err)}`, 'error')
    }
  }, [log])
  const requestState = useCallback(() => sendIfOpen('get_state'), [sendIfOpen])
  const requestSchedule = useCallback(() => sendIfOpen('get_schedule'), [sendIfOpen])

  return { ...status, requestState, requestSchedule }
}

function summarizeSchedule(raw: unknown): ScheduleSummary {
  const summary: ScheduleSummary = { raw }
  if (!raw) return summary
  if (typeof raw === 'object') {
    const obj = raw as Record<string, any>
    const pickName = (item: any): string | undefined => {
      if (!item) return undefined
      if (typeof item === 'string') return item
      if (typeof item.name === 'string') return item.name
      if (typeof item.command === 'string') return item.command
      if (typeof item.task === 'string') return item.task
      return undefined
    }
    summary.current = pickName(obj.current ?? obj.running)
      ?? (Array.isArray(obj.pending) ? pickName(obj.pending[0]) : undefined)

    // 注意：后端 get_schedule_data() 返回的 pending 已经是 pending_task[1:]
    // （第一项是 running 任务，被切掉了），所以 pending[0] 才是真正的下一个待跑任务。
    summary.next = pickName(obj.next)
      ?? (Array.isArray(obj.waiting) && obj.waiting.length > 0
            ? pickName(obj.waiting[0]) : undefined)
      ?? (Array.isArray(obj.pending) && obj.pending.length > 0
            ? pickName(obj.pending[0]) : undefined)
  }
  return summary
}
