import { useCallback, useEffect, useMemo, useState } from 'react'
import { getOasClient, type LogEvent } from './api/oasClient'
import { useOasStatus } from './hooks/useOasStatus'
import { Header } from './components/Header'
import { ExplorationPresetCard } from './components/ExplorationPresetCard'
import { RealmRaidPresetCard } from './components/RealmRaidPresetCard'
import { ControlPanel } from './components/ControlPanel'
import { LogPanel } from './components/LogPanel'

const MAX_LOG = 300

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
  const [activePresetLabel, setActivePresetLabel] = useState('探索28')
  const [activePreset, setActivePreset] = useState<'exploration' | 'realmRaid'>('exploration')

  // 启动检测 + 自动重试。
  //
  // 一键启动场景：start.bat 同时拉起后端和前端，前端通常会先就绪。
  // 这里实现「等后端」轮询：
  //   - 首次 testBackend() 失败时不再要求手点重试，
  //   - 每 2 秒静默重试一次，直到成功；
  //   - 成功后立刻拉一次 config_list 并自动选默认配置。
  //
  // 后端一旦在线就停止轮询，避免无谓请求。
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
      // 只在第 1 次失败时打一条提示，避免日志被刷屏
      if (attempt === 1) {
        pushLog({ ts: Date.now(), level: 'warn',
          message: '后端未就绪，将每 2 秒自动重试……（请确认 server.py 正在启动）' })
      }
      timer = setTimeout(tick, 2000)
    }

    tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [client, pushLog])

  // ============= WebSocket 状态 =============
  const status = useOasStatus(client, currentConfig, wsReconnectKey, pushLog)

  // ============= 动作 =============
  const handleApplyPreset = useCallback(async () => {
    if (!currentConfig) return
    setApplyingPreset(true)
    try {
      await client.applyExploration28Preset(currentConfig)
      setActivePresetLabel('探索28')
      setActivePreset('exploration')
      setPresetRefreshTick(t => t + 1) // 触发卡片重新读 args 展示新值
    } finally {
      setApplyingPreset(false)
    }
  }, [client, currentConfig])

  const handleApplyRealmRaidPreset = useCallback(async () => {
    if (!currentConfig) return
    setApplyingPreset(true)
    try {
      await client.applyRealmRaidPreset(currentConfig)
      setActivePresetLabel('个人突破')
      setActivePreset('realmRaid')
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
    if (activePreset === 'realmRaid') {
      await client.applyRealmRaidPreset(currentConfig)
    } else {
      await client.applyExploration28Preset(currentConfig)
    }
    setPresetRefreshTick(t => t + 1)
    await client.startScript(currentConfig)
    // 启动后用 WS 'get_state' 触发一次广播
    setWsReconnectKey(k => k + 1)
  }, [client, currentConfig, backendOnline, activePreset, pushLog])

  const handleStop = useCallback(async () => {
    if (!currentConfig) return
    await client.stopScript(currentConfig)
    setWsReconnectKey(k => k + 1)
  }, [client, currentConfig])

  const handleRefresh = useCallback(() => {
    setPresetRefreshTick(t => t + 1)
    setWsReconnectKey(k => k + 1)
    pushLog({ ts: Date.now(), level: 'info', message: '已请求刷新状态' })
  }, [pushLog])

  const handleReconnectWs = useCallback(() => {
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
            <strong>正在等待 OAS 后端就绪…</strong>
          </p>
          <p style={{ color: 'var(--text-dim)' }}>
            前端每 2 秒会自动重试一次。<br />
            如果你是通过 <code>start.bat</code> 一键启动的，
            后端首次启动通常需要 10-30 秒（加载 OCR 模型）。
          </p>
          <p style={{ color: 'var(--text-dim)' }}>
            若长时间无响应，请检查名为「OAS Backend」的命令行窗口里的报错信息。
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
          <p style={{ color: 'var(--text-dim)' }}>正在检测后端…</p>
        </div>
      ) : (
        <>
          <ExplorationPresetCard
            client={client}
            scriptName={currentConfig}
            refreshTick={presetRefreshTick}
            onApplyPreset={handleApplyPreset}
            applying={applyingPreset}
          />
          <RealmRaidPresetCard
            client={client}
            scriptName={currentConfig}
            refreshTick={presetRefreshTick}
            onApplyPreset={handleApplyRealmRaidPreset}
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
          />
        </>
      )}

      <LogPanel events={logs} onClear={() => setLogs([])} />
    </div>
  )
}
