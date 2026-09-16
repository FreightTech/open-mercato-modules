import { describe, it, expect, vi, afterEach } from 'vitest'

// The adapter's fetches run through `n4Request`, which drives undici's `fetch`
// (same instance as the dispatcher). Mock the undici module, keeping the real
// ProxyAgent/Agent so `dispatcher` is built exactly as in production.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('undici', async (orig) => {
  const actual = await orig<typeof import('undici')>()
  return { ...actual, fetch: fetchMock }
})

import { N4TerminalAdapter } from '../adapter'
import type { ResolvedTerminalConfig } from '../../../terminal-adapter'

let counter = 0
function cfg(proxyUrl: string | null): ResolvedTerminalConfig {
  // Unique terminalCode per config to bypass the process-level token cache.
  return {
    terminalCode: `proxytest-${counter++}`,
    adapterType: 'n4',
    displayName: 'x',
    baseUrl: 'https://api2.baltichub.com/V1/',
    proxyUrl,
    endpoints: { unit: '/unit', vessel: '/VESSEL' },
    authType: 'oauth2_password',
    tokenUrl: 'https://token.example/token',
    clientId: 'c',
    authConfig: { username: 'u', password: 'p' },
    rateLimitRequests: 200,
    rateLimitWindowSeconds: 60,
  }
}

function stubFetch() {
  fetchMock.mockImplementation(async (_url: string | URL, init?: any) => {
    if (init?.method === 'POST') {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
    }
    return new Response(
      JSON.stringify({ 'query-response': { 'data-table': { columns: { column: [] }, rows: null } } }),
      { status: 200 },
    )
  })
  return fetchMock
}

afterEach(() => fetchMock.mockReset())

describe('N4 adapter proxy dispatcher', () => {
  it('attaches a dispatcher to the API + token fetches when proxyUrl is set', async () => {
    stubFetch()
    await new N4TerminalAdapter().fetchVesselVisit({ visitRef: '26AAA1', config: cfg('http://127.0.0.1:8888') })

    const vesselCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/VESSEL'))
    const tokenCall = fetchMock.mock.calls.find((c) => (c[1] as any)?.method === 'POST')
    expect(vesselCall?.[1]?.dispatcher).toBeDefined()
    expect(tokenCall?.[1]?.dispatcher).toBeDefined()
  })

  it('uses no dispatcher when proxyUrl is null (direct)', async () => {
    stubFetch()
    await new N4TerminalAdapter().fetchVesselVisit({ visitRef: '26BBB2', config: cfg(null) })

    const vesselCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/VESSEL'))
    const tokenCall = fetchMock.mock.calls.find((c) => (c[1] as any)?.method === 'POST')
    expect(vesselCall?.[1]?.dispatcher).toBeUndefined()
    expect(tokenCall?.[1]?.dispatcher).toBeUndefined()
  })
})
