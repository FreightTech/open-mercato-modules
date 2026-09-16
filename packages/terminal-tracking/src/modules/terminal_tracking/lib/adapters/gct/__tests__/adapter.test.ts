import { describe, it, expect, vi, afterEach } from 'vitest'

// The adapter's fetches run through `n4Request`, which drives undici's `fetch`.
// Mock the undici module, keeping the real ProxyAgent/Agent so the dispatcher is
// built exactly as in production.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('undici', async (orig) => {
  const actual = await orig<typeof import('undici')>()
  return { ...actual, fetch: fetchMock }
})

import { GctTerminalAdapter } from '../adapter'
import type { ResolvedTerminalConfig } from '../../../terminal-adapter'

let counter = 0
function cfg(overrides: Partial<ResolvedTerminalConfig> = {}): ResolvedTerminalConfig {
  // Unique terminalCode per config to bypass the process-level token cache.
  return {
    terminalCode: `gcttest-${counter++}`,
    adapterType: 'gct',
    displayName: 'GCT',
    baseUrl: 'https://api.gct.example',
    proxyUrl: null,
    endpoints: { unit: '/gctapi/GetContainerDetails' },
    authType: 'gct_token',
    // Authenticator secret (base32) — GCT's login takes a TOTP code as password.
    // `JBSWY3DPEHPK3PXP` is the canonical RFC test seed ("Hello!").
    authConfig: { companyCode: 'ACME', loginName: 'user', totpSecret: 'JBSWY3DPEHPK3PXP' },
    rateLimitRequests: 60,
    rateLimitWindowSeconds: 60,
    unlocode: 'PLGDY',
    ...overrides,
  }
}

const FUTURE = '2999-01-01T00:00:00Z'
const PAST = '2000-01-01T00:00:00Z'

function tokenResponse(token = 'tok-123', expires: string = FUTURE) {
  return new Response(JSON.stringify({ token, token_type: 'Bearer', expires }), { status: 200 })
}
function detailsResponse(containers: unknown[]) {
  return new Response(JSON.stringify({ Total: containers.length, Containers: containers }), { status: 200 })
}

const isAuthCall = (c: any[]) => (c[1] as any)?.method === 'GET'
const isDetailsCall = (c: any[]) => (c[1] as any)?.method === 'POST'
// Mint (full auth) vs refresh (keep-alive) are both GET — tell them apart by URL.
const isMintCall = (c: any[]) => String(c[0]).includes('/gctapi/Auth')
const isRefreshCall = (c: any[]) => String(c[0]).includes('/gctapi/ping')

afterEach(() => fetchMock.mockReset())

describe('GctTerminalAdapter.testConnection', () => {
  // TC-TRACK-301
  it('mints a token and reports success; a generated TOTP code goes in the path, token in the Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('abc'))
    const config = cfg()
    const res = await new GctTerminalAdapter().testConnection(config)

    expect(res.success).toBe(true)
    const authCall = fetchMock.mock.calls.find(isAuthCall)!
    // company/login in the path; the password segment is a fresh 6-digit TOTP code.
    expect(String(authCall[0])).toMatch(/\/gctapi\/Auth\/ACME\/user\/\d{6}$/)
    // The raw authenticator secret must NEVER appear in the URL — only the code.
    expect(String(authCall[0])).not.toContain('JBSWY3DPEHPK3PXP')
  })

  it('honours a legacy static loginPassword when no totpSecret is configured', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('abc'))
    const config = cfg({ authConfig: { companyCode: 'ACME', loginName: 'user', loginPassword: 'legacy-pass' } })
    const res = await new GctTerminalAdapter().testConnection(config)

    expect(res.success).toBe(true)
    const authCall = fetchMock.mock.calls.find(isAuthCall)!
    expect(String(authCall[0])).toContain('/gctapi/Auth/ACME/user/legacy-pass')
  })

  it('reports failure with only the status (never the secret) on a bad token', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 403 }))
    const res = await new GctTerminalAdapter().testConnection(cfg())
    expect(res.success).toBe(false)
    expect(res.message).toContain('403')
    expect(res.message).not.toContain('JBSWY3DPEHPK3PXP')
  })

  it('fails clearly when auth_config is missing credentials', async () => {
    const res = await new GctTerminalAdapter().testConnection(cfg({ authConfig: {} }))
    expect(res.success).toBe(false)
    expect(res.message).toMatch(/companyCode|totpSecret/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('GctTerminalAdapter.fetchEvents', () => {
  // TC-TRACK-306 (mapping + Authorization header form)
  it('replays the raw token in the Authorization header and maps the container', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('tok-xyz'))
    fetchMock.mockResolvedValueOnce(
      detailsResponse([{ CntrID: 'GCTU1234567', VisitNo: 'V9', GroundingDateTime: '2026-08-10T09:30:00Z' }]),
    )

    const { events } = await new GctTerminalAdapter().fetchEvents({
      containerNumber: 'GCTU1234567',
      config: cfg(),
    })

    expect(events).toHaveLength(1)
    expect(events[0].sourceEventId).toBe(events[0].sourceEventId) // stable
    expect(events[0].eventCode).toBe('GTIN')

    const detailsCall = fetchMock.mock.calls.find(isDetailsCall)!
    expect((detailsCall[1] as any).headers.Authorization).toBe('tok-xyz')
    expect(JSON.parse((detailsCall[1] as any).body)).toMatchObject({ CntrID: 'GCTU1234567' })
  })

  // TC-TRACK-309
  it('returns [] for an empty/malformed Containers payload without throwing', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse())
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ Total: 0 }), { status: 200 }))
    const { events } = await new GctTerminalAdapter().fetchEvents({ containerNumber: 'X', config: cfg() })
    expect(events).toEqual([])
  })

  it('throws on a non-JSON details body', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse())
    fetchMock.mockResolvedValueOnce(new Response('<html>500</html>', { status: 200 }))
    await expect(
      new GctTerminalAdapter().fetchEvents({ containerNumber: 'X', config: cfg() }),
    ).rejects.toThrow(/valid JSON/)
  })
})

describe('GctTerminalAdapter token cache + 401 handling', () => {
  // TC-TRACK-305
  it('reuses the cached token across calls, then re-acquires after a 401', async () => {
    const config = cfg()
    // 1st fetchEvents: token GET + details POST(200)
    fetchMock.mockResolvedValueOnce(tokenResponse('t1'))
    fetchMock.mockResolvedValueOnce(detailsResponse([]))
    await new GctTerminalAdapter().fetchEvents({ containerNumber: 'A', config })
    expect(fetchMock.mock.calls.filter(isAuthCall)).toHaveLength(1)

    // 2nd fetchEvents: cache hit (no new token GET) + details POST that 401s
    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
    await expect(
      new GctTerminalAdapter().fetchEvents({ containerNumber: 'A', config }),
    ).rejects.toThrow(/401/)
    expect(fetchMock.mock.calls.filter(isAuthCall)).toHaveLength(1) // still cached until invalidated

    // 3rd fetchEvents: the 401 invalidated the cache, so a fresh token is minted
    fetchMock.mockResolvedValueOnce(tokenResponse('t2'))
    fetchMock.mockResolvedValueOnce(detailsResponse([]))
    await new GctTerminalAdapter().fetchEvents({ containerNumber: 'A', config })
    expect(fetchMock.mock.calls.filter(isAuthCall)).toHaveLength(2)
  })
})

describe('GctTerminalAdapter token refresh (keep-alive)', () => {
  // TC-TRACK-307 — an expired token is refreshed via /gctapi/ping, not re-minted.
  it('refreshes an expired token via /gctapi/ping instead of re-authenticating', async () => {
    const config = cfg()
    // 1st fetchEvents mints a token that is ALREADY expired (past `expires`).
    fetchMock.mockResolvedValueOnce(tokenResponse('t-mint', PAST))
    fetchMock.mockResolvedValueOnce(detailsResponse([]))
    await new GctTerminalAdapter().fetchEvents({ containerNumber: 'A', config })

    // 2nd fetchEvents: token is stale → keep-alive refresh returns a fresh token.
    fetchMock.mockResolvedValueOnce(tokenResponse('t-refreshed', FUTURE)) // ping
    fetchMock.mockResolvedValueOnce(detailsResponse([]))
    await new GctTerminalAdapter().fetchEvents({ containerNumber: 'A', config })

    expect(fetchMock.mock.calls.filter(isRefreshCall)).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(isMintCall)).toHaveLength(1) // no re-auth
    const details = fetchMock.mock.calls.filter(isDetailsCall)
    expect((details[1][1] as any).headers.Authorization).toBe('t-refreshed')
  })

  // TC-TRACK-308 — a failed refresh falls back to a full re-authentication.
  it('re-authenticates when the refresh call fails', async () => {
    const config = cfg()
    fetchMock.mockResolvedValueOnce(tokenResponse('t1', PAST)) // mint (already expired)
    fetchMock.mockResolvedValueOnce(detailsResponse([]))
    await new GctTerminalAdapter().fetchEvents({ containerNumber: 'A', config })

    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 })) // ping fails
    fetchMock.mockResolvedValueOnce(tokenResponse('t2', FUTURE)) // re-auth mint
    fetchMock.mockResolvedValueOnce(detailsResponse([]))
    await new GctTerminalAdapter().fetchEvents({ containerNumber: 'A', config })

    expect(fetchMock.mock.calls.filter(isRefreshCall)).toHaveLength(1) // tried once
    expect(fetchMock.mock.calls.filter(isMintCall)).toHaveLength(2) // initial + re-auth
    const details = fetchMock.mock.calls.filter(isDetailsCall)
    expect((details[1][1] as any).headers.Authorization).toBe('t2')
  })

  it('re-authenticates when the refresh response carries no token', async () => {
    const config = cfg()
    fetchMock.mockResolvedValueOnce(tokenResponse('t1', PAST))
    fetchMock.mockResolvedValueOnce(detailsResponse([]))
    await new GctTerminalAdapter().fetchEvents({ containerNumber: 'A', config })

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 })) // ping, no token
    fetchMock.mockResolvedValueOnce(tokenResponse('t2', FUTURE))
    fetchMock.mockResolvedValueOnce(detailsResponse([]))
    await new GctTerminalAdapter().fetchEvents({ containerNumber: 'A', config })

    expect(fetchMock.mock.calls.filter(isRefreshCall)).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(isMintCall)).toHaveLength(2)
  })
})

describe('GctTerminalAdapter.fetchEventsBatch', () => {
  it('loops per container and isolates a single container failure', async () => {
    const config = cfg()
    fetchMock.mockResolvedValueOnce(tokenResponse()) // up-front acquire
    // container A (token cached now): details 500 → isolated
    fetchMock.mockResolvedValueOnce(new Response('err', { status: 500 }))
    // container B: details 200 with a mappable row
    fetchMock.mockResolvedValueOnce(
      detailsResponse([{ CntrID: 'B', VisitNo: 'VB', GroundingDateTime: '2026-08-10T09:30:00Z' }]),
    )

    const { events } = await new GctTerminalAdapter().fetchEventsBatch({
      containerNumbers: ['A', 'B'],
      config,
    })
    expect(events).toHaveLength(1)
    expect(events[0].containerNumber).toBe('B')
  })

  it('fails the whole batch when the up-front token acquire fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 403 }))
    await expect(
      new GctTerminalAdapter().fetchEventsBatch({ containerNumbers: ['A', 'B'], config: cfg() }),
    ).rejects.toThrow()
  })
})
