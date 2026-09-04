import type { FundRow, PortfolioInput, RiskProfile, ValidationIssue } from '../types'
import { parseAmount, todayIso } from './format'

export const MIN_AGE = 18
export const MAX_AGE = 100

export function emptyRow(): FundRow {
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `row-${Math.random().toString(36).slice(2)}`,
    scheme: null,
    fundName: '',
    investmentDate: '',
    amountInvested: '',
    currentAmount: '',
  }
}

export function validateAge(age: string): string | null {
  if (age.trim() === '') return 'Enter your age.'
  const value = Number(age)
  if (!Number.isInteger(value)) return 'Age must be a whole number.'
  if (value < MIN_AGE || value > MAX_AGE) {
    return `Age must be between ${MIN_AGE} and ${MAX_AGE}.`
  }
  return null
}

/** Row ids that repeat an earlier row's scheme. */
export function duplicateRowIds(rows: FundRow[]): Set<string> {
  const seen = new Map<string, string>()
  const duplicates = new Set<string>()
  for (const row of rows) {
    const key = row.scheme?.schemeCode ?? row.fundName.trim().toLowerCase()
    if (!key) continue
    if (seen.has(key)) duplicates.add(row.id)
    else seen.set(key, row.id)
  }
  return duplicates
}

export function validateRow(row: FundRow): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (field: string, message: string) =>
    issues.push({ rowId: row.id, field, message })

  if (!row.fundName.trim()) {
    add('fundName', 'Search for and select a scheme.')
  } else if (!row.scheme) {
    add(
      'fundName',
      'Select a scheme from the search results so it can be identified exactly.',
    )
  }

  if (row.investmentDate) {
    if (Number.isNaN(new Date(row.investmentDate).getTime())) {
      add('investmentDate', 'Enter a valid investment date.')
    } else if (row.investmentDate > todayIso()) {
      add('investmentDate', 'The investment date cannot be in the future.')
    }
  }

  const invested = parseAmount(row.amountInvested)
  if (invested === null) add('amountInvested', 'Enter the amount invested.')
  else if (invested <= 0) add('amountInvested', 'Amount invested must be greater than zero.')

  const current = parseAmount(row.currentAmount)
  if (current === null) add('currentAmount', 'Enter the current value.')
  else if (current < 0) add('currentAmount', 'The current value cannot be negative.')

  return issues
}

export function validatePortfolio(age: string, rows: FundRow[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const ageError = validateAge(age)
  if (ageError) issues.push({ rowId: null, field: 'age', message: ageError })

  if (rows.length === 0) {
    issues.push({ rowId: null, field: 'funds', message: 'Add at least one fund.' })
  }

  for (const row of rows) issues.push(...validateRow(row))

  for (const id of duplicateRowIds(rows)) {
    issues.push({
      rowId: id,
      field: 'fundName',
      message: 'This scheme is already in your portfolio. Merge or remove the duplicate.',
    })
  }

  return issues
}

/** Parses a YYYY-MM-DD input value as a local calendar date. */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null
  }
  return date
}

export function buildPayload(
  age: string,
  riskProfile: RiskProfile,
  rows: FundRow[],
): PortfolioInput {
  return {
    investorAge: Number(age),
    riskProfile,
    funds: rows.map((row) => ({
      schemeCode: row.scheme?.schemeCode ?? null,
      fundName: row.scheme?.schemeName ?? row.fundName.trim(),
      investmentDate: row.investmentDate ? parseIsoDate(row.investmentDate) : null,
      amountInvested: parseAmount(row.amountInvested) ?? 0,
      currentAmount: parseAmount(row.currentAmount) ?? 0,
    })),
  }
}

/** Live totals for the preview panel; ignores rows that are not yet filled in. */
export function previewTotals(rows: FundRow[]) {
  let invested = 0
  let current = 0
  let counted = 0
  for (const row of rows) {
    const i = parseAmount(row.amountInvested)
    const c = parseAmount(row.currentAmount)
    if (i === null || c === null || i <= 0 || c < 0) continue
    invested += i
    current += c
    counted += 1
  }
  return {
    invested,
    current,
    gain: current - invested,
    returnPct: invested > 0 ? ((current - invested) / invested) * 100 : null,
    counted,
  }
}
