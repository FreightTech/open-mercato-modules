import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  registerOceanShipment,
  getOceanShipment,
  registerAirShipment,
  ShipsGoCreditsExhaustedError,
  ShipsGoAuthError,
  ShipsGoRateLimitedError,
  ShipsGoApiError,
  normalizeAwbNumber,
  type ShipsGoClientConfig,
} from '../lib/shipsgo-client'

/**
 * TC-TRACK-414 — ShipsGo client register/fetch handling.
 *
 * Covers the credit/idempotency contract: 200 (created), 409 (already exists →
 * free, same id), 402 (credits exhausted → typed error, never retried).
 */

const config: ShipsGoClientConfig = {
  apiToken: 'test-token',
  baseUrl: 'https://api.shipsgo.com/v2',
}

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('registerOceanShipment', () => {
  it('returns the id on 200 (created, credit spent)', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { message: 'SUCCESS', shipment: { id: 777 } }))
    const result = await registerOceanShipment(config, { reference: 'job-1', bookingNumber: 'BK123' })
    expect(result).toEqual({ id: '777', alreadyExisted: false })
  })

  it('treats 409 as success and returns the existing id (no charge)', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { message: 'ALREADY_EXISTS', shipment: { id: 555 } }))
    const result = await registerOceanShipment(config, { reference: 'job-1', bookingNumber: 'BK123' })
    expect(result).toEqual({ id: '555', alreadyExisted: true })
  })

  it('throws ShipsGoCreditsExhaustedError on 402', async () => {
    vi.stubGlobal('fetch', mockFetch(402, { message: 'PAYMENT_REQUIRED' }))
    await expect(
      registerOceanShipment(config, { reference: 'job-1', bookingNumber: 'BK123' }),
    ).rejects.toBeInstanceOf(ShipsGoCreditsExhaustedError)
  })

  it('sends booking_number and the job id as reference, omitting carrier when unset', async () => {
    const fetchMock = mockFetch(200, { message: 'SUCCESS', shipment: { id: 1 } })
    vi.stubGlobal('fetch', fetchMock)
    await registerOceanShipment(config, { reference: 'job-42', bookingNumber: 'BK999' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.shipsgo.com/v2/ocean/shipments')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Shipsgo-User-Token']).toBe('test-token')
    const payload = JSON.parse(init.body as string)
    expect(payload).toEqual({ reference: 'job-42', booking_number: 'BK999' })
    expect(payload).not.toHaveProperty('carrier')
  })

  it('throws ShipsGoApiError on other non-2xx', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { message: 'ERROR' }))
    await expect(
      registerOceanShipment(config, { reference: 'job-1', containerNumber: 'MSCU1234567' }),
    ).rejects.toBeInstanceOf(ShipsGoApiError)
  })
})

describe('getOceanShipment', () => {
  it('unwraps the shipment envelope', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { shipment: { id: 5, container_number: 'MSCU1' } }))
    const shipment = await getOceanShipment(config, '5')
    expect(shipment.id).toBe(5)
    expect(shipment.container_number).toBe('MSCU1')
  })
})

/**
 * Account-level HTTP conditions (403 auth, 429 rate limit) must surface as their
 * own typed errors on BOTH register and GET, so the poll loop backs the job off
 * instead of burning its retry budget (like it already does for 402).
 */
function mockFetchWithHeaders(status: number, body: unknown, headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response)
}

describe('account-level errors (403 / 429)', () => {
  it('throws ShipsGoAuthError on 403 (register)', async () => {
    vi.stubGlobal('fetch', mockFetchWithHeaders(403, { message: 'FORBIDDEN' }))
    await expect(
      registerOceanShipment(config, { reference: 'job-1', bookingNumber: 'BK123' }),
    ).rejects.toBeInstanceOf(ShipsGoAuthError)
  })

  it('throws ShipsGoAuthError on 403 (GET)', async () => {
    vi.stubGlobal('fetch', mockFetchWithHeaders(403, { message: 'FORBIDDEN' }))
    await expect(getOceanShipment(config, '5')).rejects.toBeInstanceOf(ShipsGoAuthError)
  })

  it('throws ShipsGoRateLimitedError on 429 with retryAfter from RateLimit-Reset', async () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 42
    vi.stubGlobal('fetch', mockFetchWithHeaders(429, { message: 'TOO_MANY' }, { 'RateLimit-Reset': String(resetEpoch) }))
    const err = await registerOceanShipment(config, { reference: 'job-1', bookingNumber: 'BK123' }).catch((e) => e)
    expect(err).toBeInstanceOf(ShipsGoRateLimitedError)
    expect((err as ShipsGoRateLimitedError).retryAfterSeconds).toBeGreaterThan(0)
    expect((err as ShipsGoRateLimitedError).retryAfterSeconds).toBeLessThanOrEqual(42)
  })

  it('429 without a reset header still throws (undefined retryAfter)', async () => {
    vi.stubGlobal('fetch', mockFetchWithHeaders(429, { message: 'TOO_MANY' }))
    const err = await getOceanShipment(config, '5').catch((e) => e)
    expect(err).toBeInstanceOf(ShipsGoRateLimitedError)
    expect((err as ShipsGoRateLimitedError).retryAfterSeconds).toBeUndefined()
  })
})

describe('normalizeAwbNumber', () => {
  it('hyphenates a bare 11-digit AWB', () => {
    expect(normalizeAwbNumber('33388888888')).toBe('333-88888888')
  })
  it('normalizes spaced/hyphenated input to NNN-NNNNNNNN', () => {
    expect(normalizeAwbNumber('333 8888 8888')).toBe('333-88888888')
    expect(normalizeAwbNumber('333-88888888')).toBe('333-88888888')
  })
  it('leaves a non-11-digit value untouched (ShipsGo returns the authoritative error)', () => {
    expect(normalizeAwbNumber('NOT-AN-AWB')).toBe('NOT-AN-AWB')
  })
  it('registerAirShipment sends the normalized awb_number', async () => {
    const fetchMock = mockFetch(200, { message: 'SUCCESS', shipment: { id: 9 } })
    vi.stubGlobal('fetch', fetchMock)
    await registerAirShipment(config, { reference: 'job-air', awbNumber: '020 1234 5678' })
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(payload.awb_number).toBe('020-12345678')
  })
})
