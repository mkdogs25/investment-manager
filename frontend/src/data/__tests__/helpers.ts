import type { NavPoint } from '../calculations'

export const REPORT_DATE = new Date(2026, 8, 4) // 4 September 2026, local midnight

export function d(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day)
}

/** Deterministic pseudo-random generator so fixtures are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rand: () => number): number {
  // Box-Muller
  const u = Math.max(rand(), Number.EPSILON)
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function syntheticNavs({
  start,
  end,
  startNav = 100,
  annualDrift = 0.12,
  annualVol = 0.15,
  seed = 7,
}: {
  start: Date
  end: Date
  startNav?: number
  annualDrift?: number
  annualVol?: number
  seed?: number
}): NavPoint[] {
  const rand = mulberry32(seed)
  const dailyDrift = annualDrift / 252
  const dailyVol = annualVol / Math.sqrt(252)
  const points: NavPoint[] = []
  let nav = startNav
  const cursor = new Date(start.getTime())
  while (cursor.getTime() <= end.getTime()) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) {
      points.push({ on: new Date(cursor.getTime()), nav: Number(nav.toFixed(4)) })
      nav *= 1 + dailyDrift + gaussian(rand) * dailyVol
      nav = Math.max(nav, 1)
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return points
}

export function flatSeries(days: number, nav = 100): NavPoint[] {
  const start = new Date(REPORT_DATE.getTime())
  start.setDate(start.getDate() - days)
  return Array.from({ length: days + 1 }, (_, i) => {
    const on = new Date(start.getTime())
    on.setDate(on.getDate() + i)
    return { on, nav }
  })
}

export function compoundingSeries(days: number, dailyRate: number): NavPoint[] {
  const start = new Date(REPORT_DATE.getTime())
  start.setDate(start.getDate() - days)
  return Array.from({ length: days + 1 }, (_, i) => {
    const on = new Date(start.getTime())
    on.setDate(on.getDate() + i)
    return { on, nav: 100 * Math.pow(1 + dailyRate, i) }
  })
}
