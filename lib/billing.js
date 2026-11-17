/**
 * 账单同步 —— dsh-budget 的「真实钱」来源。
 *
 * 两条路，优先第一条：
 *   1. **平台用量接口**（真·账单，按天）：登录账号 token 由宿主 `deepseekAccount` 服务持有，
 *      `getPlatformSession()` 能拿到 `{ origin, token, requestHeaders }`（Host-only 快照），
 *      然后请求 `GET {origin}/api/v0/usage/by_api_key/cost?start&end&tz`：
 *      `biz_data.data[].series[].buckets[] = { time, cost }`，按天汇总就是当月每天花了多少。
 *      start/end 是「本地零点」化的 epoch 秒（`Date.UTC(y,m,d)/1000 - tz`），tz 是东八区这类秒偏移。
 *   2. **余额差记账**（兜底，接口不可用时）：
 *      · 开放平台 Key：`GET https://api.deepseek.com/user/balance`（balance_infos[].total_balance）
 *      · 登录账号钱包：`deepseekAccount.getBalance()`
 *      隔一会儿采一次余额，两次之间的**下降**记到当天，**上升**算充值。
 *
 * 台账文件 `%DSH_HOME%/budget-billing.json`：
 *   { monthKey, currency, lastTotal, days: { 'YYYY-MM-DD': 花费 }, topups, samples,
 *     lastSyncMs, source, error, monthTotal }
 *
 * @module dsh-budget/lib/billing
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 保留多少条原始采样（只用于面板上的「最近余额」，不参与计算）。 */
const SAMPLE_KEEP = 60

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function billingPath() {
  return join(dshHome(), 'budget-billing.json')
}

/** 空台账。 */
export function emptyBilling() {
  return {
    monthKey: '',
    currency: 'CNY',
    lastTotal: null,
    days: {},
    topups: 0,
    samples: [],
    lastSyncMs: 0,
    source: '',
    error: '',
    monthTotal: null,
  }
}

/** 读台账（坏文件/缺字段一律回落）。 */
export function readBilling() {
  const path = billingPath()
  const empty = emptyBilling()
  try {
    if (!existsSync(path)) return empty
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (!raw || typeof raw !== 'object') return empty
    const days = {}
    if (raw.days && typeof raw.days === 'object') {
      for (const [key, value] of Object.entries(raw.days)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(key) && typeof value === 'number' && Number.isFinite(value)) days[key] = value
      }
    }
    return {
      monthKey: typeof raw.monthKey === 'string' ? raw.monthKey : '',
      currency: typeof raw.currency === 'string' && raw.currency ? raw.currency : 'CNY',
      lastTotal: typeof raw.lastTotal === 'number' && Number.isFinite(raw.lastTotal) ? raw.lastTotal : null,
      days,
      topups: typeof raw.topups === 'number' && Number.isFinite(raw.topups) ? raw.topups : 0,
      samples: Array.isArray(raw.samples) ? raw.samples.slice(-SAMPLE_KEEP) : [],
      lastSyncMs: typeof raw.lastSyncMs === 'number' ? raw.lastSyncMs : 0,
      source: typeof raw.source === 'string' ? raw.source : '',
      error: typeof raw.error === 'string' ? raw.error : '',
      monthTotal: typeof raw.monthTotal === 'number' && Number.isFinite(raw.monthTotal) ? raw.monthTotal : null,
    }
  } catch {
    return empty
  }
}

export function writeBilling(state) {
  const path = billingPath()
  try {
    mkdirSync(dirname(path), { recursive: true })
  } catch {
    /* 目录已存在 */
  }
  try {
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch {
    /* 磁盘问题不该把插件带崩 */
  }
  return state
}

const money = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6

/**
 * 把一次余额采样记账。
 * @param state - 现有台账（readBilling 的返回值，不会被修改）。
 * @param sample - { total, currency, source }，total 是当前余额合计。
 * @param keys - { dayKey, monthKey }。
 * @param now - 采样时间。
 * @returns 新台账。
 */
export function recordSample(state, sample, keys, now = new Date()) {
  const next = {
    ...state,
    days: { ...state.days },
    samples: Array.isArray(state.samples) ? state.samples.slice(-SAMPLE_KEEP) : [],
    topups: Number(state.topups) || 0,
  }
  next.currency = sample.currency || state.currency || 'CNY'
  next.source = sample.source || ''
  next.error = ''
  next.lastSyncMs = now.getTime()

  // 跨月：上月台账不计入本月，但余额基线保留（本月第一天正常从基线往下算）。
  if (next.monthKey !== keys.monthKey) {
    next.monthKey = keys.monthKey
    next.days = {}
    next.topups = 0
  }

  const total = Number(sample.total)
  if (Number.isFinite(total)) {
    const before = typeof next.lastTotal === 'number' && Number.isFinite(next.lastTotal) ? next.lastTotal : null
    if (before !== null) {
      const delta = money(before - total)
      if (delta > 0) next.days[keys.dayKey] = money((next.days[keys.dayKey] ?? 0) + delta)
      else if (delta < 0) next.topups = money(next.topups + -delta)
    }
    next.lastTotal = money(total)
    next.samples.push({ t: now.getTime(), total: money(total) })
    if (next.samples.length > SAMPLE_KEEP) next.samples.splice(0, next.samples.length - SAMPLE_KEEP)
  }
  return next
}

/**
 * 用平台「用量」接口的数据覆盖当月台账 —— 这是真账单，不是估算。
 * @param state - 现有台账（不会被修改）。
 * @param usage - { currency, days: { 'YYYY-MM-DD': 花费 }, total }。
 * @param keys - { dayKey, monthKey }。
 * @param now - 同步时间。
 * @returns 新台账（days 整月替换，余额采样保留）。
 */
export function recordUsage(state, usage, keys, now = new Date()) {
  const days = {}
  for (const [key, value] of Object.entries(usage?.days ?? {})) {
    const amount = Number(value)
    if (/^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(amount)) days[key] = money(amount)
  }
  const total = Number(usage?.total)
  return {
    ...state,
    monthKey: keys.monthKey,
    currency: usage?.currency || state.currency || 'CNY',
    days,
    topups: Number(state.topups) || 0,
    samples: Array.isArray(state.samples) ? state.samples.slice(-SAMPLE_KEEP) : [],
    lastSyncMs: now.getTime(),
    source: 'usage',
    error: '',
    monthTotal: Number.isFinite(total) ? money(total) : money(Object.values(days).reduce((a, b) => a + b, 0)),
  }
}

/** 记一次失败（保留上次余额与台账，只写错误与时间）。 */
export function recordFailure(state, message, now = new Date()) {
  return { ...state, error: String(message ?? '').slice(0, 300), lastSyncMs: now.getTime() }
}

/** 台账里某个月每天的真实花费（只有采到过的日子）。 */
export function billingDaysOf(state, monthKey) {
  const out = {}
  if (!state || state.monthKey !== monthKey) return out
  for (const [key, value] of Object.entries(state.days || {})) {
    if (key.startsWith(monthKey) && typeof value === 'number') out[key] = value
  }
  return out
}
