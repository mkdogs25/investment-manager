/**
 * Builds the .xlsx report with ExcelJS, entirely in the browser.
 *
 * Five sheets: Portfolio Summary, Fund Analysis, Fund Details, Methodology and
 * Data Sources. Anything that could not be retrieved is written as the literal
 * string "Data unavailable" so it is never confused with a real zero.
 *
 * Mirrors backend/app/services/excel_generator.py.
 */

import ExcelJS from 'exceljs'
import type { AnalysisReport, FundAnalysis } from './analysis'
import {
  DISCLAIMER,
  MIN_OBSERVATIONS_FOR_RISK,
  RISK_FREE_RATE,
  TRADING_DAYS_PER_YEAR,
} from './analysis'
import { ALLOCATION_COLOURS, renderAllocationChart } from './chart'
import { MIN_COMPONENTS, methodologyRows } from './scoring'

export const UNAVAILABLE = 'Data unavailable'

// --- palette (ARGB) ---------------------------------------------------
const INK = 'FF1F2937'
const BRAND = 'FF1E3A5F'
const ACCENT = 'FF0F766E'
const MUTED = 'FF6B7280'
const GAIN = 'FF15803D'
const LOSS = 'FFB91C1C'

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }
const SUBHEAD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
const LABEL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }

const TITLE_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 18, bold: true, color: { argb: BRAND } }
const SUBTITLE_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10, italic: true, color: { argb: MUTED } }
const SECTION_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 12, bold: true, color: { argb: ACCENT } }
const HEADER_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
const LABEL_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 11, bold: true, color: { argb: INK } }
const BODY_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 11, color: { argb: INK } }
const NOTE_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 9, italic: true, color: { argb: MUTED } }

const THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
}

// `#,##,##0.00` is the Indian lakh/crore grouping mask: 15000000 renders as
// 1,50,00,000.00. Two plain sections keep the minus sign on negatives.
const INR = '"₹"#,##,##0.00'
const INR_SIGNED = '"₹"#,##,##0.00;[Red]-"₹"#,##,##0.00'
const PCT = '0.00"%";[Red]-0.00"%"'
const NUM2 = '0.00'
const DATE_FMT = 'DD-MM-YYYY'

type CellValue = string | number | Date | null | undefined

interface WriteOptions {
  font?: Partial<ExcelJS.Font>
  fill?: ExcelJS.Fill
  numFmt?: string
  align?: 'left' | 'center' | 'right'
  border?: boolean
  wrap?: boolean
}

function write(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: CellValue,
  options: WriteOptions = {},
): ExcelJS.Cell {
  const cell = ws.getCell(row, col)
  const missing = value === null || value === undefined
  cell.value = missing ? UNAVAILABLE : value
  cell.font = options.font ?? BODY_FONT
  if (options.fill) cell.fill = options.fill
  if (options.numFmt && !missing) cell.numFmt = options.numFmt
  cell.alignment = {
    horizontal:
      options.align ?? (missing || typeof value === 'string' ? 'left' : 'right'),
    vertical: 'middle',
    wrapText: options.wrap ?? false,
  }
  if (options.border) cell.border = THIN
  return cell
}

function title(ws: ExcelJS.Worksheet, row: number, text: string, subtitle?: string): number {
  write(ws, row, 1, text, { font: TITLE_FONT, align: 'left' })
  row += 1
  if (subtitle) {
    write(ws, row, 1, subtitle, { font: SUBTITLE_FONT, align: 'left' })
    row += 1
  }
  return row + 1
}

function section(ws: ExcelJS.Worksheet, row: number, text: string): number {
  write(ws, row, 1, text, { font: SECTION_FONT, align: 'left' })
  return row + 1
}

function headerRow(ws: ExcelJS.Worksheet, row: number, headers: string[]): number {
  headers.forEach((header, index) => {
    write(ws, row, index + 1, header, {
      font: HEADER_FONT, fill: HEADER_FILL, align: 'center', border: true, wrap: true,
    })
  })
  ws.getRow(row).height = 32
  return row + 1
}

function widths(ws: ExcelJS.Worksheet, values: number[]): void {
  values.forEach((width, index) => {
    ws.getColumn(index + 1).width = width
  })
}

function disclaimer(ws: ExcelJS.Worksheet, row: number, span = 8): number {
  row += 1
  write(ws, row, 1, 'Disclaimer', { font: SECTION_FONT, align: 'left' })
  row += 1
  ws.mergeCells(row, 1, row + 2, Math.max(span, 4))
  const cell = write(ws, row, 1, DISCLAIMER, { font: NOTE_FONT, align: 'left', wrap: true })
  cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
  return row + 4
}

function fundLabel(fund: FundAnalysis): string {
  return fund.scheme?.schemeName || fund.input.fundName
}

function signRule(ref: string): ExcelJS.ConditionalFormattingOptions {
  return {
    ref,
    rules: [
      {
        type: 'cellIs', operator: 'lessThan', formulae: ['0'], priority: 1,
        style: { font: { color: { argb: LOSS } } },
      },
      {
        type: 'cellIs', operator: 'greaterThan', formulae: ['0'], priority: 2,
        style: { font: { color: { argb: GAIN } } },
      },
    ],
  }
}

// ----------------------------------------------------------------------
// Sheet 1 — Portfolio Summary
// ----------------------------------------------------------------------
function sheetSummary(wb: ExcelJS.Workbook, report: AnalysisReport): void {
  const ws = wb.addWorksheet('Portfolio Summary', {
    views: [{ showGridLines: false }],
  })
  widths(ws, [38, 20, 20, 20, 16, 16, 18])

  let row = title(
    ws, 1,
    'Mutual Fund Portfolio Analyzer',
    'Portfolio summary — figures in INR unless stated otherwise',
  )

  row = section(ws, row, 'Portfolio Summary')
  const t = report.totals
  const summaryRows: [string, CellValue, string | undefined][] = [
    ['Investor Age', report.investorAge, '0'],
    ['Risk Profile', report.riskProfile, undefined],
    ['Number of Funds', t.numberOfFunds, '0'],
    ['Total Invested', t.totalInvested, INR],
    ['Current Portfolio Value', t.totalCurrent, INR],
    ['Total Gain/Loss', t.totalGainLoss, INR_SIGNED],
    ['Total Return', t.totalReturnPct, PCT],
    ['Report Generated', report.generatedAt, undefined],
    ['Largest Holding', t.largestHolding, undefined],
    ['Largest Holding Value', t.largestHoldingValue, INR],
    ['Smallest Holding', t.smallestHolding, undefined],
    ['Smallest Holding Value', t.smallestHoldingValue, INR],
  ]
  const summaryStart = row
  for (const [label, value, numFmt] of summaryRows) {
    write(ws, row, 1, label, { font: LABEL_FONT, fill: LABEL_FILL, align: 'left', border: true })
    write(ws, row, 2, value, { numFmt, border: true })
    row += 1
  }
  ws.addConditionalFormatting(signRule(`B${summaryStart + 5}:B${summaryStart + 6}`))

  row += 1
  row = section(ws, row, 'Portfolio Allocation')
  const allocHeaderRow = row
  row = headerRow(ws, row, [
    'Fund', 'Invested', 'Current Value', 'Gain/Loss', 'Return %', 'Allocation %',
  ])

  const firstDataRow = row
  for (const fund of report.funds) {
    write(ws, row, 1, fundLabel(fund), { align: 'left', border: true })
    write(ws, row, 2, fund.input.amountInvested, { numFmt: INR, border: true })
    write(ws, row, 3, fund.input.currentAmount, { numFmt: INR, border: true })
    write(ws, row, 4, fund.gainLoss, { numFmt: INR_SIGNED, border: true })
    write(ws, row, 5, fund.absoluteReturnPct, { numFmt: PCT, border: true })
    write(ws, row, 6, fund.allocationPct, { numFmt: PCT, border: true })
    row += 1
  }
  const lastDataRow = row - 1

  const totalOpts = { font: LABEL_FONT, fill: SUBHEAD_FILL, border: true }
  write(ws, row, 1, 'TOTAL', { ...totalOpts, align: 'left' })
  write(ws, row, 2, t.totalInvested, { ...totalOpts, numFmt: INR })
  write(ws, row, 3, t.totalCurrent, { ...totalOpts, numFmt: INR })
  write(ws, row, 4, t.totalGainLoss, { ...totalOpts, numFmt: INR_SIGNED })
  write(ws, row, 5, t.totalReturnPct, { ...totalOpts, numFmt: PCT })
  write(ws, row, 6, t.totalCurrent > 0 ? 100 : null, { ...totalOpts, numFmt: PCT })
  row += 2

  if (lastDataRow >= firstDataRow) {
    ws.views = [{ state: 'frozen', ySplit: firstDataRow - 1, showGridLines: false }]
    ws.addConditionalFormatting(signRule(`D${firstDataRow}:E${lastDataRow}`))
    ws.addConditionalFormatting({
      ref: `F${firstDataRow}:F${lastDataRow}`,
      rules: [
        {
          type: 'colorScale', priority: 3,
          cfvo: [{ type: 'min' }, { type: 'max' }],
          color: [{ argb: 'FFFFFFFF' }, { argb: 'FF93C5FD' }],
        },
      ],
    })

    const png = renderAllocationChart(
      report.funds.map((fund, index) => ({
        label: fundLabel(fund),
        value: fund.input.currentAmount,
        colour: ALLOCATION_COLOURS[index % ALLOCATION_COLOURS.length],
      })),
    )
    if (png) {
      const imageId = wb.addImage({ buffer: png as ExcelJS.Buffer, extension: 'png' })
      ws.addImage(imageId, {
        tl: { col: 7, row: allocHeaderRow - 1 },
        ext: { width: 900, height: 420 },
      })
    }
  }

  row = section(ws, row, 'Risk Profile Context')
  ws.mergeCells(row, 1, row + 1, 6)
  write(
    ws, row, 1,
    `Investor profile: ${report.riskProfile}. This is recorded for context only — the ` +
      'report makes no buy, sell or switch recommendation. The figures below describe ' +
      'the portfolio as it stands.',
    { font: NOTE_FONT, align: 'left', wrap: true },
  )
  row += 3

  const allocations = report.funds
    .map((f) => f.allocationPct)
    .filter((v): v is number => v !== null)
  const largestAlloc = allocations.length ? Math.max(...allocations) : null
  const topThree = allocations.length
    ? [...allocations].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0)
    : null

  const contextRows: [string, CellValue, string | undefined][] = [
    ['Number of holdings', t.numberOfFunds, '0'],
    ['Largest single-fund allocation', largestAlloc, PCT],
    ['Top 3 holdings as share of portfolio', topThree, PCT],
    [
      'Funds with complete scheme data',
      report.funds.filter((f) => f.status === 'retrieved').length,
      '0',
    ],
  ]
  for (const [label, value, numFmt] of contextRows) {
    write(ws, row, 1, label, { font: LABEL_FONT, fill: LABEL_FILL, align: 'left', border: true })
    write(ws, row, 2, value, { numFmt, border: true })
    row += 1
  }

  row += 1
  row = section(ws, row, 'Category Distribution (by current value)')
  row = headerRow(ws, row, ['Scheme Category', 'Share of Portfolio'])
  const categories = Object.entries(report.categoryDistribution)
  if (categories.length > 0) {
    for (const [category, share] of categories) {
      write(ws, row, 1, category, { align: 'left', border: true })
      write(ws, row, 2, share, { numFmt: PCT, border: true })
      row += 1
    }
  } else {
    write(ws, row, 1, null, { align: 'left', border: true })
    write(ws, row, 2, null, { border: true })
    row += 1
  }

  disclaimer(ws, row, 6)
}

// ----------------------------------------------------------------------
// Sheet 2 — Fund Analysis
// ----------------------------------------------------------------------
export const FUND_ANALYSIS_HEADERS = [
  'Fund', 'AMC', 'Category', 'Scheme Type', 'Investment Date', 'Holding Period',
  'Amount Invested', 'Current Amount', 'Gain/Loss', 'Return %', 'CAGR',
  '1Y Return', '3Y Return', '5Y Return', 'Volatility', 'Sharpe',
  'Max Drawdown', 'Fund Score', 'Allocation %', 'Data Status',
]

function sheetFundAnalysis(wb: ExcelJS.Workbook, report: AnalysisReport): void {
  const ws = wb.addWorksheet('Fund Analysis', { views: [{ showGridLines: false }] })
  widths(ws, [42, 24, 24, 22, 15, 22, 16, 16, 16, 12, 12, 12, 12, 12, 12, 10, 14, 12, 13, 18])

  let row = title(
    ws, 1, 'Fund Analysis',
    'Trailing returns, risk metrics and the Fund Analysis Score are calculated by this ' +
      'application from published NAV history — see the Methodology sheet.',
  )
  const hRow = row
  row = headerRow(ws, row, FUND_ANALYSIS_HEADERS)
  const firstDataRow = row

  for (const fund of report.funds) {
    const s = fund.scheme
    write(ws, row, 1, fundLabel(fund), { align: 'left', border: true })
    write(ws, row, 2, s?.fundHouse ?? null, { align: 'left', border: true })
    write(ws, row, 3, s?.schemeCategory ?? null, { align: 'left', border: true })
    write(ws, row, 4, s?.schemeType ?? null, { align: 'left', border: true })
    write(ws, row, 5, fund.input.investmentDate, {
      numFmt: DATE_FMT, align: 'center', border: true,
    })
    write(ws, row, 6, fund.holdingPeriodDays !== null ? fund.holdingPeriodLabel : null, {
      align: 'left', border: true,
    })
    write(ws, row, 7, fund.input.amountInvested, { numFmt: INR, border: true })
    write(ws, row, 8, fund.input.currentAmount, { numFmt: INR, border: true })
    write(ws, row, 9, fund.gainLoss, { numFmt: INR_SIGNED, border: true })
    write(ws, row, 10, fund.absoluteReturnPct, { numFmt: PCT, border: true })

    if (fund.cagrPct === null && fund.cagrNote) {
      write(ws, row, 11, fund.cagrNote, {
        font: NOTE_FONT, align: 'left', border: true, wrap: true,
      })
    } else {
      write(ws, row, 11, fund.cagrPct, { numFmt: PCT, border: true })
    }

    write(ws, row, 12, fund.return1y.value, { numFmt: PCT, border: true })
    write(ws, row, 13, fund.return3y.value, { numFmt: PCT, border: true })
    write(ws, row, 14, fund.return5y.value, { numFmt: PCT, border: true })
    write(ws, row, 15, fund.volatility.value, { numFmt: PCT, border: true })
    write(ws, row, 16, fund.sharpeRatio.value, { numFmt: NUM2, border: true })
    write(ws, row, 17, fund.maxDrawdown.value, { numFmt: PCT, border: true })

    if (fund.fundScore === null) {
      write(ws, row, 18, 'Score unavailable — insufficient data', {
        font: NOTE_FONT, align: 'left', border: true, wrap: true,
      })
    } else {
      write(ws, row, 18, fund.fundScore, { numFmt: NUM2, border: true })
    }

    write(ws, row, 19, fund.allocationPct, { numFmt: PCT, border: true })
    write(ws, row, 20, fund.statusLabel, { align: 'left', border: true })
    row += 1
  }

  const lastDataRow = row - 1
  ws.views = [{ state: 'frozen', ySplit: firstDataRow - 1, showGridLines: false }]
  if (lastDataRow >= firstDataRow) {
    ws.autoFilter = { from: { row: hRow, column: 1 }, to: { row: lastDataRow, column: 20 } }
    for (const column of ['I', 'J', 'K', 'L', 'M', 'N', 'Q']) {
      ws.addConditionalFormatting(signRule(`${column}${firstDataRow}:${column}${lastDataRow}`))
    }
    ws.addConditionalFormatting({
      ref: `R${firstDataRow}:R${lastDataRow}`,
      rules: [
        {
          type: 'colorScale', priority: 4,
          cfvo: [
            { type: 'num', value: 0 },
            { type: 'num', value: 50 },
            { type: 'num', value: 100 },
          ],
          color: [{ argb: 'FFFCA5A5' }, { argb: 'FFFEF3C7' }, { argb: 'FF86EFAC' }],
        },
      ],
    })
  }

  row += 1
  write(
    ws, row, 1,
    "Fund Score is this application's own transparent score (0-100). It is not a rating " +
      'from Value Research or any other organisation.',
    { font: NOTE_FONT, align: 'left' },
  )
  row += 1

  const messages = report.funds.flatMap((f) => f.messages.map((m) => [f, m] as const))
  if (messages.length > 0) {
    row += 1
    row = section(ws, row, 'Per-fund notes')
    for (const [fund, message] of messages) {
      write(ws, row, 1, fundLabel(fund), { align: 'left', border: true })
      ws.mergeCells(row, 2, row, 8)
      write(ws, row, 2, message, { align: 'left', border: true, wrap: true })
      row += 1
    }
  }

  disclaimer(ws, row, 8)
}

// ----------------------------------------------------------------------
// Sheet 3 — Fund Details
// ----------------------------------------------------------------------
function sheetFundDetails(wb: ExcelJS.Workbook, report: AnalysisReport): void {
  const ws = wb.addWorksheet('Fund Details', { views: [{ showGridLines: false }] })
  widths(ws, [30, 60])

  let row = title(
    ws, 1, 'Fund Details',
    'Scheme identification and metadata exactly as published by the data provider.',
  )

  const ALWAYS = new Set([
    'Scheme Name', 'AMC', 'Scheme Code', 'Category', 'Latest NAV', 'NAV Date', 'Data Status',
  ])

  for (const fund of report.funds) {
    row = section(ws, row, fundLabel(fund))
    const s = fund.scheme
    const fields: [string, CellValue, string | undefined][] = [
      ['Scheme Name', s?.schemeName ?? null, undefined],
      ['AMC', s?.fundHouse ?? null, undefined],
      ['Scheme Code', s?.schemeCode ?? null, undefined],
      ['ISIN (Growth)', s?.isinGrowth ?? null, undefined],
      ['ISIN (IDCW Reinvestment)', s?.isinDivReinvestment ?? null, undefined],
      ['Category', s?.schemeCategory ?? null, undefined],
      ['Scheme Type', s?.schemeType ?? null, undefined],
      ['Direct/Regular', s?.plan ?? null, undefined],
      ['Growth/IDCW', s?.option ?? null, undefined],
      ['Latest NAV', s?.latestNav ?? null, NUM2],
      ['NAV Date', s?.latestNavDate ?? null, DATE_FMT],
      ['Earliest Published NAV Date', s?.inceptionDate ?? null, DATE_FMT],
      ['NAV Observations Used', s?.navHistoryPoints ?? null, '0'],
      ['AUM', fund.aum.value, INR],
      ['Expense Ratio', fund.expenseRatio.value, PCT],
      ['Benchmark', fund.benchmark, undefined],
      ['Data Status', fund.statusLabel, undefined],
    ]

    for (const [label, value, numFmt] of fields) {
      // Render a field only when it has a value, or when its absence is
      // meaningful to the reader (identification and status fields).
      if ((value === null || value === undefined) && !ALWAYS.has(label)) continue
      write(ws, row, 1, label, { font: LABEL_FONT, fill: LABEL_FILL, align: 'left', border: true })
      write(ws, row, 2, value, { numFmt, align: 'left', border: true })
      row += 1
    }

    if (fund.messages.length > 0) {
      write(ws, row, 1, 'Notes', { font: LABEL_FONT, fill: LABEL_FILL, align: 'left', border: true })
      write(ws, row, 2, fund.messages.join(' '), {
        font: NOTE_FONT, align: 'left', border: true, wrap: true,
      })
      row += 1
    }
    row += 1
  }

  disclaimer(ws, row, 2)
}

// ----------------------------------------------------------------------
// Sheet 4 — Methodology
// ----------------------------------------------------------------------
function sheetMethodology(wb: ExcelJS.Workbook, report: AnalysisReport): void {
  const ws = wb.addWorksheet('Methodology', { views: [{ showGridLines: false }] })
  widths(ws, [32, 100])

  let row = title(
    ws, 1, 'Methodology',
    'Every figure in this workbook is reproducible from the formulae below.',
  )

  const rf = (RISK_FREE_RATE * 100).toFixed(2)
  const entries: [string, string][] = [
    ['Absolute Gain/Loss',
      'Current Amount − Amount Invested, using the values you entered. Your inputs are never adjusted.'],
    ['Absolute Return %',
      '(Current Amount − Amount Invested) ÷ Amount Invested × 100.'],
    ['Holding Period',
      'Exact elapsed calendar time between the investment date and the report generation date, expressed in years, months and days. Whole months are counted first, with end-of-month clamping, and the remaining days after that.'],
    ['CAGR',
      '((Current Amount ÷ Amount Invested) ^ (365.25 ÷ holding period in days)) − 1, × 100. The actual holding period is used — no rounding to whole years. CAGR is not calculated when the investment date is missing or invalid, when the holding period is under one day, or when the current value is zero.'],
    ['Portfolio Allocation %',
      'Current Fund Value ÷ Total Current Portfolio Value × 100.'],
    ['Portfolio Totals',
      'Simple sums of the amounts you entered. Total Return % is total gain/loss ÷ total invested × 100.'],
    ['1Y / 3Y / 5Y Returns',
      'Calculated by this application from the scheme’s published NAV history. The 1-year figure is an absolute return; the 3-year and 5-year figures are annualised (CAGR). The window start uses the nearest NAV published on or before the target date, within a 10-day tolerance for market holidays; outside that tolerance the figure is reported as unavailable. A period is left blank when the NAV history does not cover it.'],
    ['Since-Inception Return',
      'Annualised return from the earliest published NAV to the latest, shown only when at least one year of history exists. Note that the earliest published NAV date is not necessarily the scheme’s official inception date.'],
    ['Volatility',
      `Standard deviation (sample, n−1) of daily NAV returns, annualised by multiplying by √${TRADING_DAYS_PER_YEAR}, expressed in percent. Requires at least ${MIN_OBSERVATIONS_FOR_RISK} daily observations.`],
    ['Sharpe Ratio',
      `(annualised return − risk-free rate) ÷ annualised volatility, where the annualised return is derived from the mean daily NAV return over the full available history and the risk-free rate is ${rf}% p.a. Both legs come from the same NAV series.`],
    ['Maximum Drawdown',
      'Largest peak-to-trough decline of the NAV series over its full published history, expressed as a negative percentage.'],
    ['Consistency',
      'Share of rolling 1-year windows, sampled monthly, in which the NAV rose. Reported only when at least 12 such windows exist.'],
    ['Fund Analysis Score',
      `A transparent 0-100 score computed by this application from the components in the table below. Each component is mapped to 0-100 by linear interpolation between two documented anchor points and clipped to that range; the score is the weighted mean of the components that could be computed, with weights renormalised over those components. Fewer than ${MIN_COMPONENTS} available components yields "Score unavailable — insufficient data". This score is NOT a rating from Value Research or any other organisation, and it is not a recommendation.`],
    ['Data Retrieval',
      `Scheme identification, metadata and NAV history are retrieved from ${report.providerName} over its public API, requested directly by your browser. No website is scraped and no access control is bypassed. Your portfolio figures are never transmitted anywhere: all analysis and this workbook are produced locally in your browser. Retrieval dates and per-data-point outcomes are recorded on the Data Sources sheet.`],
    ['Unavailable Data',
      'Anything that could not be retrieved or computed is shown as "Data unavailable" and is never substituted with an estimate, a placeholder or zero.'],
  ]

  row = headerRow(ws, row, ['Metric', 'How it is calculated'])
  for (const [label, description] of entries) {
    write(ws, row, 1, label, { font: LABEL_FONT, fill: LABEL_FILL, align: 'left', border: true })
    const cell = write(ws, row, 2, description, { align: 'left', border: true, wrap: true })
    cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
    ws.getRow(row).height = Math.max(30, 13 * (Math.floor(description.length / 95) + 1))
    row += 1
  }

  row += 1
  row = section(ws, row, 'Fund Analysis Score — components and weights')
  row = headerRow(ws, row, ['Component', 'Weight', 'Scale'])
  ws.getColumn(3).width = 90
  for (const [component, weight, description] of methodologyRows()) {
    write(ws, row, 1, component, { font: LABEL_FONT, fill: LABEL_FILL, align: 'left', border: true })
    write(ws, row, 2, weight, { align: 'center', border: true })
    const cell = write(ws, row, 3, description, { align: 'left', border: true, wrap: true })
    cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
    row += 1
  }

  row += 1
  row = section(ws, row, 'Assumptions')
  const assumptions = [
    'One year is treated as 365.25 days so that leap years do not distort annualisation.',
    `${TRADING_DAYS_PER_YEAR} trading days per year are assumed when annualising daily volatility.`,
    `The risk-free rate used by the Sharpe ratio is ${rf}% per annum.`,
    'Amounts invested are treated as a single lump sum on the stated investment date; SIP instalments and additional purchases are not modelled, so the CAGR shown is the point-to-point return on the figures you entered, not an XIRR.',
    'NAV values of zero in the source feed are treated as missing rather than as prices.',
    'Scheme-level returns are derived from the scheme’s own NAV and are independent of when you personally invested.',
    'Direct/Regular and Growth/IDCW are read from the AMFI scheme name; where the name does not state them, the field shows "Data unavailable".',
    'All calculations run at full floating-point precision; rounding happens only when a value is displayed.',
    'The allocation chart is a rendered image; every number it depicts is also present as cells in the Portfolio Allocation table beside it.',
  ]
  for (const text of assumptions) {
    write(ws, row, 1, '•', { align: 'center' })
    const cell = write(ws, row, 2, text, { align: 'left', wrap: true })
    cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
    row += 1
  }

  disclaimer(ws, row, 3)
}

// ----------------------------------------------------------------------
// Sheet 5 — Data Sources
// ----------------------------------------------------------------------
function sheetDataSources(wb: ExcelJS.Workbook, report: AnalysisReport): void {
  const ws = wb.addWorksheet('Data Sources', { views: [{ showGridLines: false }] })
  widths(ws, [42, 32, 22, 18, 44])

  let row = title(
    ws, 1, 'Data Sources',
    'Provenance and retrieval outcome for every externally obtained data point.',
  )
  const hRow = row
  row = headerRow(ws, row, ['Fund', 'Data Point', 'Source', 'Retrieved On', 'Status'])
  const firstDataRow = row

  for (const record of report.dataSources) {
    write(ws, row, 1, record.fund, { align: 'left', border: true })
    write(ws, row, 2, record.dataPoint, { align: 'left', border: true })
    write(ws, row, 3, record.source, { align: 'left', border: true })
    write(ws, row, 4, record.retrievedOn, { align: 'center', border: true })
    write(ws, row, 5, record.status, { align: 'left', border: true })
    row += 1
  }

  const lastDataRow = row - 1
  ws.views = [{ state: 'frozen', ySplit: firstDataRow - 1, showGridLines: false }]
  if (lastDataRow >= firstDataRow) {
    ws.autoFilter = { from: { row: hRow, column: 1 }, to: { row: lastDataRow, column: 5 } }
    ws.addConditionalFormatting({
      ref: `E${firstDataRow}:E${lastDataRow}`,
      rules: [
        {
          type: 'containsText', operator: 'containsText', text: 'Failed', priority: 1,
          style: {
            font: { color: { argb: LOSS }, bold: true },
            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEE2E2' } },
          },
        },
        {
          type: 'containsText', operator: 'containsText', text: 'Unavailable', priority: 2,
          style: {
            font: { color: { argb: 'FFB45309' } },
            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEF3C7' } },
          },
        },
      ],
    })
  }

  row += 1
  write(
    ws, row, 1,
    'Retrieval dates are recorded in DD-MM-YYYY format. NAV data published by ' +
      'AMFI-derived sources may lag the market by one business day.',
    { font: NOTE_FONT, align: 'left' },
  )
  row += 1
  disclaimer(ws, row, 5)
}

// ----------------------------------------------------------------------
export function buildWorkbook(report: AnalysisReport): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Mutual Fund Portfolio Analyzer'
  wb.title = 'Mutual Fund Portfolio Analysis'
  wb.created = new Date()

  sheetSummary(wb, report)
  sheetFundAnalysis(wb, report)
  sheetFundDetails(wb, report)
  sheetMethodology(wb, report)
  sheetDataSources(wb, report)
  return wb
}

export async function buildWorkbookBlob(report: AnalysisReport): Promise<Blob> {
  const buffer = await buildWorkbook(report).xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function suggestedFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `portfolio-analysis-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.xlsx`
}
