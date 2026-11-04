import { currencyCode, monthlyCost } from './format'
import { request } from './http'
import type { ActualCost, NodeInfo, Snapshot } from './model'

export interface ExchangeRates {
  date: string
  rates: Record<string, number>
  stale?: boolean
}

const CACHE_KEY = 'zool:exchange-rates'
let loading: Promise<ExchangeRates> | undefined

function parseRates(data: unknown): ExchangeRates {
  if (!Array.isArray(data) || data.length === 0) throw new Error('Missing exchange rates')
  const rates: Record<string, number> = { USD: 1 }
  let date = ''
  for (const row of data) {
    if (!row || row.base !== 'USD' || !/^[A-Z]{3}$/.test(row.quote) ||
      !Number.isFinite(row.rate) || row.rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      throw new Error('Invalid exchange rates')
    }
    if (row.quote !== 'USD') rates[row.quote] = row.rate
    if (row.date > date) date = row.date
  }
  return { date, rates }
}

async function fetchRates(): Promise<ExchangeRates> {
  let cached: ExchangeRates | undefined
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')
    if (saved && Number.isFinite(saved.savedAt)) {
      cached = parseRates(saved.data)
      const age = Date.now() - saved.savedAt
      if (age >= 0 && age < 86_400_000) return cached
    }
  } catch {
    /* Storage may be unavailable or contain an older cache format. */
  }
  try {
    const data = await request<unknown>('https://api.frankfurter.dev/v2/rates?base=USD', { credentials: 'omit' })
    const result = parseRates(data)
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }))
    } catch {
      /* A successful conversion does not require persistent storage. */
    }
    return result
  } catch (error) {
    if (cached) return { ...cached, stale: true }
    throw error
  }
}

export function loadExchangeRates() {
  return loading ??= fetchRates().finally(() => { loading = undefined })
}

export const displayCurrency = (locale?: string) => locale === 'zh-CN' ? 'CNY' : 'USD'

export function convertAmount(amount: number, source: string, target: 'CNY' | 'USD', rates: Record<string, number> = { USD: 1 }): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null
  if (amount === 0) return 0
  const code = currencyCode(source)
  if (code === target) return amount
  if (!code || !Number.isFinite(rates[code]) || rates[code] <= 0 || !Number.isFinite(rates[target]) || rates[target] <= 0) return null
  return amount / rates[code] * rates[target]
}

/** Never present a partial currency sum as the fleet's total. */
export function onlineMonthlyCost(
  nodes: readonly NodeInfo[],
  snapshots: Record<string, Snapshot>,
  currency: 'CNY' | 'USD',
  rates: Record<string, number> = { USD: 1 },
  actualCosts?: Record<string, ActualCost>,
) {
  let amount = 0
  let paid = 0
  let complete = true
  for (const node of nodes) {
    if (!snapshots[node.id]?.online) continue
    const actual = actualCosts?.[node.id]
    const monthly = monthlyCost(actual?.amount ?? node.price, node.billingCycle)
    if (monthly <= 0) continue
    paid++
    const converted = convertAmount(monthly, actual?.currency ?? node.currency, currency, rates)
    if (converted === null) complete = false
    else amount += converted
  }
  return { amount: complete ? amount : null, paid }
}
