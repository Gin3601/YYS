import { ScriptStateLabel, type OasStatus } from '../hooks/useOasStatus'
import { type DailyRunWatchdog, formatDuration } from '../hooks/useDailyRunWatchdog'

interface Props {
  scriptName: string | null
  backendOnline: boolean | null
  status: OasStatus
  startLabel?: string
  onStart: () => void
  onStop: () => void
  onRefresh: () => void
  onReconnectWs: () => void
  watchdog: DailyRunWatchdog
  dailyLimitMinutes: number
  onChangeDailyLimit: (minutes: number) => void
}

export function ControlPanel(props: Props) {
  const {
    scriptName, backendOnline, status, startLabel = '启动脚本',
    onStart, onStop, onRefresh, onReconnectWs,
    watchdog, dailyLimitMinutes, onChangeDailyLimit,
  } = props

  const canControl = !!scriptName && backendOnline === true
  const stateText = status.scriptState === null
    ? '未知'
    : ScriptStateLabel[status.scriptState] ?? `未知(${status.scriptState})`

  // 运行时长状态色：超限 → danger；> 80% 限额 → warn；其余正常
  const limitSeconds = dailyLimitMinutes * 60
  const ratio = limitSeconds > 0 ? watchdog.todaySeconds / limitSeconds : 0
  const runtimeColor =
    watchdog.isOverLimit ? 'var(--danger)' :
    ratio >= 0.8        ? 'var(--warn)'   :
                          'var(--text-strong)'

  const handleResetRuntime = () => {
    if (watchdog.todaySeconds <= 0) return
    if (window.confirm(`将清空今日已累计的 ${formatDuration(watchdog.todaySeconds)} 运行时长。继续？`)) {
      watchdog.resetToday()
    }
  }

  return (
    <section className="card control-panel">
      <h2>御灵控制盘
        <span className="deco">✦</span>
      </h2>
      <div className="card-grid">
        <div className="field">
          <span className="label">脚本状态</span>
          <span className="value">
            <StateDot state={status.scriptState} />
            {stateText}
          </span>
        </div>
        <div className="field">
          <span className="label">当前任务</span>
          <span className="value">{status.schedule?.current ?? '—'}</span>
        </div>
        <div className="field">
          <span className="label">下一次任务</span>
          <span className="value">{status.schedule?.next ?? '—'}</span>
        </div>
        <div className="field">
          <span className="label">通讯链路</span>
          <span className="value">
            <span className={`dot ${status.wsConnected ? 'success' : 'error'}`} />
            {status.wsConnected ? '已连接' : '已断开'}
          </span>
        </div>
        <div className="field" style={{ gridColumn: 'span 2' }}>
          <span className="label">今日运行 / 上限</span>
          <span className="value" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ color: runtimeColor, fontWeight: 600 }}>
              {formatDuration(watchdog.todaySeconds)}
            </span>
            <span style={{ color: 'var(--text-mute)' }}>/</span>
            <input
              className="input"
              type="number"
              min={5}
              max={1440}
              step={5}
              style={{ width: 80 }}
              value={dailyLimitMinutes}
              onChange={e => {
                // 关键：始终把输入值钳进 [5, 1440] 再回写。
                // 不能用「校验失败就忽略」的写法 —— 那会让输入框显示用户键入但 state 不变，
                // 用户以为改成功了其实没改（受控组件的常见坑）。
                const n = parseInt(e.target.value || '0', 10)
                if (Number.isFinite(n)) {
                  onChangeDailyLimit(Math.max(5, Math.min(1440, n)))
                }
              }}
              title="单日运行时长上限（分钟），自动钳到 5-1440 范围内"
            />
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>分钟</span>
            {watchdog.isOverLimit && (
              <span style={{ color: 'var(--danger)', fontSize: 12, marginLeft: 4 }}>
                ⚠ 已超限
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="btn-row">
        <button
          type="button"
          className="btn primary"
          disabled={!canControl || watchdog.isOverLimit}
          onClick={onStart}
          title={watchdog.isOverLimit ? '今日已超运行上限，请先重置或调大上限' : undefined}
        >⛩ {startLabel}</button>
        <button
          type="button"
          className="btn danger"
          disabled={!canControl}
          onClick={onStop}
        >■ 停止脚本</button>
        <button
          type="button"
          className="btn"
          disabled={!scriptName}
          onClick={onRefresh}
        >↻ 刷新状态</button>
        <button
          type="button"
          className="btn"
          disabled={watchdog.todaySeconds <= 0}
          onClick={handleResetRuntime}
          title="清空今日已累计的运行时长（一般不需要，除非误触超限了）"
        >↺ 重置今日计时</button>
        {!status.wsConnected && scriptName && (
          <button
            type="button"
            className="btn"
            onClick={onReconnectWs}
          >⟳ 重连</button>
        )}
      </div>
    </section>
  )
}

function StateDot({ state }: { state: number | null }) {
  let cls = 'muted'
  if (state === 1) cls = 'success'
  else if (state === 2) cls = 'warn'
  else if (state === 3) cls = 'warn'
  else if (state === 0) cls = 'muted'
  return <span className={`dot ${cls}`} />
}
