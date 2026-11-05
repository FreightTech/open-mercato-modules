import { describe, it, expect, vi, afterEach } from 'vitest'
import { TrackingService } from '../services/trackingService'
import { CarrierPermissionDeniedError } from '../lib/carrier-adapter'
import { CoscoAdapter } from '../lib/adapters/cosco'

/**
 * Permission-denied handling (pollTrackingJob).
 *
 * When a carrier POSITIVELY denies access to a reference's data — valid
 * credentials, booking not under this account/profile (e.g. CargoSmart EWS404
 * "User does not have permission to access", EWS102 "not registered") — retrying
 * can never return data. The job is PAUSED (resumable) on the first occurrence so
 * it leaves the active-only poll filter and stops spending request quota. The
 * retry budget is untouched and the transition emits permission_denied once.
 *
 * TC-TRACK-PERM-001 — adapter throws → job paused, retry untouched, event once, no re-emit.
 * TC-TRACK-PERM-002/003 — CoscoAdapter maps EWS404 / EWS102 → CarrierPermissionDeniedError.
 * TC-TRACK-PERM-004 — a non-permission Cosco error stays a plain error (retryable).
 */

const scope = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}

function createMockEm() {
  const jobs = new Map<string, any>()
  const em: any = {
    findOne: vi.fn(async (Entity: any, filter: any) => {
      const name = typeof Entity === 'function' ? Entity.name : Entity?.name
      return name === 'TrackingJob' ? (jobs.get(filter.id) ?? null) : null
    }),
    find: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    create: vi.fn((_E: any, data: any) => ({ ...data })),
    persist: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn(),
  }
  return { em, jobs }
}

function makeService() {
  const { em, jobs } = createMockEm()
  const emitted: Array<{ event: string; payload: any }> = []
  const adapter = {
    carrierCode: 'cosco',
    supportedReferenceTypes: ['container', 'booking', 'bol'],
    fetchEvents: vi.fn(async () => {
      throw new CarrierPermissionDeniedError({ carrierCode: 'cosco', referenceType: 'booking', referenceValue: '6463118490' })
    }),
    testConnection: vi.fn(),
  }
  const service = new TrackingService({
    em: () => em,
    eventBus: { emit: vi.fn((event: string, payload: any) => { emitted.push({ event, payload }); return Promise.resolve() }), on: vi.fn() } as any,
    carrierRegistry: { get: (code: string) => (code === 'cosco' ? adapter : undefined) } as any,
    cacheService: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn(), incr: vi.fn() } as any,
    webhookService: { dispatchEvent: vi.fn(), dispatchWithRetry: vi.fn(), buildFullShipmentPayload: vi.fn() } as any,
  })
  const job: any = {
    id: 'job-1', ...scope, carrierCode: 'cosco', referenceType: 'booking', referenceValue: '6463118490',
    status: 'active', retryCount: 0, notFoundCount: 0, notFoundSince: null,
    createdAt: new Date(), nextPollAt: new Date(),
    shipments: { set: vi.fn(), getItems: () => [] }, events: { set: vi.fn(), getItems: () => [] }, deletedAt: null,
  }
  jobs.set(job.id, job)
  return { service, job, emitted }
}

const PERM = 'shipment_tracking.tracking_job.permission_denied'

describe('permission-denied handling (pollTrackingJob)', () => {
  it('TC-TRACK-PERM-001: pauses the job, keeps the retry budget, emits once', async () => {
    const { service, job, emitted } = makeService()

    await service.pollTrackingJob(job.id)

    expect(job.status).toBe('paused') // NOT 'failed', NOT 'active'
    expect(job.retryCount).toBe(0) // retry budget untouched
    expect(job.nextPollAt).toBeNull() // unscheduled
    const perm = emitted.filter((e) => e.event === PERM)
    expect(perm).toHaveLength(1)
    expect(perm[0].payload).toMatchObject({
      id: job.id, carrierCode: 'cosco', referenceType: 'booking', referenceValue: '6463118490',
      tenantId: scope.tenantId, organizationId: scope.organizationId,
    })

    // A second poll (e.g. via a reuse path) must NOT re-emit while already paused.
    await service.pollTrackingJob(job.id)
    expect(emitted.filter((e) => e.event === PERM)).toHaveLength(1)
    expect(job.retryCount).toBe(0)
  })
})

describe('CoscoAdapter permission classification', () => {
  const authConfig = { app_key: 'k', scac_code: 'COSU', customer_id: 'c' }
  const adapter = new CoscoAdapter()
  const mockFetch = (body: unknown) =>
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: true, status: 200, json: async () => body } as any)

  afterEach(() => vi.restoreAllMocks())

  it('TC-TRACK-PERM-002: EWS404 → CarrierPermissionDeniedError', async () => {
    mockFetch({ errors: [{ errorCode: 'EWS404', errorDescription: 'User does not have permission to access.' }] })
    await expect(adapter.fetchEvents({ referenceType: 'booking', referenceValue: '6463118490', apiEndpoint: 'https://x', authConfig }))
      .rejects.toBeInstanceOf(CarrierPermissionDeniedError)
  })

  it('TC-TRACK-PERM-003: EWS102 (not registered) → CarrierPermissionDeniedError', async () => {
    mockFetch({ errors: [{ errorCode: 'EWS102', errorDescription: 'User is not registered with the carrier' }] })
    await expect(adapter.fetchEvents({ referenceType: 'booking', referenceValue: '123', apiEndpoint: 'https://x', authConfig }))
      .rejects.toBeInstanceOf(CarrierPermissionDeniedError)
  })

  it('TC-TRACK-PERM-004: a non-permission error stays a plain (retryable) error', async () => {
    mockFetch({ errors: [{ errorCode: 'EWS999', errorDescription: 'Problem encountered during processing' }] })
    await expect(adapter.fetchEvents({ referenceType: 'booking', referenceValue: '123', apiEndpoint: 'https://x', authConfig }))
      .rejects.not.toBeInstanceOf(CarrierPermissionDeniedError)
  })
})
