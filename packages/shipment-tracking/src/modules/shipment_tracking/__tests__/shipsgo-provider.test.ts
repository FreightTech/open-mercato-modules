import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TC-TRACK-412 / TC-TRACK-413 — ShipsGoProvider register-then-poll contract.
 *
 * These exercise the fallback provider at the service seam where it is
 * genuinely testable without a live, credit-spending ShipsGo account:
 *
 *   - resolveConfig: per-tenant row (decrypted) vs platform-env fallback, and
 *     the ocean/air enable gates.
 *   - fetchOrRegister: first poll registers + persists provider_shipment_id
 *     (TC-TRACK-412); a subsequent poll with the id already set does NOT
 *     re-register (TC-TRACK-413 — the app-side half of ShipsGo's own 409 dedup).
 *
 * The register/poll HTTP status contract (200/409/402) itself lives in
 * shipsgo-client.test.ts (TC-TRACK-414); the end-to-end ingestion + 402 job
 * error live in shipsgo-poll.test.ts. Here we own the provider's own logic.
 *
 * The network layer (registerOceanShipment/getOceanShipment) and the tenant
 * decryption read (findOneWithDecryption) are mocked; the provider's branching
 * and persistence are the system under test.
 */

// Hoisted so the vi.mock factories (themselves hoisted) can close over them.
const { registerOceanShipment, getOceanShipment, registerAirShipment, getAirShipment, findOneWithDecryption } = vi.hoisted(() => ({
  registerOceanShipment: vi.fn(),
  getOceanShipment: vi.fn(),
  registerAirShipment: vi.fn(),
  getAirShipment: vi.fn(),
  findOneWithDecryption: vi.fn(),
}))

vi.mock('../lib/shipsgo-client', async () => {
  // Preserve the real error classes; only stub the network calls.
  const actual = await vi.importActual<typeof import('../lib/shipsgo-client')>('../lib/shipsgo-client')
  return { ...actual, registerOceanShipment, getOceanShipment, registerAirShipment, getAirShipment }
})

vi.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

// Imported AFTER the mocks are declared so the provider binds the stubs.
import { ShipsGoProvider } from '../services/shipsGoProvider'
import type { TrackingJob } from '../data/entities'

const scope = {
  organizationId: '00000000-0000-0000-0000-000000000002',
  tenantId: '00000000-0000-0000-0000-000000000001',
}

function makeEm() {
  return { flush: vi.fn().mockResolvedValue(undefined) }
}

function makeJob(overrides: Partial<TrackingJob> = {}): TrackingJob {
  return {
    id: 'job-abc',
    ...scope,
    provider: 'shipsgo',
    mode: 'ocean',
    carrierCode: 'shipsgo',
    referenceType: 'booking',
    referenceValue: 'MEDUQY000000',
    providerShipmentId: null,
    ...overrides,
  } as unknown as TrackingJob
}

const OCEAN_SHIPMENT = {
  id: 987654,
  reference: 'job-abc',
  booking_number: 'MEDUQY000000',
  container_number: 'MSCU1234567',
  carrier: { scac: 'MSCU', name: 'MSC', status: 'active' },
  status: 'SAILING',
  containers: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.SHIPSGO_API_TOKEN
  delete process.env.SHIPSGO_BASE_URL
})

describe('ShipsGoProvider.resolveConfig', () => {
  it('prefers an enabled per-tenant row and decrypts the token', async () => {
    findOneWithDecryption.mockResolvedValue({
      apiToken: 'tenant-secret',
      baseUrl: 'https://api.shipsgo.com/v2',
      isEnabled: true,
      isActive: true,
      oceanEnabled: true,
      airEnabled: true,
    })
    const provider = new ShipsGoProvider({ em: () => makeEm() as never })
    const config = await provider.resolveConfig(scope, 'ocean')
    expect(config).toEqual({ apiToken: 'tenant-secret', baseUrl: 'https://api.shipsgo.com/v2' })
  })

  it('falls back to platform env when no tenant row exists', async () => {
    findOneWithDecryption.mockResolvedValue(null)
    process.env.SHIPSGO_API_TOKEN = 'env-secret'
    const provider = new ShipsGoProvider({ em: () => makeEm() as never })
    const config = await provider.resolveConfig(scope, 'ocean')
    expect(config).toEqual({ apiToken: 'env-secret', baseUrl: 'https://api.shipsgo.com/v2' })
  })

  it('returns null when the requested mode is disabled on the tenant row', async () => {
    findOneWithDecryption.mockResolvedValue({
      apiToken: 'tenant-secret',
      baseUrl: 'https://api.shipsgo.com/v2',
      isEnabled: true,
      isActive: true,
      oceanEnabled: false,
      airEnabled: true,
    })
    const provider = new ShipsGoProvider({ em: () => makeEm() as never })
    expect(await provider.resolveConfig(scope, 'ocean')).toBeNull()
  })

  it('returns null when neither a tenant row nor env token is present', async () => {
    findOneWithDecryption.mockResolvedValue(null)
    const provider = new ShipsGoProvider({ em: () => makeEm() as never })
    expect(await provider.resolveConfig(scope, 'ocean')).toBeNull()
  })

  // Regression (H1): a tenant that turned ShipsGo off (or whose row is inactive)
  // must NOT silently fall back to the shared platform account and spend its
  // credits. Only the *absence* of a row reaches the env fallback.
  it('does NOT fall back to the platform env when a disabled tenant row exists', async () => {
    findOneWithDecryption.mockResolvedValue({
      apiToken: 'tenant-secret',
      baseUrl: 'https://api.shipsgo.com/v2',
      isEnabled: false,
      isActive: true,
      oceanEnabled: true,
      airEnabled: true,
    })
    process.env.SHIPSGO_API_TOKEN = 'env-secret'
    const provider = new ShipsGoProvider({ em: () => makeEm() as never })
    expect(await provider.resolveConfig(scope, 'ocean')).toBeNull()
  })

  it('does NOT fall back to the platform env when the tenant row is inactive', async () => {
    findOneWithDecryption.mockResolvedValue({
      apiToken: 'tenant-secret',
      baseUrl: 'https://api.shipsgo.com/v2',
      isEnabled: true,
      isActive: false,
      oceanEnabled: true,
      airEnabled: true,
    })
    process.env.SHIPSGO_API_TOKEN = 'env-secret'
    const provider = new ShipsGoProvider({ em: () => makeEm() as never })
    expect(await provider.resolveConfig(scope, 'air')).toBeNull()
  })
})

describe('ShipsGoProvider.resolveRateLimit', () => {
  it('honors the tenant row rate limit when present', async () => {
    findOneWithDecryption.mockResolvedValue({ rateLimitRequests: 30, rateLimitWindowSeconds: 120 })
    const provider = new ShipsGoProvider({ em: () => makeEm() as never })
    expect(await provider.resolveRateLimit(scope)).toEqual({ requests: 30, windowSeconds: 120 })
  })

  it('falls back to the platform default when no row exists', async () => {
    findOneWithDecryption.mockResolvedValue(null)
    const provider = new ShipsGoProvider({ em: () => makeEm() as never })
    expect(await provider.resolveRateLimit(scope)).toEqual({ requests: 60, windowSeconds: 60 })
  })
})

describe('ShipsGoProvider.resolvePollContext', () => {
  it('reads the config row ONCE and returns config + rate limit together (L2)', async () => {
    findOneWithDecryption.mockResolvedValue({
      apiToken: 'tenant-secret', baseUrl: 'https://api.shipsgo.com/v2',
      isEnabled: true, isActive: true, oceanEnabled: true, airEnabled: true,
      rateLimitRequests: 30, rateLimitWindowSeconds: 120,
    })
    const provider = new ShipsGoProvider({ em: () => makeEm() as never })
    const ctx = await provider.resolvePollContext(scope, 'ocean')
    expect(findOneWithDecryption).toHaveBeenCalledTimes(1)
    expect(ctx.config).toEqual({ apiToken: 'tenant-secret', baseUrl: 'https://api.shipsgo.com/v2' })
    expect(ctx.rateLimit).toEqual({ requests: 30, windowSeconds: 120 })
  })

  it('keys the rate limit on the tenant id for a BYO-token row (L3)', async () => {
    findOneWithDecryption.mockResolvedValue({
      apiToken: 'tenant-secret', baseUrl: 'https://api.shipsgo.com/v2',
      isEnabled: true, isActive: true, oceanEnabled: true, airEnabled: true,
      rateLimitRequests: 60, rateLimitWindowSeconds: 60,
    })
    const provider = new ShipsGoProvider({ em: () => makeEm() as never })
    const ctx = await provider.resolvePollContext(scope, 'ocean')
    expect(ctx.rateLimitIdentity).toBe(scope.tenantId)
  })

  it('shares ONE rate-limit identity across tenants on the platform env account (L3)', async () => {
    findOneWithDecryption.mockResolvedValue(null)
    process.env.SHIPSGO_API_TOKEN = 'env-secret'
    const provider = new ShipsGoProvider({ em: () => makeEm() as never })
    const ctx = await provider.resolvePollContext(scope, 'ocean')
    expect(ctx.config).toEqual({ apiToken: 'env-secret', baseUrl: 'https://api.shipsgo.com/v2' })
    // Not the tenant id — a shared constant, so all env-fallback tenants share one budget.
    expect(ctx.rateLimitIdentity).not.toBe(scope.tenantId)
    expect(ctx.rateLimitIdentity).toBe('shipsgo:platform-shared')
  })
})

describe('ShipsGoProvider.fetchOrRegister', () => {
  beforeEach(() => {
    findOneWithDecryption.mockResolvedValue({
      apiToken: 'tenant-secret',
      baseUrl: 'https://api.shipsgo.com/v2',
      isEnabled: true,
      isActive: true,
      oceanEnabled: true,
      airEnabled: true,
    })
    getOceanShipment.mockResolvedValue(OCEAN_SHIPMENT)
  })

  it('registers on first poll, persisting provider_shipment_id (TC-TRACK-412)', async () => {
    registerOceanShipment.mockResolvedValue({ id: '987654', alreadyExisted: false })
    const em = makeEm()
    const provider = new ShipsGoProvider({ em: () => em as never })
    const job = makeJob({ providerShipmentId: null })

    await provider.fetchOrRegister(job)

    // Booking reference is forwarded; the tracking-job id is the ShipsGo reference.
    expect(registerOceanShipment).toHaveBeenCalledWith(
      { apiToken: 'tenant-secret', baseUrl: 'https://api.shipsgo.com/v2' },
      { reference: 'job-abc', bookingNumber: 'MEDUQY000000', containerNumber: null },
    )
    // Id is persisted immediately (crash-safe) before the fetch.
    expect(job.providerShipmentId).toBe('987654')
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(getOceanShipment).toHaveBeenCalledWith(
      { apiToken: 'tenant-secret', baseUrl: 'https://api.shipsgo.com/v2' },
      '987654',
    )
  })

  it('does NOT re-register when the job already has a provider_shipment_id (TC-TRACK-413)', async () => {
    const em = makeEm()
    const provider = new ShipsGoProvider({ em: () => em as never })
    const job = makeJob({ providerShipmentId: '987654' })

    await provider.fetchOrRegister(job)

    expect(registerOceanShipment).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(getOceanShipment).toHaveBeenCalledWith(expect.anything(), '987654')
  })

  it('accepts a 409-existing registration id transparently (TC-TRACK-413)', async () => {
    registerOceanShipment.mockResolvedValue({ id: '555', alreadyExisted: true })
    getOceanShipment.mockResolvedValue({ ...OCEAN_SHIPMENT, id: 555 })
    const em = makeEm()
    const provider = new ShipsGoProvider({ em: () => em as never })
    const job = makeJob({ providerShipmentId: null })

    await provider.fetchOrRegister(job)

    expect(job.providerShipmentId).toBe('555')
    expect(getOceanShipment).toHaveBeenCalledWith(expect.anything(), '555')
  })

  it('sends the container reference for a container-typed job', async () => {
    registerOceanShipment.mockResolvedValue({ id: '1', alreadyExisted: false })
    const em = makeEm()
    const provider = new ShipsGoProvider({ em: () => em as never })
    const job = makeJob({ referenceType: 'container', referenceValue: 'MSCU1234567', providerShipmentId: null })

    await provider.fetchOrRegister(job)

    expect(registerOceanShipment).toHaveBeenCalledWith(
      expect.anything(),
      { reference: 'job-abc', bookingNumber: null, containerNumber: 'MSCU1234567' },
    )
  })

  it('throws when the tenant has no ShipsGo config (nothing to register against)', async () => {
    findOneWithDecryption.mockResolvedValue(null)
    const provider = new ShipsGoProvider({ em: () => makeEm() as never })
    await expect(provider.fetchOrRegister(makeJob())).rejects.toThrow(/not configured/i)
    expect(registerOceanShipment).not.toHaveBeenCalled()
  })

})

describe('ShipsGoProvider.fetchOrRegister — air (TC-TRACK-416)', () => {
  const AIR_SHIPMENT = {
    id: 55555,
    reference: 'job-air',
    awb_number: '020-12345678',
    airline: { iata: 'LH', name: 'Lufthansa' },
    status: 'EN_ROUTE',
    movements: [],
  }

  beforeEach(() => {
    findOneWithDecryption.mockResolvedValue({
      apiToken: 'tenant-secret',
      baseUrl: 'https://api.shipsgo.com/v2',
      isEnabled: true,
      isActive: true,
      oceanEnabled: true,
      airEnabled: true,
    })
    getAirShipment.mockResolvedValue(AIR_SHIPMENT)
  })

  function makeAirJob(overrides: Partial<TrackingJob> = {}): TrackingJob {
    return makeJob({
      mode: 'air',
      referenceType: 'awb',
      referenceValue: '020-12345678',
      providerShipmentId: null,
      ...overrides,
    })
  }

  it('registers via the air endpoint with the AWB and persists the id', async () => {
    registerAirShipment.mockResolvedValue({ id: '55555', alreadyExisted: false })
    const em = makeEm()
    const provider = new ShipsGoProvider({ em: () => em as never })
    const job = makeAirJob()

    const result = await provider.fetchOrRegister(job)

    expect(registerAirShipment).toHaveBeenCalledWith(
      { apiToken: 'tenant-secret', baseUrl: 'https://api.shipsgo.com/v2' },
      { reference: 'job-abc', awbNumber: '020-12345678' },
    )
    // Ocean endpoint must never be touched for an air job.
    expect(registerOceanShipment).not.toHaveBeenCalled()
    expect(job.providerShipmentId).toBe('55555')
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(getAirShipment).toHaveBeenCalledWith(expect.anything(), '55555')
    expect(result.awbNumber).toBe('020-12345678')
    expect(result.airlineCode).toBe('LH')
    expect(result.airStatus).toBe('EN_ROUTE')
  })

  it('does not re-register an air job that already has a provider id', async () => {
    const em = makeEm()
    const provider = new ShipsGoProvider({ em: () => em as never })
    await provider.fetchOrRegister(makeAirJob({ providerShipmentId: '55555' }))
    expect(registerAirShipment).not.toHaveBeenCalled()
    expect(getAirShipment).toHaveBeenCalledWith(expect.anything(), '55555')
  })

  it('returns null config (and never registers) when air is disabled on the tenant row', async () => {
    findOneWithDecryption.mockResolvedValue({
      apiToken: 'tenant-secret', baseUrl: 'https://api.shipsgo.com/v2', isEnabled: true, isActive: true, oceanEnabled: true, airEnabled: false,
    })
    const provider = new ShipsGoProvider({ em: () => makeEm() as never })
    await expect(provider.fetchOrRegister(makeAirJob())).rejects.toThrow(/not configured/i)
    expect(registerAirShipment).not.toHaveBeenCalled()
  })
})
