import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import { useStore } from '@/app/store'
import { convertAmount, displayCurrency } from '@/core/cost'
import type { NodeInfo } from '@/core/model'
import { FLAG_CODES } from '@/core/flags.manifest'
import { regionFlagCode } from '@/core/region'
import { daysUntil, duration, formatBytes, formatMoney, formatPercent, splitBytes, splitSpeed, type Parts } from '@/core/format'

export function StatusDot({ online, pending, className = '' }: { online: boolean; pending?: boolean; className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      className={`status-dot ${className}`}
      data-online={pending ? undefined : online}
      data-pending={pending ? '' : undefined}
      role="img"
      aria-label={t(pending ? 'status.connecting' : online ? 'status.online' : 'status.offline')}
    />
  )
}

/** A number with a smaller unit, e.g. 3.11 MB/s. */
export function Quantity({ parts, className = '', unitClassName = '' }: { parts: Parts; className?: string; unitClassName?: string }) {
  return (
    <span className={`num whitespace-nowrap ${className}`}>
      {parts.value}
      <span className={`ml-[0.2em] text-[0.72em] text-muted ${unitClassName}`}>{parts.unit}</span>
    </span>
  )
}

export const Bytes = ({ value, className, digits }: { value: number; className?: string; digits?: number }) => (
  <Quantity parts={splitBytes(value, digits)} className={className} />
)

export const Speed = ({ value, className }: { value: number; className?: string }) => (
  <Quantity parts={splitSpeed(value)} className={className} />
)

export const Percent = ({ value, className }: { value: number; className?: string }) => (
  <Quantity parts={{ value: formatPercent(value), unit: '%' }} className={className} />
)

export function useUptime() {
  const { t } = useTranslation()
  return (seconds: number) => {
    const d = duration(seconds)
    if (d.days > 0) return t('unit.days', { count: d.days })
    if (d.hours > 0) return `${d.hours}${t('unit.hourShort')} ${d.minutes}${t('unit.minuteShort')}`
    return `${d.minutes}${t('unit.minuteShort')}`
  }
}

export function useBilling() {
  const { t, i18n } = useTranslation()
  const loggedIn = useStore((s) => s.session.loggedIn)
  const actualCosts = useStore((s) => s.actualCosts)
  const rates = useStore((s) => s.exchangeRates)
  const currency = displayCurrency(i18n.resolvedLanguage)
  const cycle = (days: number) => {
    if (days <= 0) return days === -1 ? ` ${t('unit.oneTime')}` : ''
    if (days >= 28 && days <= 31) return t('unit.perMonth')
    if (days >= 360 && days <= 366) return t('unit.perYear')
    return t('unit.perDays', { count: days })
  }
  const price = (n: NodeInfo) => {
    if (n.price === -2) return t('metric.payAsYouGo')
    if (n.price === -1) return t('metric.free')
    if (!(n.price > 0)) return ''
    return money(n.price, n.currency, n.billingCycle)
  }
  const money = (amount: number, source: string, days: number) => {
    const converted = convertAmount(amount, source, currency, rates?.rates)
    return converted === null ? '—' : `${formatMoney(converted, currency)}${cycle(days)}`
  }
  return {
    price,
    actualPrice(n: NodeInfo) {
      if (!loggedIn || actualCosts === null) return ''
      const actual = actualCosts[n.id]
      return actual ? money(actual.amount, actual.currency, n.billingCycle) : price(n)
    },
    quota(n: NodeInfo) {
      if (n.trafficLimit < 0) return t('metric.unknown')
      if (n.trafficLimit === 0) return t('metric.unlimited')
      return `${formatBytes(n.trafficLimit)}${cycle(n.trafficLimitPeriod ?? 0)}`
    },
    expiry(n: NodeInfo): { text: string; level?: 'warn' | 'danger' } | null {
      if (n.expiredAt === null) return null
      if (n.expiredAt === 0) return { text: t('expiry.longTerm') }
      const days = daysUntil(n.expiredAt)
      if (days > 3650) return { text: t('expiry.longTerm') }
      if (days < 0) return { text: t('expiry.expired'), level: 'danger' }
      if (days === 0) return { text: t('expiry.today'), level: 'danger' }
      return { text: t('expiry.inDays', { count: days }), level: days <= 7 ? 'danger' : days <= 30 ? 'warn' : undefined }
    },
  }
}

export function useRelativeTime() {
  const { i18n } = useTranslation()
  return (at: number) => {
    const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
    const s = Math.round((at - Date.now()) / 1000)
    const abs = Math.abs(s)
    if (abs < 60) return rtf.format(s, 'second')
    if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
    if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
    return rtf.format(Math.round(s / 86400), 'day')
  }
}

/**
 * A region's flag, served from this site (`public/flags`, flag-icons 4:3). Decoration only:
 * the code or name always sits beside it, so it is hidden from assistive technology. An
 * unknown or malformed code gets a neutral globe rather than a guessed file name.
 */
export function RegionFlag({ code, className = '' }: { code: string; className?: string }) {
  const cc = regionFlagCode(code, FLAG_CODES)
  if (!cc) return <Globe size={12} strokeWidth={1.7} className={`shrink-0 text-faint ${className}`} aria-hidden />
  return <img className={`flag ${className}`} src={`/flags/${cc}.svg`} alt="" aria-hidden="true" width={16} height={12} loading="lazy" decoding="async" />
}

/** Two-letter region code with its flag, in a quiet mono tag. */
export function RegionTag({ code, className = '' }: { code: string; className?: string }) {
  if (!code) return null
  return (
    <span
      className={`inline-flex h-[20px] items-center gap-1 rounded-[6px] border border-line bg-surface-2 px-1.5 font-mono text-[11px] leading-none tracking-wide text-muted ${className}`}
    >
      <RegionFlag code={code} />
      {code}
    </span>
  )
}

/**
 * A single line that slides back and forth when it does not fit, instead of ending in "…".
 * It only moves when it overflows, and never under reduced motion, where the ellipsis stays.
 */
export function Marquee({ text, className = '' }: { text: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = box.current
    const inner = el?.firstElementChild as HTMLElement | null
    if (!el || !inner) return
    const fit = () => {
      // offsetWidth ignores the transform, so the slide itself never reads as "fits now"
      const over = inner.offsetWidth - el.clientWidth
      if (over > 1) {
        el.dataset.marquee = ''
        el.style.setProperty('--marquee-shift', `${-over}px`)
        // about 30px/s with a pause at each end; at least 4s, or a few pixels of overflow reads as a twitch
        el.style.setProperty('--marquee-time', `${Math.max(4, over / 30 / 0.6 + 1).toFixed(1)}s`)
      } else delete el.dataset.marquee
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])
  return (
    <span ref={box} className={`marquee ${className}`} title={text}>
      <span>{text}</span>
    </span>
  )
}
