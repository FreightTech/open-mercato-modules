/**
 * Tests for the vessel-api client — focused on fetchPois (the POI map feature).
 *
 * Covers query-param building, 404/error handling, and deduping by code
 * (the live endpoint can return the same POI code more than once).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPois, type PoiInfo } from '../vessel-api'

// ─── Helpers ─────────────────────────────────────────────────

function makePoi(overrides: Partial<PoiInfo> & { code: string }): PoiInfo {
  return {
    code: overrides.code,
    locode: overrides.locode ?? null as unknown as string,
    type: overrides.type ?? 'WAYPOINT',
    center: overrides.center ?? { lat: 0, lng: 0 },
    radiusMeters: overrides.radiusMeters ?? 5000,
    portName: overrides.portName ?? null,
    terminalName: overrides.terminalName ?? null,
    city: overrides.city ?? null,
    country: overrides.country ?? null,
    regionNamePl: overrides.regionNamePl ?? null,
    regionNameEn: overrides.regionNameEn ?? null,
  }
}

function mockFetchOnce(body: unknown, init?: { ok?: boolean; status?: number }) {
  const ok = init?.ok ?? true
  const status = init?.status ?? 200
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  })
  // @ts-expect-error - assigning a partial fetch mock for tests
  global.fetch = fetchMock
  return fetchMock
}

function lastUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  return String(fetchMock.mock.calls[0][0])
}

// ─── Tests ───────────────────────────────────────────────────

describe('fetchPois', () => {
  const originalFetch = global.fetch
  const originalBaseUrl = process.env.NEXT_PUBLIC_VESSEL_API_URL

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.NEXT_PUBLIC_VESSEL_API_URL = 'https://vessel.example.test'
  })

  afterEach(() => {
    global.fetch = originalFetch
    if (originalBaseUrl === undefined) delete process.env.NEXT_PUBLIC_VESSEL_API_URL
    else process.env.NEXT_PUBLIC_VESSEL_API_URL = originalBaseUrl
  })

  it('dedupes POIs that share a code (live endpoint returns duplicates)', async () => {
    const fetchMock = mockFetchOnce({
      pois: [
        makePoi({ code: 'N055E012-01920', regionNameEn: 'Baltic Sea' }),
        makePoi({ code: 'N055E012-01920', regionNameEn: 'Baltic Sea (dup)' }),
        makePoi({ code: 'PLGDY-T1', type: 'TERMINAL' }),
      ],
      count: 3,
      limit: 1000,
    })

    const pois = await fetchPois()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(pois).toHaveLength(2)
    expect(pois.map((p) => p.code)).toEqual(['N055E012-01920', 'PLGDY-T1'])
    // First occurrence wins
    expect(pois[0].regionNameEn).toBe('Baltic Sea')
  })

  it('builds the bounding-box, type and limit query params', async () => {
    const fetchMock = mockFetchOnce({ pois: [], count: 0, limit: 500 })

    await fetchPois(
      { north: 55.5, south: 53, east: 20, west: 12 },
      { type: 'TERMINAL', limit: 500 }
    )

    const url = lastUrl(fetchMock)
    expect(url).toContain('/poi?')
    expect(url).toContain('north=55.5')
    expect(url).toContain('south=53')
    expect(url).toContain('east=20')
    expect(url).toContain('west=12')
    expect(url).toContain('type=TERMINAL')
    expect(url).toContain('limit=500')
  })

  it('omits bounds/type/limit params when not provided', async () => {
    const fetchMock = mockFetchOnce({ pois: [], count: 0, limit: 5000 })

    await fetchPois()

    const url = lastUrl(fetchMock)
    expect(url).toMatch(/\/poi$/)
    expect(url).not.toContain('?')
  })

  it('returns an empty array on 404', async () => {
    mockFetchOnce({}, { ok: false, status: 404 })
    await expect(fetchPois()).resolves.toEqual([])
  })

  it('throws with the API error message on a non-ok response', async () => {
    mockFetchOnce({ error: 'Invalid bounding box values' }, { ok: false, status: 400 })
    await expect(fetchPois()).rejects.toThrow('Invalid bounding box values')
  })

  it('returns an empty array when the response has no pois field', async () => {
    mockFetchOnce({ count: 0, limit: 5000 })
    await expect(fetchPois()).resolves.toEqual([])
  })
})
