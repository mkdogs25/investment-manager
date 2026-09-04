import { describe, expect, it } from 'vitest'
import {
  analysePortfolio,
  deriveOption,
  derivePlan,
  type FundInput,
  type PortfolioInput,
} from '../analysis'
import { ProviderError, type FundDataProvider, type SchemeData } from '../providers/types'
import { REPORT_DATE, d, syntheticNavs } from './helpers'

export function makeScheme(
  code: string,
  name: string,
  {
    historyYears = 8,
    category = 'Equity Scheme - Flexi Cap Fund' as string | null,
    fundHouse = 'Example Asset Management Ltd' as string | null,
    seed = 7,
    navs,
  }: Partial<{
    historyYears: number
    category: string | null
    fundHouse: string | null
    seed: number
    navs: SchemeData['navHistory']
  }> = {},
): SchemeData {
  const start = new Date(REPORT_DATE.getTime())
  start.setDate(start.getDate() - Math.round(historyYears * 365.25))
  return {
    meta: {
      schemeCode: code,
      schemeName: name,
      fundHouse,
      schemeCategory: category,
      schemeType: 'Open Ended Schemes',
      isinGrowth: 'INF000000001',
      isinDivReinvestment: null,
      aum: null,
      expenseRatio: null,
      benchmark: null,
    },
    navHistory: navs ?? syntheticNavs({ start, end: REPORT_DATE, seed }),
  }
}

export class FakeProvider implements FundDataProvider {
  readonly name = 'FakeProvider'
  readonly documentationUrl = 'https://example.invalid/docs'
  failWith: Error | null = null
  calls: string[] = []

  constructor(private readonly schemes: Record<string, SchemeData> = {}) {}

  async searchSchemes(query: string) {
    if (this.failWith) throw this.failWith
    const needle = query.trim().toLowerCase()
    return Object.values(this.schemes)
      .filter((s) => s.meta.schemeName.toLowerCase().includes(needle))
      .map((s) => ({
        schemeCode: s.meta.schemeCode,
        schemeName: s.meta.schemeName,
        fundHouse: s.meta.fundHouse,
        schemeCategory: s.meta.schemeCategory,
        schemeType: s.meta.schemeType,
      }))
  }

  async getScheme(schemeCode: string): Promise<SchemeData> {
    this.calls.push(schemeCode)
    if (this.failWith) throw this.failWith
    const scheme = this.schemes[schemeCode]
    if (!scheme) throw new ProviderError('not_found', `no scheme ${schemeCode}`)
    return scheme
  }
}

export function defaultProvider(): FakeProvider {
  return new FakeProvider({
    '118989': makeScheme('118989', 'Example Flexi Cap Fund - Direct Plan - Growth', { seed: 11 }),
    '120503': makeScheme('120503', 'Example Large Cap Fund - Regular Plan - IDCW', {
      category: 'Equity Scheme - Large Cap Fund', seed: 23,
    }),
  })
}

export function defaultFunds(): FundInput[] {
  return [
    {
      schemeCode: '118989',
      fundName: 'Example Flexi Cap Fund - Direct Plan - Growth',
      investmentDate: d(2023, 9, 4),
      amountInvested: 100_000,
      currentAmount: 150_000,
    },
    {
      schemeCode: '120503',
      fundName: 'Example Large Cap Fund - Regular Plan - IDCW',
      investmentDate: d(2024, 1, 15),
      amountInvested: 50_000,
      currentAmount: 40_000,
    },
  ]
}

export function portfolio(funds = defaultFunds()): PortfolioInput {
  return { investorAge: 34, riskProfile: 'Balanced', funds }
}

describe('scheme name derivations', () => {
  it('reads plan and option from the AMFI name', () => {
    expect(derivePlan('HDFC Flexi Cap Fund - Direct Plan - Growth')).toBe('Direct')
    expect(derivePlan('HDFC Flexi Cap Fund - Regular Plan - Growth')).toBe('Regular')
    expect(derivePlan('Some Fund - Growth')).toBeNull()
    expect(deriveOption('HDFC Flexi Cap Fund - Direct Plan - Growth')).toBe('Growth')
    expect(deriveOption('HDFC Flexi Cap Fund - Direct Plan - IDCW')).toBe('IDCW')
    expect(deriveOption('HDFC Fund - Dividend Payout')).toBe('IDCW')
    expect(deriveOption('HDFC Fund')).toBeNull()
  })
})

describe('portfolio analysis', () => {
  it('produces totals and allocations', async () => {
    const report = await analysePortfolio(portfolio(), REPORT_DATE, defaultProvider())
    expect(report.totals.numberOfFunds).toBe(2)
    expect(report.totals.totalInvested).toBe(150_000)
    expect(report.totals.totalCurrent).toBe(190_000)
    expect(report.totals.totalGainLoss).toBe(40_000)
    expect(report.totals.totalReturnPct).toBeCloseTo(26.6667, 3)
    expect(report.funds.reduce((a, f) => a + f.allocationPct!, 0)).toBeCloseTo(100, 8)
  })

  it('preserves the user inputs verbatim', async () => {
    const report = await analysePortfolio(portfolio(), REPORT_DATE, defaultProvider())
    expect(report.funds[0].input.amountInvested).toBe(100_000)
    expect(report.funds[0].input.currentAmount).toBe(150_000)
  })

  it('matches the worked CAGR example', async () => {
    const report = await analysePortfolio(portfolio(), REPORT_DATE, defaultProvider())
    expect(report.funds[0].cagrPct).toBeCloseTo(14.4679, 3)
    expect(report.funds[0].holdingPeriodLabel).toBe('3 years')
  })

  it('reports a loss with negative figures', async () => {
    const report = await analysePortfolio(portfolio(), REPORT_DATE, defaultProvider())
    const loser = report.funds[1]
    expect(loser.gainLoss).toBe(-10_000)
    expect(loser.absoluteReturnPct).toBeCloseTo(-20, 8)
    expect(loser.cagrPct!).toBeLessThan(0)
  })

  it('withholds CAGR without an investment date but keeps absolute figures', async () => {
    const funds = [{ ...defaultFunds()[0], investmentDate: null }]
    const report = await analysePortfolio(portfolio(funds), REPORT_DATE, defaultProvider())
    expect(report.funds[0].cagrPct).toBeNull()
    expect(report.funds[0].cagrNote).toBe('CAGR unavailable — investment date required')
    expect(report.funds[0].absoluteReturnPct).toBeCloseTo(50, 8)
  })

  it('withholds CAGR at a zero current value but still reports the loss', async () => {
    const funds = [{ ...defaultFunds()[0], currentAmount: 0 }]
    const report = await analysePortfolio(portfolio(funds), REPORT_DATE, defaultProvider())
    expect(report.funds[0].gainLoss).toBe(-100_000)
    expect(report.funds[0].absoluteReturnPct).toBeCloseTo(-100, 8)
    expect(report.funds[0].cagrPct).toBeNull()
    expect(report.funds[0].cagrNote).toContain('CAGR unavailable')
  })

  it('marks scheme metrics as calculated', async () => {
    const report = await analysePortfolio(portfolio(), REPORT_DATE, defaultProvider())
    const fund = report.funds[0]
    expect(fund.return1y.origin).toBe('calculated')
    expect(fund.volatility.value!).toBeGreaterThan(0)
    expect(fund.maxDrawdown.value!).toBeLessThanOrEqual(0)
    expect(fund.fundScore).not.toBeNull()
  })

  it('keeps unpublished metrics null rather than zero', async () => {
    const report = await analysePortfolio(portfolio(), REPORT_DATE, defaultProvider())
    const fund = report.funds[0]
    expect(fund.expenseRatio.value).toBeNull()
    expect(fund.expenseRatio.origin).toBeNull()
    expect(fund.aum.value).toBeNull()
    expect(fund.benchmark).toBeNull()
  })

  it('lets one failing fund not block the others', async () => {
    const provider = new FakeProvider({
      '118989': makeScheme('118989', 'Example Flexi Cap Fund - Direct Plan - Growth', { seed: 11 }),
    })
    const report = await analysePortfolio(portfolio(), REPORT_DATE, provider)
    expect(report.funds[0].status).toBe('retrieved')
    expect(report.funds[1].status).toBe('unavailable')
    expect(report.funds[1].messages.length).toBeGreaterThan(0)
    // Totals still cover both, because they come from the user's own input.
    expect(report.totals.totalCurrent).toBe(190_000)
    expect(report.funds[1].absoluteReturnPct).toBeCloseTo(-20, 8)
  })

  it('reports a provider outage per fund', async () => {
    const provider = defaultProvider()
    provider.failWith = new ProviderError('unavailable', 'simulated outage')
    const report = await analysePortfolio(portfolio(), REPORT_DATE, provider)
    expect(report.funds.every((f) => f.status === 'unavailable')).toBe(true)
    expect(report.funds.every((f) => f.scheme === null)).toBe(true)
    expect(
      report.dataSources.some(
        (r) => r.dataPoint === 'Scheme metadata' && r.status.startsWith('Failed'),
      ),
    ).toBe(true)
  })

  it('surfaces a blocked cross-origin request to the user', async () => {
    const provider = defaultProvider()
    provider.failWith = new ProviderError(
      'cors', 'The browser could not reach MFapi.in. ... cross-origin requests ...',
    )
    const report = await analysePortfolio(portfolio(), REPORT_DATE, provider)
    expect(report.funds[0].messages.join(' ')).toContain('cross-origin')
    expect(report.dataSources.some((r) => r.status === 'Failed — cors')).toBe(true)
  })

  it('still does the user maths without a selected scheme', async () => {
    const provider = defaultProvider()
    const funds: FundInput[] = [
      {
        schemeCode: null,
        fundName: 'A fund I typed but never selected',
        investmentDate: d(2024, 9, 4),
        amountInvested: 10_000,
        currentAmount: 12_000,
      },
    ]
    const report = await analysePortfolio(portfolio(funds), REPORT_DATE, provider)
    expect(report.funds[0].status).toBe('unavailable')
    expect(report.funds[0].absoluteReturnPct).toBeCloseTo(20, 8)
    expect(report.funds[0].cagrPct).not.toBeNull()
    expect(provider.calls).toHaveLength(0)
  })

  it('marks thin metadata as partial', async () => {
    const thin = makeScheme('111111', 'Thin Scheme - Growth', {
      historyYears: 0.2, category: null, fundHouse: null,
    })
    const provider = new FakeProvider({ '111111': thin })
    const funds: FundInput[] = [
      {
        schemeCode: '111111', fundName: 'Thin Scheme - Growth',
        investmentDate: d(2026, 6, 1), amountInvested: 1_000, currentAmount: 1_100,
      },
    ]
    const report = await analysePortfolio(portfolio(funds), REPORT_DATE, provider)
    expect(report.funds[0].status).toBe('partial')
    expect(report.funds[0].return3y.value).toBeNull()
    expect(report.funds[0].fundScore).toBeNull()
    expect(report.funds[0].fundScoreNote).toBe('Score unavailable — insufficient data')
  })

  it('treats a scheme with no NAV history as unavailable', async () => {
    const empty = makeScheme('222222', 'Empty Scheme', { navs: [] })
    const provider = new FakeProvider({ '222222': empty })
    const funds: FundInput[] = [
      {
        schemeCode: '222222', fundName: 'Empty Scheme',
        investmentDate: d(2025, 1, 1), amountInvested: 1_000, currentAmount: 1_000,
      },
    ]
    const report = await analysePortfolio(portfolio(funds), REPORT_DATE, provider)
    expect(report.funds[0].status).toBe('unavailable')
    expect(report.funds[0].messages.join(' ')).toContain('NAV history')
  })

  it('distributes categories to 100 percent', async () => {
    const report = await analysePortfolio(portfolio(), REPORT_DATE, defaultProvider())
    const sum = Object.values(report.categoryDistribution).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(100, 8)
    expect(Object.keys(report.categoryDistribution).sort()).toEqual([
      'Equity Scheme - Flexi Cap Fund',
      'Equity Scheme - Large Cap Fund',
    ])
  })

  it('stamps every data source with a retrieval date', async () => {
    const report = await analysePortfolio(portfolio(), REPORT_DATE, defaultProvider())
    expect(report.dataSources.length).toBeGreaterThan(0)
    expect(report.dataSources.every((r) => r.retrievedOn === '04-09-2026')).toBe(true)
    expect(report.dataSources.some((r) => r.source === 'FakeProvider')).toBe(true)
    expect(report.dataSources.some((r) => r.source === 'User input')).toBe(true)
  })

  it('handles a 25-fund portfolio', async () => {
    const scheme = makeScheme('base', 'Example Fund - Direct Plan - Growth', { seed: 11 })
    const schemes: Record<string, SchemeData> = {}
    const funds: FundInput[] = []
    for (let i = 0; i < 25; i += 1) {
      const code = String(i).padStart(6, '0')
      schemes[code] = scheme
      funds.push({
        schemeCode: code, fundName: `Fund ${i}`, investmentDate: d(2022, 1, 10),
        amountInvested: 10_000 + i, currentAmount: 12_000 + i,
      })
    }
    const report = await analysePortfolio(
      portfolio(funds), REPORT_DATE, new FakeProvider(schemes),
    )
    expect(report.totals.numberOfFunds).toBe(25)
    expect(report.funds.reduce((a, f) => a + f.allocationPct!, 0)).toBeCloseTo(100, 6)
  })
})
