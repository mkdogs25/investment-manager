export type RiskProfile = 'Conservative' | 'Balanced' | 'Aggressive'

export type DataStatus = 'retrieved' | 'partial' | 'unavailable'

export interface SchemeSearchResult {
  scheme_code: string
  scheme_name: string
  fund_house: string | null
  scheme_category: string | null
  scheme_type: string | null
  plan: string | null
  option: string | null
}

export interface SchemeDetail extends SchemeSearchResult {
  isin_growth: string | null
  isin_div_reinvestment: string | null
  latest_nav: number | null
  latest_nav_date: string | null
  inception_date: string | null
  nav_history_points: number | null
  aum: number | null
  expense_ratio: number | null
  benchmark: string | null
}

/** One portfolio row while the user is editing it. */
export interface FundRow {
  id: string
  scheme: SchemeSearchResult | null
  fundName: string
  investmentDate: string
  amountInvested: string
  currentAmount: string
}

export interface FundInputPayload {
  scheme_code: string | null
  fund_name: string
  investment_date: string | null
  amount_invested: number
  current_amount: number
}

export interface PortfolioPayload {
  investor_age: number
  risk_profile: RiskProfile
  funds: FundInputPayload[]
}

export interface MetricValue {
  value: number | null
  origin: string | null
  note: string | null
}

export interface FundAnalysis {
  input: FundInputPayload
  scheme: SchemeDetail | null
  status: DataStatus
  status_label: string
  messages: string[]
  gain_loss: number
  absolute_return_pct: number
  holding_period_days: number | null
  holding_period_label: string
  cagr_pct: number | null
  cagr_note: string | null
  allocation_pct: number | null
  return_1y: MetricValue
  return_3y: MetricValue
  return_5y: MetricValue
  return_since_inception: MetricValue
  volatility: MetricValue
  sharpe_ratio: MetricValue
  max_drawdown: MetricValue
  expense_ratio: MetricValue
  aum: MetricValue
  benchmark: string | null
  fund_score: number | null
  fund_score_note: string | null
}

export interface PortfolioTotals {
  number_of_funds: number
  total_invested: number
  total_current: number
  total_gain_loss: number
  total_return_pct: number
  largest_holding: string | null
  largest_holding_value: number | null
  smallest_holding: string | null
  smallest_holding_value: number | null
}

export interface AnalysisResponse {
  generated_at: string
  investor_age: number
  risk_profile: RiskProfile
  totals: PortfolioTotals
  funds: FundAnalysis[]
  category_distribution: Record<string, number>
  disclaimer: string
}

export interface ValidationIssue {
  rowId: string | null
  field: string
  message: string
}
