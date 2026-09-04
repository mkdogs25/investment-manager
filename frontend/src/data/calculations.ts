/**
 * Pure financial calculations.
 *
 * Nothing here touches the network, the DOM or the spreadsheet writer, so every
 * formula is testable on its own. Full floating point precision is preserved;
 * rounding happens only at the presentation layer.
 *
 * This mirrors backend/app/services/calculations.py formula for formula — see
 * the Methodology sheet, which documents both.
 */

export const DAYS_PER_YEAR = 365.25
const MS_PER_DAY = 86_400_000

export interface NavPoint {
  /** Calendar date of the NAV, normalised to UTC midnight. */
  on: Date
  nav: number
}

/** Whole days between two dates, ignoring any time-of-day component. */
export function daysBetween(start: Date, end: Date): number {
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  return Math.round((b - a) / MS_PER_DAY)
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime())
  copy.setDate(copy.getDate() + days)
  return copy
}

// ----------------------------------------------------------------------
// Investment-level maths
// ----------------------------------------------------------------------
export function absoluteGain(amountInvested: number, currentAmount: number): number {
  return currentAmount - amountInvested
}

export function absoluteReturnPct(amountInvested: number, currentAmount: number): number {
  if (amountInvested <= 0) throw new Error('Amount invested must be greater than zero')
  return ((currentAmount - amountInvested) / amountInvested) * 100
}

export function holdingPeriodDays(start: Date, end: Date): number {
  const days = daysBetween(start, end)
  if (days < 0) throw new Error('Investment date cannot be after the report date')
  return days
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

/**
 * Adds whole months, clamping the day to the target month's length, so that
 * 31 January plus one month is 28 February rather than spilling into March.
 */
function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getFullYear()
  const monthIndex = date.getMonth() + months
  const targetYear = year + Math.floor(monthIndex / 12)
  const targetMonth = ((monthIndex % 12) + 12) % 12
  const day = Math.min(date.getDate(), daysInMonth(targetYear, targetMonth))
  return new Date(targetYear, targetMonth, day)
}

/**
 * Human readable elapsed time, e.g. "3 years, 1 month, 12 days".
 *
 * Counts whole months first (with end-of-month clamping) and only then the
 * leftover days, which is what makes 31 Jan to 1 Mar read as "1 month, 1 day"
 * rather than borrowing a negative remainder.
 */
export function holdingPeriodLabel(start: Date, end: Date): string {
  if (daysBetween(start, end) < 0) {
    throw new Error('Investment date cannot be after the report date')
  }

  let months =
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  if (months > 0 && daysBetween(addMonthsClamped(start, months), end) < 0) {
    months -= 1
  }
  const days = daysBetween(addMonthsClamped(start, months), end)
  const years = Math.floor(months / 12)
  const remainingMonths = months % 12

  const parts: string[] = []
  if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`)
  if (remainingMonths) {
    parts.push(`${remainingMonths} month${remainingMonths === 1 ? '' : 's'}`)
  }
  if (days || parts.length === 0) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  return parts.join(', ')
}

/**
 * Annualised return over the *actual* holding period:
 *
 *     CAGR = ((current / invested) ** (365.25 / days)) - 1
 *
 * Returns null when the holding period is under a day (annualising it would
 * explode) or when either amount makes the result undefined.
 */
export function cagrPct(
  amountInvested: number,
  currentAmount: number,
  start: Date,
  end: Date,
): number | null {
  if (amountInvested <= 0 || currentAmount <= 0) return null
  const days = holdingPeriodDays(start, end)
  if (days < 1) return null
  const years = days / DAYS_PER_YEAR
  return (Math.pow(currentAmount / amountInvested, 1 / years) - 1) * 100
}

export function allocationPct(
  fundCurrentValue: number,
  totalCurrentValue: number,
): number | null {
  if (totalCurrentValue <= 0) return null
  return (fundCurrentValue / totalCurrentValue) * 100
}

// ----------------------------------------------------------------------
// NAV-series maths
// ----------------------------------------------------------------------
function sorted(series: NavPoint[]): NavPoint[] {
  return series.filter((p) => p.nav > 0).sort((a, b) => a.on.getTime() - b.on.getTime())
}

/**
 * Nearest NAV at or before `target`.
 *
 * Indian funds publish no NAV on holidays, so a small look-back window is
 * allowed. Beyond it the value is reported unavailable rather than silently
 * using a stale price.
 */
export function navOnOrBefore(
  series: NavPoint[],
  target: Date,
  toleranceDays = 10,
): NavPoint | null {
  const obs = sorted(series)
  // Binary search for the last point at or before the target.
  let low = 0
  let high = obs.length - 1
  let found = -1
  const targetTime = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate())
  while (low <= high) {
    const mid = (low + high) >> 1
    const point = obs[mid].on
    const midTime = Date.UTC(point.getFullYear(), point.getMonth(), point.getDate())
    if (midTime <= targetTime) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  if (found < 0) return null
  const candidate = obs[found]
  if (daysBetween(candidate.on, target) > toleranceDays) return null
  return candidate
}

/**
 * Trailing return over `years`: absolute for windows of a year or less,
 * annualised beyond that — the convention on Indian fund factsheets.
 */
export function trailingReturnPct(series: NavPoint[], years: number): number | null {
  const obs = sorted(series)
  if (obs.length === 0) return null
  const end = obs[obs.length - 1]
  const startDate = addDays(end.on, -Math.round(years * DAYS_PER_YEAR))
  if (daysBetween(obs[0].on, startDate) < 0) return null
  const start = navOnOrBefore(obs, startDate)
  if (!start || start.nav <= 0) return null
  const growth = end.nav / start.nav
  if (years <= 1) return (growth - 1) * 100
  return (Math.pow(growth, 1 / years) - 1) * 100
}

/** Annualised return from the first published NAV to the latest. */
export function sinceInceptionReturnPct(series: NavPoint[]): number | null {
  const obs = sorted(series)
  if (obs.length < 2) return null
  const days = daysBetween(obs[0].on, obs[obs.length - 1].on)
  if (days < 365) return null
  if (obs[0].nav <= 0) return null
  const years = days / DAYS_PER_YEAR
  return (Math.pow(obs[obs.length - 1].nav / obs[0].nav, 1 / years) - 1) * 100
}

export function dailyReturns(series: NavPoint[]): number[] {
  const obs = sorted(series)
  const out: number[] = []
  for (let i = 1; i < obs.length; i += 1) {
    if (obs[i - 1].nav <= 0) continue
    out.push(obs[i].nav / obs[i - 1].nav - 1)
  }
  return out
}

function meanAndSampleStdev(values: number[]): { mean: number; stdev: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1)
  return { mean, stdev: Math.sqrt(variance) }
}

/** Annualised standard deviation of daily NAV returns, in percent. */
export function volatilityPct(
  series: NavPoint[],
  tradingDaysPerYear = 252,
  minObservations = 60,
): number | null {
  const returns = dailyReturns(series)
  if (returns.length < minObservations) return null
  const { stdev } = meanAndSampleStdev(returns)
  return stdev * Math.sqrt(tradingDaysPerYear) * 100
}

/**
 * (annualised return − risk-free rate) / annualised volatility.
 * Both legs come from the same daily NAV series, so the ratio is consistent.
 */
export function sharpeRatio(
  series: NavPoint[],
  riskFreeRate = 0.06,
  tradingDaysPerYear = 252,
  minObservations = 60,
): number | null {
  const returns = dailyReturns(series)
  if (returns.length < minObservations) return null
  const { mean, stdev } = meanAndSampleStdev(returns)
  if (stdev <= 0) return null
  const annualReturn = Math.pow(1 + mean, tradingDaysPerYear) - 1
  const annualVol = stdev * Math.sqrt(tradingDaysPerYear)
  return (annualReturn - riskFreeRate) / annualVol
}

/** Largest peak-to-trough decline, as a negative percentage. */
export function maxDrawdownPct(series: NavPoint[]): number | null {
  const obs = sorted(series)
  if (obs.length < 2) return null
  let peak = obs[0].nav
  let worst = 0
  for (const point of obs) {
    peak = Math.max(peak, point.nav)
    if (peak > 0) worst = Math.min(worst, point.nav / peak - 1)
  }
  return worst * 100
}

/**
 * Share of rolling windows with a positive return, in percent.
 * Sampled monthly to stay cheap on twenty-year histories.
 */
export function rollingReturnConsistency(
  series: NavPoint[],
  windowYears = 1,
): number | null {
  const obs = sorted(series)
  if (obs.length < 2) return null
  const spanDays = Math.round(windowYears * DAYS_PER_YEAR)
  const last = obs[obs.length - 1].on
  if (daysBetween(obs[0].on, last) < spanDays + 365) return null

  let positives = 0
  let total = 0
  const cursor = addDays(obs[0].on, spanDays)
  while (daysBetween(cursor, last) >= 0) {
    const start = navOnOrBefore(obs, addDays(cursor, -spanDays))
    const end = navOnOrBefore(obs, cursor)
    if (start && end && start.nav > 0) {
      total += 1
      if (end.nav > start.nav) positives += 1
    }
    cursor.setMonth(cursor.getMonth() + 1)
  }

  if (total < 12) return null
  return (positives / total) * 100
}

// ----------------------------------------------------------------------
// Portfolio-level maths
// ----------------------------------------------------------------------
export interface PortfolioRow {
  name: string
  invested: number
  current: number
}

export interface PortfolioTotals {
  numberOfFunds: number
  totalInvested: number
  totalCurrent: number
  totalGainLoss: number
  totalReturnPct: number
  largestHolding: string | null
  largestHoldingValue: number | null
  smallestHolding: string | null
  smallestHoldingValue: number | null
}

export function portfolioTotals(rows: PortfolioRow[]): PortfolioTotals {
  const totalInvested = rows.reduce((a, r) => a + r.invested, 0)
  const totalCurrent = rows.reduce((a, r) => a + r.current, 0)
  const gain = totalCurrent - totalInvested

  let largest: PortfolioRow | null = null
  let smallest: PortfolioRow | null = null
  for (const row of rows) {
    if (!largest || row.current > largest.current) largest = row
    if (!smallest || row.current < smallest.current) smallest = row
  }

  return {
    numberOfFunds: rows.length,
    totalInvested,
    totalCurrent,
    totalGainLoss: gain,
    totalReturnPct: totalInvested > 0 ? (gain / totalInvested) * 100 : 0,
    largestHolding: largest?.name ?? null,
    largestHoldingValue: largest?.current ?? null,
    smallestHolding: smallest?.name ?? null,
    smallestHoldingValue: smallest?.current ?? null,
  }
}
