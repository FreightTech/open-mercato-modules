import { describe, it, expect, vi, beforeEach } from 'vitest'

const { findOneWithDecryption } = vi.hoisted(() => ({ findOneWithDecryption: vi.fn() }))
vi.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption }))

import { TerminalTrackingService } from '../terminalTrackingService'

const BASE_CONFIG = {
  id: 'cfg-1',
  terminalCode: 'dct',
  adapterType: 'n4',
  displayName: 'Baltic Hub',
  baseUrl: 'https://api2.baltichub.com/V1/',
  endpoints: { unit: '/unit', vessel: '/VESSEL' },
  authType: 'oauth2_password',
  tokenUrl: 'https://token',
  scope: 'scope',
  clientId: 'client',
  proxyUrl: null,
  rateLimitRequests: 200,
  rateLimitWindowSeconds: 60,
  unlocode: 'PLGDN',
  smdgCodes: ['PLGDNDCT'],
  bicCodes: [],
}

function makeService() {
  const captured: { resolved?: { authConfig?: unknown } } = {}
  const adapter = {
    adapterType: 'n4',
    defaultEndpoints: { unit: '/unit', vessel: '/VESSEL' },
    fetchEvents: vi.fn(),
    testConnection: vi.fn(async (resolved: { authConfig?: unknown }) => {
      captured.resolved = resolved
      return { success: true, message: 'ok' }
    }),
  }
  const em = { fork() { return this } }
  const service = new TerminalTrackingService({
    em: () => em as never,
    eventBus: { emit: vi.fn(async () => {}) } as never,
    terminalRegistry: { get: () => adapter } as never,
    cacheService: { get: async () => null, set: async () => {} } as never,
  })
  return { service, captured }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('encrypted object fields re-hydrated after decryption', () => {
  // @open-mercato/shared `decryptFields` returns an encrypted object field as a
  // raw JSON string (it never calls `parseDecryptedFieldValue`). Without the
  // re-hydrate step the adapter reads `authConfig.password` off a string and
  // sends an empty credential — Baltic Hub ROPC then returns `AADB2C90083`.
  it('parses authConfig handed back as a JSON string into an object', async () => {
    findOneWithDecryption.mockResolvedValue({
      ...BASE_CONFIG,
      authConfig: '{"username":"baltic_user","password":"s3cret"}',
    })
    const { service, captured } = makeService()

    await service.testTerminalConfig({ id: 'cfg-1', organizationId: 'org-1', tenantId: 'ten-1' })

    expect(captured.resolved?.authConfig).toEqual({ username: 'baltic_user', password: 's3cret' })
  })

  it('leaves an already-decoded object authConfig unchanged', async () => {
    findOneWithDecryption.mockResolvedValue({
      ...BASE_CONFIG,
      authConfig: { username: 'u', password: 'p' },
    })
    const { service, captured } = makeService()

    await service.testTerminalConfig({ id: 'cfg-1', organizationId: 'org-1', tenantId: 'ten-1' })

    expect(captured.resolved?.authConfig).toEqual({ username: 'u', password: 'p' })
  })
})
