import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 每日运行时长监督器。
 *
 * 设计：
 * - 当 scriptState === 1 (RUNNING) 时每 5s 累计一次，写到 localStorage
 * - 当累计达到 limitMinutes 时调用一次 onLimitExceeded（典型用法：自动 stopScript）
 * - 关键边界：
 *   * 配置变化 / 日期变化 → 切换到新的 storage key，自动归零
 *   * 用户刷新页面 → 从 localStorage 恢复，不丢累计
 *   * 后端 / 前端崩了重启 → 同上，累计不丢
 *   * 5s 粒度的累计 → 漂移最多 5s，对"小时级"上限来说完全可接受
 * - 不试图记录"哪个任务在跑"，只关心总运行时长 —— 因为对账号风险而言，
 *   运行任何任务都消耗时间预算
 *
 * 返回 todaySeconds 是已累计 + 当前段实时秒；
 * isOverLimit 是 >= 上限；
 * resetToday 是手动清零（管理员调试用）。
 */

const TICK_INTERVAL_MS = 5_000   // 累计粒度
const STORAGE_PREFIX = 'oas-lite-web:runtime:'

function todayKey(): string {
  // YYYY-MM-DD（本地时区）—— 凌晨自动滚到新 key
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function readStoredSeconds(key: string): number {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return 0
    const parsed = JSON.parse(raw)
    const n = Number(parsed?.accumulatedSeconds)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

function writeStoredSeconds(key: string, seconds: number): void {
  try {
    localStorage.setItem(key, JSON.stringify({ accumulatedSeconds: seconds }))
  } catch {
    // 配额满 / 隐私模式禁用 —— 内存累计照样工作
  }
}

export interface DailyRunWatchdog {
  /** 今天已累计的运行秒数（含当前还在跑的段，定期更新）*/
  todaySeconds: number
  /** 是否已超过上限 */
  isOverLimit: boolean
  /** 手动归零今日计时（弹 confirm 让调用方处理） */
  resetToday: () => void
}

export function useDailyRunWatchdog(
  configName: string | null,
  scriptState: number | null,   // 1 表示 RUNNING（来自 OasStatus）
  limitMinutes: number,
  onLimitExceeded: () => void,
): DailyRunWatchdog {
  const storageKey = configName ? `${STORAGE_PREFIX}${configName}:${todayKey()}` : null

  const [todaySeconds, setTodaySeconds] = useState<number>(() =>
    storageKey ? readStoredSeconds(storageKey) : 0
  )

  // 用 ref 持有回调，避免回调变化导致计时 effect 重启
  const onLimitRef = useRef(onLimitExceeded)
  useEffect(() => { onLimitRef.current = onLimitExceeded }, [onLimitExceeded])

  // 已触发过上限 → 同一日内不再重复触发（除非用户手动 reset）
  const limitTriggeredRef = useRef(false)

  // configName / 日期变化时重新加载
  useEffect(() => {
    if (!storageKey) {
      setTodaySeconds(0)
      limitTriggeredRef.current = false
      return
    }
    setTodaySeconds(readStoredSeconds(storageKey))
    limitTriggeredRef.current = false
  }, [storageKey])

  // 跑步时每 5s tick 一次：累加 + 持久化 + 检查上限
  useEffect(() => {
    if (scriptState !== 1 || !storageKey) return
    const id = setInterval(() => {
      setTodaySeconds(prev => {
        const next = prev + TICK_INTERVAL_MS / 1000
        writeStoredSeconds(storageKey, next)
        if (next >= limitMinutes * 60 && !limitTriggeredRef.current) {
          limitTriggeredRef.current = true
          try { onLimitRef.current() } catch { /* ignore */ }
        }
        return next
      })
    }, TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [scriptState, storageKey, limitMinutes])

  const resetToday = useCallback(() => {
    setTodaySeconds(0)
    limitTriggeredRef.current = false
    if (storageKey) {
      try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
    }
  }, [storageKey])

  return {
    todaySeconds,
    isOverLimit: todaySeconds >= limitMinutes * 60,
    resetToday,
  }
}

/** 把秒数格式化成「Xh Ym」/「Ym Zs」/「Zs」便于展示 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}
