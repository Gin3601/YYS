import { useEffect, useMemo, useState } from 'react'
import type { OasClient, TaskArgs } from '../api/oasClient'
import { EXPLORATION_DEFAULTS, type ExplorationPresetValues } from '../api/oasClient'
import {
  loadPresetDraft, savePresetDraft, clearPresetDraft,
  validateTimeString, validateNumberRange,
  valuesEqual, normalizeForCompare,
  offsetToNextRunString, ORDER_OPTIONS,
} from '../api/presetStorage'

interface Props {
  client: OasClient
  scriptName: string | null
  /** 父组件用 refreshTick 触发卡片重新拉一次 args */
  refreshTick: number
  /** 点击「应用预设」时父组件接收用户当前编辑的值并写入后端 */
  onApplyPreset: (values: ExplorationPresetValues) => void
  applying: boolean
}

// 28 个章节固定罗列，与 ExplorationLevel enum 对齐
const EXPLORATION_LEVELS = Array.from({ length: 28 }, (_, i) => {
  const num = i + 1
  // 与后端 enum 文字一致：第一章 / 第二章 / ... / 第二十八章
  const cn = num < 11
    ? ['一','二','三','四','五','六','七','八','九','十'][num - 1]
    : num < 20
      ? `十${['','一','二','三','四','五','六','七','八','九'][num - 10]}`
      : `二十${['','一','二','三','四','五','六','七','八'][num - 20]}`
  return `第${cn}章`
})

const USER_STATUS_OPTS: Array<{ value: string; label: string }> = [
  { value: 'alone',  label: '单人' },
  { value: 'leader', label: '队长' },
  { value: 'member', label: '队员' },
]

const AUTO_ROTATE_OPTS: Array<{ value: string; label: string }> = [
  { value: '不', label: '不添加' },
  { value: '是', label: '添加候补' },
]

// 本地草稿 = 用户编辑的字段 + UI 状态（orderOffset）。
// orderOffset 不发给后端，只是 UI 用来记住用户上次选了哪个执行顺序；
// 真正发的是 offsetToNextRunString(orderOffset) → next_run。
type Draft = ExplorationPresetValues & { _orderOffset?: number }

export function ExplorationPresetCard({
  client,
  scriptName,
  refreshTick,
  onApplyPreset,
  applying,
}: Props) {
  const [args, setArgs] = useState<TaskArgs | null>(null)
  const [loading, setLoading] = useState(false)

  // 用户编辑的本地状态——初值来自后端 args，可被用户改写
  const [explorationLevel, setExplorationLevel] = useState(EXPLORATION_DEFAULTS.exploration_level)
  const [userStatus,       setUserStatus]       = useState(EXPLORATION_DEFAULTS.user_status)
  const [minionsCnt,       setMinionsCnt]       = useState<number>(EXPLORATION_DEFAULTS.minions_cnt)
  const [limitTime,        setLimitTime]        = useState(EXPLORATION_DEFAULTS.limit_time)
  const [autoRotate,       setAutoRotate]       = useState(EXPLORATION_DEFAULTS.auto_rotate)
  const [orderOffset,      setOrderOffset]      = useState<number>(0)  // 默认队首

  useEffect(() => {
    if (!scriptName) {
      setArgs(null)
      return
    }
    const abort = new AbortController()
    setLoading(true)
    client.getTaskArgs(scriptName, 'Exploration', { signal: abort.signal }).then(data => {
      if (abort.signal.aborted) return
      setArgs(data)
      setLoading(false)
      // 初始化优先级：localStorage 草稿 > 后端当前值 > 内置默认
      const draft = loadPresetDraft<Draft>(scriptName, 'exploration')
      if (data) {
        const exp = data.exploration_config ?? []
        const pick = <T,>(name: string, fallback: T): T => {
          const v = exp.find(a => a.name === name)?.value
          return (v === null || v === undefined) ? fallback : (v as T)
        }
        setExplorationLevel(draft?.exploration_level ?? pick('exploration_level', EXPLORATION_DEFAULTS.exploration_level))
        setUserStatus(draft?.user_status ?? pick('user_status', EXPLORATION_DEFAULTS.user_status))
        setMinionsCnt(draft?.minions_cnt ?? Number(pick('minions_cnt', EXPLORATION_DEFAULTS.minions_cnt)))
        setLimitTime(draft?.limit_time ?? String(pick('limit_time', EXPLORATION_DEFAULTS.limit_time)))
        setAutoRotate(draft?.auto_rotate ?? pick('auto_rotate', EXPLORATION_DEFAULTS.auto_rotate))
        setOrderOffset(draft?._orderOffset ?? 0)
      }
    })
    return () => { abort.abort() }
  }, [client, scriptName, refreshTick])

  // 每次本地编辑变化都暂存草稿，刷新页面 / 切配置后也能恢复
  useEffect(() => {
    if (!scriptName) return
    savePresetDraft<Draft>(scriptName, 'exploration', {
      exploration_level: explorationLevel,
      user_status: userStatus,
      minions_cnt: minionsCnt,
      limit_time: limitTime,
      auto_rotate: autoRotate,
      _orderOffset: orderOffset,
    })
  }, [scriptName, explorationLevel, userStatus, minionsCnt, limitTime, autoRotate, orderOffset])

  // 抽取后端当前值用于差异比对（args 变化时记忆化）
  const backendValues = useMemo(() => {
    if (!args) return null
    const exp = args.exploration_config ?? []
    const get = (name: string) => exp.find(a => a.name === name)?.value
    return {
      exploration_level: get('exploration_level'),
      user_status: get('user_status'),
      minions_cnt: get('minions_cnt'),
      limit_time: get('limit_time'),
      auto_rotate: get('auto_rotate'),
    }
  }, [args])

  // 统计本地值与后端值的差异数（仅用户可调字段；scheduler 等总是会写）
  const diffCount = useMemo(() => {
    if (!backendValues) return 0
    let n = 0
    if (!valuesEqual(explorationLevel, backendValues.exploration_level)) n++
    if (!valuesEqual(userStatus,       backendValues.user_status))       n++
    if (!valuesEqual(minionsCnt,       backendValues.minions_cnt))       n++
    if (!valuesEqual(limitTime,        backendValues.limit_time))        n++
    if (!valuesEqual(autoRotate,       backendValues.auto_rotate))       n++
    return n
  }, [backendValues, explorationLevel, userStatus, minionsCnt, limitTime, autoRotate])

  const disabled = !scriptName || applying || !args

  const handleApply = () => {
    // 前端校验 —— 后端会拒，但提前拦下能省一次网络往返、提示更友好
    const issues = [
      validateTimeString('时间限制', limitTime),
      validateNumberRange('战斗次数', minionsCnt, 0, 9999),
    ].filter(Boolean)
    if (issues.length > 0) {
      alert(issues.map(i => i!.message).join('\n'))
      return
    }
    onApplyPreset({
      exploration_level: explorationLevel,
      user_status: userStatus,
      minions_cnt: minionsCnt,
      limit_time: limitTime,
      auto_rotate: autoRotate,
      next_run: offsetToNextRunString(orderOffset),
    })
  }

  // 清掉本地草稿、重置回后端值
  const handleReset = () => {
    if (!scriptName || !backendValues) return
    if (diffCount > 0 && !window.confirm(`将丢弃 ${diffCount} 处本地编辑，恢复为后端当前值？`)) return
    clearPresetDraft(scriptName, 'exploration')
    if (backendValues.exploration_level != null)
      setExplorationLevel(String(backendValues.exploration_level))
    if (backendValues.user_status != null)
      setUserStatus(String(backendValues.user_status))
    if (backendValues.minions_cnt != null)
      setMinionsCnt(Number(backendValues.minions_cnt))
    if (backendValues.limit_time != null)
      setLimitTime(String(backendValues.limit_time))
    if (backendValues.auto_rotate != null)
      setAutoRotate(String(backendValues.auto_rotate))
  }

  // 单独抽个组件，避免每个 field 都重复 diff 渲染逻辑
  const DiffHint = ({ backend }: { backend: unknown }) => {
    if (backend === null || backend === undefined) return null
    return <span className="field-diff">当前：{normalizeForCompare(backend) || '(空)'}</span>
  }

  return (
    <section className="card">
      <h2>探索28 · 预设
        <span className="deco">❀</span>
      </h2>

      {!scriptName ? (
        <div style={{ color: 'var(--text-dim)' }}>请先选择一个配置。</div>
      ) : loading && !args ? (
        <div style={{ color: 'var(--text-dim)' }}>正在读取 Exploration 参数…</div>
      ) : !args ? (
        <div style={{ color: 'var(--danger)' }}>
          读取参数失败，请查看底部日志或浏览器控制台。
        </div>
      ) : (
        <div className="card-grid tabular">
          <div className="field">
            <span className="label">探索章节</span>
            <span className="value">
              <select
                className="input"
                value={explorationLevel}
                disabled={disabled}
                onChange={e => setExplorationLevel(e.target.value)}
              >
                {EXPLORATION_LEVELS.map(lv => (
                  <option key={lv} value={lv}>{lv}</option>
                ))}
              </select>
              {!valuesEqual(explorationLevel, backendValues?.exploration_level) &&
                <DiffHint backend={backendValues?.exploration_level} />}
            </span>
          </div>

          <div className="field">
            <span className="label">用户状态</span>
            <span className="value">
              <select
                className="input"
                value={userStatus}
                disabled={disabled}
                onChange={e => setUserStatus(e.target.value)}
              >
                {USER_STATUS_OPTS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {!valuesEqual(userStatus, backendValues?.user_status) &&
                <DiffHint backend={backendValues?.user_status} />}
            </span>
          </div>

          <div className="field">
            <span className="label">战斗次数</span>
            <span className="value">
              <input
                className="input"
                type="number"
                min={0}
                value={minionsCnt}
                disabled={disabled}
                onChange={e => setMinionsCnt(Math.max(0, parseInt(e.target.value || '0', 10)))}
              />
              {!valuesEqual(minionsCnt, backendValues?.minions_cnt) &&
                <DiffHint backend={backendValues?.minions_cnt} />}
            </span>
          </div>

          <div className="field">
            <span className="label">时间限制</span>
            <span className="value">
              <input
                className="input"
                type="text"
                placeholder="HH:MM:SS"
                value={limitTime}
                disabled={disabled}
                onChange={e => setLimitTime(e.target.value)}
              />
              {!valuesEqual(limitTime, backendValues?.limit_time) &&
                <DiffHint backend={backendValues?.limit_time} />}
            </span>
          </div>

          <div className="field">
            <span className="label">自动候补</span>
            <span className="value">
              <select
                className="input"
                value={autoRotate}
                disabled={disabled}
                onChange={e => setAutoRotate(e.target.value)}
              >
                {AUTO_ROTATE_OPTS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {!valuesEqual(autoRotate, backendValues?.auto_rotate) &&
                <DiffHint backend={backendValues?.auto_rotate} />}
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
          稳定性默认：关组队 / 绘卷 / 切魂
        </span>
      </div>
    </section>
  )
}
