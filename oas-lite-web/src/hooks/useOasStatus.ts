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
  /** 当前/最近一次任务名 */
  current?: string
  /** 下一次任务名 */
  next?: string
  /** 原始数据（便于排查） */
  raw?: unknown
}

export interface OasStatus {
  /** WebSocket 是否连接中 */
  wsConnected: boolean
  /** 最近一次的脚本状态码 */
  scriptState: number | null
  /** 最近一次的 schedule 摘要 */
  schedule: ScheduleSummary | null
  /** 最近一次任意 ws 消息原文（用于底部日志展示） */
  lastMessage: string | null
}

/**
 * 订阅 OAS 的 ws://host/ws/{script} 状态通道。
 *
 * 设计：
 * - script 为 null 时不连接（用于尚未选中配置的情况）。
 * - 断开后**不自动重连**，由 UI 提供「重连」按钮主动触发。
 * - reconnectKey 变化会触发重连。
 */
export function useOasStatus(
  client: OasClient,
  scriptName: string | null,
  reconnectKey: number,
  logSink?: LogSink,
): OasStatus {
  const [status, setStatus] = useState<OasStatus>({
    wsConnected: false,
    scriptState: null,
    schedule: null,
    lastMessage: null,
  })
  const wsRef = useRef<WebSocket | null>(null)

  // 用 ref 包一层 sink，避免依赖变化触发重连
  const sinkRef = useRef<LogSink | undefined>(logSink)
  useEffect(() => { sinkRef.current = logSink }, [logSink])

  const log = useCallback((msg: string) => {
    sinkRef.current?.({ ts: Date.now(), level: 'info', message: msg })
  }, [])

  useEffect(() => {
    if (!scriptName) {
      setStatus(s => ({ ...s, wsConnected: false }))
      return
    }

    let cancelled = false
    let ws: WebSocket
    try {
      ws = client.createStatusWebSocket(scriptName)
    } catch (err) {
      log(`WS 创建失败：${String(err)}`)
      return
    }
    wsRef.current = ws

    ws.onopen = () => {
      if (cancelled) return
      setStatus(s => ({ ...s, wsConnected: true }))
      log(`WS 已连接 (${scriptName})`)
      // 主动请求一次状态与排程
      try { ws.send('get_state') } catch {}
      try { ws.send('get_schedule') } catch {}
    }

    ws.onmessage = (ev) => {
      if (cancelled) return
      const raw = typeof ev.data === 'string' ? ev.data : '[binary]'
      let parsed: any = null
      try { parsed = JSON.parse(raw) } catch { /* keep raw */ }

      setStatus(s => {
        const next: OasStatus = { ...s, lastMessage: raw }
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
      log(`WS 错误 (${scriptName})`)
    }

    ws.onclose = () => {
      if (cancelled) return
      setStatus(s => ({ ...s, wsConnected: false }))
      log(`WS 已断开 (${scriptName})`)
    }

    return () => {
      cancelled = true
      try { ws.close() } catch {}
      wsRef.current = null
    }
    // 仅在 script 或 reconnectKey 变更时重连；client 是单例不会变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptName, reconnectKey])

  return status
}

/**
 * 把 schedule 数据压成 {current, next} 摘要。
 *
 * 后端 get_schedule_data 的结构不固定（不同版本可能是 dict 或 list），
 * 这里做一份「尽力而为」的解析，保留 raw 让用户能直接看原始结构。
 */
function summarizeSchedule(raw: unknown): ScheduleSummary {
  const summary: ScheduleSummary = { raw }

  if (!raw) return summary

  // 形态 1：{ pending: [...], waiting: [...] } 之类
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

    // 当前任务：常见字段 current / running / pending[0]
    summary.current = pickName(obj.current ?? obj.running)
      ?? (Array.isArray(obj.pending) ? pickName(obj.pending[0]) : undefined)

    // 下次任务：常见字段 next / waiting[0]
    summary.next = pickName(obj.next)
      ?? (Array.isArray(obj.waiting) ? pickName(obj.waiting[0]) : undefined)
      ?? (Array.isArray(obj.pending) && obj.pending.length > 1
            ? pickName(obj.pending[1]) : undefined)
  }

  return summary
}
