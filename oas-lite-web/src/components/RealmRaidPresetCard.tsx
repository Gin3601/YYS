import { useEffect, useMemo, useState } from 'react'
import type { OasClient, TaskArgs } from '../api/oasClient'
import { REALM_RAID_DEFAULTS, type RealmRaidPresetValues } from '../api/oasClient'
import {
  loadPresetDraft, savePresetDraft, clearPresetDraft,
  validateNumberRange, validateNonEmpty,
  valuesEqual, normalizeForCompare,
  offsetToNextRunString, ORDER_OPTIONS,
} from '../api/presetStorage'

interface Props {
  client: OasClient
  scriptName: string | null
  refreshTick: number
  onApplyPreset: (values: RealmRaidPresetValues) => void
  applying: boolean
}

const WHEN_FAIL_OPTS: Array<{ value: string; label: string }> = [
  { value: 'Refresh',  label: '刷新' },
  { value: 'Continue', label: '继续' },
  { value: 'Exit',     label: '退出' },
]

// orderOffset 不发后端，仅 UI 记忆；真正发的是 offsetToNextRunString(orderOffset)
type Draft = RealmRaidPresetValues & { _orderOffset?: number }

export function RealmRaidPresetCard({
  client,
  scriptName,
  refreshTick,
  onApplyPreset,
  applying,
}: Props) {
  const [args, setArgs] = useState<TaskArgs | null>(null)
  const [loading, setLoading] = useState(false)

  const [numberAttack,   setNumberAttack]   = useState<number>(REALM_RAID_DEFAULTS.number_attack)
  const [numberBase,     setNumberBase]     = useState<number>(REALM_RAID_DEFAULTS.number_base)
  const [exitFour,       setExitFour]       = useState<boolean>(REALM_RAID_DEFAULTS.exit_four)
  const [orderAttack,    setOrderAttack]    = useState(REALM_RAID_DEFAULTS.order_attack)
  const [threeRefresh,   setThreeRefresh]   = useState<boolean>(REALM_RAID_DEFAULTS.three_refresh)
  const [whenAttackFail, setWhenAttackFail] = useState(REALM_RAID_DEFAULTS.when_attack_fail)
  const [orderOffset,    setOrderOffset]    = useState<number>(0)

  useEffect(() => {
    if (!scriptName) {
      setArgs(null)
      return
    }
    const abort = new AbortController()
    setLoading(true)
    client.getTaskArgs(scriptName, 'RealmRaid', { signal: abort.signal }).then(data => {
      if (abort.signal.aborted) return
      setArgs(data)
      setLoading(false)
      const draft = loadPresetDraft<Draft>(scriptName, 'realmRaid')
      if (data) {
        const raid = data.raid_config ?? []
        const pick = <T,>(name: string, fallback: T): T => {
          const v = raid.find(a => a.name === name)?.value
          return (v === null || v === undefined) ? fallback : (v as T)
        }
        setNumberAttack(draft?.number_attack ?? Number(pick('number_attack', REALM_RAID_DEFAULTS.number_attack)))
        setNumberBase(draft?.number_base ?? Number(pick('number_base', REALM_RAID_DEFAULTS.number_base)))
        setExitFour(draft?.exit_four ?? Boolean(pick('exit_four', REALM_RAID_DEFAULTS.exit_four)))
        setOrderAttack(draft?.order_attack ?? String(pick('order_attack', REALM_RAID_DEFAULTS.order_attack)))
        setThreeRefresh(draft?.three_refresh ?? Boolean(pick('three_refresh', REALM_RAID_DEFAULTS.three_refresh)))
        setWhenAttackFail(draft?.when_attack_fail ?? String(pick('when_attack_fail', REALM_RAID_DEFAULTS.when_attack_fail)))
        setOrderOffset(draft?._orderOffset ?? 0)
      }
    })
    return () => { abort.abort() }
  }, [client, scriptName, refreshTick])

  // 本地草稿持久化
  useEffect(() => {
    if (!scriptName) return
    savePresetDraft<Draft>(scriptName, 'realmRaid', {
      number_attack: numberAttack,
      number_base: numberBase,
      exit_four: exitFour,
      order_attack: orderAttack,
      three_refresh: threeRefresh,
      when_attack_fail: whenAttackFail,
      _orderOffset: orderOffset,
    })
  }, [scriptName, numberAttack, numberBase, exitFour, orderAttack, threeRefresh, whenAttackFail, orderOffset])

  const backendValues = useMemo(() => {
    if (!args) return null
    const raid = args.raid_config ?? []
    const get = (name: string) => raid.find(a => a.name === name)?.value
    return {
      number_attack: get('number_attack'),
      number_base: get('number_base'),
      exit_four: get('exit_four'),
      order_attack: get('order_attack'),
      three_refresh: get('three_refresh'),
      when_attack_fail: get('when_attack_fail'),
    }
  }, [args])

  const diffCount = useMemo(() => {
    if (!backendValues) return 0
    let n = 0
    if (!valuesEqual(numberAttack,   backendValues.number_attack))    n++
    if (!valuesEqual(numberBase,     backendValues.number_base))      n++
    if (!valuesEqual(exitFour,       backendValues.exit_four))        n++
    if (!valuesEqual(orderAttack,    backendValues.order_attack))     n++
    if (!valuesEqual(threeRefresh,   backendValues.three_refresh))    n++
    if (!valuesEqual(whenAttackFail, backendValues.when_attack_fail)) n++
    return n
  }, [backendValues, numberAttack, numberBase, exitFour, orderAttack, threeRefresh, whenAttackFail])

  const disabled = !scriptName || applying || !args

  const handleApply = () => {
    const issues = [
      validateNumberRange('挑战次数', numberAttack, 1, 30),
      validateNumberRange('最低票数', numberBase, 0, 20),
      validateNonEmpty('进攻顺序', orderAttack),
    ].filter(Boolean)
    if (issues.length > 0) {
      alert(issues.map(i => i!.message).join('\n'))
      return
    }
    onApplyPreset({
      number_attack: numberAttack,
      number_base: numberBase,
      exit_four: exitFour,
      order_attack: orderAttack,
      three_refresh: threeRefresh,
      when_attack_fail: whenAttackFail,
      next_run: offsetToNextRunString(orderOffset),
    })
  }

  const handleReset = () => {
    if (!scriptName || !backendValues) return
    if (diffCount > 0 && !window.confirm(`将丢弃 ${diffCount} 处本地编辑，恢复为后端当前值？`)) return
    clearPresetDraft(scriptName, 'realmRaid')
    if (backendValues.number_attack    != null) setNumberAttack(Number(backendValues.number_attack))
    if (backendValues.number_base      != null) setNumberBase(Number(backendValues.number_base))
    if (backendValues.exit_four        != null) setExitFour(Boolean(backendValues.exit_four))
    if (backendValues.order_attack     != null) setOrderAttack(String(backendValues.order_attack))
    if (backendValues.three_refresh    != null) setThreeRefresh(Boolean(backendValues.three_refresh))
    if (backendValues.when_attack_fail != null) setWhenAttackFail(String(backendValues.when_attack_fail))
  }

  const DiffHint = ({ backend }: { backend: unknown }) => {
    if (backend === null || backend === undefined) return null
    return <span className="field-diff">当前：{normalizeForCompare(backend) || '(空)'}</span>
  }

  return (
    <section className="card">
      <h2>个人突破 · 预设
        <span className="deco">❀</span>
      </h2>

      {!scriptName ? (
        <div style={{ color: 'var(--text-dim)' }}>请先选择一个配置。</div>
      ) : loading && !args ? (
        <div style={{ color: 'var(--text-dim)' }}>正在读取 RealmRaid 参数…</div>
      ) : !args ? (
        <div style={{ color: 'var(--danger)' }}>
          读取参数失败，请查看底部日志或浏览器控制台。
        </div>
      ) : (
        <div className="card-grid tabular">
          <div className="field">
            <span className="label">挑战次数</span>
            <span className="value">
              <input
                className="input"
                type="number"
                min={1}
                max={30}
                value={numberAttack}
                disabled={disabled}
                onChange={e => setNumberAttack(clamp(parseInt(e.target.value || '0', 10), 1, 30))}
              />
              {!valuesEqual(numberAttack, backendValues?.number_attack) &&
                <DiffHint backend={backendValues?.number_attack} />}
            </span>
          </div>

          <div className="field">
            <span className="label">最低票数</span>
            <span className="value">
              <input
                className="input"
                type="number"
                min={0}
                max={20}
                value={numberBase}
                disabled={disabled}
                onChange={e => setNumberBase(clamp(parseInt(e.target.value || '0', 10), 0, 20))}
              />
              {!valuesEqual(numberBase, backendValues?.number_base) &&
                <DiffHint backend={backendValues?.number_base} />}
            </span>
          </div>

          <div className="field">
            <span className="label">进攻顺序</span>
            <span className="value">
              <input
                className="input"
                type="text"
                placeholder="5 > 4 > 3 > 2 > 1 > 0"
                value={orderAttack}
                disabled={disabled}
                onChange={e => setOrderAttack(e.target.value)}
              />
              {!valuesEqual(orderAttack, backendValues?.order_attack) &&
                <DiffHint backend={backendValues?.order_attack} />}
            </span>
          </div>

          <div className="field">
            <span className="label">失败处理</span>
            <span className="value">
              <select
                className="input"
                value={whenAttackFail}
                disabled={disabled}
                onChange={e => setWhenAttackFail(e.target.value)}
              >
                {WHEN_FAIL_OPTS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {!valuesEqual(whenAttackFail, backendValues?.when_attack_fail) &&
                <DiffHint backend={backendValues?.when_attack_fail} />}
            </span>
          </div>

          <div className="field">
            <span className="label">退四打九</span>
            <span className="value">
              <label className="check-wrap">
                <input
                  type="checkbox"
                  checked={exitFour}
                  disabled={disabled}
                  onChange={e => setExitFour(e.target.checked)}
                />
                <span className="ck-label">{exitFour ? '启用' : '不启用'}</span>
              </label>
              {!valuesEqual(exitFour, backendValues?.exit_four) &&
                <DiffHint backend={backendValues?.exit_four} />}
            </span>
          </div>

          <div className="field">
            <span className="label">三票刷新</span>
            <span className="value">
              <label className="check-wrap">
                <input
                  type="checkbox"
                  checked={threeRefresh}
                  disabled={disabled}
                  onChange={e => setThreeRefresh(e.target.checked)}
                />
                <span className="ck-label">{threeRefresh ? '启用' : '不启用'}</span>
              </label>
              {!valuesEqual(threeRefresh, backendValues?.three_refresh) &&
                <DiffHint backend={backendValues?.three_refresh} />}
            </span>
          </div>

          <div className="field">
            <span className="label">执行顺序</span>
            <span className="value">
              <select
                className="input"
                value={orderOffset}
                disabled={disabled}
                onChange={e => setOrderOffset(Number(e.target.value))}
                title="链接模式下，两个任务都启用时谁先跑。选'队首'即立即排队；选'X 分钟后'则让另一个先跑。"
              >
                {ORDER_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </span>
          </div>
        </div>
      )}

      <div className="btn-row">
        <button
          type="button"
          className="btn primary"
          disabled={disabled}
          onClick={handleApply}
        >
          {applying ? '应用中…'
            : diffCount > 0 ? `◈ 应用预设 (${diffCount} 处差异)`
            : '◈ 应用预设'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled || diffCount === 0}
          onClick={handleReset}
          title="放弃本地编辑，恢复为后端当前值"
        >
          ↺ 重置编辑
        </button>
        <span className="hint">
          执行：{ORDER_OPTIONS.find(o => o.value === orderOffset)?.label ?? '队首'}
          {' · '}
          稳定性默认：不切魂
        </span>
      </div>
    </section>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}
