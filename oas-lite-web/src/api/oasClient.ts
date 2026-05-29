/**
 * OAS 后端 API 客户端。
 *
 * 设计原则：
 * - 只读 / 写 OAS 已暴露的接口，不假设字段名。
 * - 所有 fetch 都包 try/catch，错误以 LogEvent 形式回调（由调用方决定打到 UI 还是 console）。
 * - 探索28 预设是一个「尽力而为」的过程：单条字段失败不会中止其他字段写入，
 *   每条都会发出独立日志。
 *
 * 后端 API（已通过阅读源码确认）：
 *   GET    /test
 *   GET    /config_list                                              -> string[]
 *   GET    /script_menu                                              -> object
 *   GET    /{script}/{task}/args                                     -> Record<group, ArgItem[]>
 *   PUT    /{script}/{task}/{group}/{argument}/value?types=&value=   -> bool
 *   GET    /{script}/start
 *   GET    /{script}/stop
 *   WS     /ws/{script}    ← 服务端会广播 {state: number} / {schedule: ...}
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'success'

export interface LogEvent {
  ts: number
  level: LogLevel
  message: string
}

export type LogSink = (e: LogEvent) => void

const noopSink: LogSink = () => {}

function emit(sink: LogSink, level: LogLevel, message: string) {
  const e = { ts: Date.now(), level, message }
  try { sink(e) } catch { /* sink itself failed, swallow */ }
  // 同时打到浏览器控制台，便于排查
  const fn = level === 'error' ? console.error
           : level === 'warn'  ? console.warn
           : console.log
  fn(`[oas] ${message}`)
}

/** 后端返回的单个参数描述（来源：module/config/config_model.py::script_task） */
export interface ArgItem {
  name: string
  title?: string
  description?: string
  default: unknown
  value: unknown
  /** "integer" | "number" | "boolean" | "string" | "enum" | "object" | ... */
  type: string
  enumEnum?: string[]
}

export type TaskArgs = Record<string, ArgItem[]>

/** PUT /value 端点接受的 types 字符串（来源：script_router.py 的 match） */
export type OasArgType =
  | 'integer'
  | 'number'
  | 'boolean'
  | 'string'
  | 'date_time'
  | 'time_delta'
  | 'time'
  | 'enum'

export interface OasClientOptions {
  baseUrl?: string
  sink?: LogSink
}

export class OasClient {
  readonly baseUrl: string
  private sink: LogSink

  constructor(opts: OasClientOptions = {}) {
    const raw = opts.baseUrl
      ?? import.meta.env.VITE_OAS_BASE_URL
      ?? 'http://127.0.0.1:22267'
    // 去掉末尾斜杠，方便拼接
    this.baseUrl = raw.replace(/\/+$/, '')
    this.sink = opts.sink ?? noopSink
  }

  setSink(sink: LogSink) { this.sink = sink }

  /** 把 http(s):// 替换成 ws(s)://，用于 WebSocket 连接 */
  wsBaseUrl(): string {
    return this.baseUrl.replace(/^http/i, 'ws')
  }

  // ---------------------------------- 基础 ----------------------------------

  async testBackend(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/test`)
      if (!res.ok) {
        emit(this.sink, 'warn', `GET /test 返回 ${res.status}`)
        return false
      }
      const txt = await res.text()
      emit(this.sink, 'success', `后端已连接 (/test → ${txt.slice(0, 40)})`)
      return true
    } catch (err) {
      emit(this.sink, 'error', `连接后端失败：${String(err)}`)
      return false
    }
  }

  async getConfigList(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/config_list`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data)) {
        emit(this.sink, 'warn', `GET /config_list 返回非数组：${JSON.stringify(data)}`)
        return []
      }
      emit(this.sink, 'info', `获取配置列表：[${data.join(', ')}]`)
      return data as string[]
    } catch (err) {
      emit(this.sink, 'error', `GET /config_list 失败：${String(err)}`)
      return []
    }
  }

  async getScriptMenu(): Promise<unknown> {
    try {
      const res = await fetch(`${this.baseUrl}/script_menu`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      emit(this.sink, 'error', `GET /script_menu 失败：${String(err)}`)
      return null
    }
  }

  // ------------------------------ 任务参数 ----------------------------------

  /**
   * 读取一个任务的全部字段结构 + 当前值。
   *
   * 可选传入 AbortSignal —— 调用方在切配置 / 卸载组件时 abort() 能让在途请求
   * 立刻终止，避免旧请求的响应落到新 UI 上（典型 stale-response 竞态）。
   */
  async getTaskArgs(
    scriptName: string,
    taskName: string,
    opts: { signal?: AbortSignal } = {},
  ): Promise<TaskArgs | null> {
    try {
      const url = `${this.baseUrl}/${encodeURIComponent(scriptName)}/${encodeURIComponent(taskName)}/args`
      const res = await fetch(url, { signal: opts.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      emit(this.sink, 'info',
        `读取 ${taskName} 参数结构成功（groups: ${Object.keys(data).join(', ')}）`)
      return data as TaskArgs
    } catch (err) {
      // AbortError 是正常取消，不算"失败"，静默吞掉
      if (err instanceof DOMException && err.name === 'AbortError') return null
      emit(this.sink, 'error', `GET /{config}/${taskName}/args 失败：${String(err)}`)
      return null
    }
  }

  /**
   * 写入单个参数。
   *
   * 后端签名（script_router.py）：
   *   PUT /{script_name}/{task}/{group}/{argument}/value?types=<type>&value=<value>
   *
   * 注意 value 是 query 参数，所以这里把它编码到 URL 上。
   */
  async updateTaskArg(
    scriptName: string,
    taskName: string,
    group: string,
    argument: string,
    value: unknown,
    type: OasArgType,
  ): Promise<boolean> {
    const url = new URL(
      `${this.baseUrl}/${encodeURIComponent(scriptName)}/${encodeURIComponent(taskName)}/${encodeURIComponent(group)}/${encodeURIComponent(argument)}/value`,
    )
    url.searchParams.set('types', type)
    url.searchParams.set('value', String(value))

    try {
      const res = await fetch(url.toString(), { method: 'PUT' })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        emit(this.sink, 'error',
          `写入失败 ${group}.${argument} = ${String(value)} (HTTP ${res.status}) ${text}`)
        return false
      }
      // 后端返回布尔；deep_set 成功返回 true
      const ok = await res.json().catch(() => true)
      if (ok === false) {
        emit(this.sink, 'warn',
          `写入返回 false：${group}.${argument} = ${String(value)}（字段不存在？）`)
        return false
      }
      emit(this.sink, 'success',
        `写入成功 ${group}.${argument} = ${String(value)} [${type}]`)
      return true
    } catch (err) {
      emit(this.sink, 'error',
        `写入异常 ${group}.${argument}：${String(err)}`)
      return false
    }
  }

  /**
   * 批量写入字段。后端 PUT /{script}/{task}/batch 接受 list[{group,argument,value,types}]
   * 返回 list[{group,argument,ok,error?}]。
   *
   * `batchSupported` 用于记忆探测结果：若后端返回 404（旧版本），后续调用直接走 per-field
   * 路径，避免重复探测。
   */
  private batchSupported: boolean | null = null

  async updateTaskArgsBatch(
    scriptName: string,
    taskName: string,
    items: Array<{ group: string; argument: string; value: unknown; types: OasArgType }>,
  ): Promise<{ supported: boolean; results: Array<{ group: string; argument: string; ok: boolean; error?: string }> }> {
    if (this.batchSupported === false) {
      return { supported: false, results: [] }
    }
    const url = `${this.baseUrl}/${encodeURIComponent(scriptName)}/${encodeURIComponent(taskName)}/batch`
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items),
      })
      if (res.status === 404 || res.status === 405) {
        // 旧后端没这个端点 —— 记下来，下次直接回退
        this.batchSupported = false
        emit(this.sink, 'info', '后端未提供 batch 端点，回退到逐字段 PUT')
        return { supported: false, results: [] }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        emit(this.sink, 'error', `batch 写入失败 HTTP ${res.status} ${text}`)
        // 不把 batchSupported 置 false —— 这次失败可能只是网络抖动
        return { supported: true, results: [] }
      }
      const data = await res.json()
      if (!Array.isArray(data)) {
        emit(this.sink, 'warn', `batch 返回非数组：${JSON.stringify(data)}`)
        return { supported: true, results: [] }
      }
      this.batchSupported = true
      return { supported: true, results: data }
    } catch (err) {
      emit(this.sink, 'error', `batch 请求异常：${String(err)}`)
      return { supported: true, results: [] }
    }
  }

  // ---------------------------- 脚本启动 / 停止 ----------------------------

  async startScript(scriptName: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/${encodeURIComponent(scriptName)}/start`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      emit(this.sink, 'success', `已请求启动脚本：${scriptName}`)
      return true
    } catch (err) {
      emit(this.sink, 'error', `启动失败：${String(err)}`)
      return false
    }
  }

  async stopScript(scriptName: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/${encodeURIComponent(scriptName)}/stop`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      emit(this.sink, 'success', `已请求停止脚本：${scriptName}`)
      return true
    } catch (err) {
      emit(this.sink, 'error', `停止失败：${String(err)}`)
      return false
    }
  }

  // ------------------------------- WebSocket -------------------------------

  createStatusWebSocket(scriptName: string): WebSocket {
    const url = `${this.wsBaseUrl()}/ws/${encodeURIComponent(scriptName)}`
    emit(this.sink, 'info', `WS 连接 ${url}`)
    return new WebSocket(url)
  }

  // ============================ 探索28 预设 ================================

  /**
   * 一键应用「探索28」预设。
   *
   * 关键设计：**不硬编码字段名**——先 GET .../args 拿到结构，再按 group→arg 写入。
   * 每个字段独立处理，缺失字段会发出 warn 但不中断其他写入。
   *
   * `overrides` 让 UI 覆盖用户可调字段；其余「稳定性默认值」（buff_*、绘卷、切魂等）
   * 仍硬编码为 false，避免暴露太多无关选项。
   *
   * **链接模式**：不再禁用 RealmRaid —— 两个预设可以共存，调度器自动串行排队。
   * 用户如果想要互斥行为，得在 OASX/fluentui 里手动关掉另一个 scheduler。
   *
   * 注意：**不会禁用 Restart 任务**。Restart 是 OAS 的守护任务，
   * 负责掉线/未启动时把游戏拉起来；禁用它会导致脚本断连后无法自愈。
   */
  async applyExploration28Preset(
    scriptName: string,
    overrides: ExplorationPresetValues = {},
  ): Promise<{
    success: number
    failed: number
    missing: string[]
  }> {
    const v = { ...EXPLORATION_DEFAULTS, ...overrides }

    type Plan = [task: string, group: string, argument: string, value: unknown, type: OasArgType]
    const plan: Plan[] = [
      // 调度：启用 Exploration，next_run 由 UI 控制（默认过去 → 立刻就绪）
      ['Exploration', 'scheduler', 'enable', true, 'boolean'],
      ['Exploration', 'scheduler', 'next_run', v.next_run, 'date_time'],
      // 不再动 RealmRaid.scheduler.enable —— 让两个任务共存
      // 不动 Restart.scheduler.enable —— 它是守护任务

      // 用户可调字段（来自 overrides）
      ['Exploration', 'exploration_config', 'exploration_level', v.exploration_level, 'string'],
      ['Exploration', 'exploration_config', 'user_status',       v.user_status,       'string'],
      ['Exploration', 'exploration_config', 'minions_cnt',       v.minions_cnt,       'integer'],
      ['Exploration', 'exploration_config', 'limit_time',        v.limit_time,        'time'],
      ['Exploration', 'exploration_config', 'auto_rotate',       v.auto_rotate,       'string'],

      // 稳定性默认：关闭加成、绘卷、切魂
      ['Exploration', 'exploration_config', 'buff_gold_50_click',  false, 'boolean'],
      ['Exploration', 'exploration_config', 'buff_gold_100_click', false, 'boolean'],
      ['Exploration', 'exploration_config', 'buff_exp_50_click',   false, 'boolean'],
      ['Exploration', 'exploration_config', 'buff_exp_100_click',  false, 'boolean'],
      ['Exploration', 'scrolls',            'scrolls_enable',       false, 'boolean'],
      ['Exploration', 'switch_soul_config', 'enable',               false, 'boolean'],
      ['Exploration', 'switch_soul_config', 'enable_switch_by_name', false, 'boolean'],
    ]

    return this.applyPresetPlan(scriptName, plan, '探索28')
  }

  /**
   * 一键应用「个人突破」预设。
   *
   * `overrides` 让 UI 覆盖用户可调字段；其余「稳定性默认值」
   * （switch_soul_*）仍硬编码为 false。
   *
   * **链接模式**：不再禁用 Exploration —— 两个预设可以共存（同上）。
   *
   * 注意：**不会禁用 Restart 任务**（同上）。
   */
  async applyRealmRaidPreset(
    scriptName: string,
    overrides: RealmRaidPresetValues = {},
  ): Promise<{
    success: number
    failed: number
    missing: string[]
  }> {
    const v = { ...REALM_RAID_DEFAULTS, ...overrides }

    type Plan = [task: string, group: string, argument: string, value: unknown, type: OasArgType]
    const plan: Plan[] = [
      ['RealmRaid', 'scheduler', 'enable', true, 'boolean'],
      ['RealmRaid', 'scheduler', 'next_run', v.next_run, 'date_time'],
      // 不再动 Exploration.scheduler.enable —— 让两个任务共存

      // 用户可调字段
      ['RealmRaid', 'raid_config', 'number_attack',    v.number_attack,    'integer'],
      ['RealmRaid', 'raid_config', 'number_base',      v.number_base,      'integer'],
      ['RealmRaid', 'raid_config', 'exit_four',        v.exit_four,        'boolean'],
      ['RealmRaid', 'raid_config', 'order_attack',     v.order_attack,     'string'],
      ['RealmRaid', 'raid_config', 'three_refresh',    v.three_refresh,    'boolean'],
      ['RealmRaid', 'raid_config', 'when_attack_fail', v.when_attack_fail, 'string'],

      // 稳定性默认
      ['RealmRaid', 'switch_soul_config', 'enable',               false, 'boolean'],
      ['RealmRaid', 'switch_soul_config', 'enable_switch_by_name', false, 'boolean'],
    ]

    return this.applyPresetPlan(scriptName, plan, '个人突破')
  }

  /**
   * 内部：把 plan 数组依次写入后端。
   *
   * 优先走 batch 端点（按 task 分组、每个 task 一次请求），
   * batch 不可用时退化为逐字段 PUT —— 这样旧版本后端仍能正常工作。
   *
   * 不论走哪条路径，所有"字段不在 args 里"的检测都先做一遍，
   * 避免给后端发已知会失败的写入。
   */
  private async applyPresetPlan(
    scriptName: string,
    plan: Array<[string, string, string, unknown, OasArgType]>,
    presetName: string,
  ): Promise<{ success: number; failed: number; missing: string[] }> {
    const taskArgs = new Map<string, TaskArgs>()
    const getArgs = async (task: string): Promise<TaskArgs | null> => {
      const cached = taskArgs.get(task)
      if (cached) return cached
      const args = await this.getTaskArgs(scriptName, task)
      if (args) taskArgs.set(task, args)
      return args
    }

    // 第一阶段：按 task 分组，过滤掉本地能确认不存在的字段
    type Entry = { task: string; group: string; argument: string; value: unknown; type: OasArgType }
    const byTask = new Map<string, Entry[]>()
    const missing: string[] = []

    for (const [task, group, argument, value, type] of plan) {
      const args = await getArgs(task)
      if (!args) {
        emit(this.sink, 'error', `预设跳过：读取 ${task} 参数结构失败`)
        missing.push(`${task}.${group}.${argument}`)
        continue
      }
      const groupList = args[group]
      if (!groupList) {
        emit(this.sink, 'warn',
          `预设跳过：${task} 未找到 group "${group}"。可用 group：[${Object.keys(args).join(', ')}]`)
        missing.push(`${task}.${group}.${argument}`)
        continue
      }
      if (!groupList.find(a => a.name === argument)) {
        emit(this.sink, 'warn',
          `预设跳过：${task}.${group} 下未找到字段 "${argument}"。可用字段：[${groupList.map(a => a.name).join(', ')}]`)
        missing.push(`${task}.${group}.${argument}`)
        continue
      }
      if (!byTask.has(task)) byTask.set(task, [])
      byTask.get(task)!.push({ task, group, argument, value, type })
    }

    // 第二阶段：先试 batch，每个 task 一次请求
    let success = 0
    let failed = 0
    const pendingPerField: Entry[] = []

    for (const [task, entries] of byTask) {
      const batch = await this.updateTaskArgsBatch(
        scriptName,
        task,
        entries.map(e => ({ group: e.group, argument: e.argument, value: e.value, types: e.type })),
      )
      if (!batch.supported) {
        // 后端没 batch 端点 —— 把这一批挪到 fallback 队列
        pendingPerField.push(...entries)
        continue
      }
      if (batch.results.length === 0) {
        // batch 请求本身失败（网络/500）—— 这批写入未尝试，记为 failed
        emit(this.sink, 'error', `[${task}] batch 请求失败，本批 ${entries.length} 个字段未写入`)
        failed += entries.length
        continue
      }
      // batch 成功：逐条比对结果
      for (const e of entries) {
        const r = batch.results.find(x => x.group === e.group && x.argument === e.argument)
        if (r && r.ok) {
          emit(this.sink, 'success', `[batch] ${task}.${e.group}.${e.argument} = ${String(e.value)} ✓`)
          success++
        } else {
          emit(this.sink, 'error', `[batch] ${task}.${e.group}.${e.argument} 失败：${r?.error ?? '未返回结果'}`)
          failed++
        }
      }
    }

    // 第三阶段：fallback —— 逐字段 PUT
    for (const e of pendingPerField) {
      emit(this.sink, 'info', `[per-field] ${e.task}.${e.group}.${e.argument} = ${String(e.value)} (type=${e.type})`)
      const ok = await this.updateTaskArg(scriptName, e.task, e.group, e.argument, e.value, e.type)
      if (ok) success++; else failed++
    }

    emit(this.sink, success > 0 && failed === 0 ? 'success' : 'warn',
      `${presetName} 预设应用完成：成功 ${success}，失败 ${failed}，跳过 ${missing.length}`)
    return { success, failed, missing }
  }
}

// ============================ 预设的可调字段类型 ============================

/**
 * 预设里 next_run 的特殊含义：
 *   - '2023-01-01 00:00:00'（过去时间）→ "立刻就绪"，被调度器立即挑出
 *   - 'YYYY-MM-DD HH:MM:SS'（未来时间）→ 推后到该时刻才会被挑
 *
 * 把它从硬编码改成可覆盖，目的是给"链接模式"下两个任务排序：
 *   想让 Exploration 先跑、RR 5 分钟后跑 → RR 的 next_run 设成 5 分钟后即可
 */

export interface ExplorationPresetValues {
  exploration_level?: string   // 探索章节文字，如 '第二十八章'
  user_status?: string         // 'alone' | 'leader' | 'member'
  minions_cnt?: number         // 战斗次数（≥ 0）
  limit_time?: string          // 时间限制 'HH:MM:SS'
  auto_rotate?: string         // '不' | '是'
  next_run?: string            // 'YYYY-MM-DD HH:MM:SS'；默认过去 → 立刻
}

export const EXPLORATION_DEFAULTS: Required<ExplorationPresetValues> = {
  exploration_level: '第二十八章',
  user_status: 'alone',
  minions_cnt: 50,
  limit_time: '00:50:00',
  auto_rotate: '不',
  next_run: '2023-01-01 00:00:00',
}

export interface RealmRaidPresetValues {
  number_attack?: number       // 挑战次数 1-30
  number_base?: number         // 最低保留票数 0-20
  exit_four?: boolean          // 退四打九
  order_attack?: string        // 进攻顺序，如 '5 > 4 > 3 > 2 > 1 > 0'
  three_refresh?: boolean      // 三票刷新
  when_attack_fail?: string    // 'Exit' | 'Continue' | 'Refresh'
  next_run?: string            // 'YYYY-MM-DD HH:MM:SS'；默认过去 → 立刻
}

export const REALM_RAID_DEFAULTS: Required<RealmRaidPresetValues> = {
  number_attack: 30,
  number_base: 0,
  exit_four: true,
  order_attack: '5 > 4 > 3 > 2 > 1 > 0',
  three_refresh: false,
  when_attack_fail: 'Refresh',
  next_run: '2023-01-01 00:00:00',
}

/** 单例：在整个 App 共享同一个客户端。 */
let _singleton: OasClient | null = null
export function getOasClient(sink?: LogSink): OasClient {
  if (!_singleton) _singleton = new OasClient({ sink })
  else if (sink) _singleton.setSink(sink)
  return _singleton
}
