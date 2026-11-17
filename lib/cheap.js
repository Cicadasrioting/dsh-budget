/**
 * 抠搜模式：峰谷判定 + 任务队列 + 自动审批的纯逻辑部分。
 *
 * 「抠搜」的意思就一句：峰价的时候别开跑，攒着，等谷价再跑。
 *
 * 峰谷口径抄的是 dsh-cost-meter/lib/pricing.js（同一套窗口，不自己发明）：
 *   · `peakWindows` 是 **UTC 小时**的半开区间 `[start, end)`；
 *   · `peakEnabled` 关了、或计费模式不是 `deepseek-peak` 时，全天都是平价；
 *   · 北京时间的周六周日、以及 `peakHolidays` 里的日期，全天平价（周末谷价）。
 *
 * 本文件不碰 cordis，只做判定和存储，方便直接用 node 单测。
 *
 * @module dsh-budget/lib/cheap
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 队列文件（和 budget.json 一起放 DSH 数据目录）。 */
export function queuePath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'budget-queue.json')
}

/** 空队列。 */
export function emptyQueue() {
  return { items: [] }
}

export function readQueue() {
  try {
    const path = queuePath()
    if (!existsSync(path)) return emptyQueue()
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return { items: Array.isArray(parsed?.items) ? parsed.items.filter((i) => i && typeof i.id === 'string') : [] }
  } catch {
    return emptyQueue()
  }
}

export function writeQueue(queue) {
  const path = queuePath()
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, `${JSON.stringify(queue, null, 2)}\n`, 'utf8')
}

/** 北京时间的日期键（YYYY-MM-DD）——峰谷节假日表按北京日期写。 */
export function beijingDayKey(ms) {
  const d = new Date(ms + 8 * 3600_000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** 北京时间是星期几（0=周日）。 */
function beijingWeekday(ms) {
  return new Date(ms + 8 * 3600_000).getUTCDay()
}

/**
 * 从 cost-meter 的 config 里提炼峰谷参数。
 * @param {unknown} config costMeter.getState().config
 */
export function peakConfigOf(config) {
  const src = config && typeof config === 'object' ? config : {}
  const windows = Array.isArray(src.peakWindows)
    ? src.peakWindows
        .map((w) => ({ start: Number(w?.start), end: Number(w?.end) }))
        .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end))
    : []
  const holidays = Array.isArray(src.peakHolidays)
    ? src.peakHolidays.filter((s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s))
    : []
  // billingMode 是按模型的价格条目字段，config 里常常没有；只有明确写成别的模式才否掉峰谷。
  const mode = typeof src.billingMode === 'string' && src.billingMode ? src.billingMode : 'deepseek-peak'
  return {
    enabled: src.peakEnabled === true && mode === 'deepseek-peak' && windows.length > 0,
    windows,
    holidays,
  }
}

/** 该时刻是不是峰价。 */
export function isPeakAt(ms, peak) {
  if (!peak || peak.enabled !== true) return false
  const weekday = beijingWeekday(ms)
  if (weekday === 0 || weekday === 6) return false
  if (peak.holidays.includes(beijingDayKey(ms))) return false
  const hour = new Date(ms).getUTCHours()
  return peak.windows.some(({ start, end }) =>
    start < end ? hour >= start && hour < end : hour >= start || hour < end,
  )
}

/**
 * 下一次峰谷切换的时刻（毫秒）；一直不切就返回 null（例如峰谷没开）。
 * @param {number} ms 起点
 * @param {{enabled:boolean,windows:{start:number,end:number}[],holidays:string[]}} peak
 */
export function nextSwitchAt(ms, peak) {
  if (!peak || peak.enabled !== true) return null
  const now = isPeakAt(ms, peak)
  const step = 60_000
  const limit = ms + 8 * 24 * 3600_000
  // 按分钟扫：窗口边界都是整点，扫到整点必然覆盖，8 天封顶防止死循环。
  for (let at = Math.floor(ms / step) * step + step; at <= limit; at += step) {
    if (isPeakAt(at, peak) !== now) return at
  }
  return null
}

/** 当前相位：峰/谷 + 下一次切换。 */
export function phaseAt(ms, peak) {
  const peakNow = isPeakAt(ms, peak)
  const nextAt = nextSwitchAt(ms, peak)
  return {
    peak: peakNow,
    enabled: peak?.enabled === true,
    nextAt,
    /** 还有多少毫秒切换；未知则 null。 */
    untilSwitch: nextAt === null ? null : nextAt - ms,
    weekend: beijingWeekday(ms) === 0 || beijingWeekday(ms) === 6,
  }
}

/**
 * 工具调用归到哪一类（自动审批按类放行）。
 * @param {string} toolName 工具名，例如 `ops_bash` / `write` / `plugin_manager`
 * @returns {'cmd'|'file'|'plugin'|'net'|'other'}
 */
export function approveKindOf(toolName) {
  const name = String(toolName ?? '').toLowerCase()
  if (/plugin|bundle|install/.test(name)) return 'plugin'
  if (/bash|pwsh|powershell|shell|exec|terminal/.test(name)) return 'cmd'
  if (/write|edit|replace|patch|copy|move|remove|delete|mkdir|truncate|chmod|rename/.test(name)) return 'file'
  if (/fetch|http|web|search|download|upload|browse/.test(name)) return 'net'
  return 'other'
}

/** 自动审批的类型清单（面板上勾的就是这几个）。 */
export const APPROVE_KINDS = [
  { id: 'file', label: '文件改动', hint: 'write / edit / copy / 删文件' },
  { id: 'cmd', label: '命令执行', hint: 'bash / pwsh / shell' },
  { id: 'net', label: '联网抓取', hint: 'web_fetch / 搜索 / 下载' },
  { id: 'plugin', label: '插件管理', hint: '安装、启用、卸载插件' },
  { id: 'other', label: '其他工具', hint: '剩下的全部' },
]
