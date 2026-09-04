/**
 * Provider abstraction.
 *
 * Everything above this layer (services, analysis, Excel generation) talks to
 * FundDataProvider only, so a second AMFI-derived source can be added later
 * without touching calculations or the UI.
 */

import type { NavPoint } from '../calculations'

export type ProviderErrorKind =
  | 'network'
  | 'cors'
  | 'timeout'
  | 'rate_limited'
  | 'unavailable'
  | 'not_found'
  | 'malformed'

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly userMessage: string,
    cause?: unknown,
  ) {
    super(userMessage)
    this.name = 'ProviderError'
    this.cause = cause
  }
}

export interface SchemeSummary {
  schemeCode: string
  schemeName: string
  fundHouse: string | null
  schemeCategory: string | null
  schemeType: string | null
}

export interface SchemeMeta extends SchemeSummary {
  isinGrowth: string | null
  isinDivReinvestment: string | null
  /** Fields no free AMFI-derived source publishes today. They stay null rather
   *  than being guessed, and render as "Data unavailable". */
  aum: number | null
  expenseRatio: number | null
  benchmark: string | null
}

export interface SchemeData {
  meta: SchemeMeta
  navHistory: NavPoint[]
}

export interface FundDataProvider {
  readonly name: string
  readonly documentationUrl: string | null
  searchSchemes(query: string, signal?: AbortSignal): Promise<SchemeSummary[]>
  getScheme(schemeCode: string, signal?: AbortSignal): Promise<SchemeData>
}
