import { ScriptStateLabel, type OasStatus } from '../hooks/useOasStatus'

interface Props {
  scriptName: string | null
  backendOnline: boolean | null
  status: OasStatus
  startLabel?: string
  onStart: () => void
  onStop: () => void
  onRefresh: () => void
  onReconnectWs: () => void
}

export function ControlPanel(props: Props) {
  const {
    scriptName, backendOnline, status, startLabel = '启动脚本',
    onStart, onStop, onRefresh, onReconnectWs,
  } = props

  const canControl = !!scriptName && backendOnline === true
  const stateText = status.scriptState === null
    ? '未知'
    : ScriptStateLabel[status.scriptState] ?? `未知(${status.scriptState})`

  return (
    <section className="card">
      <h2>控制面板</h2>
      <div className="card-grid">
        <div className="field">
          <span className="label">脚本运行状态</span>
          <span className="value">
            <StateDot state={status.scriptState} />
            {stateText}
          </span>
        </div>
        <div className="field">
          <span className="label">当前任务</span>
          <span className="value">{status.schedule?.current ?? '-'}</span>
        </div>
        <div className="field">
          <span className="label">下一次任务</span>
          <span className="value">{status.schedule?.next ?? '-'}</span>
        </div>
        <div className="field">
          <span className="label">WebSocket</span>
          <span className="value">
            <span className={`dot ${status.wsConnected ? 'success' : 'error'}`} />
            {status.wsConnected ? '已连接' : '状态连接已断开'}
          </span>
        </div>
      </div>

      <div className="btn-row">
        <button
          type="button"
          className="btn primary"
          disabled={!canControl}
          onClick={onStart}
        >{startLabel}</button>
        <button
          type="button"
          className="btn danger"
          disabled={!canControl}
          onClick={onStop}
        >停止脚本</button>
        <button
          type="button"
          className="btn"
          disabled={!scriptName}
          onClick={onRefresh}
        >刷新状态</button>
        {!status.wsConnected && scriptName && (
          <button
            type="button"
            className="btn"
            onClick={onReconnectWs}
          >重连 WebSocket</button>
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
