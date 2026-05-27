import { BackendStatus } from './BackendStatus'

interface Props {
  baseUrl: string
  backendOnline: boolean | null
  configList: string[]
  currentConfig: string | null
  onChangeConfig: (name: string) => void
}

export function Header(props: Props) {
  const { baseUrl, backendOnline, configList, currentConfig, onChangeConfig } = props

  return (
    <header className="header">
      <h1>OAS 探索28 Lite 控制台</h1>
      <div className="header-row">
        <BackendStatus online={backendOnline} baseUrl={baseUrl} />
        <span className="config-select">
          <span>当前配置：</span>
          {configList.length === 0 ? (
            <span style={{ color: 'var(--text-dim)' }}>
              {backendOnline === false ? '后端离线' : '加载中…'}
            </span>
          ) : (
            <select
              value={currentConfig ?? ''}
              onChange={(e) => onChangeConfig(e.target.value)}
            >
              {configList.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}
        </span>
      </div>
    </header>
  )
}
