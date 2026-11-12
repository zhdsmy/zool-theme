import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownUp, Check, ChevronDown, LayoutGrid, List, ListTree, Rows2, Rows3 } from 'lucide-react'
import { adapter, useStore, useVisibleNodes } from '@/app/store'
import { setDensity, setGrouping, setView, useDensity, useGrouping, useView } from '@/app/prefs'
import type { Density, View } from '@/core/settings'
import type { NodeInfo, Snapshot } from '@/core/model'
import { formatMoney, formatPercent, ratio, splitBytes, splitSpeed } from '@/core/format'
import { displayCurrency, onlineMonthlyCost } from '@/core/cost'
import { regionName, stripFlag } from '@/core/region'
import { Popover } from '@/components/Popover'
import { GroupHeading, NodeCard, NodeStrip } from '@/components/ledger'
import { levelFor, type Level } from '@/components/instruments'
import { RegionFlag, StatusDot } from '@/components/bits'
import { groupCounts, parseFilterQuery, sectionize, serializeFilterQuery, type Filter } from '@/core/filter'

/* ---------- sorting ---------- */

const SORT_KEYS = ['default', 'name', 'cpu', 'memory', 'network', 'traffic', 'uptime', 'expiry'] as const
type SortKey = (typeof SORT_KEYS)[number]
type Sort = { key: SortKey; desc: boolean }

const DEFAULT_DESC: Record<SortKey, boolean> = {
  default: false,
  name: false,
  cpu: true,
  memory: true,
  network: true,
  traffic: true,
  uptime: true,
  expiry: false,
}

function readSort(): Sort {
  try {
    const v = JSON.parse(localStorage.getItem('zool:sort') ?? '') as Sort
    if (SORT_KEYS.includes(v.key)) return v
  } catch {
    /* default */
  }
  return { key: 'default', desc: false }
}

function sortValue(key: SortKey, n: NodeInfo, s: Snapshot | undefined): number | string {
  switch (key) {
    case 'name':
      return stripFlag(n.name).toLowerCase()
    case 'cpu':
      return s?.online ? s.cpu : -1
    case 'memory':
      return s?.online ? ratio(s.memUsed, s.memTotal || n.memTotal) : -1
    case 'network':
      return s?.online ? s.netUp + s.netDown : -1
    case 'traffic':
      return s ? s.totalUp + s.totalDown : -1
    case 'uptime':
      return s?.online ? s.uptime : -1
    case 'expiry':
      return n.expiredAt || Number.MAX_SAFE_INTEGER
    default:
      return n.weight
  }
}

/* ---------- filter ---------- */

const FILTER_KEY = 'zool:filter'

/**
 * An address that carries any filter is taken whole: a shared link means exactly what it says,
 * and is not merged with whatever this visitor had picked before (a shared group plus a
 * remembered region can leave nothing to show). It also becomes the visitor's last choice.
 * Without one, the last choice comes back; without that, nothing is picked.
 */
function readFilter(): Filter {
  const q = parseFilterQuery(window.location.search)
  if (q.groups !== undefined || q.region !== undefined) {
    const fromLink = { groups: q.groups ?? [], region: q.region ?? null }
    remember(fromLink)
    return fromLink
  }
  let stored: Partial<Filter> = {}
  try {
    stored = JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}') as Partial<Filter>
  } catch {
    /* nothing stored */
  }
  return {
    groups: Array.isArray(stored.groups) ? stored.groups.filter((g): g is string => typeof g === 'string') : [],
    region: typeof stored.region === 'string' ? stored.region : null,
  }
}

function remember(filter: Filter) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filter))
  } catch {
    /* private mode */
  }
}

/** Puts the filter in the address without adding a history entry. */
function showInAddress(filter: Filter) {
  const { pathname, search, hash } = window.location
  const next = serializeFilterQuery(search, filter)
  if (next !== search) window.history.replaceState(window.history.state, '', `${pathname}${next}${hash}`)
}

/* ---------- overview ---------- */

/**
 * One figure in the overview band: a quiet label, the number, and the detail underneath.
 *
 * This is the top of the page, so it is the largest type on it — but only just. The headline
 * it replaces was 52px to say one sentence, which spent the most valuable part of the screen
 * on the least information. 24px is enough to lead.
 */
function Metric({
  label,
  value,
  sub,
  tone = '',
  className = '',
  subOnPhone = false,
  inlineOnPhone = false,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: string
  className?: string
  /** On a phone the band is three narrow columns; only a sub line that names something keeps its place. */
  subOnPhone?: boolean
  /** On a phone, put the value beside its label on the first line so the sub line sits directly below. */
  inlineOnPhone?: boolean
}) {
  // Before the first live frame every total is zero, and "0 / 17 online" in red is a false
  // alarm; the band waits with dashes in the same places instead.
  const fed = useStore((s) => s.fed)
  return (
    <div className={`home-metric min-w-0 py-3 md:px-3 md:py-3 md:first:pl-0 lg:px-5 lg:py-5 ${className}`}>
      <div className={inlineOnPhone ? 'flex items-baseline justify-between gap-1.5 md:block' : ''}>
        <p className="truncate text-[10.5px] leading-tight text-muted md:text-[12px] md:leading-normal">{label}</p>
        <p
          className={`num truncate text-[16px] leading-none font-medium tracking-[-0.025em] md:mt-1.5 md:text-[21px] md:font-light lg:text-[24px] ${
            inlineOnPhone ? 'shrink-0' : 'mt-1'
          } ${fed ? tone : 'text-faint'}`}
        >
          {fed ? value : '—'}
        </p>
      </div>
      {sub ? (
        <p className={`num mt-1 truncate text-[10.5px] leading-tight text-muted md:mt-2 md:line-clamp-2 md:text-[11px] md:leading-normal md:whitespace-normal ${subOnPhone ? '' : 'hidden md:block'}`}>
          {fed ? sub : '—'}
        </p>
      ) : null}
    </div>
  )
}

const Pair = ({ up, down }: { up: string; down: string }) => (
  <>
    ↑ {up} · ↓ {down}
  </>
)

/* ---------- page ---------- */

const anchorId = (group: string) => `group-${encodeURIComponent(group).replace(/%/g, '')}`

export function HomePage() {
  const { t, i18n } = useTranslation()
  const nodes = useVisibleNodes()
  const snapshots = useStore((s) => s.snapshots)
  const connection = useStore((s) => s.connection)
  const settings = useStore((s) => s.settings)
  const loggedIn = useStore((s) => s.session.loggedIn)
  const actualCosts = useStore((s) => s.actualCosts)
  const description = useStore((s) => s.site?.description)
  const tick = useStore((s) => s.liveVersion)
  const view = useView(settings.defaultView)
  const density = useDensity(settings.defaultDensity)
  const grouping = useGrouping(settings.defaultGrouped ? 'grouped' : 'flat')
  const [filter, setFilterState] = useState<Filter>(readFilter)
  const setFilter = (next: Filter) => {
    setFilterState(next)
    remember(next)
    showInAddress(next)
  }
  const [sort, setSortState] = useState<Sort>(readSort)
  const rates = useStore((s) => s.exchangeRates)
  const rateError = useStore((s) => s.exchangeRateError)
  const costCurrency = displayCurrency(i18n.resolvedLanguage)
  const cost = useMemo(() => loggedIn && actualCosts === null ? { amount: null, paid: 0 }
    : onlineMonthlyCost(nodes, snapshots, costCurrency, rates?.rates, loggedIn ? actualCosts ?? undefined : undefined),
  [nodes, snapshots, costCurrency, rates, loggedIn, actualCosts])

  const setSort = (next: Sort) => {
    setSortState(next)
    try {
      localStorage.setItem('zool:sort', JSON.stringify(next))
    } catch {
      /* private mode */
    }
  }

  const online = nodes.filter((n) => snapshots[n.id]?.online).length
  const offline = nodes.length - online
  const fed = useStore((s) => s.fed)

  /** Fleet totals for the summary line. */
  const totals = useMemo(() => {
    let up = 0
    let down = 0
    let trafficUp = 0
    let trafficDown = 0
    // Nodes with a reading past its own warning line, and the worst one of them. An average
    // across the fleet would be arithmetic without meaning — a 1-core VPS and a 16-core box
    // contribute equally to it — whereas this answers the only question a summary owes you.
    let attention = 0
    let worst: { name: string; metric: 'cpu' | 'memory' | 'disk'; pct: number; level: Level } | null = null
    for (const n of nodes) {
      const s = snapshots[n.id]
      if (s?.online) {
        up += s.netUp
        down += s.netDown
        const readings = [
          ['cpu', s.cpu],
          ['memory', ratio(s.memUsed, s.memTotal || n.memTotal)],
          ['disk', ratio(s.diskUsed, s.diskTotal || n.diskTotal)],
        ] as const
        let flagged = false
        for (const [metric, pct] of readings) {
          const level = levelFor(metric, pct)
          if (level === 'good') continue
          flagged = true
          // Past its red line outranks further past an amber one: disk 91% is amber, CPU 86% is
          // red, and the red one is the worst. Thresholds differ per metric, so compare levels first.
          const rank = level === 'danger' ? 1 : 0
          const worstRank = worst?.level === 'danger' ? 1 : 0
          if (!worst || rank > worstRank || (rank === worstRank && pct > worst.pct)) worst = { name: n.name, metric, pct, level }
        }
        if (flagged) attention++
      }
      if (s) {
        trafficUp += s.totalUp
        trafficDown += s.totalDown
      }
    }
    return {
      up,
      down,
      trafficUp,
      trafficDown,
      traffic: trafficUp + trafficDown,
      attention,
      worst,
      regions: new Set(nodes.map((n) => n.region).filter(Boolean)).size,
    }
  }, [nodes, snapshots])

  const visible = useMemo(
    // Nodes still waiting for their first snapshot stay listed: hiding them would show an empty page.
    () => (settings.showOffline ? nodes : nodes.filter((n) => snapshots[n.id]?.online || (!fed && !snapshots[n.id]))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, fed, settings.showOffline, settings.showOffline ? 0 : online],
  )

  const regions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of visible) if (n.region) counts.set(n.region, (counts.get(n.region) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [visible])

  const groups = useMemo(() => groupCounts(visible), [visible])
  // A group offered only to be told "there are no groups" is noise: one bucket is no choice.
  const offerGroups = settings.showGroups && groups.length > 1
  const offerRegions = settings.showRegions && regions.length > 1

  // A saved or shared choice can name a group or region that is not on this page any more;
  // it is ignored rather than leaving the visitor looking at an empty page with no way back.
  const pickedGroups = useMemo(
    () => (offerGroups ? filter.groups.filter((g) => groups.some(([name]) => name === g)) : []),
    [offerGroups, filter.groups, groups],
  )
  const pickedRegion = offerRegions && filter.region && regions.some(([code]) => code === filter.region) ? filter.region : null
  const filtering = pickedGroups.length > 0 || pickedRegion !== null

  // Keep the address in step with what is shown once the page knows its groups and regions.
  // Only the address: what is ignored here may be back on the next update (a node whose first
  // snapshot has not arrived yet), so the visitor's own choice is never overwritten with it.
  useEffect(() => {
    if (!visible.length) return
    showInAddress({ groups: pickedGroups, region: pickedRegion })
  }, [visible.length, pickedGroups, pickedRegion])

  /** Sections keep their natural order (lightest node first); rows inside follow the sort. */
  const sections = useMemo(() => {
    const inRegion = pickedRegion ? visible.filter((n) => n.region === pickedRegion) : visible
    const dir = sort.desc ? -1 : 1
    return sectionize(inRegion, pickedGroups, offerGroups && grouping === 'grouped')
      .map(({ name, titled, nodes: members }) => {
        const rows = [...members].sort((a, b) => {
          const va = sortValue(sort.key, a, snapshots[a.id])
          const vb = sortValue(sort.key, b, snapshots[b.id])
          const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)
          return c * dir || a.weight - b.weight || a.name.localeCompare(b.name)
        })
        let up = 0
        let down = 0
        for (const n of rows) {
          const s = snapshots[n.id]
          if (s?.online) {
            up += s.netUp
            down += s.netDown
          }
        }
        return { name, titled, rows, up, down }
      })
  }, [visible, pickedRegion, pickedGroups, offerGroups, grouping, sort, snapshots])

  const shown = sections.reduce((n, s) => n + s.rows.length, 0)

  return (
    <div className="wrap pt-3.5 md:pt-6 lg:pt-16">
      {/* headline */}
      <section className="fade-in">
        <p className="eyebrow flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* Until the first frame the dot is neutral whatever the socket is doing: red belongs to a
              connection that was working and dropped. */}
          <StatusDot online={connection === 'open' && fed} pending={!fed} />
          {connection === 'closed' && fed ? t('status.reconnecting') : connection === 'open' && fed ? t('status.live') : t('status.connecting')}
          {nodes.length > 0 && fed && (
            <>
              <span className="text-faint">/</span>
              {/* What used to be a 52px headline, at the size of a caption: it is one sentence,
                  and the overview beside it is what the top of the page is actually for. */}
              <span
                className={`normal-case tracking-normal ${
                  offline ? 'rounded-full bg-danger-wash px-2 py-0.5 font-medium text-danger md:rounded-none md:bg-transparent md:p-0 md:font-normal' : ''
                }`}
              >
                {offline === 0 ? t('status.allOnline') : t('status.someOffline', { count: offline })}
              </span>
            </>
          )}
          {nodes.length === 0 && (
            <>
              <span className="text-faint">/</span>
              <span className="normal-case tracking-normal">{t('status.noNodes')}</span>
            </>
          )}
        </p>

        {/* The fleet at a glance. This is the top of the page, so it is the biggest type on
            it — but a band of figures, not one 52px sentence. */}
        {settings.showOverview && (
          <div
            className={`home-overview mt-2.5 grid grid-cols-6 border-y border-line md:mt-3 md:divide-x md:divide-line lg:mt-4 ${settings.showCost ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}
          >
            <Metric
              label={t('overview.nodes')}
              className="col-span-2 md:col-span-1"
              tone={offline ? 'text-danger' : ''}
              value={
                <>
                  {online}
                  <span className="ml-1 text-[0.55em] text-muted">/ {nodes.length}</span>
                </>
              }
              sub={totals.regions > 0 ? t('overview.regions', { count: totals.regions }) : undefined}
            />
            <Metric
              label={t('overview.bandwidth')}
              className="col-span-2 md:col-span-1"
              value={
                <>
                  {splitSpeed(totals.up + totals.down).value}
                  <span className="ml-1 text-[0.55em] text-muted">{splitSpeed(totals.up + totals.down).unit}</span>
                </>
              }
              sub={
                <Pair
                  up={`${splitSpeed(totals.up).value} ${splitSpeed(totals.up).unit}`}
                  down={`${splitSpeed(totals.down).value} ${splitSpeed(totals.down).unit}`}
                />
              }
            />
            <Metric
              label={t('overview.traffic')}
              className="col-span-2 md:col-span-1"
              value={
                <>
                  {splitBytes(totals.traffic).value}
                  <span className="ml-1 text-[0.55em] text-muted">{splitBytes(totals.traffic).unit}</span>
                </>
              }
              sub={
                <Pair
                  up={`${splitBytes(totals.trafficUp).value} ${splitBytes(totals.trafficUp).unit}`}
                  down={`${splitBytes(totals.trafficDown).value} ${splitBytes(totals.trafficDown).unit}`}
                />
              }
            />
            {/* Not an average. A mean CPU across a one-core VPS and a sixteen-core box is
                arithmetic without meaning; this counts the machines with a reading past its own
                warning line, which is the question a summary actually owes the reader. */}
            <Metric
              label={t('overview.attention')}
              className={settings.showCost ? 'col-span-3 md:col-span-1' : 'col-span-6 md:col-span-1'}
              subOnPhone
              inlineOnPhone
              tone={totals.worst?.level === 'danger' ? 'text-danger' : totals.worst ? 'text-warn' : ''}
              value={totals.attention}
              sub={
                totals.worst
                  ? `${stripFlag(totals.worst.name)} · ${t(`metric.${totals.worst.metric}`)} ${formatPercent(totals.worst.pct)}%`
                  : t('overview.allClear')
              }
            />
            {settings.showCost && (
              <Metric
                label={t(loggedIn ? 'overview.actualCost' : 'overview.cost')}
                className="col-span-3 md:col-span-1"
                subOnPhone
                inlineOnPhone
                value={
                  <>
                    {cost.amount === null ? '—' : formatMoney(cost.amount, costCurrency)}
                    {cost.amount !== null && <span className="ml-1 text-[0.55em] text-muted">{t('unit.perMonth')}</span>}
                  </>
                }
                sub={cost.amount === null ? t(loggedIn && actualCosts === null ? 'overview.actualCostUnavailable' : rateError ? 'overview.costUnavailable' : 'overview.costLoading') : <>
                  <span className="block truncate">{t('overview.costNodes', { count: cost.paid })}</span>
                  {rates && <span className="mt-0.5 block truncate text-[10px] text-faint md:mt-1 md:text-[11px]">
                    {t(rates.stale ? 'overview.costCachedRates' : 'overview.costRates')}{' '}
                    <time dateTime={rates.date} className="inline">{rates.date}</time>
                  </span>}
                </>}
              />
            )}
          </div>
        )}
        {description && description !== 'A simple server monitor tool.' && (
          <p className="mt-2.5 max-w-[60ch] text-[13px] leading-relaxed text-muted md:mt-3 md:text-[14px]">{description}</p>
        )}
      </section>

      {/* toolbar: one row from tablet width up — groups, regions, then how to sort and draw */}
      <section className="home-toolbar mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 md:mt-5 lg:mt-8 md:flex-nowrap md:gap-2">
        {offerGroups && (
          <div className="segmented flex items-center rounded-full border border-line bg-surface p-0.5 md:bg-transparent">
            <Popover
              label={`${t('toolbar.groups')} ${pickedGroups.length || t('toolbar.all')}`}
              align="start"
              buttonClassName={`pill min-h-8 gap-1 border-0 px-2.5 sm:gap-1.5 sm:px-3 ${pickedGroups.length ? 'text-accent-text font-medium md:font-normal md:text-ink' : ''}`}
              button={
                <>
                  <span>{t('toolbar.groups')}</span>
                  <span className={`num text-muted ${pickedGroups.length ? 'text-accent-text' : 'hidden sm:inline'}`}>{pickedGroups.length ? pickedGroups.length : t('toolbar.all')}</span>
                  <ChevronDown size={14} strokeWidth={1.7} className="text-muted" aria-hidden />
                </>
              }
              panelClassName="w-[240px] p-1.5"
            >
              {() => (
                <div>
                  <ul role="group" aria-label={t('toolbar.groups')} className="max-h-[min(60vh,360px)] overflow-y-auto">
                    {groups.map(([name, count]) => {
                      const on = pickedGroups.includes(name)
                      return (
                        <li key={name || 'ungrouped'}>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            className="flex h-10 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[14px] hover:bg-wash"
                            onClick={() =>
                              setFilter({
                                groups: on ? pickedGroups.filter((g) => g !== name) : [...pickedGroups, name],
                                region: pickedRegion,
                              })
                            }
                          >
                            <span
                              className={`grid size-4 shrink-0 place-items-center rounded-[5px] border ${on ? 'border-accent bg-accent text-on-accent' : 'border-line-strong'}`}
                              aria-hidden
                            >
                              {on && <Check size={12} strokeWidth={2.2} />}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{name || t('toolbar.ungrouped')}</span>
                            <span className="num text-[12px] text-muted">{count}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  {pickedGroups.length > 0 && (
                    <button
                      type="button"
                      className="mt-1 flex h-9 w-full items-center rounded-[10px] border-t border-line px-3 text-left text-[13px] text-muted hover:text-ink"
                      onClick={() => setFilter({ groups: [], region: pickedRegion })}
                    >
                      {t('toolbar.showAll')}
                    </button>
                  )}
                </div>
              )}
            </Popover>
            <button
              type="button"
              aria-pressed={grouping === 'grouped'}
              title={t('toolbar.grouped')}
              aria-label={t('toolbar.grouped')}
              disabled={pickedGroups.length === 1}
              onClick={() => setGrouping(grouping === 'grouped' ? 'flat' : 'grouped')}
              className={`grid h-8 w-9 place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                grouping === 'grouped' ? 'bg-accent text-on-accent' : 'text-muted hover:text-ink'
              }`}
            >
              <ListTree size={15} strokeWidth={1.7} aria-hidden />
            </button>
          </div>
        )}

        {offerRegions ? (
          // On a phone the strip gets a row of its own: squeezed between the group picker and
          // the view switch it had room for one pill, which reads as the only region there is.
          <div
            className="region-strip scroll-x order-last -ml-1 flex min-w-0 basis-full gap-1 pl-1 md:order-none md:flex-1 md:basis-auto md:py-1"
            role="group"
            aria-label={t('toolbar.regions')}
          >
            {regions.map(([code, count]) => (
              <button
                key={code}
                type="button"
                className="region-pill pill min-h-8 shrink-0 gap-1.5 px-3 text-[12px]"
                aria-pressed={pickedRegion === code}
                title={regionName(code, i18n.language)}
                onClick={() => setFilter({ groups: pickedGroups, region: pickedRegion === code ? null : code })}
              >
                <span className="region-pill-inner md:contents">
                  <RegionFlag code={code} />
                  <span className="font-mono tracking-wide">{code}</span>
                  <span className="num text-muted">{count}</span>
                </span>
              </button>
            ))}
            {filtering && (
              <button
                type="button"
                className="region-pill pill min-h-8 shrink-0 px-3 text-[12px] underline-offset-4 hover:underline md:hidden"
                onClick={() => setFilter({ groups: [], region: null })}
              >
                <span className="region-pill-inner text-accent-text md:contents">{t('toolbar.clear')}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1" />
        )}
        {/* keeps sort and view at the right edge of the first row on a phone */}
        {offerRegions && <div className="flex-1 md:hidden" />}

        {/* On a phone this would push the view switch onto a row of its own; there it sits at
            the end of the region strip instead, below. */}
        {filtering && (
          <button
            type="button"
            className="pill hidden min-h-8 shrink-0 px-3 text-[12px] underline-offset-4 hover:underline md:inline-flex"
            onClick={() => setFilter({ groups: [], region: null })}
          >
            {t('toolbar.clear')}
          </button>
        )}

        <Popover
          label={t('toolbar.sort')}
          buttonClassName="sort-pill pill border-line! bg-surface text-ink md:bg-transparent"
          button={
            <>
              <ArrowDownUp size={14} strokeWidth={1.7} aria-hidden />
              <span className="text-[12px] md:text-[13px]">{t(`sort.${sort.key}`)}</span>
            </>
          }
          panelClassName="w-[220px] p-1.5"
        >
          {(close) => (
            <ul>
              {SORT_KEYS.filter((k) => k !== 'expiry' || adapter.capabilities.billing).map((key) => {
                const active = sort.key === key
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className="flex h-10 w-full items-center gap-2 rounded-[10px] px-3 text-left text-[14px] hover:bg-wash"
                      onClick={() => {
                        setSort(active ? { key, desc: !sort.desc } : { key, desc: DEFAULT_DESC[key] })
                        close()
                      }}
                    >
                      <span className="flex-1">{t(`sort.${key}`)}</span>
                      {active && (
                        <span className="flex items-center gap-1 text-[12px] text-accent-text">
                          {sort.desc ? t('toolbar.descending') : t('toolbar.ascending')}
                          <Check size={15} strokeWidth={1.8} className="text-accent-text" aria-hidden />
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Popover>

        <div className="segmented flex rounded-full border border-line bg-surface p-0.5 md:bg-transparent" role="group" aria-label={t('toolbar.view')}>
          {(
            [
              ['ledger', List, 'list'],
              ['cards', LayoutGrid, 'grid'],
            ] as const
          ).map(([value, Icon, labelKey]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              title={t(`toolbar.${labelKey}`)}
              aria-label={t(`toolbar.${labelKey}`)}
              onClick={() => setView(value as View)}
              className={`grid h-8 w-9 place-items-center rounded-full transition-colors ${
                view === value ? 'bg-accent text-on-accent' : 'text-muted hover:text-ink'
              }`}
            >
              <Icon size={15} strokeWidth={1.7} />
            </button>
          ))}
        </div>

        {/* Density is a row height, so it has nothing to say about cards. */}
        {view === 'ledger' && (
          /* A phone's first toolbar row has room for groups, sort and view only; density is a desktop
             refinement, and with it the row wrapped to a third line on touch screens. */
          <div className="segmented hidden rounded-full border border-line p-0.5 md:flex" role="group" aria-label={t('toolbar.density')}>
            {(
              [
                ['comfortable', Rows2],
                ['compact', Rows3],
              ] as const
            ).map(([value, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={density === value}
                title={t(`toolbar.${value}`)}
                aria-label={t(`toolbar.${value}`)}
                onClick={() => setDensity(value as Density)}
                className={`grid h-8 w-9 place-items-center rounded-full transition-colors ${
                  density === value ? 'bg-accent text-on-accent' : 'text-muted hover:text-ink'
                }`}
              >
                <Icon size={15} strokeWidth={1.7} />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* the ledger */}
      {/* While the connection is down after data arrived, the readings stay but dim: they are the
          last known values, not a fleet that went offline. */}
      <section className="mt-2 md:mt-4" data-stale={fed && connection !== 'open' ? '' : undefined}>
        {shown === 0 ? (
          <p className="rounded-[20px] border border-dashed border-line py-16 text-center text-[14px] text-muted">{t('toolbar.empty')}</p>
        ) : (
          sections.map((section) => (
            <div key={section.name || 'ungrouped'}>
              {section.titled && (
                <GroupHeading
                  id={anchorId(section.name)}
                  name={section.name || t('toolbar.ungrouped')}
                  count={section.rows.length}
                  up={section.up}
                  down={section.down}
                />
              )}
              {view === 'cards' ? (
                <div data-grid="cards" className="mt-2.5 grid gap-2.5 sm:grid-cols-2 md:mt-4 md:gap-3 min-[50rem]:grid-cols-3 xl:grid-cols-4">
                  {section.rows.map((node) => (
                    <NodeCard key={node.id} node={node} snap={snapshots[node.id]} tick={tick} pending={!fed && !snapshots[node.id]} />
                  ))}
                </div>
              ) : (
                section.rows.map((node) => (
                  <NodeStrip key={node.id} node={node} snap={snapshots[node.id]} tick={tick} density={density} pending={!fed && !snapshots[node.id]} />
                ))
              )}
            </div>
          ))
        )}
        {shown > 0 && (
          <p className="num mt-3 text-[12px] text-muted md:mt-4">
            {filtering ? t('status.shown', { shown, count: nodes.length }) : t('status.summary', { online, count: nodes.length })}
          </p>
        )}
      </section>
    </div>
  )
}
