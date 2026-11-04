import { currencyCode, monthlyCost } from './format'
import { request } from './http'
import type { NodeInfo, Snapshot } from './model'

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

/** Never present a partial currency sum as the fleet's total. */
export function onlineMonthlyCost(
  nodes: readonly NodeInfo[],
  snapshots: Record<string, Snapshot>,
  currency: 'CNY' | 'USD',
  rates: Record<string, number> = { USD: 1 },
) {
  let amount = 0
  let paid = 0
  let complete = true
  for (const node of nodes) {
    if (!snapshots[node.id]?.online) continue
    const monthly = monthlyCost(node.price, node.billingCycle)
    if (monthly <= 0) continue
    paid++
    const code = currencyCode(node.currency)
    if (code === currency) amount += monthly
    else if (code && rates[code] > 0 && rates[currency] > 0) amount += monthly / rates[code] * rates[currency]
    else complete = false
  }
  return { amount: complete ? amount : null, paid }
}
