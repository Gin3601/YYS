import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getOasClient,
  type LogEvent,
  type ExplorationPresetValues,
  type RealmRaidPresetValues,
} from './api/oasClient'
import { useOasStatus } from './hooks/useOasStatus'
import { useDailyRunWatchdog } from './hooks/useDailyRunWatchdog'
import { Header } from './components/Header'
import { ExplorationPresetCard } from './components/ExplorationPresetCard'
import { RealmRaidPresetCard } from './components/RealmRaidPresetCard'
import { ControlPanel } from './components/ControlPanel'
import { LogPanel } from './components/LogPanel'

const MAX_LOG = 300
const DAILY_LIMIT_STORAGE_KEY = 'oas-lite-web:dailyLimitMinutes'
const DEFAULT_DAILY_LIMIT_MIN = 8 * 60   // 默认 8 小时上限，可由 ControlPanel 改

export function App() {
  // ============= 日志 =============
  const [logs, setLogs] = useState<LogEvent[]>([])
  const pushLog = useCallback((e: LogEvent) => {
    setLogs(prev => {
      const next = prev.length >= MAX_LOG ? prev.slice(-MAX_LOG + 1) : prev
      return [...next, e]
    })
  }, [])

  // ============= 客户端 =============
  const client = useMemo(() => getOasClient(pushLog), [pushLog])
  // 保持 sink 同步（pushLog 重建时）
  useEffect(() => { client.setSink(pushLog) }, [client, pushLog])

  // ============= 后端 / 配置 =============
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null)
  const [configList, setConfigList] = useState<string[]>([])
  const [currentConfig, setCurrentConfig] = useState<string | null>(null)

  // ============= 状态刷新 / WS 重连触发 =============
  const [presetRefreshTick, setPresetRefreshTick] = useState(0)
  const [wsReconnectKey, setWsReconnectKey] = useState(0)
  const [applyingPreset, setApplyingPreset] = useState(false)
  // activePresetLabel 只用于「启动 XXX」按钮的文案，标识用户上一次点了哪个预设。
  // 启动时本身不会再去应用预设（防止覆盖用户手改），所以不再需要单独的枚举 state。
  const [activePresetLabel, setActivePresetLabel] = useState('探索28')

  // 启动检测 + 自动重试。
  //
  // 退避策略：2s → 4s → 8s → 15s（上限），每轮 attempt 都翻倍但封顶。
  // OAS 后端加载 OCR 模型最多 ~30s，所以前几次 quick retry 让用户尽快进入，
  // 之后拉长间隔减少请求噪音。
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const loadConfigs = async () => {
      const list = await client.getConfigList()
      if (!alive) return
      setConfigList(list)
      if (list.length === 0) {
        pushLog({ ts: Date.now(), level: 'warn',
          message: '后端未返回任何配置，请检查 config/ 目录。' })
        return
      }
      const def = list.find(n => n.toLowerCase() === 'default') ?? list[0]
      setCurrentConfig(def)
      pushLog({ ts: Date.now(), level: 'info', message: `已自动选择配置：${def}` })
    }

    const tick = async () => {
      attempt++
      const ok = await client.testBackend()
      if (!alive) return
      setBackendOnline(ok)
      if (ok) {
        await loadConfigs()
        return
      }
      if (attempt === 1) {
        pushLog({ ts: Date.now(), level: 'warn',
          message: '后端未就绪，将退避重试（2s/4s/8s/15s...）……（请确认 server.py 正在启动）' })
      }
      // 指数退避封顶 15s，保留一些节奏响应性
      const delayMs = Math.min(15_000, 2000 * Math.pow(2, attempt - 1))
      timer = setTimeout(tick, delayMs)
    }

    tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [client, pushLog])

  // ============= WebSocket 状态 =============
  const status = useOasStatus(client, currentConfig, wsReconnectKey, pushLog)

  // ============= 每日运行时长 watchdog =============
  // 上限单位：分钟。从 localStorage 读默认值，允许用户在 ControlPanel 修改。
  const [dailyLimitMinutes, setDailyLimitMinutes] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(DAILY_LIMIT_STORAGE_KEY)
      const n = raw ? Number(raw) : NaN
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT_MIN
    } catch {
      return DEFAULT_DAILY_LIMIT_MIN
    }
  })
  useEffect(() => {
    try { localStorage.setItem(DAILY_LIMIT_STORAGE_KEY, String(dailyLimitMinutes)) } catch {}
  }, [dailyLimitMinutes])

  // 超限处理：自动停脚本 + 推一条显著日志。不弹 alert（避免阻塞下次启动）。
  const handleLimitExceeded = useCallback(() => {
    pushLog({
      ts: Date.now(), level: 'error',
      message: `⚠ 今日运行时长已达 ${dailyLimitMinutes} 分钟上限，自动停止脚本以保护账号。`
        + ' 请在 ControlPanel 重置今日计时或调大上限后再启动。',
    })
    if (currentConfig) {
      client.stopScript(currentConfig).catch(() => {})
    }
  }, [client, currentConfig, dailyLimitMinutes, pushLog])

  const watchdog = useDailyRunWatchdog(
    currentConfig,
    status.scriptState,
    dailyLimitMinutes,
    handleLimitExceeded,
  )

  // ============= 动作 =============
  const handleApplyExploration = useCallback(async (values: ExplorationPresetValues) => {
    if (!currentConfig) return
    setApplyingPreset(true)
    try {
      await client.applyExploration28Preset(currentConfig, values)
      setActivePresetLabel('探索28')
      setPresetRefreshTick(t => t + 1)
    } finally {
      setApplyingPreset(false)
    }
  }, [client, currentConfig])

  const handleApplyRealmRaid = useCallback(async (values: RealmRaidPresetValues) => {
    if (!currentConfig) return
    setApplyingPreset(true)
    try {
      await client.applyRealmRaidPreset(currentConfig, values)
      setActivePresetLabel('个人突破')
      setPresetRefreshTick(t => t + 1)
    } finally {
      setApplyingPreset(false)
    }
  }, [client, currentConfig])

  const handleStart = useCallback(async () => {
    if (!currentConfig) return
    if (backendOnline !== true) {
      pushLog({ ts: Date.now(), level: 'warn', message: '后端未连接，无法启动。' })
      return
    }
    if (watchdog.isOverLimit) {
      pushLog({
        ts: Date.now(), level: 'warn',
        message: `今日已达运行时长上限（${dailyLimitMinutes} 分钟），先在 ControlPanel 重置计时或调大上限再启动。`,
      })
      return
    }
    // 不再在启动时自动重写预设字段——用户若需要应用预设，应显式点击「应用预设」按钮。
    await client.startScript(currentConfig)
    // 启动后请求一次状态广播（不重建 WS）
    status.requestState()
    status.requestSchedule()
  }, [client, currentConfig, backendOnline, pushLog, status, watchdog.isOverLimit, dailyLimitMinutes])

  const handleStop = useCallback(async () => {
    if (!currentConfig) return
    if (status.scriptState === 1) {  // RUNNING
      const ok = window.confirm('脚本正在运行中，确认停止吗？')
      if (!ok) return
    }
    await client.stopScript(currentConfig)
    status.requestState()
  }, [client, currentConfig, status])

  const handleRefresh = useCallback(() => {
    setPresetRefreshTick(t => t + 1)
    status.requestState()
    status.requestSchedule()
    pushLog({ ts: Date.now(), level: 'info', message: '已请求刷新状态' })
  }, [pushLog, status])

  const handleReconnectWs = useCallback(() => {
    // 用户明确按了"重连"按钮 → 强制 teardown + 重建
    // （平时连接断了 hook 会自动指数退避重连，无需走这里）
    setWsReconnectKey(k => k + 1)
  }, [])

  const handleChangeConfig = useCallback((name: string) => {
    setCurrentConfig(name)
    pushLog({ ts: Date.now(), level: 'info', message: `切换配置：${name}` })
  }, [pushLog])

  return (
    <div className="app">
      <Header
        baseUrl={client.baseUrl}
        backendOnline={backendOnline}
        configList={configList}
        currentConfig={currentConfig}
        onChangeConfig={handleChangeConfig}
      />

      {backendOnline === false ? (
        <div className="boot">
          <p>
            <strong>式神召唤中…</strong>
          </p>
          <p>
            正在等待 OAS 后端就绪，每 2 秒自动重试一次。<br />
            若是通过 <code>start.bat</code> 一键启动，
            后端首次启动通常需要 10-30 秒（加载 OCR 模型）。
          </p>
          <p>
            若长时间无响应，请检查「OAS Backend」窗口的报错信息。
          </p>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const ok = await client.testBackend()
              setBackendOnline(ok)
              if (ok) {
                const list = await client.getConfigList()
                setConfigList(list)
                if (list.length) {
                  const def = list.find(n => n.toLowerCase() === 'default') ?? list[0]
                  setCurrentConfig(def)
                }
              }
            }}
          >立即重试</button>
        </div>
      ) : backendOnline === null ? (
        <div className="boot">
          <p>正在检测后端…</p>
        </div>
      ) : (
        <>
          <ExplorationPresetCard
            client={client}
            scriptName={currentConfig}
            refreshTick={presetRefreshTick}
            onApplyPreset={handleApplyExploration}
            applying={applyingPreset}
          />
          <RealmRaidPresetCard
            client={client}
            scriptName={currentConfig}
            refreshTick={presetRefreshTick}
            onApplyPreset={handleApplyRealmRaid}
            applying={applyingPreset}
          />
          <ControlPanel
            scriptName={currentConfig}
            backendOnline={backendOnline}
            status={status}
            startLabel={`启动${activePresetLabel}`}
            onStart={handleStart}
            onStop={handleStop}
            onRefresh={handleRefresh}
            onReconnectWs={handleReconnectWs}
            watchdog={watchdog}
            dailyLimitMinutes={dailyLimitMinutes}
            onChangeDailyLimit={setDailyLimitMinutes}
          />
        </>
      )}

      <LogPanel events={logs} onClear={() => setLogs([])} />
    </div>
  )
}
