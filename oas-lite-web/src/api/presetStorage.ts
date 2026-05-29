/**
 * 预设表单的本地持久化 + 校验工具。
 *
 * 设计动机：
 * - 用户在卡片里改了字段但还没点「应用预设」就刷新页面 / 切配置，本地编辑会丢。
 *   保存到 localStorage 可以让他们回到页面看到上次编辑的内容。
 * - 时间字符串 / 数字范围在前端做一次浅校验，避免给后端发已知会失败的请求。
 *
 * 注意：localStorage 按 (config_name, preset_kind) 分桶，
 * 切换配置时各自独立，不会互相串改。
 */

const STORAGE_PREFIX = 'oas-lite-web:preset:'

export function loadPresetDraft<T>(configName: string, kind: string): Partial<T> | null {
  if (!configName) return null
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${configName}:${kind}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as Partial<T>
    return null
  } catch {
    return null
  }
}

export function savePresetDraft<T>(configName: string, kind: string, values: T): void {
  if (!configName) return
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${configName}:${kind}`, JSON.stringify(values))
  } catch {
    // 配额满 / 隐私模式禁用 localStorage —— 忽略，编辑仍然在内存中正常工作
  }
}

export function clearPresetDraft(configName: string, kind: string): void {
  if (!configName) return
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${configName}:${kind}`)
  } catch { /* ignore */ }
}

// —— 字段比对工具 ——

/**
 * 把不同类型的值统一成可比较的字符串。
 * 数字/布尔/字符串都转 string；null/undefined 都转 ''.
 * 这是个浅比较，对象/数组不展开 —— 我们这边的字段都是基本类型。
 */
export function normalizeForCompare(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b)
}

// —— 调度时间格式化 ——

/**
 * 把"延后多少秒"转成 OAS 后端要求的 'YYYY-MM-DD HH:MM:SS' next_run 字符串。
 *
 * offsetSeconds <= 0 → 返回固定的"过去时间"，调度器视为立刻就绪。
 * offsetSeconds > 0  → 返回 (现在 + offset) 的本地时间字符串。
 *
 * 后端 PUT /{cfg}/{task}/{group}/{argument}/value 收到 type='date_time' 时
 * 会用 datetime.strptime(value, '%Y-%m-%d %H:%M:%S')，所以格式必须严格对齐。
 */
export function offsetToNextRunString(offsetSeconds: number): string {
  if (offsetSeconds <= 0) return '2023-01-01 00:00:00'
  const future = new Date(Date.now() + offsetSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())} `
       + `${pad(future.getHours())}:${pad(future.getMinutes())}:${pad(future.getSeconds())}`
}

/** 「执行顺序」下拉选项 —— 两张卡共用 */
export const ORDER_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0,     label: '队首（立即）' },
  { value: 5*60,  label: '5 分钟后' },
  { value: 30*60, label: '30 分钟后' },
  { value: 60*60, label: '1 小时后' },
]

// —— 字段校验 ——

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/

export interface ValidationIssue {
  field: string
  message: string
}

export function validateTimeString(field: string, value: string): ValidationIssue | null {
  if (!TIME_RE.test(value)) {
    return { field, message: `${field} 必须是 HH:MM:SS 格式（00:00:00 - 23:59:59）` }
  }
  return null
}

export function validateNumberRange(
  field: string, value: number, lo: number, hi: number,
): ValidationIssue | null {
  if (Number.isNaN(value)) {
    return { field, message: `${field} 不是有效数字` }
  }
  if (value < lo || value > hi) {
    return { field, message: `${field} 必须在 ${lo} - ${hi} 之间（当前 ${value}）` }
  }
  return null
}

export function validateNonEmpty(field: string, value: string): ValidationIssue | null {
  if (!value || value.trim().length === 0) {
    return { field, message: `${field} 不能为空` }
  }
  return null
}
