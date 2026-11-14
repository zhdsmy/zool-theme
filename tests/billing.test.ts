import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { parsePublicNote } from '../src/adapters/nezha'
import { useBilling } from '../src/components/bits'
import type { NodeInfo } from '../src/core/model'
import en from '../src/i18n/locales/en.json'
import zhCN from '../src/i18n/locales/zh-CN.json'
import zhTW from '../src/i18n/locales/zh-TW.json'
import ja from '../src/i18n/locales/ja.json'

const privateBilling = vi.hoisted(() => ({ loggedIn: false, actualCosts: null as Record<string, { amount: number; currency: string }> | null,
  exchangeRates: { date: '2026-11-04', rates: { USD: 1, CNY: 7, EUR: 0.9, AUD: 1.5 } } as { date: string; rates: Record<string, number> } | null }))
vi.mock('../src/app/store', () => ({
  useStore: (select: (state: unknown) => unknown) => select({ session: { loggedIn: privateBilling.loggedIn }, actualCosts: privateBilling.actualCosts, exchangeRates: privateBilling.exchangeRates }),
}))

const i18n = createInstance()
const resources = { en: { translation: en }, 'zh-CN': { translation: zhCN }, 'zh-TW': { translation: zhTW }, ja: { translation: ja } }
beforeAll(async () => { await i18n.use(initReactI18next).init({ resources, lng: 'en', interpolation: { escapeValue: false } }) })

function Billing({ node }: { node: NodeInfo }) {
  const billing = useBilling()
  return createElement('div', null, [billing.price(node), billing.actualPrice(node), billing.expiry(node)?.text, billing.quota(node)].filter(Boolean).join(' | '))
}

function render(note: object) {
  const node = { ...parsePublicNote(JSON.stringify(note)), id: 'sample' } as NodeInfo
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(Billing, { node })))
}

describe('Nezha billing display', () => {
  it.each(['en', 'zh-CN', 'zh-TW', 'ja'] as const)('shows permanent, free, period quotas and pay-as-you-go in %s', async (locale) => {
    await i18n.changeLanguage(locale)
    const t = resources[locale].translation
    const free = render({ billingDataMod: { amount: '0', endDate: '0000-00-00T23:59:59+08:00' }, planDataMod: { trafficVol: '100GB/Month' } })
    expect(free).toContain(t.metric.free)
    expect(free).toContain(t.expiry.longTerm)
    expect(free).toContain(`100 GB${t.unit.perMonth}`)
    const metered = render({ billingDataMod: { amount: '-1' } })
    expect(metered).toContain(t.metric.payAsYouGo)
    expect(metered).not.toContain(t.metric.free)
    expect(render({})).toContain(t.metric.unknown)
    expect(render({ planDataMod: { trafficVol: 'Unlimited' } })).toContain(t.metric.unlimited)
  })

  it('shows private expenses only when authenticated, with zero and empty-field inheritance', async () => {
    await i18n.changeLanguage('en')
    const displayed = { billingDataMod: { amount: 'USD 10.00', cycle: 'Month' } }
    privateBilling.actualCosts = { sample: { amount: 0, currency: 'CNY' } }
    expect(render(displayed)).not.toContain('$0.00')
    privateBilling.loggedIn = true
    expect(render(displayed)).toContain('$0.00')
    privateBilling.actualCosts = {}
    expect(render(displayed).match(/\$10\.00/g)).toHaveLength(2)
    privateBilling.actualCosts = null
    expect(render(displayed).match(/\$10\.00/g)).toHaveLength(1)
    privateBilling.loggedIn = false
  })

  it.each(['en', 'zh-CN', 'zh-TW', 'ja'] as const)('uses the locale currency for both bills and preserves the year cycle in %s', async (locale) => {
    await i18n.changeLanguage(locale)
    privateBilling.loggedIn = true
    privateBilling.actualCosts = { sample: { amount: 14, currency: 'CNY' } }
    const html = render({ billingDataMod: { amount: 'EUR 9.00', cycle: 'Year' } })
    const unit = resources[locale].translation.unit.perYear
    expect(html).toContain(`${locale === 'zh-CN' ? '¥70.00' : '$10.00'}${unit}`)
    expect(html).toContain(`${locale === 'zh-CN' ? '¥14.00' : '$2.00'}${unit}`)
    expect(html).not.toContain('€')
    privateBilling.loggedIn = false
    privateBilling.actualCosts = null
  })

  it('withholds an unconvertible bill while zero remains displayable without rates', async () => {
    await i18n.changeLanguage('en')
    privateBilling.exchangeRates = null
    privateBilling.loggedIn = true
    privateBilling.actualCosts = { sample: { amount: 0, currency: 'CNY' } }
    const html = render({ billingDataMod: { amount: 'CNY 70.00', cycle: 'Month' } })
    expect(html).toContain('—')
    expect(html).toContain('$0.00')
    expect(html).not.toContain('¥70.00')
    privateBilling.loggedIn = false
    privateBilling.actualCosts = null
  })

  it('restates recurring bills per month or year and keeps the original currency on request', async () => {
    await i18n.changeLanguage('zh-CN')
    privateBilling.exchangeRates = { date: '2026-11-04', rates: { USD: 1, CNY: 7, EUR: 0.9, AUD: 1.5 } }
    const saved: Record<string, string> = {}
    vi.stubGlobal('localStorage', { getItem: (k: string) => saved[k] ?? null, setItem: (k: string, v: string) => { saved[k] = v } })
    const yearly = { billingDataMod: { amount: 'EUR 9.00', cycle: 'Year' } }
    saved['zool:period'] = 'month'
    expect(render(yearly)).toContain('¥5.83/月')
    saved['zool:currency'] = 'USD'
    saved['zool:period'] = 'year'
    expect(render(yearly)).toContain('$10.00/年')
    saved['zool:currency'] = 'original'
    expect(render(yearly)).toContain('€9.00/年')
    saved['zool:period'] = 'original'
    expect(render({ billingDataMod: { amount: 'USD 100', cycle: '-1' } })).not.toContain('/年')
    vi.unstubAllGlobals()
  })
})
