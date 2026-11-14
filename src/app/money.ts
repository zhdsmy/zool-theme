import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { displayCurrency } from '@/core/cost'

/**
 * How bills are shown, chosen on the home page and kept per browser. `original` leaves each
 * node's own currency or billing cycle alone; the default is the locale currency and each
 * node's own cycle, which is how bills read before the choice existed.
 */
export type MoneyCurrency = 'original' | string
export type MoneyPeriod = 'original' | 'month' | 'year'

const KEYS = { currency: 'zool:currency', period: 'zool:period' } as const
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l())
}

const getCurrency = () => {
  const v = read(KEYS.currency)
  return v === 'original' || (v && /^[A-Z]{3}$/.test(v)) ? v : null
}
const getPeriod = (): MoneyPeriod => {
  const v = read(KEYS.period)
  return v === 'month' || v === 'year' ? v : 'original'
}

export const setMoneyCurrency = (currency: MoneyCurrency) => write(KEYS.currency, currency)
export const setMoneyPeriod = (period: MoneyPeriod) => write(KEYS.period, period)

export function useMoney(): { currency: MoneyCurrency; period: MoneyPeriod } {
  const { i18n } = useTranslation()
  const currency = useSyncExternalStore(subscribe, getCurrency, getCurrency)
  const period = useSyncExternalStore(subscribe, getPeriod, getPeriod)
  return { currency: currency ?? displayCurrency(i18n.resolvedLanguage), period }
}
