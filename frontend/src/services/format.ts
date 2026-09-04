/** Display helpers. Values arrive at full precision and are rounded only here. */

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
})

const inrCompact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

export const UNAVAILABLE = 'Data unavailable'

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return UNAVAILABLE
  return inr.format(value)
}

export function formatCurrencyCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return UNAVAILABLE
  return inrCompact.format(value)
}

export function formatPercent(
  value: number | null | undefined,
  { signed = false }: { signed?: boolean } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return UNAVAILABLE
  const sign = signed && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return UNAVAILABLE
  return value.toFixed(digits)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return UNAVAILABLE
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return UNAVAILABLE
  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** Parses a user-entered rupee amount, tolerating commas and spaces. */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[,\s₹]/g, '')
  if (cleaned === '') return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

export function todayIso(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10)
}
