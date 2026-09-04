import { describe, expect, it, vi } from 'vitest'
import { MFApiProvider, parseApiDate, parseNumber } from '../providers/mfapi'
import { ProviderError } from '../providers/types'

const SEARCH_PAYLOAD = [
  { schemeCode: 118989, schemeName: 'HDFC Flexi Cap Fund - Direct Plan - Growth' },
  { schemeCode: 118990, schemeName: 'HDFC Flexi Cap Fund - Growth' },
]

const SCHEME_PAYLOAD = {
  meta: {
    fund_house: 'HDFC Mutual Fund',
    scheme_type: 'Open Ended Schemes',
    scheme_category: 'Equity Scheme - Flexi Cap Fund',
    scheme_code: 118989,
    scheme_name: 'HDFC Flexi Cap Fund - Direct Plan - Growth',
    isin_growth: 'INF179K01YV8',
    isin_div_reinvestment: null,
  },
  data: [
    { date: '04-09-2026', nav: '1750.50000' },
    { date: '03-09-2026', nav: '1742.10000' },
    { date: '02-09-2026', nav: '0.00000' },
    { date: '01-09-2026', nav: '1730.00000' },
  ],
  status: 'SUCCESS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function providerWith(impl: typeof fetch) {
  return new MFApiProvider('https://api.mfapi.in', 60_000, impl)
}

describe('date and number parsing', () => {
  it('parses dd-mm-yyyy', () => {
    const parsed = parseApiDate('04-09-2026')!
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(8)
    expect(parsed.getDate()).toBe(4)
  })

  it('rejects malformed and impossible dates', () => {
    expect(parseApiDate('2026-09-04')).toBeNull()
    expect(parseApiDate('31-02-2026')).toBeNull()
    expect(parseApiDate(null)).toBeNull()
    expect(parseApiDate('')).toBeNull()
  })

  it('parses numeric strings and rejects rubbish', () => {
    expect(parseNumber('1750.5')).toBeCloseTo(1750.5, 8)
    expect(parseNumber(null)).toBeNull()
    expect(parseNumber('N.A.')).toBeNull()
  })
})

describe('MFapi provider', () => {
  it('maps search results to scheme codes and names', async () => {
    const fetchMock = vi.fn(async (url: any) => {
      expect(String(url)).toContain('/mf/search?q=hdfc%20flexi')
      return jsonResponse(SEARCH_PAYLOAD)
    })
    const results = await providerWith(fetchMock as any).searchSchemes('hdfc flexi')
    expect(results.map((r) => r.schemeCode)).toEqual(['118989', '118990'])
  })

  it('short-circuits an empty query without a request', async () => {
    const fetchMock = vi.fn()
    expect(await providerWith(fetchMock as any).searchSchemes('   ')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caches search results', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(SEARCH_PAYLOAD))
    const provider = providerWith(fetchMock as any)
    await provider.searchSchemes('hdfc')
    await provider.searchSchemes('HDFC')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('parses metadata and NAV history', async () => {
    const provider = providerWith((async () => jsonResponse(SCHEME_PAYLOAD)) as any)
    const data = await provider.getScheme('118989')
    expect(data.meta.schemeCode).toBe('118989')
    expect(data.meta.fundHouse).toBe('HDFC Mutual Fund')
    expect(data.meta.isinGrowth).toBe('INF179K01YV8')
    expect(data.meta.isinDivReinvestment).toBeNull()
    // Zero-NAV placeholder dropped; history returned oldest-first.
    expect(data.navHistory.map((p) => p.nav)).toEqual([1730, 1742.1, 1750.5])
    expect(data.navHistory[0].on.getDate()).toBe(1)
  })

  it('never invents AUM, expense ratio or benchmark', async () => {
    const provider = providerWith((async () => jsonResponse(SCHEME_PAYLOAD)) as any)
    const data = await provider.getScheme('118989')
    expect(data.meta.aum).toBeNull()
    expect(data.meta.expenseRatio).toBeNull()
    expect(data.meta.benchmark).toBeNull()
  })

  it('identifies schemes by code, not by name', async () => {
    const fetchMock = vi.fn(async (url: any) => {
      const code = String(url).split('/').pop()!
      return jsonResponse({
        ...SCHEME_PAYLOAD,
        meta: {
          ...SCHEME_PAYLOAD.meta,
          scheme_code: Number(code),
          scheme_name:
            code === '118989'
              ? 'HDFC Flexi Cap Fund - Direct Plan - Growth'
              : 'HDFC Flexi Cap Fund - Growth',
        },
      })
    })
    const provider = providerWith(fetchMock as any)
    const direct = await provider.getScheme('118989')
    const regular = await provider.getScheme('118990')
    expect(direct.meta.schemeName).not.toBe(regular.meta.schemeName)
  })

  it('caches scheme data', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(SCHEME_PAYLOAD))
    const provider = providerWith(fetchMock as any)
    await provider.getScheme('118989')
    await provider.getScheme('118989')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    [404, 'not_found'],
    [429, 'rate_limited'],
    [503, 'unavailable'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const provider = providerWith((async () => jsonResponse({}, status)) as any)
    await expect(provider.getScheme('118989')).rejects.toMatchObject({ kind })
  })

  it('treats a FAIL payload as not found', async () => {
    const provider = providerWith(
      (async () => jsonResponse({ status: 'FAIL', message: 'Invalid scheme' })) as any,
    )
    await expect(provider.getScheme('999999')).rejects.toMatchObject({ kind: 'not_found' })
  })

  it('reports a malformed body', async () => {
    const provider = providerWith(
      (async () => new Response('<html>nope</html>', { status: 200 })) as any,
    )
    await expect(provider.getScheme('118989')).rejects.toMatchObject({ kind: 'malformed' })
  })

  it('reports a blocked cross-origin request distinctly', async () => {
    const provider = providerWith((async () => {
      throw new TypeError('Failed to fetch')
    }) as any)
    const error = await provider.searchSchemes('hdfc').catch((e) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error.kind).toBe('cors')
    expect(error.userMessage).toContain('cross-origin')
  })
})
