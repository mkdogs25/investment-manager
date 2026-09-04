/**
 * MFapi.in provider, called directly from the browser.
 *
 * Endpoints (all public, no credentials, no scraping):
 *   GET /mf/search?q=<term>   scheme search
 *   GET /mf/<code>            scheme metadata + full NAV history
 *
 * Because this runs in the page rather than on a server, the request is subject
 * to the browser's same-origin policy: MFapi.in must return permissive CORS
 * headers. A failure there is reported distinctly (kind: 'cors') so the UI can
 * explain it instead of showing an empty result list.
 */

import type { NavPoint } from '../calculations'
import {
  ProviderError,
  type FundDataProvider,
  type SchemeData,
  type SchemeSummary,
} from './types'

const DEFAULT_BASE_URL = 'https://api.mfapi.in'
const REQUEST_TIMEOUT_MS = 20_000

/** MFapi.in returns dates as dd-mm-YYYY. */
export function parseApiDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw.trim())
  if (!match) return null
  const [, day, month, year] = match
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

export function parseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  const value = Number(String(raw).trim())
  return Number.isFinite(value) ? value : null
}

interface CacheEntry<T> {
  at: number
  value: T
}

export class MFApiProvider implements FundDataProvider {
  readonly name = 'MFapi.in'
  readonly documentationUrl = 'https://www.mfapi.in/docs/'

  private readonly schemeCache = new Map<string, CacheEntry<SchemeData>>()
  private readonly searchCache = new Map<string, CacheEntry<SchemeSummary[]>>()

  constructor(
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly cacheTtlMs = 60 * 60 * 1000,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.baseUrl = this.baseUrl.replace(/\/+$/, '')
  }

  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort)

    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
    } catch (error) {
      if (signal?.aborted) throw error
      if (controller.signal.aborted) {
        throw new ProviderError(
          'timeout',
          `${this.name} did not respond in time. Check your connection and try again.`,
          error,
        )
      }
      // A cross-origin rejection surfaces as an opaque TypeError with no status,
      // indistinguishable from an offline network at the JS level, so say both.
      throw new ProviderError(
        'cors',
        `The browser could not reach ${this.name}. This is either a network problem or ` +
          `${this.name} refusing cross-origin requests from this site.`,
        error,
      )
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    if (response.status === 404) {
      throw new ProviderError('not_found', `${this.name} has no record for this scheme.`)
    }
    if (response.status === 429) {
      throw new ProviderError(
        'rate_limited',
        `${this.name} is rate limiting requests. Try again shortly.`,
      )
    }
    if (!response.ok) {
      throw new ProviderError(
        'unavailable',
        `${this.name} returned an error (HTTP ${response.status}).`,
      )
    }

    try {
      return await response.json()
    } catch (error) {
      throw new ProviderError('malformed', `${this.name} returned a malformed response.`, error)
    }
  }

  private cached<T>(store: Map<string, CacheEntry<T>>, key: string): T | null {
    const entry = store.get(key)
    if (!entry) return null
    if (Date.now() - entry.at > this.cacheTtlMs) {
      store.delete(key)
      return null
    }
    return entry.value
  }

  async searchSchemes(query: string, signal?: AbortSignal): Promise<SchemeSummary[]> {
    const trimmed = query.trim()
    if (!trimmed) return []

    const key = trimmed.toLowerCase()
    const hit = this.cached(this.searchCache, key)
    if (hit) return hit

    const payload = await this.get(`/mf/search?q=${encodeURIComponent(trimmed)}`, signal)
    const results: SchemeSummary[] = (Array.isArray(payload) ? payload : [])
      .filter((item) => item && item.schemeCode !== undefined && item.schemeCode !== null)
      .map((item) => ({
        schemeCode: String(item.schemeCode),
        schemeName: String(item.schemeName ?? '').trim(),
        fundHouse: item.fundHouse ?? null,
        schemeCategory: item.schemeCategory ?? null,
        schemeType: item.schemeType ?? null,
      }))

    this.searchCache.set(key, { at: Date.now(), value: results })
    return results
  }

  async getScheme(schemeCode: string, signal?: AbortSignal): Promise<SchemeData> {
    const code = String(schemeCode).trim()
    const hit = this.cached(this.schemeCache, code)
    if (hit) return hit

    const payload = (await this.get(`/mf/${encodeURIComponent(code)}`, signal)) as
      | Record<string, any>
      | null

    if (!payload || typeof payload !== 'object' || payload.status === 'FAIL') {
      throw new ProviderError('not_found', `${this.name} has no scheme ${code}.`)
    }

    const metaRaw = payload.meta ?? {}
    const navHistory: NavPoint[] = []
    for (const row of Array.isArray(payload.data) ? payload.data : []) {
      const on = parseApiDate(row?.date)
      const nav = parseNumber(row?.nav)
      // A NAV of exactly 0 is a placeholder in the AMFI feed, not a price.
      if (!on || nav === null || nav <= 0) continue
      navHistory.push({ on, nav })
    }
    navHistory.sort((a, b) => a.on.getTime() - b.on.getTime())

    const data: SchemeData = {
      meta: {
        schemeCode: String(metaRaw.scheme_code ?? code),
        schemeName: String(metaRaw.scheme_name ?? '').trim(),
        fundHouse: metaRaw.fund_house || null,
        schemeCategory: metaRaw.scheme_category || null,
        schemeType: metaRaw.scheme_type || null,
        isinGrowth: metaRaw.isin_growth || null,
        isinDivReinvestment: metaRaw.isin_div_reinvestment || null,
        aum: null,
        expenseRatio: null,
        benchmark: null,
      },
      navHistory,
    }

    this.schemeCache.set(code, { at: Date.now(), value: data })
    return data
  }
}
