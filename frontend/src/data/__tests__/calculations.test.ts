import { describe, expect, it } from 'vitest'
import * as calc from '../calculations'
import {
  REPORT_DATE,
  compoundingSeries,
  d,
  flatSeries,
  syntheticNavs,
} from './helpers'

describe('investment-level maths', () => {
  it('computes absolute gain and return', () => {
    expect(calc.absoluteGain(100_000, 150_000)).toBe(50_000)
    expect(calc.absoluteReturnPct(100_000, 150_000)).toBeCloseTo(50, 10)
    expect(calc.absoluteGain(100_000, 80_000)).toBe(-20_000)
    expect(calc.absoluteReturnPct(100_000, 80_000)).toBeCloseTo(-20, 10)
  })

  it('rejects a zero investment', () => {
    expect(() => calc.absoluteReturnPct(0, 1000)).toThrow()
  })

  it('measures an exact three-year holding period', () => {
    expect(calc.holdingPeriodDays(d(2023, 9, 4), d(2026, 9, 4))).toBe(1096)
    expect(calc.holdingPeriodLabel(d(2023, 9, 4), d(2026, 9, 4))).toBe('3 years')
  })

  it('measures a mixed holding period', () => {
    expect(calc.holdingPeriodLabel(d(2024, 1, 15), d(2026, 3, 20))).toBe(
      '2 years, 2 months, 5 days',
    )
  })

  it('handles a same-day holding period', () => {
    expect(calc.holdingPeriodLabel(d(2026, 9, 4), d(2026, 9, 4))).toBe('0 days')
  })

  it('borrows correctly when the end day precedes the start day', () => {
    expect(calc.holdingPeriodLabel(d(2026, 1, 31), d(2026, 3, 1))).toBe('1 month, 1 day')
  })

  it('rejects reversed dates', () => {
    expect(() => calc.holdingPeriodDays(d(2026, 9, 5), d(2026, 9, 4))).toThrow()
  })

  it('computes CAGR over the actual holding period', () => {
    const value = calc.cagrPct(100_000, 150_000, d(2023, 9, 4), d(2026, 9, 4))
    const expected = (Math.pow(1.5, 365.25 / 1096) - 1) * 100
    expect(value).toBeCloseTo(expected, 10)
    expect(value).toBeCloseTo(14.4679, 3)
  })

  it('does not round CAGR to whole years', () => {
    const partial = calc.cagrPct(100_000, 150_000, d(2024, 3, 15), REPORT_DATE)
    const whole = calc.cagrPct(100_000, 150_000, d(2024, 9, 4), REPORT_DATE)
    expect(partial).not.toBeCloseTo(whole!, 6)
  })

  it('withholds CAGR when it is undefined', () => {
    expect(calc.cagrPct(100_000, 150_000, d(2026, 9, 4), d(2026, 9, 4))).toBeNull()
    expect(calc.cagrPct(100_000, 0, d(2023, 9, 4), d(2026, 9, 4))).toBeNull()
    expect(calc.cagrPct(0, 150_000, d(2023, 9, 4), d(2026, 9, 4))).toBeNull()
  })

  it('reports a negative CAGR on a loss', () => {
    expect(calc.cagrPct(100_000, 60_000, d(2021, 9, 4), d(2026, 9, 4))!).toBeLessThan(0)
  })

  it('computes allocation', () => {
    expect(calc.allocationPct(25_000, 100_000)).toBeCloseTo(25, 10)
    expect(calc.allocationPct(0, 0)).toBeNull()
  })
})

describe('portfolio totals', () => {
  it('sums and identifies extremes', () => {
    const totals = calc.portfolioTotals([
      { name: 'A', invested: 100_000, current: 150_000 },
      { name: 'B', invested: 50_000, current: 40_000 },
    ])
    expect(totals.numberOfFunds).toBe(2)
    expect(totals.totalInvested).toBe(150_000)
    expect(totals.totalCurrent).toBe(190_000)
    expect(totals.totalGainLoss).toBe(40_000)
    expect(totals.totalReturnPct).toBeCloseTo(26.6667, 3)
    expect(totals.largestHolding).toBe('A')
    expect(totals.smallestHolding).toBe('B')
  })

  it('produces allocations summing to 100', () => {
    const rows = [
      { name: 'A', invested: 1, current: 150_000 },
      { name: 'B', invested: 1, current: 40_000 },
      { name: 'C', invested: 1, current: 10_000 },
    ]
    const total = rows.reduce((a, r) => a + r.current, 0)
    const sum = rows.reduce((a, r) => a + calc.allocationPct(r.current, total)!, 0)
    expect(sum).toBeCloseTo(100, 10)
  })

  it('handles an empty portfolio without dividing by zero', () => {
    const totals = calc.portfolioTotals([])
    expect(totals.numberOfFunds).toBe(0)
    expect(totals.totalReturnPct).toBe(0)
    expect(totals.largestHolding).toBeNull()
  })
})

describe('NAV series metrics', () => {
  it('treats the 1Y return as absolute', () => {
    const series = compoundingSeries(800, 0.0002)
    const end = series[series.length - 1]
    const start = calc.navOnOrBefore(series, calc.addDays(end.on, -365))!
    const expected = (end.nav / start.nav - 1) * 100
    expect(calc.trailingReturnPct(series, 1)).toBeCloseTo(expected, 8)
  })

  it('annualises the 3Y return', () => {
    const series = compoundingSeries(2000, 0.0002)
    expect(calc.trailingReturnPct(series, 3)).toBeCloseTo(
      calc.trailingReturnPct(series, 1)!,
      0,
    )
  })

  it('withholds trailing returns when history is too short', () => {
    const series = compoundingSeries(200, 0.0002)
    expect(calc.trailingReturnPct(series, 3)).toBeNull()
    expect(calc.trailingReturnPct(series, 5)).toBeNull()
  })

  it('respects the holiday look-back tolerance', () => {
    const series = [{ on: d(2026, 1, 1), nav: 10 }]
    expect(calc.navOnOrBefore(series, d(2026, 1, 5))).not.toBeNull()
    expect(calc.navOnOrBefore(series, d(2026, 3, 1))).toBeNull()
    expect(calc.navOnOrBefore(series, d(2025, 12, 31))).toBeNull()
  })

  it('computes since-inception return', () => {
    const series = compoundingSeries(1000, 0.0002)
    const years = 1000 / calc.DAYS_PER_YEAR
    const expected =
      (Math.pow(series[series.length - 1].nav / series[0].nav, 1 / years) - 1) * 100
    expect(calc.sinceInceptionReturnPct(series)).toBeCloseTo(expected, 8)
  })

  it('needs a year of history for since-inception', () => {
    expect(calc.sinceInceptionReturnPct(compoundingSeries(200, 0.0002))).toBeNull()
  })

  it('reports zero volatility for a flat series', () => {
    expect(calc.volatilityPct(flatSeries(400))).toBeCloseTo(0, 10)
  })

  it('recovers the target volatility of a synthetic series', () => {
    const series = syntheticNavs({
      start: d(2016, 9, 5),
      end: d(2026, 9, 4),
      annualVol: 0.18,
      seed: 3,
    })
    expect(calc.volatilityPct(series)).toBeCloseTo(18, -0.5)
  })

  it('requires a minimum number of observations', () => {
    expect(calc.volatilityPct(flatSeries(10))).toBeNull()
    expect(calc.volatilityPct(flatSeries(10), 252, 5)).not.toBeNull()
  })

  it('leaves Sharpe undefined when volatility is zero', () => {
    expect(calc.sharpeRatio(flatSeries(400))).toBeNull()
  })

  it('signs Sharpe by excess return', () => {
    const strong = syntheticNavs({
      start: d(2016, 9, 5), end: d(2026, 9, 4),
      annualDrift: 0.2, annualVol: 0.12, seed: 5,
    })
    const weak = syntheticNavs({
      start: d(2016, 9, 5), end: d(2026, 9, 4),
      annualDrift: -0.05, annualVol: 0.12, seed: 5,
    })
    expect(calc.sharpeRatio(strong)!).toBeGreaterThan(0)
    expect(calc.sharpeRatio(weak)!).toBeLessThan(0)
  })

  it('finds the worst peak-to-trough decline', () => {
    const navs = [100, 120, 90, 110, 60, 80]
    const series = navs.map((nav, i) => ({ on: calc.addDays(d(2026, 1, 1), i), nav }))
    expect(calc.maxDrawdownPct(series)).toBeCloseTo(-50, 10)
  })

  it('reports zero drawdown for a monotonic series', () => {
    expect(calc.maxDrawdownPct(compoundingSeries(300, 0.001))).toBeCloseTo(0, 10)
  })

  it('needs two points for a drawdown', () => {
    expect(calc.maxDrawdownPct([{ on: d(2026, 1, 1), nav: 10 }])).toBeNull()
  })

  it('scores consistency of a rising series at 100', () => {
    expect(calc.rollingReturnConsistency(compoundingSeries(1500, 0.0005))).toBeCloseTo(100, 10)
  })

  it('scores consistency of a falling series at 0', () => {
    expect(calc.rollingReturnConsistency(compoundingSeries(1500, -0.0005))).toBeCloseTo(0, 10)
  })

  it('withholds consistency when history is too short', () => {
    expect(calc.rollingReturnConsistency(compoundingSeries(400, 0.0005))).toBeNull()
  })

  it('skips non-positive NAVs in daily returns', () => {
    const series = [
      { on: d(2026, 1, 1), nav: 10 },
      { on: d(2026, 1, 2), nav: 11 },
    ]
    expect(calc.dailyReturns(series)).toHaveLength(1)
    expect(calc.dailyReturns(series)[0]).toBeCloseTo(0.1, 10)
  })

  it('sorts unsorted input before computing', () => {
    const series = [
      { on: d(2026, 1, 3), nav: 12 },
      { on: d(2026, 1, 1), nav: 10 },
      { on: d(2026, 1, 2), nav: 11 },
    ]
    expect(calc.maxDrawdownPct(series)).toBeCloseTo(0, 10)
  })
})
