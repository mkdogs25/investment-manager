/**
 * Thin adapter between the React components and the in-browser data engine.
 *
 * There is no backend: scheme search, NAV retrieval, all analysis and the
 * workbook itself run in the page. Nothing the user types leaves their browser
 * except the scheme code sent to the public NAV API.
 */

import { analysePortfolio } from '../data/analysis'
import type { AnalysisReport, PortfolioInput } from '../data/analysis'
import { getProvider } from '../data/providers/registry'
import { ProviderError, type SchemeSummary } from '../data/providers/types'

export { ProviderError }

export function providerName(): string {
  return getProvider().name
}

export function searchSchemes(
  query: string,
  signal?: AbortSignal,
): Promise<SchemeSummary[]> {
  return getProvider().searchSchemes(query, signal)
}

export function analyse(input: PortfolioInput): Promise<AnalysisReport> {
  return analysePortfolio(input)
}

/**
 * Builds the workbook and hands it to the browser as a download.
 *
 * The spreadsheet writer is imported lazily: it is by far the largest
 * dependency and is only needed once the user actually asks for the report, so
 * it stays out of the initial page load.
 */
export async function downloadReport(report: AnalysisReport): Promise<string> {
  const { buildWorkbookBlob, suggestedFilename } = await import('../data/excel')
  const blob = await buildWorkbookBlob(report)
  const filename = suggestedFilename(report.reportDate)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoked on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
  return filename
}

export function describeError(error: unknown): string {
  if (error instanceof ProviderError) return error.userMessage
  if (error instanceof Error) return error.message
  return 'Something went wrong while generating the report.'
}
