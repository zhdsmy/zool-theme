import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadExchangeRates, onlineMonthlyCost } from '../src/core/cost'
import { currencyCode, formatMoney } from '../src/core/format'
import type { NodeInfo, Snapshot } from '../src/core/model'

const rates = { USD: 1, CNY: 7, EUR: 0.9, AUD: 1.5 }
const wire = Object.entries(rates).filter(([quote]) => quote !== 'USD')
  .map(([quote, rate]) => ({ base: 'USD', quote, rate, date: '2026-11-03' }))
const node = (id: string, currency: string, price: number, billingCycle = 30) =>
  ({ id, currency, price, billingCycle }) as NodeInfo
const online = { online: true } as Snapshot

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('monthly fleet cost', () => {
  const nodes = [
    node('usd', '$', 120, 365), node('cny', '￥', 70), node('eur', 'EUR', 9), node('aud', 'AUD$', 15),
    node('offline', '$', 12), node('unseen', '$', 100), node('free', 'CNY', -1), node('once', '$', 100, -1),
  ]
  const snapshots = Object.fromEntries(nodes.filter(n => n.id !== 'unseen')
    .map(n => [n.id, { online: n.id !== 'offline' } as Snapshot]))

  it('converts every online recurring bill to the selected currency', () => {
    expect(onlineMonthlyCost(nodes, snapshots, 'USD', rates)).toEqual({ amount: 40, paid: 4 })
    expect(onlineMonthlyCost(nodes, snapshots, 'CNY', rates)).toEqual({ amount: 280, paid: 4 })
  })

  it('does not misrepresent missing rates as a partial total', () => {
    expect(onlineMonthlyCost(nodes, snapshots, 'USD')).toEqual({ amount: null, paid: 4 })
    expect(onlineMonthlyCost([node('x', 'XYZ', 1)], { x: online }, 'USD', rates).amount).toBeNull()
    expect(onlineMonthlyCost([node('x', 'CNY', 70)], { x: online }, 'CNY')).toEqual({ amount: 70, paid: 1 })
    expect(onlineMonthlyCost([], {}, 'USD')).toEqual({ amount: 0, paid: 0 })
  })

  it('uses ISO currency codes and unambiguous two-decimal prices', () => {
    for (const alias of ['¥', '￥', 'RMB', 'cny']) expect(currencyCode(alias)).toBe('CNY')
    expect(formatMoney(1888, 'CNY')).toBe('¥1888.00')
    expect(formatMoney(36, 'USD')).toBe('$36.00')
    expect(formatMoney(30.48, 'AUD$')).toBe('A$30.48')
    expect(formatMoney(19.98, 'EUR')).toBe('€19.98')
  })
})

describe('exchange rates', () => {
  function storage(value: string | null = null) {
    const store = { getItem: vi.fn(() => value), setItem: vi.fn() }
    vi.stubGlobal('localStorage', store)
    return store
  }

  it('fetches once for concurrent callers, validates and caches daily rates', async () => {
    const store = storage()
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(wire)))
    vi.stubGlobal('fetch', fetch)
    const [first, second] = await Promise.all([loadExchangeRates(), loadExchangeRates()])
    expect(first).toEqual({ date: '2026-11-03', rates })
    expect(second).toEqual(first)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1].credentials).toBe('omit')
    expect(store.setItem).toHaveBeenCalledOnce()
  })

  it('uses a fresh cache without requesting rates', async () => {
    storage(JSON.stringify({ savedAt: Date.now(), data: wire }))
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await loadExchangeRates()).toEqual({ date: '2026-11-03', rates })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('marks the last valid cache when the refresh fails', async () => {
    storage(JSON.stringify({ savedAt: Date.now() - 86_400_001, data: wire }))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await loadExchangeRates()).toEqual({ date: '2026-11-03', rates, stale: true })
  })

  it.each([[], [{ ...wire[0], rate: 0 }], [{ ...wire[0], rate: -1 }], [{ ...wire[0], base: 'EUR' }]].map(data => ({ data })))
    ('rejects invalid rates instead of silently omitting currencies: $data', async ({ data }) => {
      storage()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(data))))
      await expect(loadExchangeRates()).rejects.toThrow(/exchange rates/)
    })
})
