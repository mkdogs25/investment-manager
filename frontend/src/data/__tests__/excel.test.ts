import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { analysePortfolio, DISCLAIMER, type FundInput } from '../analysis'
import {
  FUND_ANALYSIS_HEADERS,
  UNAVAILABLE,
  buildWorkbook,
  buildWorkbookBlob,
  suggestedFilename,
} from '../excel'
import { REPORT_DATE, d } from './helpers'
import { FakeProvider, defaultProvider, makeScheme, portfolio } from './analysis.test'

const EXPECTED_SHEETS = [
  'Portfolio Summary', 'Fund Analysis', 'Fund Details', 'Methodology', 'Data Sources',
]

async function report(provider = defaultProvider(), funds?: FundInput[]) {
  return analysePortfolio(portfolio(funds), REPORT_DATE, provider)
}

/** Round-trips the workbook through the real xlsx writer and reader. */
async function roundTrip(rep: Awaited<ReturnType<typeof report>>) {
  const buffer = await buildWorkbook(rep).xlsx.writeBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  return wb
}

function textOf(ws: ExcelJS.Worksheet): string {
  const parts: string[] = []
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.value !== null && cell.value !== undefined) parts.push(String(cell.value))
    })
  })
  return parts.join(' ')
}

function findRowWithA(ws: ExcelJS.Worksheet, value: string): number {
  let found = -1
  ws.eachRow((row, rowNumber) => {
    if (found === -1 && String(row.getCell(1).value ?? '') === value) found = rowNumber
  })
  return found
}

describe('workbook generation', () => {
  it('writes a real xlsx that reopens', async () => {
    const buffer = await buildWorkbook(await report()).xlsx.writeBuffer()
    const bytes = new Uint8Array(buffer as ArrayBuffer)
    expect(bytes[0]).toBe(0x50) // 'P'
    expect(bytes[1]).toBe(0x4b) // 'K' — a zip-backed xlsx
    expect(bytes.byteLength).toBeGreaterThan(5_000)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    expect(wb.worksheets.length).toBe(5)
  })

  it('contains all five sheets in order', async () => {
    const wb = await roundTrip(await report())
    expect(wb.worksheets.map((w) => w.name)).toEqual(EXPECTED_SHEETS)
  })

  it('matches the analysis on the summary sheet', async () => {
    const rep = await report()
    const ws = (await roundTrip(rep)).getWorksheet('Portfolio Summary')!
    const values: Record<string, unknown> = {}
    ws.eachRow((row) => {
      const key = row.getCell(1).value
      const value = row.getCell(2).value
      if (typeof key === 'string' && value !== null && value !== undefined) {
        values[key] = value
      }
    })
    expect(values['Investor Age']).toBe(rep.investorAge)
    expect(values['Risk Profile']).toBe('Balanced')
    expect(values['Number of Funds']).toBe(2)
    expect(values['Total Invested']).toBeCloseTo(rep.totals.totalInvested, 6)
    expect(values['Current Portfolio Value']).toBeCloseTo(rep.totals.totalCurrent, 6)
    expect(values['Total Gain/Loss']).toBeCloseTo(rep.totals.totalGainLoss, 6)
    expect(values['Total Return']).toBeCloseTo(rep.totals.totalReturnPct, 6)
  })

  it('sums the allocation block to 100 percent', async () => {
    const rep = await report()
    const ws = (await roundTrip(rep)).getWorksheet('Portfolio Summary')!
    const header = findRowWithA(ws, 'Fund')
    let sum = 0
    let count = 0
    for (let r = header + 1; ; r += 1) {
      const label = ws.getCell(r, 1).value
      if (label === null || label === undefined || label === 'TOTAL') break
      sum += Number(ws.getCell(r, 6).value)
      count += 1
    }
    expect(count).toBe(rep.funds.length)
    expect(sum).toBeCloseTo(100, 6)
  })

  it('writes the fund analysis headers and per-fund values', async () => {
    const rep = await report()
    const ws = (await roundTrip(rep)).getWorksheet('Fund Analysis')!
    const header = findRowWithA(ws, 'Fund')
    const headers = FUND_ANALYSIS_HEADERS.map((_, i) => ws.getCell(header, i + 1).value)
    expect(headers).toEqual(FUND_ANALYSIS_HEADERS)

    rep.funds.forEach((fund, index) => {
      const r = header + 1 + index
      expect(ws.getCell(r, 1).value).toBe(fund.scheme!.schemeName)
      expect(Number(ws.getCell(r, 7).value)).toBeCloseTo(fund.input.amountInvested, 6)
      expect(Number(ws.getCell(r, 8).value)).toBeCloseTo(fund.input.currentAmount, 6)
      expect(Number(ws.getCell(r, 9).value)).toBeCloseTo(fund.gainLoss, 6)
      expect(Number(ws.getCell(r, 10).value)).toBeCloseTo(fund.absoluteReturnPct, 6)
      expect(Number(ws.getCell(r, 11).value)).toBeCloseTo(fund.cagrPct!, 6)
      expect(Number(ws.getCell(r, 19).value)).toBeCloseTo(fund.allocationPct!, 6)
    })
  })

  it('applies formatting to the fund analysis sheet', async () => {
    const ws = (await roundTrip(await report())).getWorksheet('Fund Analysis')!
    const header = findRowWithA(ws, 'Fund')
    const first = header + 1

    // ExcelJS's published types narrow these away, but both exist at runtime.
    const view = ws.views[0] as { state?: string; ySplit?: number }
    expect(view.state).toBe('frozen')
    expect(view.ySplit).toBe(header)
    expect(ws.autoFilter).toBeTruthy()
    expect(ws.getCell(first, 7).numFmt).toContain('₹')
    expect(ws.getCell(first, 10).numFmt).toContain('%')
    expect(ws.getCell(first, 5).numFmt).toBe('DD-MM-YYYY')
    expect(ws.getCell(header, 1).font?.bold).toBe(true)
    expect(ws.getColumn(1).width).toBeGreaterThan(20)
    expect((ws as unknown as { conditionalFormattings: unknown[] }).conditionalFormattings.length).toBeGreaterThan(0)
  })

  it('lists every scheme on the details sheet', async () => {
    const rep = await report()
    const text = textOf((await roundTrip(rep)).getWorksheet('Fund Details')!)
    for (const fund of rep.funds) {
      expect(text).toContain(fund.scheme!.schemeName)
      expect(text).toContain(fund.scheme!.schemeCode)
    }
    expect(text).toContain('ISIN (Growth)')
    expect(text).toContain('Direct')
    expect(text).toContain('Regular')
  })

  it('documents every metric in the methodology', async () => {
    const text = textOf((await roundTrip(await report())).getWorksheet('Methodology')!)
    for (const topic of [
      'CAGR', 'Absolute Return', 'Portfolio Allocation', 'Volatility', 'Sharpe Ratio',
      'Maximum Drawdown', 'Fund Analysis Score', 'Data Retrieval', 'Assumptions',
    ]) {
      expect(text).toContain(topic)
    }
    expect(text).toContain('365.25')
    expect(text).toContain('Value Research') // the explicit non-affiliation statement
    for (const component of ['Long Term Return', 'Consistency', 'Sharpe', 'Expense Ratio']) {
      expect(text).toContain(component)
    }
  })

  it('states that analysis happens locally in the browser', async () => {
    const text = textOf((await roundTrip(await report())).getWorksheet('Methodology')!)
    expect(text).toContain('locally in your browser')
  })

  it('records provenance on the data sources sheet', async () => {
    const rep = await report()
    const ws = (await roundTrip(rep)).getWorksheet('Data Sources')!
    const header = findRowWithA(ws, 'Fund')
    const rows: unknown[][] = []
    for (let r = header + 1; r <= header + rep.dataSources.length; r += 1) {
      rows.push([1, 2, 3, 4, 5].map((c) => ws.getCell(r, c).value))
    }
    expect(rows).toHaveLength(rep.dataSources.length)
    expect(rows.every((r) => r[3] === '04-09-2026')).toBe(true)
    expect(rows.some((r) => r[1] === 'Historical NAV' && r[2] === 'FakeProvider')).toBe(true)
    expect(ws.autoFilter).toBeTruthy()
  })

  it('repeats the disclaimer on every sheet', async () => {
    const wb = await roundTrip(await report())
    for (const name of EXPECTED_SHEETS) {
      expect(textOf(wb.getWorksheet(name)!)).toContain(
        'informational and educational purposes only',
      )
    }
    expect(DISCLAIMER.startsWith('This tool is for informational')).toBe(true)
  })

  it('labels missing data instead of zeroing it', async () => {
    const thin = makeScheme('333333', 'Thin Scheme - Growth', {
      historyYears: 0.15, category: null, fundHouse: null,
    })
    const funds: FundInput[] = [
      {
        schemeCode: '333333', fundName: 'Thin Scheme - Growth', investmentDate: null,
        amountInvested: 1_000, currentAmount: 1_100,
      },
    ]
    const rep = await report(new FakeProvider({ '333333': thin }), funds)
    const ws = (await roundTrip(rep)).getWorksheet('Fund Analysis')!
    const r = findRowWithA(ws, 'Fund') + 1

    expect(ws.getCell(r, 2).value).toBe(UNAVAILABLE)  // AMC
    expect(ws.getCell(r, 13).value).toBe(UNAVAILABLE) // 3Y return
    expect(ws.getCell(r, 11).value).toBe('CAGR unavailable — investment date required')
    expect(ws.getCell(r, 18).value).toBe('Score unavailable — insufficient data')
    // The user's own figures stay real numbers.
    expect(ws.getCell(r, 7).value).toBe(1_000)
    expect(ws.getCell(r, 9).value).toBe(100)
  })

  it('still builds when every fund fails', async () => {
    const provider = defaultProvider()
    provider.failWith = new Error('total outage')
    const wb = await roundTrip(await report(provider))
    expect(wb.worksheets.map((w) => w.name)).toEqual(EXPECTED_SHEETS)
    expect(textOf(wb.getWorksheet('Data Sources')!)).toContain('Failed')
  })

  it('handles a 22-fund workbook', async () => {
    const scheme = makeScheme('base', 'Example Fund - Direct Plan - Growth', { seed: 11 })
    const schemes: Record<string, any> = {}
    const funds: FundInput[] = []
    for (let i = 0; i < 22; i += 1) {
      const code = String(i).padStart(6, '0')
      schemes[code] = scheme
      funds.push({
        schemeCode: code, fundName: `Fund ${i}`, investmentDate: d(2022, 1, 10),
        amountInvested: 10_000 + i * 100, currentAmount: 12_000 + i * 100,
      })
    }
    const rep = await report(new FakeProvider(schemes), funds)
    const ws = (await roundTrip(rep)).getWorksheet('Fund Analysis')!
    const header = findRowWithA(ws, 'Fund')
    expect(ws.getCell(header + 22, 1).value).not.toBeNull()
  })

  it('produces a blob with the spreadsheet media type', async () => {
    const blob = await buildWorkbookBlob(await report())
    expect(blob.type).toContain('spreadsheetml.sheet')
    expect(blob.size).toBeGreaterThan(5_000)
  })

  it('names the file by report date', () => {
    expect(suggestedFilename(new Date(2026, 8, 4))).toBe('portfolio-analysis-2026-09-04.xlsx')
  })
})
