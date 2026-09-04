import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WEIGHTS,
  MIN_COMPONENTS,
  computeFundScore,
  methodologyRows,
  type ScoreInputs,
} from '../scoring'

const GOOD: ScoreInputs = {
  longTermReturn: 20,
  consistency: 95,
  volatility: 5,
  sharpe: 1.5,
  maxDrawdown: -10,
  expenseRatio: 0.2,
}

const POOR: ScoreInputs = {
  longTermReturn: 0,
  consistency: 40,
  volatility: 30,
  sharpe: 0,
  maxDrawdown: -60,
  expenseRatio: 2.25,
}

describe('fund analysis score', () => {
  it('scores the best case at 100', () => {
    expect(computeFundScore(GOOD).score).toBeCloseTo(100, 8)
  })

  it('scores the worst case at 0', () => {
    expect(computeFundScore(POOR).score).toBeCloseTo(0, 8)
  })

  it('clips beyond the anchors', () => {
    expect(
      computeFundScore({ ...GOOD, longTermReturn: 90, sharpe: 8, expenseRatio: 0 }).score,
    ).toBeCloseTo(100, 8)
    expect(
      computeFundScore({ ...POOR, longTermReturn: -40, sharpe: -3, maxDrawdown: -95 }).score,
    ).toBeCloseTo(0, 8)
  })

  it('rewards lower volatility', () => {
    expect(computeFundScore({ ...GOOD, volatility: 8 }).score!).toBeGreaterThan(
      computeFundScore({ ...GOOD, volatility: 28 }).score!,
    )
  })

  it('rewards a shallower drawdown', () => {
    expect(computeFundScore({ ...POOR, maxDrawdown: -12 }).score!).toBeGreaterThan(
      computeFundScore({ ...POOR, maxDrawdown: -55 }).score!,
    )
  })

  it('does not penalise a missing expense ratio', () => {
    expect(computeFundScore({ ...GOOD, expenseRatio: null }).score).toBeCloseTo(
      computeFundScore(GOOD).score!,
      8,
    )
  })

  it('withholds the score below the minimum component count', () => {
    const result = computeFundScore({
      longTermReturn: 12,
      consistency: null,
      volatility: null,
      sharpe: null,
      maxDrawdown: null,
      expenseRatio: null,
    })
    expect(result.score).toBeNull()
    expect(result.note).toBe('Score unavailable — insufficient data')
  })

  it('scores at exactly the minimum component count', () => {
    const result = computeFundScore({
      longTermReturn: 12,
      consistency: null,
      volatility: 14,
      sharpe: 0.8,
      maxDrawdown: null,
      expenseRatio: null,
    })
    expect(MIN_COMPONENTS).toBe(3)
    expect(result.score).not.toBeNull()
    expect(result.note).toContain('3 of 6 components')
  })

  it('marks included components in the breakdown', () => {
    const result = computeFundScore({ ...GOOD, expenseRatio: null })
    expect(result.breakdown.expenseRatio.included).toBe(false)
    expect(result.breakdown.expenseRatio.normalised).toBeNull()
    expect(result.breakdown.sharpe.included).toBe(true)
  })

  it('honours configurable weights', () => {
    const heavySharpe = {
      longTermReturn: 0, consistency: 0, volatility: 0,
      sharpe: 1, maxDrawdown: 0, expenseRatio: 0,
    }
    expect(
      computeFundScore({ ...POOR, sharpe: 1.5 }, heavySharpe).score,
    ).toBeCloseTo(100, 8)
  })

  it('documents every weighted component', () => {
    const rows = methodologyRows()
    expect(rows).toHaveLength(6)
    expect(rows.every((r) => r[2].length > 0)).toBe(true)
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 8)
  })
})
