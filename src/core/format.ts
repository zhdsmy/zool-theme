import type { NodeInfo, Snapshot, TrafficLimitType } from './model'

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB']

export interface Parts {
  value: string
  unit: string
}

/** Binary (1024) byte formatting, split so the unit can be styled on its own. */
export function splitBytes(bytes: number, digits?: number): Parts {
  if (!Number.isFinite(bytes) || bytes <= 0) return { value: '0', unit: 'B' }
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1)
  const v = bytes / 1024 ** i
  const d = digits ?? (i === 0 || v >= 100 ? 0 : v >= 10 ? 1 : 2)
  return { value: v.toFixed(d), unit: BYTE_UNITS[i] }
}

export const formatBytes = (bytes: number, digits?: number) => {
  const p = splitBytes(bytes, digits)
  return `${p.value} ${p.unit}`
}

export const splitSpeed = (bytesPerSecond: number): Parts => {
  const p = splitBytes(bytesPerSecond)
  return { value: p.value, unit: `${p.unit}/s` }
}

export const formatSpeed = (bytesPerSecond: number) => {
  const p = splitSpeed(bytesPerSecond)
  return `${p.value} ${p.unit}`
}

export const ratio = (used: number, total: number) =>
  total > 0 && Number.isFinite(used) ? Math.min(100, Math.max(0, (used / total) * 100)) : 0

export const formatPercent = (p: number) => (p >= 10 || p === 0 ? p.toFixed(0) : p.toFixed(1))

/** Fixed digits without trailing zeros after the decimal point: 0.50 → "0.5", 100 → "100". */
export const formatNumber = (n: number, digits = 2) => {
  if (!Number.isFinite(n)) return '0'
  const s = n.toFixed(digits)
  return digits > 0 ? s.replace(/\.?0+$/, '') : s
}

export interface Duration {
  days: number
  hours: number
  minutes: number
}

export function duration(seconds: number): Duration {
  const s = Math.max(0, Math.floor(seconds))
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
  }
}

/** Traffic counted against the quota, following Komari's `traffic_limit_type`. */
export function trafficUsed(type: TrafficLimitType, up: number, down: number) {
  switch (type) {
    case 'sum':
      return up + down
    case 'min':
      return Math.min(up, down)
    case 'up':
      return up
    case 'down':
      return down
    default:
      return Math.max(up, down)
  }
}

export function quotaUsage(node: NodeInfo, snap: Snapshot | undefined): number | null {
  // shortcut: Nezha only supplies cumulative counters; enable period percentages when cycle statistics are available.
  if (!snap || node.trafficLimitPeriod) return null
  return trafficUsed(node.trafficLimitType, snap.totalUp, snap.totalDown)
}

/** Amortises recurring bills over calendar months. Free / unset / one-time costs are zero. */
export function monthlyCost(price: number, cycleDays: number) {
  if (!Number.isFinite(price) || !Number.isFinite(cycleDays) || price <= 0 || cycleDays <= 0) return 0
  const months = cycleDays >= 28 && cycleDays <= 31 ? 1
    : cycleDays >= 360 && cycleDays <= 366 ? 12
    : ({ 90: 3, 180: 6, 182: 6, 730: 24, 1095: 36 } as Record<number, number>)[cycleDays] ?? cycleDays * 12 / 365
  return price / months
}

export const daysUntil = (at: number, now = Date.now()) => Math.ceil((at - now) / 86_400_000)

export function formatClock(at: number, withDate = false, locale?: string) {
  const d = new Date(at)
  return d.toLocaleString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(withDate ? { month: '2-digit', day: '2-digit' } : {}),
  })
}

export function currencyCode(currency: string): string | null {
  const code = currency.trim().toUpperCase()
  return ({ '$': 'USD', 'US$': 'USD', '¥': 'CNY', '￥': 'CNY', RMB: 'CNY', '€': 'EUR', 'AUD$': 'AUD', 'A$': 'AUD' } as Record<string, string>)[code]
    ?? (/^[A-Z]{3}$/.test(code) ? code : null)
}

const SYMBOLS: Record<string, string> = {
  USD: '$', CNY: '¥', EUR: '€', AUD: 'A$', HKD: 'HK$', JPY: 'JP¥', GBP: '£', TWD: 'NT$', SGD: 'S$', CAD: 'C$', KRW: '₩',
}

export function formatMoney(amount: number, currency: string) {
  const code = currencyCode(currency)
  const symbol = SYMBOLS[code ?? ''] ?? (code ? `${code} ` : currency)
  const digits = code === 'JPY' || code === 'KRW' ? 0 : 2
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}
