import type {
  AnalysisResponse,
  PortfolioPayload,
  SchemeDetail,
  SchemeSearchResult,
} from '../types'

/** Backend base URL. Same-origin '/api' locally (via the dev proxy); an
 *  absolute URL when the frontend is hosted separately, e.g. on GitHub Pages. */
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

const BASE = API_BASE

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch {
    throw new ApiError(
      'Could not reach the analyzer backend. Check that the server is running.',
      0,
    )
  }
  if (!response.ok) {
    throw new ApiError(await readError(response), response.status)
  }
  return (await response.json()) as T
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json()
    if (typeof body?.detail === 'string') return body.detail
    if (Array.isArray(body?.detail) && body.detail.length > 0) {
      return body.detail
        .map((d: { msg?: string }) => d.msg ?? 'Invalid input')
        .join('; ')
    }
  } catch {
    /* fall through to the generic message below */
  }
  if (response.status === 429) return 'The data provider is rate limiting requests. Try again shortly.'
  if (response.status === 504) return 'The data provider timed out. Try again shortly.'
  if (response.status === 503) return 'The data provider is currently unavailable.'
  return `Request failed (HTTP ${response.status}).`
}

export interface HealthResponse {
  status: string
  provider: string
  available_providers: string[]
  server_date: string
}

/** Checks that the backend is reachable, so the UI can explain an unconfigured
 *  or offline API before the user starts typing. */
export function checkHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>('/health', { signal })
}

export function searchSchemes(
  query: string,
  signal?: AbortSignal,
): Promise<SchemeSearchResult[]> {
  return request<SchemeSearchResult[]>(
    `/funds/search?q=${encodeURIComponent(query)}&limit=25`,
    { signal },
  )
}

export function getScheme(schemeCode: string): Promise<SchemeDetail> {
  return request<SchemeDetail>(`/funds/${encodeURIComponent(schemeCode)}`)
}

export function analysePortfolio(payload: PortfolioPayload): Promise<AnalysisResponse> {
  return request<AnalysisResponse>('/portfolio/analyze', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Downloads the .xlsx workbook and hands it to the browser. */
export async function downloadReport(payload: PortfolioPayload): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${BASE}/portfolio/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new ApiError(
      'Could not reach the analyzer backend. Check that the server is running.',
      0,
    )
  }
  if (!response.ok) {
    throw new ApiError(await readError(response), response.status)
  }

  const filename =
    parseFilename(response.headers.get('Content-Disposition')) ??
    `portfolio-analysis-${new Date().toISOString().slice(0, 10)}.xlsx`

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return filename
}

function parseFilename(header: string | null): string | null {
  if (!header) return null
  const match = /filename="?([^";]+)"?/i.exec(header)
  return match ? match[1] : null
}
