import { useEffect, useState } from 'react'
import type { OasClient, TaskArgs } from '../api/oasClient'

interface Props {
  client: OasClient
  scriptName: string | null
  /** 父组件用 refreshTick 触发卡片重新拉一次 args */
  refreshTick: number
  onApplyPreset: () => void
  applying: boolean
}

/**
 * 显示当前 Exploration 任务的关键字段实际值（从 args 读取），
 * 并提供「应用探索28预设」按钮。
 *
 * 字段实际值从 GET /{config}/Exploration/args 拿，不硬编码——这样
 * 如果后端字段名/默认值变了，UI 仍能展示真实值。
 */
export function ExplorationPresetCard({
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
    client.getTaskArgs(scriptName, 'Exploration').then(data => {
      if (!cancelled) {
        setArgs(data)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [client, scriptName, refreshTick])

  const exp = args?.exploration_config ?? []
  const find = (name: string) => exp.find(a => a.name === name)

  const fmt = (v: unknown): string => {
    if (v === null || v === undefined) return '-'
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
  }

  return (
    <section className="card">
      <h2>探索28 预设</h2>
      {!scriptName ? (
        <div style={{ color: 'var(--text-dim)' }}>请先选择一个配置。</div>
      ) : loading && !args ? (
        <div style={{ color: 'var(--text-dim)' }}>正在读取 Exploration 参数…</div>
      ) : !args ? (
        <div style={{ color: 'var(--danger)' }}>
          读取参数失败，请查看底部日志或浏览器控制台。
        </div>
      ) : (
        <div className="card-grid">
          <Field label="探索章节" item={find('exploration_level')} fallback={fmt(undefined)} />
          <Field label="用户状态" item={find('user_status')} fallback={fmt(undefined)} />
          <Field label="战斗次数" item={find('minions_cnt')} fallback={fmt(undefined)} />
          <Field label="时间限制" item={find('limit_time')} fallback={fmt(undefined)} />
          <Field label="自动候补" item={find('auto_rotate')} fallback={fmt(undefined)} />
        </div>
      )}

      <div className="btn-row">
        <button
          type="button"
          className="btn primary"
          disabled={!scriptName || applying}
          onClick={onApplyPreset}
        >
          {applying ? '应用中…' : '应用探索28预设'}
        </button>
        <span style={{ color: 'var(--text-dim)', fontSize: 12, alignSelf: 'center' }}>
          预设：第二十八章 / 单人 / 30 次 / 30 分钟 / 关组队&绘卷&切魂
        </span>
      </div>
    </section>
  )
}

function Field({
  label,
  item,
  fallback,
}: {
  label: string
  item: ReturnType<TaskArgs[string]['find']> | undefined
  fallback: string
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
    displayValue = fallback
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
