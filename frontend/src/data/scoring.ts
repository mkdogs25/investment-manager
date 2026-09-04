/**
 * The Fund Analysis Score.
 *
 * A transparent, reproducible score computed from publicly available metrics.
 * It is emphatically NOT Value Research's (or anyone else's) rating, and the
 * workbook says so wherever the score appears.
 *
 * Each component is mapped onto 0-100 by linear interpolation between two
 * documented anchor points. The final score is the weighted mean of the
 * components that could actually be computed; below MIN_COMPONENTS the score is
 * withheld rather than forced.
 *
 * Mirrors backend/app/services/scoring.py.
 */

export const MIN_COMPONENTS = 3

export interface ScoringWeights {
  longTermReturn: number
  consistency: number
  volatility: number
  sharpe: number
  maxDrawdown: number
  expenseRatio: number
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  longTermReturn: 0.25,
  consistency: 0.15,
  volatility: 0.15,
  sharpe: 0.2,
  maxDrawdown: 0.15,
  expenseRatio: 0.1,
}

export type ScoreComponent = keyof ScoringWeights

/** component -> [value scoring 0, value scoring 100, human description] */
export const ANCHORS: Record<ScoreComponent, [number, number, string]> = {
  longTermReturn: [
    0, 20,
    'Longest available annualised return (5Y, else 3Y, else since inception): 0% scores 0, 20% p.a. scores 100.',
  ],
  consistency: [
    40, 95,
    'Share of rolling 1-year windows that were positive: 40% scores 0, 95% scores 100.',
  ],
  volatility: [
    30, 5,
    'Annualised volatility of daily NAV returns: 30% scores 0, 5% scores 100 (lower is better).',
  ],
  sharpe: [
    0, 1.5,
    'Sharpe ratio against the configured risk-free rate: 0.0 scores 0, 1.5 scores 100.',
  ],
  maxDrawdown: [
    -60, -10,
    'Maximum peak-to-trough NAV decline: -60% scores 0, -10% scores 100 (shallower is better).',
  ],
  expenseRatio: [
    2.25, 0.2,
    'Total expense ratio: 2.25% scores 0, 0.20% scores 100 (lower is better).',
  ],
}

const COMPONENT_LABELS: Record<ScoreComponent, string> = {
  longTermReturn: 'Long Term Return',
  consistency: 'Consistency',
  volatility: 'Volatility',
  sharpe: 'Sharpe',
  maxDrawdown: 'Max Drawdown',
  expenseRatio: 'Expense Ratio',
}

function normalise(component: ScoreComponent, value: number | null): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  const [low, high] = ANCHORS[component]
  if (high === low) return null
  const ratio = (value - low) / (high - low)
  return Math.max(0, Math.min(100, ratio * 100))
}

export interface ScoreBreakdownEntry {
  input: number | null
  normalised: number | null
  weight: number
  included: boolean
}

export interface ScoreResult {
  score: number | null
  note: string | null
  breakdown: Record<ScoreComponent, ScoreBreakdownEntry>
}

export type ScoreInputs = Record<ScoreComponent, number | null>

export function computeFundScore(
  inputs: ScoreInputs,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): ScoreResult {
  const breakdown = {} as Record<ScoreComponent, ScoreBreakdownEntry>
  let weightedSum = 0
  let weightTotal = 0
  let available = 0

  for (const key of Object.keys(ANCHORS) as ScoreComponent[]) {
    const value = inputs[key] ?? null
    const normalised = normalise(key, value)
    const weight = weights[key]
    breakdown[key] = { input: value, normalised, weight, included: normalised !== null }
    if (normalised === null) continue
    available += 1
    weightedSum += normalised * weight
    weightTotal += weight
  }

  const total = (Object.keys(ANCHORS) as ScoreComponent[]).length
  if (available < MIN_COMPONENTS || weightTotal <= 0) {
    return { score: null, note: 'Score unavailable — insufficient data', breakdown }
  }

  // Weights are renormalised over the available components, so a missing
  // expense ratio does not drag the score towards zero.
  const score = weightedSum / weightTotal
  let note: string | null = null
  if (available < total) {
    const missing = (Object.keys(breakdown) as ScoreComponent[])
      .filter((k) => !breakdown[k].included)
      .map((k) => k)
    note = `Computed from ${available} of ${total} components; unavailable: ${missing.join(', ')}.`
  }
  return { score, note, breakdown }
}

/** [component, weight, description] rows for the Methodology sheet. */
export function methodologyRows(
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): [string, string, string][] {
  return (Object.keys(ANCHORS) as ScoreComponent[]).map((key) => [
    COMPONENT_LABELS[key],
    `${Math.round(weights[key] * 100)}%`,
    ANCHORS[key][2],
  ])
}
