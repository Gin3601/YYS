interface Props {
  online: boolean | null
  baseUrl: string
}

export function BackendStatus({ online, baseUrl }: Props) {
  if (online === null) {
    return (
      <span title={baseUrl}>
        <span className="dot muted" />
        正在检测后端…
      </span>
    )
  }
  if (online) {
    return (
      <span title={baseUrl}>
        <span className="dot success" />
        式神在线 <span style={{ color: 'var(--text-mute)', fontSize: 12 }}>({baseUrl})</span>
      </span>
    )
  }
  return (
    <span title={baseUrl}>
      <span className="dot error" />
      式神未至 · 请先启动 <code>python server.py</code>
    </span>
  )
}
