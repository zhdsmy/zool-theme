import { useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'

export interface ChartPoint {
  t: number
  v: number | null
}

export interface ChartSeries {
  key: string
  label: string
  /** Any CSS colour, typically `var(--chart-1)`. */
  color: string
  points: ChartPoint[]
  area?: boolean
}

interface Props {
  series: ChartSeries[]
  format: (v: number) => string
  formatTime: (t: number) => string
  formatTooltipTime?: (t: number) => string
  yMax?: number
  height?: number
  mobileHeight?: number
  label?: string
}

const PAD = { l: 48, r: 6, t: 10, b: 24 }
const MOBILE_PAD = { l: 46, r: 4, t: 6, b: 18 }

function niceMax(v: number) {
  if (!(v > 0)) return 1
  const exp = 10 ** Math.floor(Math.log10(v))
  const f = v / exp
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nf * exp
}

/** Averages points into at most `buckets` buckets so long ranges stay light. */
function downsample(points: ChartPoint[], buckets: number): ChartPoint[] {
  if (points.length <= buckets) return points
  const size = points.length / buckets
  const out: ChartPoint[] = []
  for (let b = 0; b < buckets; b++) {
    const slice = points.slice(Math.floor(b * size), Math.floor((b + 1) * size))
    const vals = slice.map((p) => p.v).filter((v): v is number => v !== null)
    out.push({ t: slice[Math.floor(slice.length / 2)].t, v: vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : null })
  }
  return out
}

function medianStep(points: ChartPoint[]) {
  if (points.length < 3) return Infinity
  const diffs = points.slice(1).map((p, i) => p.t - points[i].t).sort((a, b) => a - b)
  return diffs[Math.floor(diffs.length / 2)]
}

function nearest(points: ChartPoint[], t: number) {
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].t < t) lo = mid
    else hi = mid
  }
  return Math.abs(points[lo].t - t) <= Math.abs(points[hi].t - t) ? lo : hi
}

/**
 * A small, dependency-free SVG time-series chart: hairline grid, 1.5px lines,
 * a soft area under the first series, and a crosshair tooltip.
 */
export function Chart({ series, format, formatTime, formatTooltipTime = formatTime, yMax, height = 150, mobileHeight, label }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.matchMedia('(width < 768px)').matches : false))
  const [hoverT, setHoverT] = useState<number | null>(null)
  const uid = useId().replace(/:/g, '')

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const mq = window.matchMedia('(width < 768px)')
    const sync = () => {
      setWidth(el.clientWidth)
      setIsMobile(mq.matches)
    }
    sync()
    const ro = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width)
      setIsMobile(mq.matches)
    })
    ro.observe(el)
    mq.addEventListener('change', sync)
    return () => {
      ro.disconnect()
      mq.removeEventListener('change', sync)
    }
  }, [])

  const pad = isMobile ? MOBILE_PAD : PAD
  const actualHeight = isMobile ? (mobileHeight ?? Math.round(height * 0.58)) : height
  const plotW = Math.max(0, width - pad.l - pad.r)
  const plotH = actualHeight - pad.t - pad.b

  const prepared = useMemo(
    () => series.map((s) => ({ ...s, points: downsample(s.points, Math.max(40, Math.floor(plotW / 2))) })),
    [series, plotW],
  )

  const all = prepared.flatMap((s) => s.points)
  const t0 = all.length ? Math.min(...all.map((p) => p.t)) : 0
  const t1 = all.length ? Math.max(...all.map((p) => p.t)) : 1
  const span = t1 - t0 || 1
  const dataMax = Math.max(0, ...all.map((p) => p.v ?? 0))
  const max = yMax && yMax > 0 ? yMax : niceMax(dataMax * 1.1)

  const x = (t: number) => pad.l + ((t - t0) / span) * plotW
  const y = (v: number) => pad.t + plotH - (Math.min(v, max) / max) * plotH

  const paths = prepared.map((s) => {
    const gap = medianStep(s.points) * 4
    let line = ''
    let area = ''
    let segStart: number | null = null
    let prevT = -Infinity
    let lastX = 0
    for (const p of s.points) {
      if (p.v === null || p.t - prevT > gap) {
        if (segStart !== null) area += `L${lastX},${pad.t + plotH}L${segStart},${pad.t + plotH}Z`
        segStart = null
      }
      if (p.v !== null) {
        const px = x(p.t)
        const py = y(p.v)
        if (segStart === null) {
          line += `M${px},${py}`
          area += `M${px},${py}`
          segStart = px
        } else {
          line += `L${px},${py}`
          area += `L${px},${py}`
        }
        lastX = px
      }
      prevT = p.t
    }
    if (segStart !== null) area += `L${lastX},${pad.t + plotH}L${segStart},${pad.t + plotH}Z`
    return { key: s.key, color: s.color, line, area: s.area ? area : '' }
  })

  const yTicks = [0, max / 2, max]
  const tickCount = plotW > 0 && plotW < 210 ? 3 : 4
  const xTicks = width > 0 && all.length ? Array.from({ length: tickCount }, (_, i) => t0 + (span * i) / (tickCount - 1)) : []
  const tickTextClass = isMobile ? 'num fill-muted text-[10px]' : 'num fill-muted text-[11px]'

  const hover =
    hoverT === null
      ? null
      : prepared.map((s) => {
          const i = s.points.length ? nearest(s.points, hoverT) : -1
          return { s, p: i >= 0 ? s.points[i] : null }
        })
  const hoverX = hoverT === null ? 0 : x(hover?.find((h) => h.p)?.p?.t ?? hoverT)

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    if (px < pad.l || !all.length) return setHoverT(null)
    setHoverT(t0 + ((px - pad.l) / plotW) * span)
  }

  const empty = all.every((p) => p.v === null)

  return (
    <div ref={box} className="relative select-none" style={{ height: actualHeight }} role="img" aria-label={label}>
      {width > 0 && (
        <svg width={width} height={actualHeight} className="block touch-pan-y overflow-visible" onPointerMove={onMove} onPointerLeave={() => setHoverT(null)}>
          <defs>
            {prepared.map((s) => (
              <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 0.16 }} />
                <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0 }} />
              </linearGradient>
            ))}
          </defs>
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--line)' }} strokeDasharray={i === 0 ? undefined : '2 4'} />
              <text x={pad.l - (isMobile ? 6 : 8)} y={y(v)} dy="0.32em" textAnchor="end" className={tickTextClass}>
                {format(v)}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text
              key={i}
              x={x(t)}
              y={actualHeight - (isMobile ? 3 : 6)}
              textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
              className={tickTextClass}
            >
              {formatTime(t)}
            </text>
          ))}
          {paths.map((p) => p.area && <path key={`a-${p.key}`} d={p.area} style={{ fill: `url(#${uid}-${p.key})` }} />)}
          {paths.map((p) => (
            <path
              key={p.key}
              d={p.line}
              fill="none"
              style={{ stroke: p.color }}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {hover && (
            <g>
              <line x1={hoverX} x2={hoverX} y1={pad.t} y2={pad.t + plotH} style={{ stroke: 'var(--line-strong)' }} />
              {hover.map(({ s, p }) =>
                p && p.v !== null ? (
                  <circle key={s.key} cx={x(p.t)} cy={y(p.v)} r={3.5} style={{ fill: 'var(--surface)', stroke: s.color }} strokeWidth={1.5} />
                ) : null,
              )}
            </g>
          )}
        </svg>
      )}
      {empty && width > 0 && <div className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-muted">—</div>}
      {hover && hover.some((h) => h.p) && (
        <div
          className="popover pointer-events-none absolute top-1 z-10 min-w-[140px] px-3 py-2 text-[12px]"
          style={hoverX > width / 2 ? { right: width - hoverX + 12 } : { left: hoverX + 12 }}
        >
          <p className="num mb-1 text-muted">{formatTooltipTime(hover.find((h) => h.p)!.p!.t)}</p>
          {hover.map(({ s, p }) => (
            <p key={s.key} className="flex items-center gap-2">
              <span className="h-[2px] w-3 rounded-full" style={{ background: s.color }} />
              <span className="text-muted">{s.label}</span>
              <span className="num ml-auto pl-3">{p && p.v !== null ? format(p.v) : '—'}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
