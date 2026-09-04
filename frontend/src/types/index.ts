export type {
  AnalysisReport,
  DataSourceRecord,
  DataStatus,
  FundAnalysis,
  FundInput,
  MetricValue,
  PortfolioInput,
  RiskProfile,
  SchemeDetail,
} from '../data/analysis'
export type { SchemeSummary } from '../data/providers/types'

import type { SchemeSummary } from '../data/providers/types'

/** One portfolio row while the user is editing it. */
export interface FundRow {
  id: string
  scheme: SchemeSummary | null
  fundName: string
  investmentDate: string
  amountInvested: string
  currentAmount: string
}

export interface ValidationIssue {
  rowId: string | null
  field: string
  message: string
}
