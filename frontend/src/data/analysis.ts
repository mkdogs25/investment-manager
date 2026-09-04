/**
 * Portfolio analysis orchestration.
 *
 * One fund failing must never stop the rest of the portfolio being analysed, so
 * every provider call is individually guarded and its outcome recorded both as
 * a per-fund status and as a row on the Data Sources sheet.
 *
 * Mirrors backend/app/services/analysis_service.py.
 */

import * as calc from './calculations'
import type { NavPoint, PortfolioTotals } from './calculations'
import { getProvider } from './providers/registry'
import { ProviderError, type FundDataProvider, type SchemeData } from './providers/types'
import { computeFundScore, type ScoreResult } from './scoring'

export const DISCLAIMER =
  'This tool is for informational and educational purposes only and does not ' +
  'constitute financial advice or a recommendation to buy, sell, or hold any ' +
  'investment. Historical performance does not guarantee future results. Data ' +
  'may be delayed, incomplete, or subject to errors. Verify important ' +
  'information with the relevant fund house, AMFI, and other official sources ' +
  'before making investment decisions.'

export const RISK_FREE_RATE = 0.06
export const TRADING_DAYS_PER_YEAR = 252
export const MIN_OBSERVATIONS_FOR_RISK = 60

export type RiskProfile = 'Conservative' | 'Balanced' | 'Aggressive'
export type DataStatus = 'retrieved' | 'partial' | 'unavailable'

export const STATUS_LABEL: Record<DataStatus, string> = {
  retrieved: '✓ Data retrieved',
  partial: '⚠ Partial data',
  unavailable: '✕ Data unavailable',
}

export interface FundInput {
  schemeCode: string | null
  fundName: string
  investmentDate: Date | null
  amountInvested: number
  currentAmount: number
}

export interface PortfolioInput {
  investorAge: number
  riskProfile: RiskProfile
  funds: FundInput[]
}

export interface MetricValue {
  value: number | null
  origin: 'calculated' | 'retrieved' | null
  note?: string
}

export interface SchemeDetail {
  schemeCode: string
  schemeName: string
  fundHouse: string | null
  schemeCategory: string | null
  schemeType: string | null
  plan: string | null
  option: string | null
  isinGrowth: string | null
  isinDivReinvestment: string | null
  latestNav: number | null
  latestNavDate: Date | null
  inceptionDate: Date | null
  navHistoryPoints: number
  aum: number | null
  expenseRatio: number | null
  benchmark: string | null
}

export interface FundAnalysis {
  input: FundInput
  scheme: SchemeDetail | null
  status: DataStatus
  statusLabel: string
  messages: string[]
  gainLoss: number
  absoluteReturnPct: number
  holdingPeriodDays: number | null
  holdingPeriodLabel: string
  cagrPct: number | null
  cagrNote: string | null
  allocationPct: number | null
  return1y: MetricValue
  return3y: MetricValue
  return5y: MetricValue
  returnSinceInception: MetricValue
  volatility: MetricValue
  sharpeRatio: MetricValue
  maxDrawdown: MetricValue
  expenseRatio: MetricValue
  aum: MetricValue
  benchmark: string | null
  fundScore: number | null
  fundScoreNote: string | null
}

export interface DataSourceRecord {
  fund: string
  dataPoint: string
  source: string
  retrievedOn: string
  status: string
}

export interface AnalysisReport {
  generatedAt: string
  reportDate: Date
  investorAge: number
  riskProfile: RiskProfile
  providerName: string
  totals: PortfolioTotals
  funds: FundAnalysis[]
  categoryDistribution: Record<string, number>
  dataSources: DataSourceRecord[]
  disclaimer: string
}

// ----------------------------------------------------------------------
// Scheme-name derivations (the AMFI name is the only source for these)
// ----------------------------------------------------------------------
const DIRECT = /\bdirect\b/i
const REGULAR = /\bregular\b/i
const GROWTH = /\bgrowth\b/i
const IDCW = /\b(idcw|dividend|payout|reinvest\w*)\b/i

export function derivePlan(schemeName: string): string | null {
  if (DIRECT.test(schemeName)) return 'Direct'
  if (REGULAR.test(schemeName)) return 'Regular'
  return null
}

export function deriveOption(schemeName: string): string | null {
  if (IDCW.test(schemeName)) return 'IDCW'
  if (GROWTH.test(schemeName)) return 'Growth'
  return null
}

// ----------------------------------------------------------------------
interface NavMetrics {
  latestNav: number | null
  latestNavDate: Date | null
  inceptionDate: Date | null
  observations: number
  return1y: number | null
  return3y: number | null
  return5y: number | null
  returnSinceInception: number | null
  volatility: number | null
  sharpeRatio: number | null
  maxDrawdown: number | null
  consistency: number | null
  notes: string[]
}

export function computeNavMetrics(history: NavPoint[]): NavMetrics {
  const metrics: NavMetrics = {
    latestNav: null, latestNavDate: null, inceptionDate: null, observations: history.length,
    return1y: null, return3y: null, return5y: null, returnSinceInception: null,
    volatility: null, sharpeRatio: null, maxDrawdown: null, consistency: null, notes: [],
  }

  if (history.length === 0) {
    metrics.notes.push('No NAV history was published for this scheme.')
    return metrics
  }

  const latest = history[history.length - 1]
  metrics.latestNav = latest.nav
  metrics.latestNavDate = latest.on
  // MFapi.in exposes the earliest published NAV, not the SID inception date;
  // they coincide for most schemes but the workbook labels it accordingly.
  metrics.inceptionDate = history[0].on

  metrics.return1y = calc.trailingReturnPct(history, 1)
  metrics.return3y = calc.trailingReturnPct(history, 3)
  metrics.return5y = calc.trailingReturnPct(history, 5)
  metrics.returnSinceInception = calc.sinceInceptionReturnPct(history)
  metrics.volatility = calc.volatilityPct(
    history, TRADING_DAYS_PER_YEAR, MIN_OBSERVATIONS_FOR_RISK,
  )
  metrics.sharpeRatio = calc.sharpeRatio(
    history, RISK_FREE_RATE, TRADING_DAYS_PER_YEAR, MIN_OBSERVATIONS_FOR_RISK,
  )
  metrics.maxDrawdown = calc.maxDrawdownPct(history)
  metrics.consistency = calc.rollingReturnConsistency(history)

  if (metrics.volatility === null) {
    metrics.notes.push(
      `Volatility and Sharpe ratio need at least ${MIN_OBSERVATIONS_FOR_RISK} daily NAV observations.`,
    )
  }
  if (metrics.return5y === null && metrics.return3y === null) {
    metrics.notes.push('NAV history is too short for 3-year or 5-year returns.')
  }
  return metrics
}

function longTermReturn(metrics: NavMetrics): number | null {
  return metrics.return5y ?? metrics.return3y ?? metrics.returnSinceInception ?? null
}

function buildSchemeDetail(data: SchemeData, metrics: NavMetrics): SchemeDetail {
  return {
    schemeCode: data.meta.schemeCode,
    schemeName: data.meta.schemeName,
    fundHouse: data.meta.fundHouse,
    schemeCategory: data.meta.schemeCategory,
    schemeType: data.meta.schemeType,
    plan: derivePlan(data.meta.schemeName),
    option: deriveOption(data.meta.schemeName),
    isinGrowth: data.meta.isinGrowth,
    isinDivReinvestment: data.meta.isinDivReinvestment,
    latestNav: metrics.latestNav,
    latestNavDate: metrics.latestNavDate,
    inceptionDate: metrics.inceptionDate,
    navHistoryPoints: metrics.observations,
    aum: data.meta.aum,
    expenseRatio: data.meta.expenseRatio,
    benchmark: data.meta.benchmark,
  }
}

function classifyStatus(metrics: NavMetrics, detail: SchemeDetail): DataStatus {
  if (metrics.latestNav === null) return 'unavailable'
  const complete =
    detail.fundHouse !== null &&
    detail.schemeCategory !== null &&
    metrics.return1y !== null &&
    metrics.volatility !== null &&
    metrics.maxDrawdown !== null
  return complete ? 'retrieved' : 'partial'
}

function formatDdMmYyyy(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`
}

function emptyMetric(): MetricValue {
  return { value: null, origin: null }
}

function applyUserMaths(analysis: FundAnalysis, fund: FundInput, reportDate: Date): void {
  analysis.gainLoss = calc.absoluteGain(fund.amountInvested, fund.currentAmount)
  analysis.absoluteReturnPct = calc.absoluteReturnPct(fund.amountInvested, fund.currentAmount)

  if (!fund.investmentDate) {
    analysis.cagrNote = 'CAGR unavailable — investment date required'
    return
  }
  if (calc.daysBetween(fund.investmentDate, reportDate) < 0) {
    analysis.cagrNote = 'CAGR unavailable — investment date is in the future'
    return
  }

  analysis.holdingPeriodDays = calc.holdingPeriodDays(fund.investmentDate, reportDate)
  analysis.holdingPeriodLabel = calc.holdingPeriodLabel(fund.investmentDate, reportDate)
  const cagr = calc.cagrPct(
    fund.amountInvested, fund.currentAmount, fund.investmentDate, reportDate,
  )
  if (cagr === null) {
    analysis.cagrNote =
      'CAGR unavailable — holding period is under a day, or the current value is zero'
  } else {
    analysis.cagrPct = cagr
  }
}

function newAnalysis(fund: FundInput): FundAnalysis {
  return {
    input: fund,
    scheme: null,
    status: 'unavailable',
    statusLabel: STATUS_LABEL.unavailable,
    messages: [],
    gainLoss: 0,
    absoluteReturnPct: 0,
    holdingPeriodDays: null,
    holdingPeriodLabel: 'Data unavailable',
    cagrPct: null,
    cagrNote: null,
    allocationPct: null,
    return1y: emptyMetric(),
    return3y: emptyMetric(),
    return5y: emptyMetric(),
    returnSinceInception: emptyMetric(),
    volatility: emptyMetric(),
    sharpeRatio: emptyMetric(),
    maxDrawdown: emptyMetric(),
    expenseRatio: emptyMetric(),
    aum: emptyMetric(),
    benchmark: null,
    fundScore: null,
    fundScoreNote: null,
  }
}

async function analyseFund(
  fund: FundInput,
  reportDate: Date,
  provider: FundDataProvider,
): Promise<{ analysis: FundAnalysis; sources: [string, string, string][] }> {
  const analysis = newAnalysis(fund)
  const sources: [string, string, string][] = [
    ['Amount invested / current value', 'User input', 'Provided by user'],
  ]

  applyUserMaths(analysis, fund, reportDate)

  if (!fund.schemeCode) {
    analysis.messages.push(
      'No scheme was selected from the search results, so no scheme data could be ' +
        'retrieved. Returns based on your own figures are still shown.',
    )
    sources.push(['Scheme metadata', provider.name, 'Not requested — no scheme selected'])
    return { analysis, sources }
  }

  let data: SchemeData
  try {
    data = await provider.getScheme(fund.schemeCode)
  } catch (error) {
    const message =
      error instanceof ProviderError
        ? error.userMessage
        : `Unexpected error retrieving scheme data: ${String(error)}`
    const kind = error instanceof ProviderError ? error.kind : 'unexpected'
    analysis.messages.push(message)
    sources.push(['Scheme metadata', provider.name, `Failed — ${kind}`])
    sources.push(['Historical NAV', provider.name, `Failed — ${kind}`])
    return { analysis, sources }
  }

  const metrics = computeNavMetrics(data.navHistory)
  const detail = buildSchemeDetail(data, metrics)
  analysis.scheme = detail

  analysis.return1y = { value: metrics.return1y, origin: 'calculated' }
  analysis.return3y = { value: metrics.return3y, origin: 'calculated' }
  analysis.return5y = { value: metrics.return5y, origin: 'calculated' }
  analysis.returnSinceInception = {
    value: metrics.returnSinceInception, origin: 'calculated',
  }
  analysis.volatility = { value: metrics.volatility, origin: 'calculated' }
  analysis.sharpeRatio = {
    value: metrics.sharpeRatio,
    origin: 'calculated',
    note: `Risk-free rate ${(RISK_FREE_RATE * 100).toFixed(2)}% p.a.`,
  }
  analysis.maxDrawdown = { value: metrics.maxDrawdown, origin: 'calculated' }
  analysis.expenseRatio = {
    value: detail.expenseRatio,
    origin: detail.expenseRatio === null ? null : 'retrieved',
  }
  analysis.aum = { value: detail.aum, origin: detail.aum === null ? null : 'retrieved' }
  analysis.benchmark = detail.benchmark

  const score: ScoreResult = computeFundScore({
    longTermReturn: longTermReturn(metrics),
    consistency: metrics.consistency,
    volatility: metrics.volatility,
    sharpe: metrics.sharpeRatio,
    maxDrawdown: metrics.maxDrawdown,
    expenseRatio: detail.expenseRatio,
  })
  analysis.fundScore = score.score
  analysis.fundScoreNote = score.note

  sources.push(['Scheme metadata', provider.name, 'Retrieved'])
  sources.push([
    'Historical NAV',
    provider.name,
    metrics.observations > 0 ? 'Retrieved' : 'Unavailable — no NAV history',
  ])
  sources.push([
    'Latest NAV',
    provider.name,
    metrics.latestNav !== null ? 'Retrieved' : 'Unavailable',
  ])
  for (const label of ['Expense ratio', 'AUM', 'Benchmark']) {
    sources.push([label, provider.name, 'Unavailable — not published by this provider'])
  }

  analysis.status = classifyStatus(metrics, detail)
  analysis.statusLabel = STATUS_LABEL[analysis.status]
  analysis.messages.push(...metrics.notes)
  return { analysis, sources }
}

function categoryDistribution(
  analyses: FundAnalysis[],
  totalCurrent: number,
): Record<string, number> {
  if (totalCurrent <= 0) return {}
  const buckets: Record<string, number> = {}
  for (const analysis of analyses) {
    const category = analysis.scheme?.schemeCategory || 'Category unavailable'
    buckets[category] = (buckets[category] ?? 0) + analysis.input.currentAmount
  }
  return Object.fromEntries(
    Object.keys(buckets)
      .sort()
      .map((key) => [key, (buckets[key] / totalCurrent) * 100]),
  )
}

export async function analysePortfolio(
  input: PortfolioInput,
  reportDate: Date = new Date(),
  provider: FundDataProvider = getProvider(),
): Promise<AnalysisReport> {
  const retrievedOn = formatDdMmYyyy(reportDate)

  const results = await Promise.all(
    input.funds.map((fund) => analyseFund(fund, reportDate, provider)),
  )

  const funds = results.map((r) => r.analysis)
  const dataSources: DataSourceRecord[] = []
  results.forEach(({ analysis, sources }) => {
    for (const [dataPoint, source, status] of sources) {
      dataSources.push({
        fund: analysis.scheme?.schemeName ?? analysis.input.fundName,
        dataPoint,
        source,
        retrievedOn,
        status,
      })
    }
  })

  const totals = calc.portfolioTotals(
    funds.map((f) => ({
      name: f.scheme?.schemeName ?? f.input.fundName,
      invested: f.input.amountInvested,
      current: f.input.currentAmount,
    })),
  )

  for (const fund of funds) {
    fund.allocationPct = calc.allocationPct(fund.input.currentAmount, totals.totalCurrent)
  }

  return {
    generatedAt: `${formatDdMmYyyy(reportDate)} ${String(reportDate.getHours()).padStart(2, '0')}:${String(
      reportDate.getMinutes(),
    ).padStart(2, '0')}`,
    reportDate,
    investorAge: input.investorAge,
    riskProfile: input.riskProfile,
    providerName: provider.name,
    totals,
    funds,
    categoryDistribution: categoryDistribution(funds, totals.totalCurrent),
    dataSources,
    disclaimer: DISCLAIMER,
  }
}
