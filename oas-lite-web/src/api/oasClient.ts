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

  async getTaskArgs(scriptName: string, taskName: string): Promise<TaskArgs | null> {
    try {
      const url = `${this.baseUrl}/${encodeURIComponent(scriptName)}/${encodeURIComponent(taskName)}/args`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      emit(this.sink, 'info',
        `读取 ${taskName} 参数结构成功（groups: ${Object.keys(data).join(', ')}）`)
      return data as TaskArgs
    } catch (err) {
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
   * 预设内容：
   *   - Exploration.scheduler.enable         = true（加入调度器）
   *   - Restart.scheduler.enable             = false（避免启动时只排 Restart）
   *   - exploration_config.exploration_level = '第二十八章'
   *   - exploration_config.user_status       = 'alone'（单人）
   *   - exploration_config.minions_cnt       = 50
   *   - exploration_config.limit_time        = '00:50:00'（50 分钟）
   *   - exploration_config.auto_rotate       = '不'（不添加候补）
   *   - exploration_config.buff_*            = false（关闭加成稳定性优先）
   *   - scrolls.scrolls_enable               = false（关绘卷）
   *   - switch_soul_config.enable            = false（关切魂）
   *   - switch_soul_config.enable_switch_by_name = false
   *
   * 这些字段如果后端版本变了，前端会打日志告知，并继续处理其余字段。
   */
  async applyExploration28Preset(scriptName: string): Promise<{
    success: number
    failed: number
    missing: string[]
  }> {
    const taskArgs = new Map<string, TaskArgs>()
    const getArgs = async (task: string): Promise<TaskArgs | null> => {
      const cached = taskArgs.get(task)
      if (cached) return cached
      const args = await this.getTaskArgs(scriptName, task)
      if (args) taskArgs.set(task, args)
      return args
    }

    // 期望的目标值表 — 每条形如 [task, group, argument, value, type]
    type Plan = [task: string, group: string, argument: string, value: unknown, type: OasArgType]
    const plan: Plan[] = [
      ['Exploration', 'scheduler', 'enable', true, 'boolean'],
      ['Exploration', 'scheduler', 'next_run', '2023-01-01 00:00:00', 'date_time'],
      ['RealmRaid', 'scheduler', 'enable', false, 'boolean'],
      ['Restart', 'scheduler', 'enable', false, 'boolean'],
      ['Exploration', 'exploration_config', 'exploration_level', '第二十八章', 'string'],
      ['Exploration', 'exploration_config', 'user_status',       'alone',     'string'],
      ['Exploration', 'exploration_config', 'minions_cnt',       50,           'integer'],
      ['Exploration', 'exploration_config', 'limit_time',        '00:50:00',   'time'],
      ['Exploration', 'exploration_config', 'auto_rotate',       '不',         'string'],
      ['Exploration', 'exploration_config', 'buff_gold_50_click',  false, 'boolean'],
      ['Exploration', 'exploration_config', 'buff_gold_100_click', false, 'boolean'],
      ['Exploration', 'exploration_config', 'buff_exp_50_click',   false, 'boolean'],
      ['Exploration', 'exploration_config', 'buff_exp_100_click',  false, 'boolean'],
      ['Exploration', 'scrolls',            'scrolls_enable',       false, 'boolean'],
      ['Exploration', 'switch_soul_config', 'enable',               false, 'boolean'],
      ['Exploration', 'switch_soul_config', 'enable_switch_by_name', false, 'boolean'],
    ]

    let success = 0
    let failed = 0
    const missing: string[] = []

    for (const [task, group, argument, value, type] of plan) {
      const args = await getArgs(task)
      if (!args) {
        emit(this.sink, 'error', `预设跳过：读取 ${task} 参数结构失败`)
        failed++
        continue
      }
      const groupList = args[group]
      if (!groupList) {
        emit(this.sink, 'warn',
          `预设跳过：${task} 未找到 group "${group}"。可用 group：[${Object.keys(args).join(', ')}]`)
        missing.push(`${task}.${group}.${argument}`)
        continue
      }
      const found = groupList.find(a => a.name === argument)
      if (!found) {
        emit(this.sink, 'warn',
          `预设跳过：${task}.${group} 下未找到字段 "${argument}"。可用字段：[${groupList.map(a => a.name).join(', ')}]`)
        missing.push(`${task}.${group}.${argument}`)
        continue
      }
      emit(this.sink, 'info',
        `[preset] writing ${task}.${group}.${argument} = ${String(value)} (type=${type})`)
      const ok = await this.updateTaskArg(scriptName, task, group, argument, value, type)
      if (ok) success++; else failed++
    }

    emit(this.sink, success > 0 && failed === 0 ? 'success' : 'warn',
      `探索28 预设应用完成：成功 ${success}，失败 ${failed}，跳过 ${missing.length}`)
    return { success, failed, missing }
  }

  /**
   * 一键应用「个人突破」预设。
   *
   * 预设内容：
   *   - RealmRaid.scheduler.enable           = true
   *   - Exploration.scheduler.enable         = false
   *   - Restart.scheduler.enable             = false
   *   - raid_config.number_attack            = 30
   *   - raid_config.number_base              = 0
   *   - raid_config.exit_four                = true
   *   - raid_config.order_attack             = '5 > 4 > 3 > 2 > 1 > 0'
   *   - raid_config.three_refresh            = false
   *   - raid_config.when_attack_fail         = 'Refresh'
   *   - switch_soul_config.*                 = false（默认不切魂）
   */
  async applyRealmRaidPreset(scriptName: string): Promise<{
    success: number
    failed: number
    missing: string[]
  }> {
    const taskArgs = new Map<string, TaskArgs>()
    const getArgs = async (task: string): Promise<TaskArgs | null> => {
      const cached = taskArgs.get(task)
      if (cached) return cached
      const args = await this.getTaskArgs(scriptName, task)
      if (args) taskArgs.set(task, args)
      return args
    }

    type Plan = [task: string, group: string, argument: string, value: unknown, type: OasArgType]
    const plan: Plan[] = [
      ['RealmRaid', 'scheduler', 'enable', true, 'boolean'],
      ['RealmRaid', 'scheduler', 'next_run', '2023-01-01 00:00:00', 'date_time'],
      ['Exploration', 'scheduler', 'enable', false, 'boolean'],
      ['Restart', 'scheduler', 'enable', false, 'boolean'],
      ['RealmRaid', 'raid_config', 'number_attack', 30, 'integer'],
      ['RealmRaid', 'raid_config', 'number_base', 0, 'integer'],
      ['RealmRaid', 'raid_config', 'exit_four', true, 'boolean'],
      ['RealmRaid', 'raid_config', 'order_attack', '5 > 4 > 3 > 2 > 1 > 0', 'string'],
      ['RealmRaid', 'raid_config', 'three_refresh', false, 'boolean'],
      ['RealmRaid', 'raid_config', 'when_attack_fail', 'Refresh', 'string'],
      ['RealmRaid', 'switch_soul_config', 'enable', false, 'boolean'],
      ['RealmRaid', 'switch_soul_config', 'enable_switch_by_name', false, 'boolean'],
    ]

    let success = 0
    let failed = 0
    const missing: string[] = []

    for (const [task, group, argument, value, type] of plan) {
      const args = await getArgs(task)
      if (!args) {
        emit(this.sink, 'error', `预设跳过：读取 ${task} 参数结构失败`)
        failed++
        continue
      }
      const groupList = args[group]
      if (!groupList) {
        emit(this.sink, 'warn',
          `预设跳过：${task} 未找到 group "${group}"。可用 group：[${Object.keys(args).join(', ')}]`)
        missing.push(`${task}.${group}.${argument}`)
        continue
      }
      const found = groupList.find(a => a.name === argument)
      if (!found) {
        emit(this.sink, 'warn',
          `预设跳过：${task}.${group} 下未找到字段 "${argument}"。可用字段：[${groupList.map(a => a.name).join(', ')}]`)
        missing.push(`${task}.${group}.${argument}`)
        continue
      }
      emit(this.sink, 'info',
        `[preset] writing ${task}.${group}.${argument} = ${String(value)} (type=${type})`)
      const ok = await this.updateTaskArg(scriptName, task, group, argument, value, type)
      if (ok) success++; else failed++
    }

    emit(this.sink, success > 0 && failed === 0 ? 'success' : 'warn',
      `个人突破预设应用完成：成功 ${success}，失败 ${failed}，跳过 ${missing.length}`)
    return { success, failed, missing }
  }
}

/** 单例：在整个 App 共享同一个客户端。 */
let _singleton: OasClient | null = null
export function getOasClient(sink?: LogSink): OasClient {
  if (!_singleton) _singleton = new OasClient({ sink })
  else if (sink) _singleton.setSink(sink)
  return _singleton
}
