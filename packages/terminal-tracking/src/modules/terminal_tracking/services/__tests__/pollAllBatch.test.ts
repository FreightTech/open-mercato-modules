import { describe, it, expect, vi, beforeEach } from 'vitest'

const { checkRateLimit, findOneWithDecryption } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  findOneWithDecryption: vi.fn(),
}))
vi.mock('../../lib/rate-limiter', () => ({ checkRateLimit }))
vi.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption }))

import { TerminalTrackingService } from '../terminalTrackingService'

const CONFIG = {
  terminalCode: 'bct',
  adapterType: 'n4',
  displayName: 'Baltic Hub',
  baseUrl: 'https://api2.baltichub.com/V1/',
  endpoints: { unit: '/unit', vessel: '/VESSEL' },
  authType: 'oauth2_password',
  tokenUrl: null,
  scope: null,
  clientId: null,
  authConfig: null,
  rateLimitRequests: 200,
  rateLimitWindowSeconds: 60,
  unlocode: 'PLGDN',
  smdgCodes: ['GDNBCT'],
  bicCodes: [],
  vesselCacheTtlSeconds: null,
}

// Three containers at one terminal; c1 and c2 share vessel visit A, c3 on B.
const VISIT_BY_CONTAINER: Record<string, string> = {
  C1: '26AAAA001',
  C2: '26AAAA001',
  C3: '26BBBB002',
}

function jobs() {
  return ['C1', 'C2', 'C3'].map((cn, i) => ({
    id: `job-${i + 1}`,
    organizationId: 'org-1',
    tenantId: 'ten-1',
    terminalCode: 'bct',
    containerNumber: cn,
    schedule: null,
    status: 'active',
  }))
}

function makeHarness() {
  const fetchEventsBatch = vi.fn(async ({ containerNumbers }: { containerNumbers: string[] }) => ({
    events: containerNumbers.map((cn) => ({
      source: 'terminal',
      sourceEventId: `bct:${cn}:DEPA`,
      eventType: 'EQUIPMENT',
      eventCode: 'DISC',
      eventClassifierCode: 'ACT',
      eventDateTime: new Date('2026-06-03T01:58:00Z'),
      containerNumber: cn,
      ufvGkey: cn,
      visitRefIn: VISIT_BY_CONTAINER[cn],
      visitRefOut: 'GEN_TRUCK',
      rawData: { Category: 'Import' }, // import leg → vessel on I/B
    })),
  }))
  const fetchVesselVisit = vi.fn(async ({ visitRef }: { visitRef: string }) => ({
    visitRef,
    vesselName: `VESSEL ${visitRef}`,
    ibVoyage: '623N',
    obVoyage: '625S',
    line: 'MAE',
    phase: 'Inbound',
    eta: new Date('2026-06-14T10:00:00Z'),
    etd: null,
    ata: null,
    atd: null,
    beginReceive: null,
    dryCutoff: null,
    rawData: null,
  }))
  const adapter = {
    adapterType: 'n4',
    defaultEndpoints: { unit: '/unit', vessel: '/VESSEL' },
    fetchEvents: vi.fn(),
    fetchEventsBatch,
    fetchVesselVisit,
    testConnection: vi.fn(),
  }

  const em = {
    fork() {
      return this
    },
    async find(_entity: any, where: any) {
      if (where && 'status' in where) return jobs() // due jobs
      return [] // vessel cache miss + no existing events
    },
    create(_entity: any, data: any) {
      return { ...data }
    },
    async flush() {},
  }

  const eventBus = { emit: vi.fn(async () => {}) }
  const service = new TerminalTrackingService({
    em: () => em as never,
    eventBus: eventBus as never,
    terminalRegistry: { get: () => adapter } as never,
    cacheService: { get: async () => null, set: async () => {} } as never,
  })
  return { service, adapter, fetchEventsBatch, fetchVesselVisit, eventBus }
}

beforeEach(() => {
  vi.clearAllMocks()
  checkRateLimit.mockResolvedValue({ allowed: true })
  findOneWithDecryption.mockResolvedValue({ ...CONFIG })
})

describe('pollAllActiveJobs batching', () => {
  it('fetches all containers in one /unit call and resolves each vessel once', async () => {
    const { service, fetchEventsBatch, fetchVesselVisit, eventBus } = makeHarness()

    const res = await service.pollAllActiveJobs('ten-1')

    // One batched /unit call for all three containers.
    expect(fetchEventsBatch).toHaveBeenCalledTimes(1)
    expect(fetchEventsBatch.mock.calls[0][0].containerNumbers).toEqual(['C1', 'C2', 'C3'])

    // Two unique vessel visits (A shared by C1+C2, B for C3) → two fetches.
    expect(fetchVesselVisit).toHaveBeenCalledTimes(2)
    const fetchedRefs = fetchVesselVisit.mock.calls.map((c) => c[0].visitRef).sort()
    expect(fetchedRefs).toEqual(['26AAAA001', '26BBBB002'])

    // One terminal event emitted per container.
    const created = eventBus.emit.mock.calls.filter((c) => c[0] === 'terminal_tracking.terminal_event.created')
    expect(created).toHaveLength(3)
    expect(res).toMatchObject({ polled: 3, newEvents: 3 })
  })

  it('minimises rate-limit spend: 1 unit token + 2 vessel tokens, not 3 unit calls', async () => {
    const { service } = makeHarness()
    await service.pollAllActiveJobs('ten-1')
    // 1 (unit batch) + 2 (unique vessels) = 3 — versus 3 unit + 3 vessel pre-batching.
    expect(checkRateLimit).toHaveBeenCalledTimes(3)
  })
})
