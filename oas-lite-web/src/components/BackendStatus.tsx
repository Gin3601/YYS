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
        后端已连接 <span style={{ color: 'var(--text-dim)' }}>({baseUrl})</span>
      </span>
    )
  }
  return (
    <span title={baseUrl}>
      <span className="dot error" />
      未检测到 OAS 后端，请先启动 <code>python server.py</code>
    </span>
  )
}
