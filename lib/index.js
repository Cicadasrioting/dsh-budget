/**
 * dsh-budget —— 按月额度的 DeepSeek 用量预算（宿主半侧）。
 *
 * 规则（用户原话的口径）：
 *   · 每月额度可配置（`~/.dsh/budget.json` 的 `monthlyQuota`，或 `/budget 300` 直接改）。
 *   · 当月工作日数量决定日均额度：`base = monthlyQuota / 当月工作日数`。
 *   · 没用完的额度自动结转：今天可用的 = `base × 已过工作日数 − 本月今天之前已花`，
 *     所以「日均 8 元、第 1 天花了 6、第 2 天就能用 10」这种累计是自然结果，不需要额外台账。
 *   · 今天剩下的额度降到 `lowPercent`（默认 10%）时让桌宠提醒一次，降到 0 再提醒一次；
 *     一天各一次，跨天重置。
 *
 * 数据来源：`costMeter.getState()`（dsh-cost-meter 的服务，口径与本机账本一致，
 * 已按会话/子代理/缓存命中算好钱）。提醒通道：dsh-pet 的 `POST /dsh-pet-7340/broadcast?pet=<id>`
 * —— 这是宠物官方给第三方插件用的投喂口（读它的 `src/host/routes/interaction.ts` 确认过）。
 *
 * @module dsh-budget/lib/index
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { billingDaysOf, billingPath, readBilling, recordFailure, recordSample, recordUsage, writeBilling } from './billing.js'

/** 插件行 id（与 cordis.patch.yml 一致）。 */
export const name = 'budget'
/** 注入：计费服务、Web 路由、斜杠命令。 */
export const inject = ['costMeter', 'webServer', 'commands']

/** 本插件路由前缀（第三方插件路由都挂在 /plugins/<包名>/ 下）。 */
const ROUTE_PREFIX = '/plugins/dsh-budget'
/** 桌宠插件的路由段（见 dsh-pet/src/shared/constants.ts 的 ROUTE_SEGMENT）。 */
const PET_SEGMENT = '/dsh-pet-7340'
/** 定时评估间隔：提醒看的是「钱」，30s 足够，别把宿主拖累。 */
const EVAL_INTERVAL_MS = 30_000

/** 默认配置；文件里缺的字段一律回落到这里。 */
const DEFAULT_CONFIG = {
  /** 每月额度（单位见 currency）。0 或负数 = 不启用。 */
  monthlyQuota: 300,
  currency: 'CNY',
  /** 额外算作休息日的日期（YYYY-MM-DD），例如法定节假日。 */
  holidays: [],
  /** 额外算作工作日的日期（YYYY-MM-DD），例如调休上班的周末。 */
  extraWorkdays: [],
  /** 剩余额度百分比降到这个值时提醒。 */
  lowPercent: 10,
  /** 总开关。 */
  remind: true,
  /** 指定桌宠 id；留空 = 自动取宠物列表里的第一只。 */
  petId: '',
  /** 气泡停留时长（毫秒）。 */
  bubbleMs: 15000,
  /** 超额是否停用：当天额度用尽就拦掉模型调用（进行中的任务先跑完）。 */
  autoDisable: false,
  /** 账单同步：定时采一次 DeepSeek 余额，用余额差记出每天真实花费。 */
  billSync: true,
  /** 采样间隔（分钟）。 */
  billIntervalMinutes: 15,
  /** 开放平台 Key；留空 = 用宿主账号钱包，再不行才读 DEEPSEEK_API_KEY。 */
  billApiKey: '',
}

/** DSH 数据目录。 */
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function configPath() {
  return join(dshHome(), 'budget.json')
}

function statePath() {
  return join(dshHome(), 'budget-state.json')
}

/** 停用状态机（跨进程保存，重启后仍然记得今天已经停用）。 */
function runtimePath() {
  return join(dshHome(), 'budget-runtime.json')
}

const EMPTY_RUNTIME = {
  /** 这份状态属于哪一天（跨天自动清空）。 */
  dayKey: '',
  /** 已决定停用，但当时有回合在跑 —— 等它结束再真正停。 */
  pending: false,
  /** 已停用：模型调用被拦。 */
  disabled: false,
  /** 「再用一次」：放行到下一个回合结束。 */
  allowTurn: false,
  /** 今天手动恢复过，当天不再自动停用。 */
  mutedDay: '',
  /** 停用时刻（毫秒）。 */
  since: 0,
}

function readRuntime() {
  const raw = readJson(runtimePath(), {})
  const pick = (v) => v === true
  return {
    dayKey: typeof raw.dayKey === 'string' ? raw.dayKey : '',
    pending: pick(raw.pending),
    disabled: pick(raw.disabled),
    allowTurn: pick(raw.allowTurn),
    mutedDay: typeof raw.mutedDay === 'string' ? raw.mutedDay : '',
    since: Number.isFinite(raw.since) ? raw.since : 0,
  }
}

/** 读 JSON 文件，坏文件不抛异常（读不动就用空对象）。 */
function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback
    const text = readFileSync(path, 'utf8')
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch {
    return fallback
  }
}

/** 写 JSON 文件（建目录，失败不抛给调用方）。 */
function writeJson(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
  } catch {
    /* 存不下标记最多是重复提醒一次，不该影响主流程 */
  }
}

/** 把外部给的配置净化成可用的形状。 */
function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const num = (v, def) => (typeof v === 'number' && Number.isFinite(v) ? v : def)
  const dateList = (v) =>
    Array.isArray(v) ? v.map((s) => String(s)).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)) : []
  return {
    monthlyQuota: Math.max(0, num(src.monthlyQuota, DEFAULT_CONFIG.monthlyQuota)),
    currency: typeof src.currency === 'string' && src.currency ? src.currency : DEFAULT_CONFIG.currency,
    holidays: dateList(src.holidays),
    extraWorkdays: dateList(src.extraWorkdays),
    lowPercent: Math.min(100, Math.max(0, num(src.lowPercent, DEFAULT_CONFIG.lowPercent))),
    remind: src.remind === undefined ? DEFAULT_CONFIG.remind : src.remind !== false,
    petId: typeof src.petId === 'string' ? src.petId : DEFAULT_CONFIG.petId,
    bubbleMs: Math.max(0, num(src.bubbleMs, DEFAULT_CONFIG.bubbleMs)),
    autoDisable: src.autoDisable === true,
    billSync: src.billSync === undefined ? DEFAULT_CONFIG.billSync : src.billSync !== false,
    billIntervalMinutes: Math.min(240, Math.max(1, num(src.billIntervalMinutes, DEFAULT_CONFIG.billIntervalMinutes))),
    billApiKey: typeof src.billApiKey === 'string' ? src.billApiKey.trim() : '',
  }
}

function readConfig() {
  return normalizeConfig(readJson(configPath(), {}))
}

/** 合并式保存配置（只覆盖给到的字段）。 */
function saveConfig(patch) {
  const merged = { ...readConfig(), ...(patch && typeof patch === 'object' ? patch : {}) }
  const next = normalizeConfig(merged)
  writeJson(configPath(), next)
  return next
}

/** 本地日期键（YYYY-MM-DD）。 */
function dayKeyOf(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 本地月份键（YYYY-MM）。 */
function monthKeyOf(date) {
  return dayKeyOf(date).slice(0, 7)
}

/** 某月的工作日列表（周一至周五，减去 holidays，加上 extraWorkdays）。 */
function workdaysOfMonth(monthKey, cfg) {
  const [year, month] = String(monthKey).split('-').map(Number)
  if (!year || !month) return []
  const total = new Date(year, month, 0).getDate()
  const holidays = new Set(cfg.holidays)
  const extras = new Set(cfg.extraWorkdays)
  const out = []
  for (let day = 1; day <= total; day += 1) {
    const date = new Date(year, month - 1, day)
    const key = dayKeyOf(date)
    const weekday = date.getDay()
    let work = weekday >= 1 && weekday <= 5
    if (holidays.has(key)) work = false
    if (extras.has(key)) work = true
    if (work) out.push(key)
  }
  return out
}

/** 某一天花了多少（按本机货币；账本里 cny 字段有就优先）。 */
function moneyOf(day) {
  if (!day || typeof day !== 'object') return 0
  const value = day.costCny ?? day.cost
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * 核心计算：把计费状态 + 配置算成今天的额度账。
 * 纯函数，方便单测与复用（路由 / 斜杠命令 / 定时器同一口径）。
 */
export function computePlan(costState, cfg, now = new Date(), billing = null) {
  const meta = costState?.meta && typeof costState.meta === 'object' ? costState.meta : {}
  const monthKey = /^\d{4}-\d{2}$/.test(String(meta.monthKey)) ? String(meta.monthKey) : monthKeyOf(now)
  const todayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(meta.dayKey)) ? String(meta.dayKey) : dayKeyOf(now)

  const workdays = workdaysOfMonth(monthKey, cfg)
  const totalWorkdays = workdays.length
  const elapsedWorkdays = workdays.filter((d) => d <= todayKey).length
  const base = totalWorkdays > 0 ? cfg.monthlyQuota / totalWorkdays : 0
  const isWorkday = workdays.includes(todayKey)

  const history = Array.isArray(costState?.history) ? costState.history : []
  // 每天的账：先铺本地估算（costMeter），再用账单同步（余额差）覆盖真正采到的那几天。
  const ledger = new Map()
  for (const day of history) {
    const key = String(day?.date ?? '')
    if (key.startsWith(monthKey)) ledger.set(key, moneyOf(day))
  }
  const todayMeter = moneyOf(costState?.today)
  if (!ledger.has(todayKey) && todayMeter > 0) ledger.set(todayKey, todayMeter)

  const apiDays = billing && billing.monthKey === monthKey ? billingDaysOf(billing, monthKey) : {}
  let billedDays = 0
  let billedToday = null
  for (const [key, value] of Object.entries(apiDays)) {
    ledger.set(key, value)
    billedDays += 1
    if (key === todayKey) billedToday = value
  }

  const spentBeforeToday = [...ledger]
    .filter(([key]) => key < todayKey)
    .reduce((sum, [, value]) => sum + value, 0)
  const spentToday = ledger.get(todayKey) ?? 0
  const spentMonth = spentBeforeToday + spentToday

  // 到今天为止累计可用（含今天这一份），减去今天之前已经花掉的 = 今天可支配
  const availableToday = base * elapsedWorkdays - spentBeforeToday
  const remaining = availableToday - spentToday
  const remainingPercent = availableToday > 0 ? (remaining / availableToday) * 100 : remaining >= 0 ? 100 : 0

  return {
    enabled: cfg.monthlyQuota > 0,
    currency: cfg.currency,
    monthKey,
    todayKey,
    isWorkday,
    monthlyQuota: round2(cfg.monthlyQuota),
    totalWorkdays,
    elapsedWorkdays,
    dailyAverage: round2(base),
    availableToday: round2(availableToday),
    spentToday: round2(spentToday),
    spentBeforeToday: round2(spentBeforeToday),
    spentMonth: round2(spentMonth),
    remaining: round2(remaining),
    remainingPercent: Math.round(remainingPercent * 10) / 10,
    monthRemaining: round2(cfg.monthlyQuota - spentMonth),
    // 结转出去的历史欠账（今天之前多花的）
    carriedDebt: round2(Math.max(0, spentBeforeToday - base * elapsedWorkdays)),
    lowPercent: cfg.lowPercent,
    overBudget: remaining < 0,
    // 账单同步的透明度：哪几天是真实账单、今天这笔是不是真的
    billedDays,
    billedToday,
    spentTodaySource: billedToday === null ? 'estimate' : 'bill',
    balance: billing && typeof billing.lastTotal === 'number' ? billing.lastTotal : null,
  }
}

/** 一句话摘要（斜杠命令与气泡共用）。 */
function summaryText(plan, gate) {
  if (!plan.enabled) return '这个月的额度还没设，/budget 300 设一个？'
  const tail = plan.remaining < 0 ? `超了 ${round2(-plan.remaining)}` : `还剩 ${round2(plan.remaining)}`
  const stop = !gate
    ? ''
    : gate.disabled
      ? `｜已停用${gate.allowTurn ? '（已放行一轮）' : ''}`
      : gate.pending
        ? '｜本轮结束后停用'
        : gate.autoDisable
          ? '｜超额停用已开'
          : ''
  return [
    `${plan.monthKey} 额度 ${plan.monthlyQuota} ${plan.currency}`,
    `工作日 ${plan.totalWorkdays} 天、日均 ${plan.dailyAverage}`,
    `今天可用 ${plan.availableToday}、已用 ${plan.spentToday}、${tail}（${plan.remainingPercent}%）`,
  ].join('｜') + stop
}

/** 从 Node 的 req 里读出请求体。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 插件主体。 */
export function apply(ctx) {
  const log = ctx.logger ?? console

  /** 宠物路由的 origin（宿主自己的地址）。 */
  function originOf() {
    try {
      const origin = ctx.webServer?.getOrigin?.()
      if (typeof origin === 'string' && origin) return origin.replace(/\/+$/, '')
    } catch {
      /* 取不到就走端口兜底 */
    }
    const port = ctx.webServer?.port
    return typeof port === 'number' && port > 0 ? `http://127.0.0.1:${port}` : ''
  }

  /** 找到要说话的桌宠 id（配置优先，否则列表第一只）。 */
  async function resolvePetId(cfg, origin) {
    if (cfg.petId) return cfg.petId
    if (!origin) return ''
    try {
      const res = await fetch(`${origin}${PET_SEGMENT}/state`, { headers: { 'cache-control': 'no-cache' } })
      if (!res.ok) return ''
      const data = await res.json()
      const ids = Object.keys(data?.pets ?? {})
      return ids[0] ?? ''
    } catch {
      return ''
    }
  }

  /** 让桌宠说一句话（失败只记日志，绝不抛给调用方）。 */
  async function petSay(text, cfg) {
    const origin = originOf()
    if (!origin) return { ok: false, reason: 'no-origin' }
    const petId = await resolvePetId(cfg, origin)
    if (!petId) return { ok: false, reason: 'no-pet' }
    // surface=any：宠物的显示端用户可随时切（web / desktop），投喂方不该猜；
    // 不带 surface 会被宠物按 bad-request 拒掉（见 dsh-pet 的 surface 校验）。
    const url = `${origin}${PET_SEGMENT}/broadcast?pet=${encodeURIComponent(petId)}&surface=any`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, duration: cfg.bubbleMs, anim: true }),
      })
      const body = await res.text().catch(() => '')
      if (!res.ok) {
        log.warn?.(`[dsh-budget] broadcast ${res.status}: ${body.slice(0, 200)}`)
        return { ok: false, reason: `http-${res.status}` }
      }
      return { ok: true, petId }
    } catch (e) {
      log.warn?.(`[dsh-budget] broadcast failed: ${e instanceof Error ? e.message : String(e)}`)
      return { ok: false, reason: 'fetch-failed' }
    }
  }

  /** 读计费状态；服务不在或抛错时返回 null。 */
  async function readCostState() {
    try {
      const meter = ctx.costMeter
      if (!meter || typeof meter.getState !== 'function') return null
      return await meter.getState()
    } catch (e) {
      log.warn?.(`[dsh-budget] getState failed: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  /** 对外暴露的配置：抹掉 API Key 原文，只留「有没有配」。 */
  function publicConfig(cfg) {
    const { billApiKey, ...rest } = cfg
    return { ...rest, hasBillApiKey: Boolean(String(billApiKey || '').trim()) }
  }

  /** 当前账本（不触发提醒）。 */
  async function status() {
    const cfg = readConfig()
    const state = await readCostState()
    const billing = readBilling()
    if (!state) return { ok: false, reason: 'cost-meter-unavailable', billing: billingView(cfg, billing) }
    const plan = computePlan(state, cfg, new Date(), billing)
    return { ok: true, plan, config: publicConfig(cfg), gate: gateOf(cfg, plan), billing: billingView(cfg, billing) }
  }

  // ---- 账单同步：余额差记账 -----------------------------------------------
  /**
   * 读一次余额。优先级：
   *   1. 宿主 `deepseekAccount` 服务的钱包（= 设置→账号 那个余额，不用 API Key，插件看不到 token）
   *   2. 配置里的 `billApiKey` / 环境变量 `DEEPSEEK_API_KEY` 打开放平台 `/user/balance`
   * 都拿不到就返回 null（调用方记失败，不假装 0）。
   */
  async function fetchBalance(cfg) {
    const account = ctx.get?.('deepseekAccount')
    if (account && typeof account.getBalance === 'function') {
      try {
        const details = await account.getBalance({
          version: '',
          locale: 'zh',
          timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
        })
        const wallets = [...(details?.value ?? []), ...(details?.bonusWallets ?? [])]
        const totals = new Map()
        for (const wallet of wallets) {
          const currency = String(wallet?.currency ?? '').toUpperCase()
          const amount = Number(wallet?.balance)
          if (!currency || !Number.isFinite(amount)) continue
          totals.set(currency, (totals.get(currency) ?? 0) + amount)
        }
        const picked = totals.has(cfg.currency) ? cfg.currency : [...totals.keys()][0]
        if (picked) return { total: totals.get(picked), currency: picked, source: 'platform' }
      } catch (e) {
        log.warn?.(`[dsh-budget] 账号余额读取失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    const key = String(cfg.billApiKey || '').trim() || String(process.env.DEEPSEEK_API_KEY ?? '').trim()
    if (!key) return null
    try {
      const res = await fetch('https://api.deepseek.com/user/balance', {
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : []
      const row = infos.find((i) => String(i?.currency ?? '').toUpperCase() === cfg.currency) ?? infos[0]
      const total = Number(row?.total_balance)
      if (!Number.isFinite(total)) throw new Error('balance_infos 里没有余额')
      return { total, currency: String(row?.currency ?? cfg.currency).toUpperCase(), source: 'api-key' }
    } catch (e) {
      log.warn?.(`[dsh-budget] 余额接口失败：${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  /**
   * 读平台「用量」接口的当月每天花费 —— 真账单，不是估算。
   *
   * token 在宿主 `deepseekAccount` 服务里（Host-only 快照 `getPlatformSession()`），
   * 下游接口 `GET {origin}/api/v0/usage/by_api_key/cost?start&end&tz` 按天返回 cost。
   * 拿不到 token 或接口报错返回 null，交给余额差兜底。
   */
  async function fetchUsage(cfg) {
    try {
      const account = ctx.get?.('deepseekAccount')
      const session = typeof account?.getPlatformSession === 'function' ? await account.getPlatformSession() : null
      if (!session?.token) return null
      const tz = -new Date().getTimezoneOffset() * 60
      const now = new Date()
      // start/end 用「本地零点」的 epoch 秒，接口按这个对齐切天
      const startSec = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), 1) / 1000) - tz
      const endSec = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1) / 1000) - tz
      const origin = session.origin || 'https://platform.deepseek.com'
      const url = `${origin}/api/v0/usage/by_api_key/cost?start=${startSec}&end=${endSec}&tz=${tz}`
      const res = await fetch(url, {
        headers: {
          ...(session.requestHeaders ?? {}),
          'x-dsh-auth-token': session.token,
          accept: 'application/json',
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      const biz = body?.data?.biz_data
      if (!biz) throw new Error(`biz_code ${body?.data?.biz_code ?? '?'}`)
      const rows = Array.isArray(biz.data) ? biz.data : []
      const upper = (v) => String(v ?? '').toUpperCase()
      const currency = rows.some((row) => upper(row?.currency) === cfg.currency)
        ? cfg.currency
        : upper(rows[0]?.currency) || cfg.currency
      const pad = (n) => String(n).padStart(2, '0')
      const label = (sec) => {
        const d = new Date((sec + tz) * 1000)
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
      }
      const days = {}
      let total = 0
      for (const row of rows) {
        if (upper(row?.currency) !== currency) continue
        for (const series of row?.series ?? []) {
          for (const bucket of series?.buckets ?? []) {
            const cost = Number(bucket?.cost)
            const time = Number(bucket?.time)
            if (!Number.isFinite(cost) || !Number.isFinite(time) || cost === 0) continue
            const key = label(time)
            days[key] = (days[key] ?? 0) + cost
            total += cost
          }
        }
      }
      return { currency, days, total }
    } catch (e) {
      log.warn?.(`[dsh-budget] 用量接口失败：${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  /** 同步一次账单：优先平台用量接口，拿不到才退回余额采样。 */
  async function syncBilling() {
    const cfg = readConfig()
    if (!cfg.billSync) return { ok: false, reason: 'off', billing: readBilling() }
    const now = new Date()
    const keys = { dayKey: dayKeyOf(now), monthKey: monthKeyOf(now) }
    let state = readBilling()
    // 余额顺手采一次：面板要显示，也是用量接口挂了之后的兜底
    const balance = await fetchBalance(cfg).catch(() => null)
    if (balance) state = recordSample(state, balance, keys, now)
    const usage = await fetchUsage(cfg)
    if (usage) {
      const next = recordUsage(state, usage, keys, now)
      writeBilling(next)
      return { ok: true, billing: next }
    }
    if (balance) {
      const next = { ...state, error: '用量接口不可用，暂时按余额差记账' }
      writeBilling(next)
      return { ok: true, reason: 'usage-unavailable', billing: next }
    }
    const failed = recordFailure(state, '取不到用量也取不到余额（账号没登录，也没有 API Key）', now)
    writeBilling(failed)
    return { ok: false, reason: 'no-balance', billing: failed }
  }

  /** 面板要看的账单摘要。 */
  function billingView(cfg, billing) {
    const monthKey = monthKeyOf(new Date())
    const todayKey = dayKeyOf(new Date())
    const days = billing.monthKey === monthKey ? billing.days : {}
    const todayCost = typeof days[todayKey] === 'number' ? days[todayKey] : null
    const monthTotal = billing.monthKey === monthKey && typeof billing.monthTotal === 'number'
      ? billing.monthTotal
      : Object.values(days).reduce((sum, value) => sum + value, 0)
    return {
      enabled: cfg.billSync,
      intervalMinutes: cfg.billIntervalMinutes,
      hasKey: Boolean(String(cfg.billApiKey || process.env.DEEPSEEK_API_KEY || '').trim()),
      source: billing.source,
      currency: billing.currency,
      balance: typeof billing.lastTotal === 'number' ? billing.lastTotal : null,
      lastSyncMs: billing.lastSyncMs,
      error: billing.error,
      topups: billing.topups,
      monthTotal: round2(monthTotal),
      todayCost: todayCost === null ? null : round2(todayCost),
      /** 账本是哪个月的（客户端据此画当月柱状图）。 */
      monthKey,
      days,
      file: billingPath(),
    }
  }

  // ---- 停用状态机 ---------------------------------------------------------
  /** 正在跑的回合（sessionId 集合）；用来判断「任务还在进行中」。 */
  const runningTurns = new Set()

  /** 读运行时并把跨天的状态清掉。 */
  function runtimeFor(todayKey) {
    const rt = readRuntime()
    if (rt.dayKey === todayKey) return rt
    const fresh = { ...EMPTY_RUNTIME, dayKey: todayKey }
    writeJson(runtimePath(), fresh)
    return fresh
  }

  /** 对外报告的闸门状态（侧边栏/命令用）。 */
  function gateOf(cfg, plan) {
    const rt = runtimeFor(plan.todayKey)
    return {
      autoDisable: cfg.autoDisable,
      disabled: rt.disabled,
      pending: rt.pending,
      allowTurn: rt.allowTurn,
      muted: rt.mutedDay === plan.todayKey,
      running: runningTurns.size > 0,
      since: rt.since,
      blocked: blockedBy(rt, cfg),
    }
  }

  /** 是否该拦下这次模型调用。 */
  function blockedBy(rt, cfg) {
    return cfg.autoDisable && rt.disabled && !rt.allowTurn
  }

  /**
   * 评估一次并（必要时）提醒 + 处理超额停用。
   * 提醒去重：每个自然日、每个档位各一次，标记存在 ~/.dsh/budget-state.json。
   * 停用：超额时若有回合在跑 → 挂 pending，等 turn/end 再停；否则立刻停。
   */
  async function evaluate(reason = 'timer') {
    const cfg = readConfig()
    const state = await readCostState()
    if (!state) return null
    const plan = computePlan(state, cfg, new Date(), readBilling())
    if (!plan.enabled) return { plan, reminded: null, reason, gate: gateOf(cfg, plan) }

    const rt = runtimeFor(plan.todayKey)
    let gateChanged = null

    // 额度回到水下（比如用户把额度调高了）→ 自动解停
    if (!plan.overBudget && (rt.disabled || rt.pending)) {
      rt.disabled = false
      rt.pending = false
      rt.allowTurn = false
      rt.since = 0
      writeJson(runtimePath(), rt)
      gateChanged = 'resumed'
    }

    // 超额 + 开了自动停用 + 今天没手动恢复过 → 停用（进行中的回合等它跑完）
    if (
      cfg.autoDisable &&
      plan.overBudget &&
      rt.mutedDay !== plan.todayKey &&
      !rt.disabled &&
      !rt.pending
    ) {
      if (runningTurns.size > 0) {
        rt.pending = true
        gateChanged = 'pending'
      } else {
        rt.disabled = true
        rt.since = Date.now()
        gateChanged = 'disabled'
      }
      writeJson(runtimePath(), rt)
    }

    if (!cfg.remind) return { plan, reminded: null, reason, gate: gateOf(cfg, plan) }

    const marks = readJson(statePath(), {})
    const today = plan.todayKey
    const fresh = marks.dayKey === today ? marks : { dayKey: today, low: false, zero: false }
    let reminded = null

    if (plan.remainingPercent <= 0 && !fresh.zero) {
      fresh.zero = true
      fresh.low = true
      reminded = 'zero'
    } else if (plan.remainingPercent <= cfg.lowPercent && !fresh.low) {
      fresh.low = true
      reminded = 'low'
    }

    if (reminded) {
      const available = Math.max(0, plan.availableToday)
      const over = plan.remaining < 0 ? `，还超了 ${round2(-plan.remaining)}` : ''
      const stopped = gateChanged === 'disabled' || gateChanged === 'pending'
      const text =
        reminded === 'zero'
          ? `今天的额度见底了：可用 ${available}、已花 ${plan.spentToday} ${plan.currency}${over}。${stopped ? '先停用了，侧边栏里可以「再用一次」。' : '收手吧。'}`
          : `额度只剩 ${plan.remainingPercent}% 了：今天还剩 ${round2(Math.max(0, plan.remaining))} ${plan.currency}，悠着点。`
      const sent = await petSay(text, cfg)
      writeJson(statePath(), fresh)
      return { plan, reminded, text, sent, reason, gate: gateOf(cfg, plan), gateChanged }
    }

    writeJson(statePath(), fresh)
    return { plan, reminded: null, reason, gate: gateOf(cfg, plan), gateChanged }
  }

  /** 卡住当前模型的调用：抛出的错会把这个回合判失败。 */
  function refuse() {
    const error = new Error(
      '今日 DeepSeek 额度已用尽，dsh-budget 已停用本轮模型调用。侧边栏「预算」里可以「再用一次」，或调高月额度。',
    )
    error.name = 'BudgetExhaustedError'
    error.code = 'BUDGET_EXHAUSTED'
    return error
  }

  // ---- 回合边界 + 模型调用闸门 -------------------------------------------
  /**
   * 监听 turn/start・turn/end：
   *   · turn/start 记下「这个会话有任务在跑」（超额时据此决定是立刻停还是等跑完）；
   *   · turn/end 把 pending 落成 disabled，并让「再用一次」的放行到期。
   * 事件形状抄 dsh-pet/src/host/plugin/session-watch.ts:155 的消费方式。
   */
  ctx.effect(() =>
    ctx.on('session/event', (session, event) => {
      const type = event?.type
      if (type !== 'turn/start' && type !== 'turn/end') return
      const sessionId = String(session?.header?.id ?? session?.id ?? 'unknown')
      if (type === 'turn/start') {
        runningTurns.add(sessionId)
        return
      }
      runningTurns.delete(sessionId)
      try {
        const cfg = readConfig()
        const today = dayKeyOf(new Date())
        const rt = runtimeFor(today)
        let changed = false
        let justDisabled = false
        if (rt.allowTurn) {
          rt.allowTurn = false
          changed = true
        }
        if (rt.pending) {
          rt.pending = false
          rt.disabled = true
          rt.since = Date.now()
          changed = true
          justDisabled = true
        }
        if (changed) writeJson(runtimePath(), rt)
        if (justDisabled) {
          void petSay('额度用完了，这个任务跑完我就先停用了。想再来一轮，侧边栏里点「再用一次」。', cfg)
        }
      } catch (e) {
        log.warn?.(`[dsh-budget] turn/end 处理失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }),
  )

  /**
   * 拦模型调用：`llm/stream` 是监听器瀑布（见 dsh-cost-meter/lib/billing-stream.js:1-12），
   * 不调 next() 直接抛错就等于这次调用没发出去，回合随之失败——这就是「停用」。
   */
  ctx.effect(() =>
    ctx.on('llm/stream', (options, next) => {
      const cfg = readConfig()
      if (cfg.autoDisable) {
        const rt = runtimeFor(dayKeyOf(new Date()))
        if (blockedBy(rt, cfg)) throw refuse()
      }
      return next()
    }),
  )

  // ---- 路由：/plugins/dsh-budget/{status,config,check,reset,allow-once,resume} ----
  // 一律用 exact 注册：`/plugins/dsh-budget/client.js` 是宿主自己发的客户端束，
  // 用 prefix 会把它一起吞掉（返回 404），侧边栏就永远出不来。
  for (const endpoint of ['status', 'check', 'reset', 'allow-once', 'resume', 'config', 'sync']) {
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/${endpoint}`,
        handler: async (req, res) => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const rest = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '')
        try {
          if (rest === 'status' && req.method === 'GET') {
            const result = await status()
            return sendJson(res, result.ok ? 200 : 503, result)
          }
          if (rest === 'check' && req.method === 'POST') {
            const result = await evaluate('manual')
            return sendJson(res, result ? 200 : 503, result ?? { ok: false, reason: 'cost-meter-unavailable' })
          }
          // 手动采一次余额（也会顺手重算一遍账）
          if (rest === 'sync' && (req.method === 'POST' || req.method === 'GET')) {
            const synced = await syncBilling()
            const result = await status()
            return sendJson(res, synced.ok ? 200 : 502, {
              ok: synced.ok,
              reason: synced.reason,
              billing: result.billing ?? null,
              plan: result.ok ? result.plan : null,
            })
          }
          // 清掉当天提醒标记（调参/重测用，不改额度）
          if (rest === 'reset' && req.method === 'POST') {
            writeJson(statePath(), { dayKey: '', low: false, zero: false })
            writeJson(runtimePath(), { ...EMPTY_RUNTIME, dayKey: dayKeyOf(new Date()) })
            return sendJson(res, 200, { ok: true })
          }
          // 「再用一次」：放行到下一个回合结束，然后重新停用
          if (rest === 'allow-once' && req.method === 'POST') {
            const cfg = readConfig()
            const today = dayKeyOf(new Date())
            const rt = runtimeFor(today)
            rt.allowTurn = true
            rt.pending = false
            writeJson(runtimePath(), rt)
            void petSay('好，放你一轮。用完这轮就真停了。', cfg)
            const result = await status()
            return sendJson(res, 200, { ok: true, gate: result.ok ? result.gate : gateOf(cfg, computePlan({}, cfg)) })
          }
          // 今天手动恢复：清停用，且当天不再自动停用
          if (rest === 'resume' && req.method === 'POST') {
            const today = dayKeyOf(new Date())
            const rt = runtimeFor(today)
            rt.disabled = false
            rt.pending = false
            rt.allowTurn = false
            rt.mutedDay = today
            rt.since = 0
            writeJson(runtimePath(), rt)
            const result = await status()
            return sendJson(res, 200, { ok: true, gate: result.ok ? result.gate : null, plan: result.ok ? result.plan : null })
          }
          if (rest === 'config') {
            if (req.method === 'GET') return sendJson(res, 200, { ok: true, config: publicConfig(readConfig()) })
            if (req.method === 'POST' || req.method === 'PUT') {
              const text = await readBody(req)
              let patch
              try {
                patch = JSON.parse(text || '{}')
              } catch {
                return sendJson(res, 400, { ok: false, reason: 'invalid-json' })
              }
              const config = saveConfig(patch)
              // 改完立刻重算一次：别等下一个 30s 拍
              const result = await evaluate('config')
              const fresh = await status()
              return sendJson(res, 200, {
                ok: true,
                config: publicConfig(config),
                plan: result?.plan ?? null,
                gate: result?.gate ?? null,
                billing: fresh.billing ?? null,
              })
            }
          }
          return sendJson(res, 404, { ok: false, reason: 'not-found' })
        } catch (e) {
          log.warn?.(`[dsh-budget] route failed: ${e instanceof Error ? e.message : String(e)}`)
          return sendJson(res, 500, { ok: false, reason: 'internal-error' })
        }
        },
      }),
    )
  }

  // ---- 斜杠命令 /budget ---------------------------------------------------
  ctx.effect(() =>
    ctx.commands.register({
      name: 'budget',
      description: '查看本月额度 / 改额度（/budget 300）',
      input: { hint: '[空=查看 | <数字>=改月额度 | on|off=提醒 | stop=超额停用 | once=再用一次 | resume=今天恢复 | sync=账单同步 | sync!=立刻同步]' },
      handler: async (invocation) => {
        const arg = String(invocation?.rawInput ?? invocation?.args ?? '').trim()
        if (!arg) {
          const result = await status()
          if (!result.ok) return { kind: 'error', text: '计费服务不可用，读不到用量' }
          return { kind: 'success', text: summaryText(result.plan, result.gate) }
        }
        if (/^\d+(\.\d+)?$/.test(arg)) {
          saveConfig({ monthlyQuota: Number(arg) })
          const result = await status()
          const plan = result.plan
          return {
            kind: 'success',
            text: plan ? `月额度改成 ${arg} ${plan.currency}，日均 ${plan.dailyAverage}（${plan.totalWorkdays} 个工作日）` : `月额度改成 ${arg}`,
          }
        }
        if (arg === 'on' || arg === 'off') {
          saveConfig({ remind: arg === 'on' })
          return { kind: 'success', text: arg === 'on' ? '桌宠提醒已打开' : '桌宠提醒已关掉' }
        }
        // 超额停用的三件套：stop 开关、once 放行一轮、resume 今天不再自动停
        if (arg === 'stop') {
          const next = !readConfig().autoDisable
          saveConfig({ autoDisable: next })
          return { kind: 'success', text: next ? '超额自动停用已打开' : '超额自动停用已关闭' }
        }
        if (arg === 'once') {
          const today = dayKeyOf(new Date())
          const rt = runtimeFor(today)
          rt.allowTurn = true
          rt.pending = false
          writeJson(runtimePath(), rt)
          return { kind: 'success', text: '放行一轮：这轮跑完再停' }
        }
        if (arg === 'resume') {
          const today = dayKeyOf(new Date())
          const rt = runtimeFor(today)
          rt.disabled = false
          rt.pending = false
          rt.allowTurn = false
          rt.mutedDay = today
          rt.since = 0
          writeJson(runtimePath(), rt)
          return { kind: 'success', text: '今天不再自动停用了' }
        }
        // 账单同步：sync 开关 / sync! 立刻采一次
        if (arg === 'sync' || arg === 'billsync') {
          const next = !readConfig().billSync
          saveConfig({ billSync: next })
          return { kind: 'success', text: next ? '账单同步已打开（每 15 分钟采一次余额）' : '账单同步已关闭，改回本地估算' }
        }
        if (arg === 'sync!' || arg === 'now') {
          const synced = await syncBilling()
          if (!synced.ok) {
            return { kind: 'error', text: synced.reason === 'off' ? '账单同步关着，先 /budget sync 打开' : '取不到用量也取不到余额：账号没登录，也没配 API Key' }
          }
          const b = synced.billing
          const where = b.source === 'usage' ? '平台用量接口' : '余额采样'
          return {
            kind: 'success',
            text: `本月已花 ${round2(b.monthTotal ?? 0)} ${b.currency}，余额 ${b.lastTotal ?? '-'}（来源：${where}）`,
          }
        }
        return { kind: 'error', text: '用法：/budget（查看）｜/budget 300（改月额度）｜/budget on|off（提醒）｜/budget stop（超额停用）｜/budget once（再用一次）｜/budget resume（今天恢复）｜/budget sync|sync!（账单同步开关/立刻同步）' }
      },
    }),
  )

  // ---- 定时评估 -----------------------------------------------------------
  ctx.effect(() => {
    const run = (reason) => {
      void Promise.resolve()
        .then(() => evaluate(reason))
        .catch((e) => log.warn?.(`[dsh-budget] evaluate failed: ${e instanceof Error ? e.message : String(e)}`))
    }
    const timer = setInterval(() => run('timer'), EVAL_INTERVAL_MS)
    // 启动后 8s 先跑一次，别等满一个周期
    const kick = setTimeout(() => run('startup'), 8_000)
    // 账单同步：每 60s 看一眼「到点没」，到点才真去打余额接口（默认 15 分钟一次）
    const syncTick = () => {
      try {
        const cfg = readConfig()
        if (!cfg.billSync) return
        const last = readBilling().lastSyncMs || 0
        if (Date.now() - last < cfg.billIntervalMinutes * 60_000) return
        void Promise.resolve()
          .then(() => syncBilling())
          .catch((e) => log.warn?.(`[dsh-budget] 账单同步失败：${e instanceof Error ? e.message : String(e)}`))
      } catch (e) {
        log.warn?.(`[dsh-budget] syncTick failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    const syncTimer = setInterval(syncTick, 60_000)
    const syncKick = setTimeout(syncTick, 12_000)
    return () => {
      clearInterval(timer)
      clearTimeout(kick)
      clearInterval(syncTimer)
      clearTimeout(syncKick)
    }
  })

  log.info?.('[dsh-budget] 已装载：月额度 / 工作日日均 / 结转 / 余额账单同步 / 超额停用')
}
