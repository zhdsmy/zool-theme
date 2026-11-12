import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronDown, RefreshCw } from 'lucide-react'
import { adapter, getLive, useStore, useVisibleNodes } from '@/app/store'
import { Link, navigate } from '@/app/router'
import { setShave, useShave } from '@/app/prefs'
import type { HistoryPoint, NodeInfo, PingData, Snapshot } from '@/core/model'
import { formatBytes, formatClock, formatNumber, formatPercent, formatSpeed, quotaUsage, ratio } from '@/core/format'
import { regionName, stripFlag } from '@/core/region'
import { summariseDay, spikeLimit } from '@/core/summary'
import { Chart, type ChartSeries } from '@/components/Chart'
import { HourGrid } from '@/components/HourGrid'
import { BlockGrid, levelFor, MirrorSpark, TickBar } from '@/components/instruments'
import { coreTicks, liveSpanMinutes, memoryBlocks, recentBuckets } from '@/core/live'
import { Popover } from '@/components/Popover'
import { Bytes, Percent, RegionTag, Speed, StatusDot, useBilling, useRelativeTime, useUptime } from '@/components/bits'
import { useIsMobile, useIsNarrow } from '@/app/ui'

/* ---------- pieces ---------- */

/**
 * One reading, enlarged. `instrument` carries the same shape the ledger row uses, so a node
 * looks like itself in both places; `meter` stays for readings that have no instrument.
 */
function Stat({
  label,
  children,
  sub,
  instrument,
}: {
  label: string
  children: ReactNode
  sub?: ReactNode
  instrument?: ReactNode
}) {
  return (
    <div className="node-stat min-w-0 py-5 md:px-3 md:py-3.5 md:first:pl-0 lg:px-5 lg:py-5">
      <p className="node-stat-label text-[13px] text-muted md:text-[12px] lg:text-[13px]">{label}</p>
      <div className="node-stat-value mt-2 truncate text-[26px] leading-none font-light tracking-[-0.03em] md:mt-1.5 md:text-[22px] lg:mt-2 lg:text-[26px]">{children}</div>
      {instrument && <div className="node-stat-inst mt-3 md:mt-2 lg:mt-3">{instrument}</div>}
      {sub && <p className="node-stat-sub num mt-2 truncate text-[12px] text-muted md:mt-1.5 md:text-[11px] lg:mt-2 lg:text-[12px]">{sub}</p>}
    </div>
  )
}

/**
 * On phones, short rows sit two-up (~165px per cell at 390px, enough for a label plus a
 * ~14-char ASCII / ~7-char CJK value). Rows that can exceed that budget pass `wide: true`
 * to span both columns; an odd trailing narrow row is promoted so no row ends half-empty.
 */
type InfoRow = [label: string, value: ReactNode, wide?: boolean]

function InfoList({ title, rows }: { title: string; rows: InfoRow[] }) {
  const visible = rows.filter(([, v]) => v !== '' && v !== null && v !== undefined)
  if (!visible.length) return null
  const wideFlags = visible.map(([, , w]) => Boolean(w))
  // Narrow rows pair up two to a line on phones; an odd one out takes the full width.
  if (wideFlags.filter((w) => !w).length % 2) wideFlags[wideFlags.lastIndexOf(false)] = true

  return (
    <section className="node-info-section">
      <h2 className="eyebrow mb-3 md:mb-1.5 lg:mb-3">{title}</h2>
      <dl className="node-info-list border-t border-line">
        {visible.map(([k, v], i) => (
          <div
            key={k}
            data-wide={wideFlags[i] ? '' : undefined}
            className="node-info-row flex items-baseline justify-between gap-6 border-b border-line py-3 text-[14px] md:gap-3 md:py-1.5 md:text-[13px] lg:gap-6 lg:py-3 lg:text-[14px]"
          >
            <dt className="node-info-dt shrink-0 text-muted">{k}</dt>
            <dd className="node-info-dd min-w-0 truncate text-right" title={typeof v === 'string' ? v : undefined}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function NodeSwitcher({ current }: { current: NodeInfo }) {
  const { t } = useTranslation()
  const nodes = useVisibleNodes()
  const snapshots = useStore((s) => s.snapshots)
  const fed = useStore((s) => s.fed)
  return (
    <Popover
      label={t('node.switch')}
      buttonClassName="pill border-line! text-ink"
      button={
        <>
          <span className="max-w-[40vw] truncate">{t('node.switch')}</span>
          <ChevronDown size={14} strokeWidth={1.7} aria-hidden />
        </>
      }
      panelClassName="max-h-[min(440px,70dvh)] w-[280px] overflow-y-auto p-1.5"
    >
      {(close) => (
        <ul>
          {nodes.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                aria-current={n.id === current.id}
                className={`flex h-10 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[14px] hover:bg-accent-wash ${n.id === current.id ? 'bg-accent-wash font-medium text-accent-text' : ''}`}
                onClick={() => {
                  close()
                  navigate(adapter.nodePath(n.id))
                }}
              >
                <StatusDot online={Boolean(snapshots[n.id]?.online)} pending={!fed && !snapshots[n.id]} />
                <span className="min-w-0 flex-1 truncate">{stripFlag(n.name)}</span>
                <RegionTag code={n.region} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  )
}

/* ---------- today's traffic and 24 h peak ---------- */

/**
 * A week of hourly records, only where the backend keeps them. Komari holds 744 hours; at
 * the 30-day range it averages to one point per day, which hides real outages, so the grid
 * asks for 7 days and nothing longer.
 */
function useWeekHistory(id: string) {
  const recordHours = useStore((s) => s.site?.recordHours ?? 0)
  const supported = adapter.capabilities.history && recordHours >= 168
  const [points, setPoints] = useState<HistoryPoint[] | null>(null)
  useEffect(() => {
    if (!supported) return
    let cancelled = false
    adapter
      .loadHistory(id, 168)
      .then((p) => !cancelled && setPoints(p))
      .catch(() => !cancelled && setPoints([]))
    return () => {
      cancelled = true
    }
  }, [id, supported])
  return supported ? points : null
}

function useDaySummary(id: string, snap: Snapshot | undefined) {
  const [points, setPoints] = useState<HistoryPoint[] | null>(null)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!adapter.capabilities.history) return
    let cancelled = false
    adapter
      .loadHistory(id, 24)
      .then((p) => !cancelled && setPoints(p))
      .catch(() => !cancelled && setPoints([]))
    return () => {
      cancelled = true
    }
  }, [id, nonce])
  const midnight = new Date().setHours(0, 0, 0, 0)
  // Wait for a live snapshot: today's traffic is measured against its counters.
  const summary = points && points.length && snap ? summariseDay(points, snap, midnight) : null
  return { summary, refresh: () => setNonce((n) => n + 1) }
}

/* ---------- charts ---------- */

type Tab = 'load' | 'ping'

function useTimeFormats(hours: number) {
  const { i18n } = useTranslation()
  const long = hours >= 24
  return {
    axis: (t: number) => (hours >= 168 ? new Date(t).toLocaleDateString(i18n.language, { month: 'numeric', day: 'numeric' }) : formatClock(t, false, i18n.language)),
    tooltip: (t: number) =>
      new Date(t).toLocaleString(i18n.language, {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        ...(long ? { month: 'numeric', day: 'numeric' } : { second: '2-digit' }),
      }),
  }
}

function ChartCard({ title, value, children }: { title: string; value?: ReactNode; children: ReactNode }) {
  return (
    <div className="node-chart-card card p-5 md:px-3.5 md:py-3 lg:p-5">
      <div className="node-chart-head mb-3 md:mb-1.5 lg:mb-3 flex items-baseline justify-between gap-3">
        <h3 className="shrink-0 text-[13px] text-muted md:text-[12px] lg:text-[13px]">{title}</h3>
        {value && <p className="num truncate text-[13px] md:text-[12px] lg:text-[13px]">{value}</p>}
      </div>
      {children}
    </div>
  )
}

function SeriesDot({ color }: { color: string }) {
  return <span className="mr-1 inline-block h-[6px] w-[6px] rounded-full align-[1px]" style={{ background: color }} aria-hidden />
}

function LoadCharts({ node, points, hours, height, snap }: { node: NodeInfo; points: HistoryPoint[]; hours: number; height: number; snap?: Snapshot }) {
  const { t } = useTranslation()
  const fmt = useTimeFormats(hours)
  const memTotal = snap?.memTotal || node.memTotal
  const diskTotal = snap?.diskTotal || node.diskTotal
  const s = (key: string, label: string, color: string, pick: (p: HistoryPoint) => number, area = false): ChartSeries => ({
    key,
    label,
    color,
    area,
    points: points.map((p) => ({ t: p.at, v: pick(p) })),
  })
  const common = { height, formatTime: fmt.axis, formatTooltipTime: fmt.tooltip }
  const last = points[points.length - 1]

  return (
    <div className="node-chart-grid grid gap-4 sm:grid-cols-2 md:grid-cols-3 md:gap-3 lg:grid-cols-2 lg:gap-4 xl:grid-cols-3">
      <ChartCard title={t('metric.cpu')} value={last ? `${formatPercent(last.cpu)}%` : undefined}>
        <Chart {...common} label={t('metric.cpu')} yMax={100} format={(v) => `${formatNumber(v, 0)}%`} series={[s('cpu', t('metric.cpu'), 'var(--chart-1)', (p) => p.cpu, true)]} />
      </ChartCard>
      <ChartCard title={t('metric.memory')} value={last ? `${formatBytes(last.memUsed)} / ${formatBytes(memTotal)}` : undefined}>
        <Chart
          {...common}
          label={t('metric.memory')}
          yMax={memTotal || undefined}
          format={(v) => formatBytes(v, 1)}
          series={[s('mem', t('metric.memory'), 'var(--chart-2)', (p) => p.memUsed, true), ...(node.swapTotal ? [s('swap', t('metric.swap'), 'var(--chart-3)', (p) => p.swapUsed)] : [])]}
        />
      </ChartCard>
      <ChartCard title={t('metric.disk')} value={last ? `${formatBytes(last.diskUsed)} / ${formatBytes(diskTotal)}` : undefined}>
        <Chart {...common} label={t('metric.disk')} yMax={diskTotal || undefined} format={(v) => formatBytes(v, 0)} series={[s('disk', t('metric.disk'), 'var(--chart-3)', (p) => p.diskUsed, true)]} />
      </ChartCard>
      <ChartCard
        title={t('metric.network')}
        value={
          last ? (
            <>
              <SeriesDot color="var(--chart-1)" />↑ {formatSpeed(last.netUp)} · <SeriesDot color="var(--chart-2)" />↓ {formatSpeed(last.netDown)}
            </>
          ) : undefined
        }
      >
        <Chart
          {...common}
          label={t('metric.network')}
          format={(v) => formatSpeed(v)}
          series={[s('up', t('metric.upload'), 'var(--chart-1)', (p) => p.netUp, true), s('down', t('metric.download'), 'var(--chart-2)', (p) => p.netDown)]}
        />
      </ChartCard>
      <ChartCard
        title={t('metric.connections')}
        value={
          last ? (
            <>
              <SeriesDot color="var(--chart-1)" />TCP {last.tcp} · <SeriesDot color="var(--chart-4)" />UDP {last.udp}
            </>
          ) : undefined
        }
      >
        <Chart
          {...common}
          label={t('metric.connections')}
          format={(v) => formatNumber(v, 0)}
          series={[s('tcp', t('metric.tcp'), 'var(--chart-1)', (p) => p.tcp, true), s('udp', t('metric.udp'), 'var(--chart-4)', (p) => p.udp)]}
        />
      </ChartCard>
      <ChartCard title={`${t('metric.load')} · ${t('metric.process')}`} value={last ? `${formatNumber(last.load1)} · ${last.process}` : undefined}>
        <Chart
          {...common}
          label={t('metric.load')}
          format={(v) => formatNumber(v, v > 0 && v < 1 && Math.round(v * 100) % 10 !== 0 ? 2 : 1)}
          series={[s('load', t('metric.load'), 'var(--chart-2)', (p) => p.load1, true)]}
        />
      </ChartCard>
    </div>
  )
}

const PING_COLORS = Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`)

function PingChart({ data, hours, height, shave }: { data: PingData; hours: number; height: number; shave: boolean }) {
  const { t } = useTranslation()
  const fmt = useTimeFormats(hours)
  // null = every line. The first click isolates a line, later clicks add or remove lines,
  // and removing the last one (or adding the last missing one) goes back to every line.
  const [shown, setShown] = useState<Set<number> | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const color = (i: number) => PING_COLORS[i % PING_COLORS.length]
  const visible = (id: number) => shown === null || shown.has(id)
  const toggle = (id: number) =>
    setShown((prev) => {
      if (prev === null) return new Set([id])
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next.size === 0 || next.size === data.tasks.length ? null : next
    })
  const series: ChartSeries[] = data.tasks.flatMap((task, i) => {
    if (!visible(task.id)) return []
    let points = data.points.filter((p) => p.task === task.id).map((p) => ({ t: p.at, v: p.value >= 0 ? p.value : null }))
    if (shave) {
      // spikes are dropped, not blanked, so the line runs straight through them
      const limit = spikeLimit(points.flatMap((p) => (p.v === null ? [] : [p.v])))
      points = points.filter((p) => p.v === null || p.v <= limit)
    }
    return [{ key: String(task.id), label: task.name, color: color(i), points }]
  })

  return (
    <div className="node-ping-card card p-5 md:p-4 lg:p-5">
      <Chart
        series={series}
        height={height}
        robust
        focus={focus !== null && visible(focus) ? String(focus) : null}
        format={(v) => `${formatNumber(v, 0)} ms`}
        formatTime={fmt.axis}
        formatTooltipTime={fmt.tooltip}
        label={t('node.tabPing')}
      />
      <ul className="node-ping-list mt-3 grid sm:grid-cols-2 sm:gap-x-6 xl:grid-cols-3" onPointerLeave={() => setFocus(null)}>
        {data.tasks.map((task, i) => (
          <li key={task.id} className="border-t border-line">
            <button
              type="button"
              aria-pressed={visible(task.id)}
              onClick={() => toggle(task.id)}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setFocus(task.id)}
              className={`node-ping-row grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2 text-left text-[13px] transition-opacity ${visible(task.id) ? '' : 'opacity-40'}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-[3px] w-3.5 shrink-0 rounded-full"
                  style={visible(task.id) ? { background: color(i) } : { boxShadow: `inset 0 0 0 1px ${color(i)}` }}
                />
                <span className="truncate" title={task.name}>{task.name}</span>
              </span>
              <span className="num min-w-[58px] text-right">{formatNumber(task.avg, 1)} ms</span>
              <span className="num min-w-[52px] text-right text-[12px] text-muted" title={`${t('node.min')} – ${t('node.max')}`}>
                {formatNumber(task.min, 0)}–{formatNumber(task.max, 0)}
                {task.loss !== undefined && (
                  <span className={`ml-2 ${task.loss > 5 ? 'text-danger' : ''}`} title={t('node.loss')}>{formatNumber(task.loss, 1)}%</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {shown !== null && (
        <button type="button" className="pill mt-2 min-h-7 px-3 text-[12px]" onClick={() => setShown(null)}>
          {t('node.showAllLines')}
        </button>
      )}
    </div>
  )
}

function NodeCharts({ node, snap }: { node: NodeInfo; snap?: Snapshot }) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const isNarrow = useIsNarrow()
  const recordHours = useStore((s) => s.site?.recordHours ?? 0)
  const [range, setRange] = useState(0)
  // Only the live range needs to follow the socket; history ranges stay put.
  const liveVersion = useStore((s) => (range === 0 ? s.liveVersion : -1))
  const ranges = adapter.historyRanges.filter((h) => h === 0 || h <= Math.max(recordHours, 1))
  const pingRanges = adapter.target === 'nezha' ? [24] : ranges.filter((h) => h > 0)
  const [tab, setTab] = useState<Tab>('load')
  const shave = useShave()
  const [pingRange, setPingRange] = useState(pingRanges.includes(24) ? 24 : (pingRanges[0] ?? 24))
  const [history, setHistory] = useState<{ key: string; points: HistoryPoint[] } | null>(null)
  const [ping, setPing] = useState<{ key: string; data: PingData } | null>(null)
  const [error, setError] = useState(false)
  const [nonce, setNonce] = useState(0)

  const historyKey = `${node.id}:${range}:${nonce}`
  const pingKey = `${node.id}:${pingRange}:${nonce}`

  useEffect(() => {
    if (tab !== 'load' || range === 0) return
    let cancelled = false
    setError(false)
    adapter
      .loadHistory(node.id, range)
      .then((points) => !cancelled && setHistory({ key: historyKey, points }))
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [tab, range, node.id, historyKey])

  useEffect(() => {
    if (tab !== 'ping' || !adapter.capabilities.ping) return
    let cancelled = false
    setError(false)
    adapter
      .loadPing(node.id, pingRange)
      .then((data) => !cancelled && setPing({ key: pingKey, data }))
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [tab, pingRange, node.id, pingKey])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const live = useMemo(() => [...getLive(node.id)], [node.id, liveVersion])
  const points = range === 0 ? live : history?.key === historyKey ? history.points : null
  const pingData = ping?.key === pingKey ? ping.data : null
  const rangeLabel = (h: number) => (h === 0 ? t('node.rangeLive') : h < 24 ? t('node.rangeHours', { count: h }) : t('node.rangeDays', { count: h / 24 }))
  const activeRanges = tab === 'load' ? ranges : pingRanges
  const activeRange = tab === 'load' ? range : pingRange
  const chartHeight = tab === 'load' ? (isMobile ? 87 : isNarrow ? 110 : 150) : isMobile ? 200 : isNarrow ? 260 : 300

  return (
    <section className="node-charts mt-16 md:mt-8 lg:mt-16">
      <div className="node-charts-bar flex flex-wrap items-center gap-3">
        <h2 className="node-charts-title mr-auto text-[24px] font-light md:text-[20px] lg:text-[24px] tracking-[-0.02em]">{t('node.charts')}</h2>
        {adapter.capabilities.ping && (
          <div className="node-tabs flex rounded-full border border-line bg-surface-2 p-0.5" role="tablist">
            {(['load', 'ping'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`h-8 rounded-full px-4 text-[13px] transition-colors ${tab === k ? 'bg-accent font-medium text-on-accent' : 'text-muted hover:text-ink'}`}
              >
                {t(k === 'load' ? 'node.tabLoad' : 'node.tabPing')}
              </button>
            ))}
          </div>
        )}
        {activeRanges.length > 1 && (
          <div className="node-ranges scroll-x flex gap-0.5" role="group">
            {activeRanges.map((h) => (
              <button
                key={h}
                type="button"
                className="pill min-h-8 px-3"
                aria-pressed={activeRange === h}
                onClick={() => (tab === 'load' ? setRange(h) : setPingRange(h))}
              >
                {rangeLabel(h)}
              </button>
            ))}
          </div>
        )}
        {tab === 'ping' && (
          <button type="button" className="pill min-h-8 px-3" aria-pressed={shave} title={t('node.shaveHint')} onClick={() => setShave(!shave)}>
            {t('node.shave')}
          </button>
        )}
        {((tab === 'load' && range > 0) || tab === 'ping') && (
          <button type="button" className="icon-btn" aria-label={t('node.refresh')} title={t('node.refresh')} onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw size={16} strokeWidth={1.6} />
          </button>
        )}
      </div>

      {tab === 'load' && range === 0 && !adapter.capabilities.history && <p className="node-live-note mt-3 text-[13px] text-muted">{t('node.liveOnly')}</p>}

      <div className="node-charts-body mt-5 md:mt-3 lg:mt-5">
        {error ? (
          <p className="rounded-[20px] border border-dashed border-line py-16 text-center text-[14px] text-muted">{t('app.loadError')}</p>
        ) : tab === 'load' ? (
          points === null ? (
            <ChartSkeleton height={chartHeight} />
          ) : points.length < 2 && range > 0 ? (
            <p className="rounded-[20px] border border-dashed border-line py-16 text-center text-[14px] text-muted">{t('node.noHistory')}</p>
          ) : (
            <LoadCharts node={node} points={points} hours={range || 0.25} height={chartHeight} snap={snap} />
          )
        ) : pingData === null ? (
          <ChartSkeleton single height={chartHeight} />
        ) : pingData.tasks.length === 0 ? (
          <p className="rounded-[20px] border border-dashed border-line py-16 text-center text-[14px] text-muted">{t('node.noPing')}</p>
        ) : (
          <PingChart data={pingData} hours={pingRange} height={chartHeight} shave={shave} />
        )}
      </div>
    </section>
  )
}

function ChartSkeleton({ single = false, height }: { single?: boolean; height: number }) {
  return (
    <div className={single ? '' : 'node-chart-grid grid gap-4 sm:grid-cols-2 md:grid-cols-3 md:gap-3 lg:grid-cols-2 lg:gap-4 xl:grid-cols-3'}>
      {Array.from({ length: single ? 1 : 6 }, (_, i) => (
        <div key={i} className="node-chart-card card p-5 md:px-3.5 md:py-3 lg:p-5">
          <div className="skeleton h-3 w-20" />
          <div className="node-chart-skel skeleton mt-5" style={{ height }} />
        </div>
      ))}
    </div>
  )
}

/* ---------- page ---------- */

export function NodePage({ id }: { id: string }) {
  const { t, i18n } = useTranslation()
  const isNarrow = useIsNarrow()
  const nodes = useVisibleNodes()
  const nodeId = decodeURIComponent(id)
  const node = nodes.find((n) => n.id === nodeId)
  const snap = useStore((s) => s.snapshots[nodeId])
  const siteName = useStore((s) => s.settings.siteTitle || s.site?.name || '')
  const uptime = useUptime()
  const relative = useRelativeTime()
  const billing = useBilling()
  const day = useDaySummary(nodeId, snap)
  const week = useWeekHistory(nodeId)
  const liveTick = useStore((s) => s.liveVersion)
  const cores = coreTicks(snap?.cpu ?? 0, node?.cpuCores ?? 0)
  const mem = memoryBlocks(snap?.memUsed ?? 0, snap?.memTotal || node?.memTotal || 0, node?.swapTotal ?? 0)
  const statBox = 150
  const statHeight = isNarrow ? 12 : 16
  const tickGap = isNarrow ? (cores.ticks > 16 ? 1 : 2) : cores.ticks > 16 ? 2 : 4
  // Disk gets blocks too: one shape for "how much of a fixed thing is used".
  const disk = memoryBlocks(snap?.diskUsed ?? 0, snap?.diskTotal || node?.diskTotal || 0, 0, 10)
  // The same fifteen-minute buffer the ledger draws, so the page opens on a familiar shape.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveNet = useMemo(() => {
    const points = getLive(nodeId)
    const span = liveSpanMinutes(points, 15)
    return {
      up: recentBuckets(points, (p) => p.netUp, 28, span),
      down: recentBuckets(points, (p) => p.netDown, 28, span),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, liveTick])

  useEffect(() => {
    if (node) document.title = `${stripFlag(node.name)} · ${siteName}`
  }, [node, siteName])

  if (!node) {
    return (
      <div className="node-page wrap pt-16">
        <Link href="/" className="inline-flex min-h-10 items-center gap-2 text-[13px] text-muted hover:text-ink">
          <ArrowLeft size={15} strokeWidth={1.7} aria-hidden />
          {t('node.back')}
        </Link>
        <p className="mt-16 text-[28px] font-light tracking-[-0.02em]">{t('node.notFound')}</p>
      </div>
    )
  }

  const online = Boolean(snap?.online)
  // Before the first live frame the node is waiting, not down.
  const fed = useStore((s) => s.fed)
  const pending = !snap && !fed
  const memTotal = snap?.memTotal || node.memTotal
  const diskTotal = snap?.diskTotal || node.diskTotal
  const used = quotaUsage(node, snap)
  const price = billing.price(node)
  const expiry = billing.expiry(node)
  const region = regionName(node.region, i18n.language)
  const clock = (at: number) => formatClock(at, false, i18n.language)

  return (
    <div className="node-page wrap pt-8 md:pt-6 lg:pt-12">
      <div className="node-topbar flex items-center justify-between gap-3">
        <Link href="/" className="inline-flex min-h-10 items-center gap-2 rounded-md text-[13px] text-muted transition-colors hover:text-accent-text">
          <ArrowLeft size={15} strokeWidth={1.7} aria-hidden />
          {t('node.back')}
        </Link>
        <NodeSwitcher current={node} />
      </div>

      <header className="node-header fade-in mt-8 md:mt-3 lg:mt-10">
        <p className="eyebrow flex flex-wrap items-center gap-x-2 gap-y-1">
          {node.region && <span>{region}</span>}
          {node.region && node.groups[0] && <span className="text-faint">/</span>}
          {node.groups[0] && <span className="normal-case tracking-normal">{node.groups.join(' · ')}</span>}
        </p>
        <h1 className="node-title mt-4 text-[34px] leading-[1.1] font-light tracking-[-0.035em] break-words md:mt-2 md:text-[30px] lg:mt-4 lg:text-[50px]">{stripFlag(node.name)}</h1>
        <p className="node-meta mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted md:mt-2.5 md:text-[13px] lg:mt-4 lg:text-[14px]">
          <span
            data-status={pending ? 'pending' : online ? 'online' : 'offline'}
            className="node-status-chip inline-flex items-center gap-2 text-ink"
          >
            <StatusDot online={online} pending={pending} />
            {pending ? t('status.connecting') : online ? t('status.online') : t('status.offline')}
          </span>
          {online && (
            <>
              <span className="text-faint">·</span>
              <span>
                {t('metric.uptime')} <span className="num text-ink">{uptime(snap!.uptime)}</span>
              </span>
            </>
          )}
          {snap?.at ? (
            <>
              <span className="text-faint">·</span>
              <span className="num">{online ? formatClock(snap.at, false, i18n.language) : t('status.lastSeen', { time: relative(snap.at) })}</span>
            </>
          ) : null}
        </p>
      </header>

      <section className={`node-stats mt-10 md:mt-5 lg:mt-10 grid grid-cols-2 border-y border-line md:grid-cols-5 lg:grid-cols-3 md:divide-x md:divide-line xl:grid-cols-6 ${online ? '' : 'opacity-50'}`}>
        <Stat
          label={t('metric.cpu')}
          sub={node.cpuCores ? t('metric.cores', { count: node.cpuCores }) : undefined}
          instrument={
            <TickBar
              animate
              stretch={isNarrow}
              filled={cores.filled}
              ticks={cores.ticks}
              notch={node.cpuCores > 0 && snap ? Math.min(1, snap.load1 / node.cpuCores) : undefined}
              height={statHeight}
              /* Fit desktop ticks to a 150px budget: four cores get fat ticks so the reading is
                 not a stub, 32 cores get thin ones and a tighter gap instead of spilling. */
              width={Math.max(2, Math.min(18, Math.floor((statBox - (cores.ticks - 1) * tickGap) / cores.ticks)))}
              gap={tickGap}
              level={levelFor('cpu', snap?.cpu ?? 0)}
              label={t('metric.cpu')}
            />
          }
        >
          <Percent value={snap?.cpu ?? 0} />
        </Stat>
        <Stat
          label={t('metric.memory')}
          sub={`${formatBytes(snap?.memUsed ?? 0)} / ${formatBytes(memTotal)}`}
          instrument={
            <BlockGrid
              animate
              stretch={isNarrow}
              filled={mem.filled}
              blocks={mem.blocks}
              swapBlocks={mem.swapBlocks}
              height={statHeight}
              /* Same 150px desktop budget the ticks get, so the two readings stay the same size. */
              box={statBox}
              level={levelFor('memory', snap ? ratio(snap.memUsed, memTotal) : 0)}
              label={t('metric.memory')}
            />
          }
        >
          <Percent value={snap ? ratio(snap.memUsed, memTotal) : 0} />
        </Stat>
        <Stat
          label={t('metric.disk')}
          sub={`${formatBytes(snap?.diskUsed ?? 0)} / ${formatBytes(diskTotal)}`}
          instrument={
            <BlockGrid
              animate
              stretch={isNarrow}
              filled={disk.filled}
              blocks={disk.blocks}
              height={statHeight}
              box={statBox}
              level={levelFor('disk', snap ? ratio(snap.diskUsed, diskTotal) : 0)}
              label={t('metric.disk')}
            />
          }
        >
          <Percent value={snap ? ratio(snap.diskUsed, diskTotal) : 0} />
        </Stat>
        <Stat label={t('metric.network')} sub={`↑ ${formatBytes(snap?.totalUp ?? 0)} · ↓ ${formatBytes(snap?.totalDown ?? 0)}`}>
          <span className="flex items-center gap-2.5 md:gap-3">
            <MirrorSpark up={liveNet.up} down={liveNet.down} width={isNarrow ? 54 : 72} height={isNarrow ? 24 : 30} label={t('metric.network')} />
            {/* stacked: the six-up band gives this cell about 200px, too narrow for both rates in a row */}
            <span className="flex flex-col text-[0.5em] leading-tight">
              <span className="whitespace-nowrap">
                <span className="mr-0.5 text-muted">↑</span>
                <Speed value={snap?.netUp ?? 0} />
              </span>
              <span className="whitespace-nowrap">
                <span className="mr-0.5 text-muted">↓</span>
                <Speed value={snap?.netDown ?? 0} />
              </span>
            </span>
          </span>
        </Stat>
        <Stat label={t('metric.load')} sub={`${t('metric.process')} ${snap?.process ?? 0}`}>
          <span className="num">{formatNumber(snap?.load1 ?? 0)}</span>
          <span className="num ml-2 text-[0.55em] text-muted">
            {formatNumber(snap?.load5 ?? 0)} · {formatNumber(snap?.load15 ?? 0)}
          </span>
        </Stat>
      </section>

      <div className="node-info-grid mt-14 grid grid-cols-1 gap-10 md:mt-6 md:grid-cols-3 md:gap-6 lg:mt-14 lg:grid-cols-2 lg:gap-10 xl:grid-cols-3">
        <InfoList
          title={t('node.system')}
          rows={[
            [t('node.os'), node.os, node.os.length > 14],
            [t('node.arch'), node.arch],
            [t('node.cpu'), node.cpuName + (node.cpuCores ? ` × ${node.cpuCores}` : ''), true],
            [t('node.virtualization'), node.virtualization],
            [t('node.gpu'), node.gpuName, true],
            [t('node.kernel'), node.kernel, node.kernel.length > 14],
          ]}
        />
        <InfoList
          title={t('node.network')}
          rows={[
            [t('node.bandwidth'), node.bandwidth],
            [t('node.ipSupport'), [node.ipv4 === undefined ? '' : `IPv4 ${node.ipv4 ? '✓' : '×'}`, node.ipv6 === undefined ? '' : `IPv6 ${node.ipv6 ? '✓' : '×'}`].filter(Boolean).join(' · ')],
            [t('node.networkRoute'), node.networkRoute, true],
            [
              t('node.today'),
              day.summary ? (
                <span key="t" className="inline-flex items-center gap-2">
                  <span className="num">
                    ↑ {formatBytes(day.summary.todayUp)} · ↓ {formatBytes(day.summary.todayDown)}
                  </span>
                  <button type="button" className="node-inline-refresh text-muted hover:text-ink" aria-label={t('node.refresh')} title={t('node.refresh')} onClick={day.refresh}>
                    <RefreshCw size={13} strokeWidth={1.7} />
                  </button>
                </span>
              ) : (
                ''
              ),
              true,
            ],
            [
              t('node.peak'),
              day.summary ? (
                <span key="p" className="node-peak-vals num flex flex-col items-end leading-relaxed">
                  <span>
                    ↑ {formatSpeed(day.summary.peakUp)} <span className="text-muted">{clock(day.summary.peakUpAt)}</span>
                  </span>
                  <span>
                    ↓ {formatSpeed(day.summary.peakDown)} <span className="text-muted">{clock(day.summary.peakDownAt)}</span>
                  </span>
                </span>
              ) : (
                ''
              ),
              true,
            ],
            [`${t('metric.upload')} · ${t('node.totals')}`, <Bytes key="u" value={snap?.totalUp ?? 0} />],
            [`${t('metric.download')} · ${t('node.totals')}`, <Bytes key="d" value={snap?.totalDown ?? 0} />],
            [
              t('metric.quota'),
              node.trafficLimit > 0 ? (
                <span key="q" className="node-quota-val num">
                  {used !== null ? `${formatBytes(used)} / ` : ''}{billing.quota(node)}
                  {Boolean(node.trafficLimitPeriod) && <span className="node-quota-note mt-1 block max-w-[24ch] text-[11px] whitespace-normal text-muted">{t('node.noCycleUsage')}</span>}
                </span>
              ) : adapter.capabilities.trafficLimit ? (
                billing.quota(node)
              ) : (
                ''
              ),
              true,
            ],
            [t('metric.connections'), snap ? <span key="c" className="num">TCP {snap.tcp} · UDP {snap.udp}</span> : ''],
            [t('metric.swap'), node.swapTotal ? <span key="s" className="num">{formatBytes(snap?.swapUsed ?? 0)} / {formatBytes(node.swapTotal)}</span> : ''],
          ]}
        />
        <InfoList
          title={t('node.billing')}
          rows={[
            [t('metric.price'), price],
            [t('metric.actualCost'), billing.actualPrice(node)],
            [
              t('metric.expiry'),
              expiry ? (
                <span
                  key="e"
                  data-level={expiry.level}
                  className={`node-expiry-val ${expiry.level === 'danger' ? 'text-danger' : expiry.level === 'warn' ? 'text-warn' : ''}`}
                >
                  {node.expiredAt && expiry.text !== t('expiry.longTerm') ? `${new Date(node.expiredAt).toLocaleDateString(i18n.language)} · ` : ''}
                  {expiry.text}
                </span>
              ) : (
                ''
              ),
              true,
            ],
            [t('metric.autoRenew'), node.expiredAt && node.autoRenewal ? '✓' : ''],
            [t('node.region'), node.region ? `${region} (${node.region})` : ''],
            [t('node.group'), node.groups.join(' · ')],
          ]}
        />
      </div>

      {week && week.length > 0 && (
        <div className="node-week mt-14 md:mt-6 lg:mt-14">
          <HourGrid points={week} />
        </div>
      )}

      {node.note && <p className="node-note mt-10 max-w-[70ch] text-[14px] leading-relaxed whitespace-pre-line text-muted">{node.note}</p>}

      <NodeCharts key={node.id} node={node} snap={snap} />
    </div>
  )
}
