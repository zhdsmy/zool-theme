import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, CalendarClock, Clock3 } from 'lucide-react'
import { adapter, getBlindWindows, getLive, useStore } from '@/app/store'
import { Link } from '@/app/router'
import type { NodeInfo, Snapshot } from '@/core/model'
import { formatPercent, splitBytes, splitSpeed, ratio, quotaUsage } from '@/core/format'
import { coreTicks, liveSpanMinutes, memoryBlocks, recentBuckets, reportRun } from '@/core/live'
import { stripFlag } from '@/core/region'
import { nodeCondition, type Condition } from '@/core/condition'
import { BlockGrid, DotRun, levelFor, MirrorSpark, TickBar, type Level } from './instruments'
import { OsGlyph } from './OsGlyph'
import { Bytes, Percent, RegionTag, Speed, StatusDot, useBilling, useUptime, useRelativeTime } from './bits'

export type Density = 'comfortable' | 'compact'

/**
 * The ledger window: 15 minutes, the length of the live ring buffer. Bucket counts are kept
 * low on purpose — a 88px spark cannot show 36 points, and a run of 30 dots at this size
 * blurs into a dotted rule instead of reading as countable cells.
 */
const WINDOW_MINUTES = 15
const SPARK_BUCKETS = 24
/** 12 capsules at 4+2.5px fit the 84px box exactly; more would overflow and shift the column. */
const RUN_CELLS = 12

/**
 * A phone row gives CPU and memory half the row each, about 106px. Dividing that by cores or
 * gigabytes drew two or four fat grey slabs on small machines, so the phone reads twelve equal
 * cells like a card; the desktop ledger keeps one tick per core and one block per gigabyte.
 */
const PHONE_CELLS = 12
const PHONE_BAR_HEIGHT = 9

/**
 * The desktop ledger's columns say what each figure is; a phone row has no columns to lean on.
 * Without a word in front, up sat under CPU and down under memory and read as their figures.
 */
const PhoneLabel = ({ children }: { children: ReactNode }) => (
  <span className="shrink-0 text-[10.5px] leading-[14px] text-muted md:hidden">{children}</span>
)

/** Match the live reading slots without inventing values before the first snapshot. */
function PendingReadings({ card = false }: { card?: boolean }) {
  const { t } = useTranslation()
  const Label = card ? 'span' : PhoneLabel
  return (
    <span className={card ? 'pending-card' : 'pending-strip'}>
      {(card ? ['cpu', 'memory', 'disk', 'network'] : ['cpu', 'memory', 'network', 'uptime']).map((metric) => (
        <span key={metric}>
          <Label>{t(card && metric === 'network' ? 'node.speed' : `metric.${metric}`)}</Label>
          {[0, 1, 2, 3].map((slot) => <span key={slot} className="skeleton" aria-hidden="true" />)}
        </span>
      ))}
    </span>
  )
}

/**
 * Why a node is not showing live readings, in words: how long since it last reported, or that
 * it never has, plus expiry (a used-up quota is already the red 100% on the traffic line). `short` is the time alone, for the narrow ledger
 * cell where the dot and dimmed readings already say "not live".
 */
function ConditionNote({ cond, short = false }: { cond: Condition; short?: boolean }) {
  const { t } = useTranslation()
  const relative = useRelativeTime()
  const time = cond.lastSeen ? relative(cond.lastSeen) : ''
  const text =
    cond.kind === 'never'
      ? t('status.noReports')
      : !time
        ? t('status.offline')
        : short
          ? time
          : cond.kind === 'stale'
            ? t('status.reportedAt', { time })
            : t('status.offlineSince', { time })
  const tone = cond.kind === 'recent' ? 'text-warn' : cond.kind === 'offline' ? 'text-danger' : 'text-muted'
  return (
    <span className={`inline-flex items-center gap-1.5 truncate ${tone}`} title={!time ? undefined : cond.kind === 'stale' ? t('status.reportedAt', { time }) : t('status.offlineSince', { time })}>
      <span className="truncate">{text}</span>
      {!short && cond.expired && (
        <>
          <span className="hidden text-danger md:inline">·</span>
          <span className="shrink-0 rounded-full bg-danger-wash px-1.5 py-0.5 text-[10px] leading-none font-medium text-danger md:rounded-none md:bg-transparent md:p-0 md:text-[12px] md:font-normal">
            {t('status.expired')}
          </span>
        </>
      )}
    </span>
  )
}

const Value = ({ parts, className = '' }: { parts: { value: string; unit: string }; className?: string }) => (
  <span className={`num whitespace-nowrap ${className}`}>
    {parts.value}
    <span className="ml-[0.15em] text-[0.8em] text-muted">{parts.unit}</span>
  </span>
)

export function GroupHeading({ id, name, count, up, down }: { id: string; name: string; count: number; up: number; down: number }) {
  const { t } = useTranslation()
  return (
    <div
      id={id}
      className="group-heading mt-4 flex items-baseline gap-2.5 rounded-[8px] bg-surface-2 px-2.5 py-1.5 first:mt-0 scroll-mt-20 md:mt-10 md:gap-3 md:rounded-none md:border-t md:border-line md:bg-transparent md:px-0 md:pt-3 md:pb-0"
    >
      <h2 className="text-[12.5px] font-semibold tracking-[-0.01em] md:text-[13px] md:font-medium">{name}</h2>
      <span className="num text-[11px] text-muted md:text-[12px]">{t('unit.nodes', { count })}</span>
      <span className="num ml-auto text-[11px] text-muted md:text-[12px]">
        ↑ {splitSpeed(up).value} {splitSpeed(up).unit} · ↓ {splitSpeed(down).value} {splitSpeed(down).unit}
      </span>
    </div>
  )
}

export function NodeStrip({
  node,
  snap,
  tick,
  density,
  pending,
}: {
  node: NodeInfo
  snap?: Snapshot
  /** Bumps with the live buffer so the instruments re-read it. */
  tick: number
  density: Density
  pending?: boolean
}) {
  const { t } = useTranslation()
  const uptime = useUptime()
  const billing = useBilling()
  const compact = density === 'compact'

  const live = useMemo(() => {
    const points = getLive(node.id)
    const span = liveSpanMinutes(points, WINDOW_MINUTES)
    return {
      up: recentBuckets(points, (p) => p.netUp, SPARK_BUCKETS, span),
      down: recentBuckets(points, (p) => p.netDown, SPARK_BUCKETS, span),
      run: reportRun(points, RUN_CELLS, span, Date.now(), getBlindWindows()),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, tick])

  const online = Boolean(snap?.online)
  const cond = nodeCondition(node, snap, Date.now(), !pending)
  // A node that went down but left readings keeps them on screen, dimmed, rather than going blank.
  const shown = online || (!pending && cond.readings && cond.kind !== 'never')
  const memTotal = snap?.memTotal || node.memTotal
  const cpu = shown ? (snap?.cpu ?? 0) : 0
  const memPct = shown ? ratio(snap?.memUsed ?? 0, memTotal) : 0
  const cpuLevel = levelFor('cpu', cpu)
  const memLevel = levelFor('memory', memPct)
  const cores = coreTicks(cpu, node.cpuCores)
  const mem = memoryBlocks(snap?.memUsed ?? 0, memTotal, node.swapTotal)
  const memUsedParts = compactBytes(snap?.memUsed ?? 0)
  const notch = node.cpuCores > 0 && snap ? Math.min(1, snap.load1 / node.cpuCores) : undefined
  const height = compact ? 9 : 11
  const expiry = billing.expiry(node)
  const used = quotaUsage(node, snap)
  const quota = node.trafficLimit > 0 && used !== null ? ratio(used, node.trafficLimit) : null

  return (
    <Link
      href={adapter.nodePath(node.id)}
      data-pending={pending ? '' : undefined}
      data-stale={shown && cond.kind !== 'online' ? '' : undefined}
      data-density={density}
      className={`node-strip block border-b border-line transition-colors hover:bg-wash md:grid md:grid-cols-[minmax(0,1fr)_126px_172px_62px_92px] md:items-center md:gap-x-4 lg:grid-cols-[minmax(0,1fr)_126px_172px_188px_92px] lg:gap-x-6 xl:grid-cols-[minmax(0,1fr)_126px_172px_228px_186px] ${
        compact ? 'px-1 py-1 md:px-2 md:py-1.5' : 'px-1 py-1.5 md:px-2 md:py-3'
      }`}
    >
      {/* identity */}
      <span className="flex min-w-0 items-center gap-1.5 md:gap-2.5">
        <StatusDot online={online} pending={pending || cond.kind === 'never'} />
        <OsGlyph os={node.os} tile={compact ? 14 : 16} size={compact ? 9 : 11} />
        <span className={`truncate font-medium md:font-normal ${compact ? 'text-[12.5px] leading-[17px] md:text-[13px] md:leading-normal' : 'text-[13px] leading-[18px] md:text-[14px] md:leading-normal'}`}>{stripFlag(node.name)}</span>
        <RegionTag code={node.region} className="region-tag-strip shrink-0 md:hidden lg:inline-flex" />
        {expiry?.level && (
          <span className={`hidden shrink-0 text-[11px] whitespace-nowrap lg:inline ${expiry.level === 'danger' ? 'text-danger' : 'text-warn'}`}>{expiry.text}</span>
        )}
        {/* on phones only the uptime rides along with the name; the run needs room */}
        <span className="num ml-auto shrink-0 pl-1.5 text-[11px] leading-[18px] whitespace-nowrap text-muted md:hidden">
          {pending || !shown ? null : cond.kind === 'online' ? uptime(snap!.uptime) : <ConditionNote cond={cond} short />}
        </span>
      </span>

      {pending ? <PendingReadings /> : shown ? (
        /* Each cell pairs a graphic with a number, both flush right, so the graphics line up
           in one column and the numbers in another. `md:contents` lets the same cells be a
           phone grid and desktop columns. On a phone it is two fixed halves over two lines —
           CPU | memory, then up | down under them — with the graphics stretched to fill their
           half. A rate cell sized to its text made every other cell slide sideways each time a
           figure changed length. */
        <span className="mt-1 grid grid-cols-2 gap-x-3 gap-y-[2px] pl-[22px] md:mt-0 md:contents md:pl-0">
          <span className="flex w-full min-w-0 items-center gap-1.5 leading-[14px] md:w-auto md:justify-end md:gap-2 md:leading-normal">
            <PhoneLabel>{t('metric.cpu')}</PhoneLabel>
            <span className="flex min-w-0 flex-1 md:hidden">
              <TickBar
                filled={(cpu / 100) * PHONE_CELLS}
                ticks={PHONE_CELLS}
                height={PHONE_BAR_HEIGHT}
                stretch
                level={cpuLevel}
                label={`${t('metric.cpu')} ${formatPercent(cpu)}%`}
              />
            </span>
            <span className="hidden w-[68px] justify-end md:flex">
              <TickBar
                filled={cores.filled}
                ticks={cores.ticks}
                notch={notch}
                height={height}
                level={cpuLevel}
                label={`${t('metric.cpu')} ${formatPercent(cpu)}%`}
              />
            </span>
            <span
              className={`num w-8 shrink-0 text-right text-[11px] leading-[14px] md:w-10 md:text-[12px] md:leading-normal ${
                cpuLevel === 'danger' ? 'font-medium text-danger md:font-normal md:text-ink' : cpuLevel === 'warn' ? 'font-medium text-warn md:font-normal md:text-ink' : ''
              }`}
            >
              {formatPercent(cpu)}%
            </span>
          </span>

          <span className="flex w-full min-w-0 items-center gap-1.5 leading-[14px] md:w-auto md:justify-end md:gap-2 md:leading-normal">
            <PhoneLabel>{t('metric.memory')}</PhoneLabel>
            <span className="flex min-w-0 flex-1 md:hidden">
              <BlockGrid
                filled={(memPct / 100) * PHONE_CELLS}
                blocks={PHONE_CELLS}
                height={PHONE_BAR_HEIGHT}
                stretch
                level={memLevel}
                label={`${t('metric.memory')} ${formatPercent(memPct)}%`}
              />
            </span>
            <span className="hidden w-[76px] shrink-0 justify-end md:flex">
              <BlockGrid
                filled={mem.filled}
                blocks={mem.blocks}
                swapBlocks={compact ? 0 : mem.swapBlocks}
                height={height}
                /* The box this sits in. Without it a 64 GB node with swap drew 143px into a
                   76px slot and landed on the CPU percentage two columns over. */
                box={76}
                level={memLevel}
                label={`${t('metric.memory')} ${formatPercent(memPct)}%`}
              />
            </span>
            <span
              className={`num w-[46px] shrink-0 text-right text-[11px] leading-[14px] whitespace-nowrap md:w-[84px] md:text-[12px] md:leading-normal ${
                memLevel === 'danger' ? 'font-medium text-danger md:font-normal md:text-muted' : memLevel === 'warn' ? 'font-medium text-warn md:font-normal md:text-muted' : 'text-muted'
              }`}
            >
              {memUsedParts.value}
              {/* The unit is dropped only when both sides share it: "904.4/4GB" read as 904 GB. */}
              <span className={memUsedParts.unit === splitBytes(memTotal, 0).unit ? 'md:hidden' : ''}>{memUsedParts.unit}</span>
              <span className="hidden md:inline">
                /{splitBytes(memTotal, 0).value}
                {splitBytes(memTotal, 0).unit}
              </span>
            </span>
          </span>

          <span className="col-span-2 flex items-center gap-1.5 leading-[14px] md:col-span-1 md:w-auto md:justify-end md:gap-2 md:leading-normal">
            {/* between md and lg the spark and the run give their width to the name column */}
            <span className="hidden w-12 lg:block xl:w-[88px]">
              <MirrorSpark up={live.up} down={live.down} width={88} height={compact ? 20 : 26} stretch label={t('metric.network')} />
            </span>
            {/* Up and down are one reading, so they sit side by side: on a phone, each under the
                half above it, and from lg, where the column was widened for it. Between md and lg
                the name column cannot give up 60px, so there they stack. */}
            <span className="num grid w-full grid-cols-2 gap-x-3 text-[11px] leading-[14px] whitespace-nowrap md:flex md:w-[62px] md:flex-col md:items-end md:gap-0 md:text-right md:leading-tight lg:w-[132px] lg:flex-row lg:items-center lg:gap-2">
              <span className="flex min-w-0 items-center gap-1.5 md:inline">
                <PhoneLabel>{t('metric.network')}</PhoneLabel>
                <span>
                  <span className="mr-0.5 text-muted">↑</span>
                  <Value parts={splitSpeed(snap?.netUp ?? 0)} />
                </span>
              </span>
              <span>
                <span className="mr-0.5 text-muted">↓</span>
                <Value parts={splitSpeed(snap?.netDown ?? 0)} />
              </span>
            </span>
          </span>

          {/* col-span is for the phone grid only; under md:contents it must not span columns */}
          <span className="col-span-2 hidden items-center justify-end gap-2.5 md:col-span-1 md:flex">
            {/* the run grows as the buffer fills, so it hangs in a fixed box to keep the column straight;
                below xl the name column needs that width more */}
            <span className="hidden w-[84px] justify-end xl:flex">
              <DotRun run={live.run} label={t('status.live')} size={compact ? 3 : 4} gap={compact ? 2 : 2.5} />
            </span>
            {/* a node that is not live says when it last reported instead; the time and a quota
                together do not fit the box, and the quota is still on its card and node page */}
            <span className="num flex w-[92px] min-w-0 justify-end text-[11px] whitespace-nowrap text-muted">
              {cond.kind === 'online' ? <span className="truncate">{uptime(snap!.uptime)}</span> : <ConditionNote cond={cond} short />}
              {quota !== null && cond.kind === 'online' && <span className={`shrink-0 whitespace-pre ${quota >= 95 ? 'text-danger' : ''}`}> · {formatPercent(quota)}%</span>}
            </span>
          </span>
        </span>
      ) : (
        <span className="mt-0.5 flex min-w-0 items-center gap-2 pl-[22px] text-[11.5px] leading-[16px] md:col-span-4 md:mt-0 md:justify-end md:pl-0 md:text-[12px] md:leading-normal">
          <ConditionNote cond={cond} />
        </span>
      )}
    </Link>
  )
}

/** "Debian GNU/Linux 12 (bookworm)" is "Debian 12" once the parts nobody reads are gone. */
const osShort = (os: string) =>
  os
    .replace(/GNU\/Linux\s*/i, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .trim()

/** The network spark's width in a card. The three readings above it no longer use a pixel
 *  budget: their cells stretch to whatever column the card gives them (71px four-up, 110px on
 *  a phone), so no card width can make them spill. */
const CARD_BOX = 88

/** Taller than a ledger row's instruments: a card has the room, and a reading you are meant
 *  to notice from across the page cannot be a hairline. */
const CARD_BAR = 14

/**
 * A card's readings are divided into a fixed number of cells, the same for every node.
 *
 * The ledger divides by what the machine has — one tick per core, one block per gigabyte —
 * because there the readings sit in a column and the texture is comparable down the page. A
 * card is one node on its own, so dividing by capacity only made the cell width a by-product
 * of "fixed width ÷ variable count": a two-core box drew two fat cells beside a sixteen-core
 * box's sixteen thin ones, and the width carried no meaning of its own. How many cores and how
 * many gigabytes is already written twice on the card, in the spec line and under the bar.
 */
const CARD_CELLS = 12

/**
 * One of the three readings across the top of a card: a quiet label, then the number at a size
 * the eye lands on first, then the instrument under it. The number leads here because a card is
 * read one node at a time — the ledger can lean on its columns instead, so its numbers are small.
 */
function CardReading({
  label,
  percent,
  level,
  instrument,
  sub,
}: {
  label: string
  percent: number
  level: Level
  instrument: ReactNode
  /** The figures behind the percentage: what is used out of what there is. */
  sub?: ReactNode
}) {
  return (
    <span className="min-w-0">
      <span className="block truncate text-[11px] leading-3.5 text-muted lg:text-[12px] lg:leading-normal lg:@max-xs:text-[11px]">{label}</span>
      {/* The number takes the warning colour too. The instrument alone is easy to skim past,
          and the number is where the eye already is — colouring only the bar buries the alarm
          in the quietest part of the reading. */}
      <Percent
        value={percent}
        className={`mt-0.5 block text-[17px] leading-5 font-light tracking-[-0.02em] lg:mt-1 lg:text-[20px] lg:leading-tight lg:@max-xs:text-[18px] ${
          level === 'danger' ? 'text-danger' : level === 'warn' ? 'text-warn' : ''
        }`}
      />
      <span className="mt-1 block lg:mt-2.5">{instrument}</span>
      {sub && <span className="num mt-1 block truncate text-[11px] leading-3.5 text-muted lg:mt-2 lg:leading-normal max-lg:@max-xs:tracking-[-0.02em]">{sub}</span>}
    </span>
  )
}

/**
 * One decimal while the figure has one or two digits, none from three: "577.8 MB" and
 * "1013.0MB" do not fit a narrow column, and a tenth of a megabyte is noise anyway.
 */
function compactBytes(bytes: number) {
  const first = splitBytes(bytes, 1)
  return Number(first.value) >= 100 ? splitBytes(bytes, 0) : first
}

/**
 * "11.3 / 16 GB": the used side is written in the total's unit, so there is one unit and it is
 * written once. A card column is 71px in a four-up row, where "1013 MB / 2 GB" did not fit and
 * "0.99 / 2 GB" does — and the two sides are easier to compare in the same unit anyway.
 */
function usedOfTotal(used: number, total: number) {
  const t = splitBytes(total, 0)
  if (total <= 0) {
    const u = compactBytes(used)
    return `${u.value} ${u.unit}`
  }
  const scale = total / Number(splitBytes(total, 6).value)
  const v = used / scale
  const value = !Number.isFinite(v) || v <= 0 ? '0' : v.toFixed(v < 1 ? 2 : v < 10 ? 1 : 0)
  return `${value} / ${t.value} ${t.unit}`
}

/**
 * The same node, given its own block instead of a row.
 *
 * The shape is the one this theme shipped with: who the machine is, then CPU / memory / disk
 * as three equal readings, then rate and traffic side by side, then one line of everything
 * else. What changed is the drawing — the plain bars are the ledger's instruments now, so the
 * two views share a language and the choice is about arrangement, not about which theme you get.
 */
export function NodeCard({ node, snap, tick, pending }: { node: NodeInfo; snap?: Snapshot; tick: number; pending?: boolean }) {
  const { t } = useTranslation()
  const uptime = useUptime()
  const billing = useBilling()
  const showBilling = useStore((s) => s.settings.showBilling)
  const actualPrice = showBilling ? billing.actualPrice(node) : ''

  const live = useMemo(() => {
    const points = getLive(node.id)
    const span = liveSpanMinutes(points, WINDOW_MINUTES)
    return {
      up: recentBuckets(points, (p) => p.netUp, SPARK_BUCKETS, span),
      down: recentBuckets(points, (p) => p.netDown, SPARK_BUCKETS, span),
      run: reportRun(points, RUN_CELLS, span, Date.now(), getBlindWindows()),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, tick])

  const online = Boolean(snap?.online)
  const cond = nodeCondition(node, snap, Date.now(), !pending)
  const shown = online || (!pending && cond.readings && cond.kind !== 'never')
  const memTotal = snap?.memTotal || node.memTotal
  const diskTotal = snap?.diskTotal || node.diskTotal
  const cpu = shown ? (snap?.cpu ?? 0) : 0
  const memPct = shown ? ratio(snap?.memUsed ?? 0, memTotal) : 0
  const diskPct = snap ? ratio(snap.diskUsed, diskTotal) : 0
  // No per-core or per-gigabyte division here: the card's cells are CARD_CELLS, always. The
  // notch stays, because a load average crossing the core count is a fact about this machine
  // rather than a way of drawing it.
  const notch = node.cpuCores > 0 && snap ? Math.min(1, snap.load1 / node.cpuCores) : undefined

  const price = showBilling ? billing.price(node) : ''
  const expiry = showBilling ? billing.expiry(node) : null
  const used = quotaUsage(node, snap)
  const quota = node.trafficLimit > 0 && used !== null ? ratio(used, node.trafficLimit) : null
  const spec = [
    osShort(node.os),
    node.cpuCores ? t('metric.cores', { count: node.cpuCores }) : '',
    memTotal ? `${splitBytes(memTotal, 0).value} ${splitBytes(memTotal, 0).unit}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Link
      href={adapter.nodePath(node.id)}
      data-pending={pending ? '' : undefined}
      data-stale={shown && cond.kind !== 'online' ? '' : undefined}
      className="card @container block transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-[0_12px_32px_-16px_rgb(24_37_27/0.18)]"
    >
      {/* Below 320px — four cards to a row — the card tightens its padding and gaps rather than
          its type: the numbers still lead, and the labels stay above them. */}
      <span className="flex flex-col px-3.5 py-2.5 lg:p-5 lg:@max-xs:p-4">
        {/* who the machine is */}
        <span className="flex items-start gap-2.5 lg:gap-3">
          <StatusDot online={online} pending={pending || cond.kind === 'never'} className="mt-[6px] lg:mt-[7px]" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <OsGlyph os={node.os} tile={20} size={13} />
              <span className="truncate text-[14px] leading-5 font-medium tracking-[-0.01em] lg:text-[16px] lg:leading-normal max-lg:@max-xs:tracking-[-0.02em]">{stripFlag(node.name)}</span>
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] leading-4 text-muted lg:mt-1 lg:block lg:text-[12px] lg:leading-normal">
              <span className="truncate">{spec || '—'}</span>
              {/* a narrow card gives the name the whole first row; the region rides on the spec line */}
              <span className="ml-auto hidden shrink-0 max-lg:@max-xs:flex"><RegionTag code={node.region} /></span>
            </span>
          </span>
          <RegionTag code={node.region} className="shrink-0 max-lg:@max-xs:hidden" />
        </span>

        {/* One shape for every state: a node with nothing to show keeps the card's height with
            still placeholders, and says why on its last line. */}
        <>
            {!shown ? <PendingReadings card /> : <>
            {/* how busy it is */}
            <span className="mt-2.5 grid grid-cols-3 gap-3 lg:mt-5 lg:gap-4 lg:@max-xs:mt-4 lg:@max-xs:gap-3">
              <CardReading
                label={t('metric.cpu')}
                percent={cpu}
                level={levelFor('cpu', cpu)}
                sub={`${t('metric.load')} ${snap!.load1.toFixed(2)}`}
                instrument={
                  <TickBar
                    animate
                    filled={(cpu / 100) * CARD_CELLS}
                    ticks={CARD_CELLS}
                    notch={notch}
                    height={CARD_BAR}
                    gap={2}
                    stretch
                    level={levelFor('cpu', cpu)}
                    label={t('metric.cpu')}
                  />
                }
              />
              <CardReading
                label={t('metric.memory')}
                percent={memPct}
                level={levelFor('memory', memPct)}
                sub={usedOfTotal(snap!.memUsed, memTotal)}
                instrument={
                  <BlockGrid
                    animate
                    filled={(memPct / 100) * CARD_CELLS}
                    blocks={CARD_CELLS}
                    height={CARD_BAR}
                    stretch
                    level={levelFor('memory', memPct)}
                    label={t('metric.memory')}
                  />
                }
              />
              <CardReading
                label={t('metric.disk')}
                percent={diskPct}
                level={levelFor('disk', diskPct)}
                sub={usedOfTotal(snap!.diskUsed, diskTotal)}
                instrument={
                  <BlockGrid
                    animate
                    filled={(diskPct / 100) * CARD_CELLS}
                    blocks={CARD_CELLS}
                    height={CARD_BAR}
                    stretch
                    level={levelFor('disk', diskPct)}
                    label={t('metric.disk')}
                  />
                }
              />
            </span>

            {/* what it is moving */}
            <span className="mt-2.5 flex min-w-0 flex-col gap-1 border-t border-line pt-2 lg:mt-5 lg:gap-2 lg:pt-4 lg:@max-xs:mt-4">
              <span className="hidden text-[12px] text-muted lg:block">{t('node.speed')}</span>
              <span className="grid grid-cols-3 items-center gap-3 lg:contents max-lg:@max-xs:grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)]">
                <MirrorSpark up={live.up} down={live.down} width={CARD_BOX} height={32} stretch label={t('metric.network')} className="h-[22px] lg:h-[32px]" />
                <span className="col-span-2 grid grid-cols-2 gap-3 text-[15px] leading-5 max-lg:@max-xs:text-[14px] font-light tracking-[-0.02em] text-ink lg:text-[20px] lg:leading-6 lg:@max-xs:text-[18px]">
                  <span className="flex h-[22px] min-w-0 items-center gap-1 lg:h-[24px] lg:gap-1.5">
                    <ArrowUp size={14} className="shrink-0 text-muted" aria-hidden />
                    <Speed value={snap!.netUp} />
                  </span>
                  <span className="flex h-[22px] min-w-0 items-center gap-1 lg:h-[24px] lg:gap-1.5">
                    <ArrowDown size={14} className="shrink-0 text-muted" aria-hidden />
                    <Speed value={snap!.netDown} />
                  </span>
                </span>
              </span>
              <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 lg:contents">
                <span className="flex min-w-0 flex-1 items-center gap-1 text-[11.5px] leading-4 whitespace-nowrap lg:flex-none max-lg:@max-xs:basis-full lg:text-[13px] lg:leading-5">
                  {/* the label gives way first when a long locale, a quota and five-digit totals meet */}
                  <span className="min-w-0 truncate text-muted">{t('metric.traffic')}</span>
                  <ArrowUp size={12} className="shrink-0 text-muted" aria-hidden />
                  <Bytes value={snap!.totalUp} />
                  <span className="text-muted">·</span>
                  <ArrowDown size={12} className="shrink-0 text-muted" aria-hidden />
                  <Bytes value={snap!.totalDown} />
                  {quota !== null && (
                    <span className={`num ml-auto shrink-0 ${quota >= 95 ? 'text-danger' : quota >= 80 ? 'text-warn' : 'text-muted'}`}>
                      {formatPercent(quota)}%
                    </span>
                  )}
                </span>
                {Boolean(node.trafficLimitPeriod) && node.trafficLimit > 0 && (
                  <span className="ml-auto text-[11px] leading-4 whitespace-nowrap text-muted lg:ml-0 lg:text-[12px] lg:leading-normal">
                    {t('metric.quota')} <span className="num">{billing.quota(node)}</span>
                  </span>
                )}
              </span>
            </span>

            </>}
            <span className="mt-2 grid gap-1 border-t border-line pt-2 text-[11.5px] leading-4 lg:mt-4 lg:gap-2 lg:pt-3 lg:text-[12px] lg:leading-normal">
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-muted">
                {pending ? <span className="skeleton h-3 flex-1" aria-hidden="true" /> : cond.kind === 'online' ? (
                  <span className="inline-flex items-center gap-1.5" title={t('metric.uptime')}>
                    <Clock3 size={12} strokeWidth={1.7} aria-hidden />
                    <span className="sr-only">{t('metric.uptime')}: </span>
                    <span className="num">{uptime(snap!.uptime)}</span>
                  </span>
                ) : <ConditionNote cond={cond} />}
                {cond.kind === 'online' && expiry && (
                  <span
                    className={`inline-flex items-center gap-1.5 ${
                      expiry.level === 'danger'
                        ? 'rounded-full bg-danger-wash px-1.5 py-0.5 leading-none font-medium text-danger lg:rounded-none lg:bg-transparent lg:p-0 lg:leading-normal lg:font-normal'
                        : expiry.level === 'warn'
                          ? 'rounded-full bg-warn-wash px-1.5 py-0.5 leading-none font-medium text-warn lg:rounded-none lg:bg-transparent lg:p-0 lg:leading-normal lg:font-normal'
                          : ''
                    }`}
                    title={t('metric.expiry')}
                  >
                    <CalendarClock size={12} strokeWidth={1.7} aria-hidden />
                    <span className="sr-only">{t('metric.expiry')}: </span>
                    <span>{expiry.text}</span>
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center">
                  {pending ? <span className="skeleton h-4 w-12 lg:h-[18px]" aria-hidden="true" /> : <DotRun run={live.run} label={t('status.live')} size={3} gap={2} />}
                </span>
              </span>
              {(price || actualPrice) && (
                <span className="card-billing flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  {price && <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap" title={t('metric.price')}>
                    <span className="text-muted">{t('metric.listPriceShort')}</span>
                    <span className="num">{price}</span>
                  </span>}
                  {actualPrice && <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap" title={t('metric.actualCost')}>
                    <span className="sr-only">{t('metric.actualCost')}: </span>
                    <span className="text-muted" aria-hidden>{t('metric.actualCostShort')}</span>
                    <span className="num font-medium">{actualPrice}</span>
                  </span>}
                </span>
              )}
            </span>
          </>
      </span>
    </Link>
  )
}
