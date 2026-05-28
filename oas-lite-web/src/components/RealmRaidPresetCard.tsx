import { useEffect, useState } from 'react'
import type { OasClient, TaskArgs } from '../api/oasClient'

interface Props {
  client: OasClient
  scriptName: string | null
  refreshTick: number
  onApplyPreset: () => void
  applying: boolean
}

export function RealmRaidPresetCard({
  client,
  scriptName,
  refreshTick,
  onApplyPreset,
  applying,
}: Props) {
  const [args, setArgs] = useState<TaskArgs | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!scriptName) {
      setArgs(null)
      return
    }
    let cancelled = false
    setLoading(true)
    client.getTaskArgs(scriptName, 'RealmRaid').then(data => {
      if (!cancelled) {
        setArgs(data)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [client, scriptName, refreshTick])

  const raid = args?.raid_config ?? []
  const scheduler = args?.scheduler ?? []
  const findRaid = (name: string) => raid.find(a => a.name === name)
  const findScheduler = (name: string) => scheduler.find(a => a.name === name)

  return (
    <section className="card">
      <h2>个人突破 预设</h2>
      {!scriptName ? (
        <div style={{ color: 'var(--text-dim)' }}>请先选择一个配置。</div>
      ) : loading && !args ? (
        <div style={{ color: 'var(--text-dim)' }}>正在读取 RealmRaid 参数...</div>
      ) : !args ? (
        <div style={{ color: 'var(--danger)' }}>
          读取参数失败，请查看底部日志或浏览器控制台。
        </div>
      ) : (
        <div className="card-grid">
          <Field label="调度启用" item={findScheduler('enable')} />
          <Field label="挑战次数" item={findRaid('number_attack')} />
          <Field label="最低票数" item={findRaid('number_base')} />
          <Field label="退四打九" item={findRaid('exit_four')} />
          <Field label="进攻顺序" item={findRaid('order_attack')} />
          <Field label="失败处理" item={findRaid('when_attack_fail')} />
        </div>
      )}

      <div className="btn-row">
        <button
          type="button"
          className="btn primary"
          disabled={!scriptName || applying}
          onClick={onApplyPreset}
        >
          {applying ? '应用中...' : '应用个人突破预设'}
        </button>
        <span style={{ color: 'var(--text-dim)', fontSize: 12, alignSelf: 'center' }}>
          预设：启用个人突破 / 30 次 / 票数不限 / 退四打九 / 失败刷新 / 不切魂
        </span>
      </div>
    </section>
  )
}

function Field({
  label,
  item,
}: {
  label: string
  item: ReturnType<TaskArgs[string]['find']> | undefined
}) {
  if (!item) {
    return (
      <div className="field">
        <span className="label">{label}</span>
        <span className="value" style={{ color: 'var(--text-dim)' }}>(字段未找到)</span>
      </div>
    )
  }
  let displayValue: string
  if (item.value === null || item.value === undefined) {
    displayValue = '-'
  } else if (typeof item.value === 'object') {
    displayValue = JSON.stringify(item.value)
  } else {
    displayValue = String(item.value)
  }
  return (
    <div className="field" title={item.description ?? item.name}>
      <span className="label">{label}</span>
      <span className="value">{displayValue}</span>
    </div>
  )
}
