import { beforeAll, describe, expect, it } from 'vitest'
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

const i18n = createInstance()
const resources = { en: { translation: en }, 'zh-CN': { translation: zhCN }, 'zh-TW': { translation: zhTW }, ja: { translation: ja } }
beforeAll(async () => { await i18n.use(initReactI18next).init({ resources, lng: 'en', interpolation: { escapeValue: false } }) })

function Billing({ node }: { node: NodeInfo }) {
  const billing = useBilling()
  return createElement('div', null, [billing.price(node), billing.expiry(node)?.text, billing.quota(node)].filter(Boolean).join(' | '))
}

function render(note: object) {
  const node = parsePublicNote(JSON.stringify(note)) as NodeInfo
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
})
