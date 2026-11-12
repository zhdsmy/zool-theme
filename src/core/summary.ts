import type { HistoryPoint } from './model'

export interface DaySummary {
  todayUp: number
  todayDown: number
  peakUp: number
  peakUpAt: number
  peakDown: number
  peakDownAt: number
}

/**
 * Today's traffic is the growth of the cumulative counters since local midnight, so it
 * does not depend on how the backend buckets its records. Peaks are the highest recorded
 * averages in the given points (the node page passes the last 24 hours).
 */
export function summariseDay(
  points: HistoryPoint[],
  now: { totalUp: number; totalDown: number } | undefined,
  midnight: number,
): DaySummary {
  const s: DaySummary = { todayUp: 0, todayDown: 0, peakUp: 0, peakUpAt: 0, peakDown: 0, peakDownAt: 0 }
  for (const p of points) {
    if (p.netUp > s.peakUp) {
      s.peakUp = p.netUp
      s.peakUpAt = p.at
    }
    if (p.netDown > s.peakDown) {
      s.peakDown = p.netDown
      s.peakDownAt = p.at
    }
  }
  const first = points.find((p) => p.at >= midnight && p.totalUp !== undefined && p.totalDown !== undefined)
  if (first && now) {
    s.todayUp = Math.max(0, now.totalUp - (first.totalUp ?? 0))
    s.todayDown = Math.max(0, now.totalDown - (first.totalDown ?? 0))
  }
  return s
}

/**
 * Latency above this counts as a spike: Tukey's far-out fence (Q3 + 3 × IQR), never
 * tighter than 1.5 × the median, so a steady 2 ms line keeps its normal 3–4 ms jitter.
 */
export function spikeLimit(values: number[]): number {
  if (values.length < 8) return Infinity
  const s = [...values].sort((a, b) => a - b)
  const q = (f: number) => s[Math.floor((s.length - 1) * f)]
  return Math.max(q(0.75) + 3 * (q(0.75) - q(0.25)), q(0.5) * 1.5)
}
