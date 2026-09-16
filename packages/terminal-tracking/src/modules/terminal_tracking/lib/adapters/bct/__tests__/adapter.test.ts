import { describe, it, expect, vi, afterEach } from 'vitest'

// The adapter's fetches run through `n4Request`, which drives undici's `fetch`.
// Mock the undici module, keeping the real ProxyAgent/Agent so the dispatcher is
// built exactly as in production.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('undici', async (orig) => {
  const actual = await orig<typeof import('undici')>()
  return { ...actual, fetch: fetchMock }
})

import { BctTerminalAdapter } from '../adapter'
import type { ResolvedTerminalConfig } from '../../../terminal-adapter'

function cfg(overrides: Partial<ResolvedTerminalConfig> = {}): ResolvedTerminalConfig {
  return {
    terminalCode: 'bct',
    adapterType: 'bct',
    displayName: 'BCT',
    baseUrl: 'https://incos.pl',
    proxyUrl: null,
    endpoints: { unit: '/rest-container/container' },
    authType: 'basic',
    authConfig: { username: 'user', password: 'secret' },
    rateLimitRequests: 60,
    rateLimitWindowSeconds: 60,
    unlocode: 'PLBCT',
    ...overrides,
  }
}

function successResponse(data: Record<string, unknown>) {
  return new Response(JSON.stringify({ data, status: 'SUCCESS' }), { status: 200 })
}
function errorResponse() {
  return new Response(JSON.stringify({ error: { type: 0, message: 'not found' }, status: 'ERROR' }), { status: 200 })
}

const EXPECTED_BASIC = `Basic ${Buffer.from('user:secret', 'utf8').toString('base64')}`

afterEach(() => fetchMock.mockReset())

describe('BctTerminalAdapter.fetchEvents', () => {
  // TC-TRACK-315 (mapping + Authorization header form + URL)
  it('sends HTTP Basic, hits the container path, and maps the snapshot', async () => {
    fetchMock.mockResolvedValueOnce(
      successResponse({
        container_nbr: 'MEDU1221231',
        in_yard_date: '03-05-2020 03:28',
        in_yard_type: 'T',
        category: 'I',
      }),
    )

    const { events } = await new BctTerminalAdapter().fetchEvents({
      containerNumber: 'MEDU1221231',
      config: cfg(),
    })

    expect(events).toHaveLength(1)
    expect(events[0].eventCode).toBe('GTIN')
    expect(events[0].sourceEventId).toBe('bct:MEDU1221231:GTIN')

    const call = fetchMock.mock.calls[0]!
    expect(String(call[0])).toBe('https://incos.pl/rest-container/container/MEDU1221231')
    expect((call[1] as any).method).toBe('GET')
    expect((call[1] as any).headers.Authorization).toBe(EXPECTED_BASIC)
  })

  it('returns [] for an INCOS ERROR envelope (container not found) without throwing', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse())
    const { events } = await new BctTerminalAdapter().fetchEvents({ containerNumber: 'X', config: cfg() })
    expect(events).toEqual([])
  })

  it('throws BctAuthError on a 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
    await expect(
      new BctTerminalAdapter().fetchEvents({ containerNumber: 'X', config: cfg() }),
    ).rejects.toThrow(/unauthorized/)
  })

  it('throws on a non-JSON body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>500</html>', { status: 200 }))
    await expect(
      new BctTerminalAdapter().fetchEvents({ containerNumber: 'X', config: cfg() }),
    ).rejects.toThrow(/valid JSON/)
  })

  it('fails when auth_config is missing credentials, before any request', async () => {
    await expect(
      new BctTerminalAdapter().fetchEvents({ containerNumber: 'X', config: cfg({ authConfig: {} }) }),
    ).rejects.toThrow(/username\/password/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('BctTerminalAdapter.fetchEventsBatch', () => {
  it('loops per container and isolates a single container failure', async () => {
    // container A: 500 → isolated; container B: SUCCESS with a mappable row
    fetchMock.mockResolvedValueOnce(new Response('err', { status: 500 }))
    fetchMock.mockResolvedValueOnce(
      successResponse({ container_nbr: 'B', in_yard_date: '03-05-2020 03:28' }),
    )

    const { events } = await new BctTerminalAdapter().fetchEventsBatch({
      containerNumbers: ['A', 'B'],
      config: cfg(),
    })
    expect(events).toHaveLength(1)
    expect(events[0].containerNumber).toBe('B')
  })

  it('fails the whole batch on an auth error (bad credentials repeat for every container)', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 403 }))
    await expect(
      new BctTerminalAdapter().fetchEventsBatch({ containerNumbers: ['A', 'B'], config: cfg() }),
    ).rejects.toThrow()
  })
})

describe('BctTerminalAdapter.testConnection', () => {
  // TC-TRACK-316
  it('reports success when the probe is reachable and authenticated (ERROR envelope, HTTP 200)', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse())
    const res = await new BctTerminalAdapter().testConnection(cfg())
    expect(res.success).toBe(true)
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'GET' })
    expect((fetchMock.mock.calls[0]![1] as any).headers.Authorization).toBe(EXPECTED_BASIC)
  })

  it('reports failure on a 401/403 without leaking the password', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 401 }))
    const res = await new BctTerminalAdapter().testConnection(cfg())
    expect(res.success).toBe(false)
    expect(res.message).toContain('401')
    expect(res.message).not.toContain('secret')
  })

  it('fails clearly when auth_config is missing credentials', async () => {
    const res = await new BctTerminalAdapter().testConnection(cfg({ authConfig: {} }))
    expect(res.success).toBe(false)
    expect(res.message).toMatch(/username\/password/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('BctTerminalAdapter.fetchVesselVisit', () => {
  const vesselCfg = () => cfg({ endpoints: { unit: '/rest-container/container', vessel: '/rest-vesselvisit/vesselvisit' } })
  function vesselResponse(data: Record<string, unknown>) {
    return new Response(JSON.stringify({ data, status: 'SUCCESS' }), { status: 200 })
  }

  // TC-TRACK-321: splits CODE/VOY into the path and maps the visit.
  it('GETs {base}/{code}/{voyage} with Basic auth and normalizes the visit', async () => {
    fetchMock.mockResolvedValueOnce(
      vesselResponse({
        vessel_code: 'MSADMIR',
        vessel_name: 'ADMIRAL NEPTUNE (MSC)',
        in_voy: 'EO630R',
        out_voy: 'EO630R',
        line_code: 'MSC',
        eta: '2026-08-13 18:00:00',
        ata: '2026-08-13 18:55:00',
      }),
    )
    const visit = await new BctTerminalAdapter().fetchVesselVisit({ visitRef: 'MSADMIR/EO630R', config: vesselCfg() })
    expect(visit).not.toBeNull()
    expect(visit!.vesselName).toBe('ADMIRAL NEPTUNE (MSC)')
    // 18:00 terminal-local (Europe/Warsaw, CEST +02:00) → 16:00 UTC.
    expect(visit!.eta?.toISOString()).toBe('2026-08-13T16:00:00.000Z')

    const call = fetchMock.mock.calls[0]!
    expect(String(call[0])).toBe('https://incos.pl/rest-vesselvisit/vesselvisit/MSADMIR/EO630R')
    expect((call[1] as any).headers.Authorization).toBe(EXPECTED_BASIC)
  })

  it('returns null for a malformed ref without any request', async () => {
    const visit = await new BctTerminalAdapter().fetchVesselVisit({ visitRef: 'EO630R', config: vesselCfg() })
    expect(visit).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null on an ERROR envelope (unknown visit / rate limit)', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse())
    const visit = await new BctTerminalAdapter().fetchVesselVisit({ visitRef: 'MSADMIR/EO630R', config: vesselCfg() })
    expect(visit).toBeNull()
  })

  it('throws BctAuthError on a 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 401 }))
    await expect(
      new BctTerminalAdapter().fetchVesselVisit({ visitRef: 'MSADMIR/EO630R', config: vesselCfg() }),
    ).rejects.toThrow(/unauthorized/)
  })
})
