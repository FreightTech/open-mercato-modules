import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the rate limiter and the decryption-aware config lookup so we can drive
// the orchestration without a DB. Hoisted so the vi.mock factories can see them.
const { checkRateLimit, findOneWithDecryption } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  findOneWithDecryption: vi.fn(),
}))
vi.mock('../../lib/rate-limiter', () => ({ checkRateLimit }))
vi.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption }))

import { TerminalTrackingService } from '../terminalTrackingService'

const JOB = {
  id: 'job-1',
  organizationId: 'org-1',
  tenantId: 'ten-1',
  terminalCode: 'bct',
  containerNumber: 'GCXU5598460',
  schedule: null,
  status: 'active',
}

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

// One active import leg (DISC): vessel on the inbound side (visitRefIn); O/B is a truck.
const FETCHED_EVENT = {
  source: 'terminal',
  sourceEventId: 'bct:11341499051:DISC',
  eventType: 'EQUIPMENT',
  eventCode: 'DISC',
  eventClassifierCode: 'ACT',
  eventDateTime: new Date('2026-06-03T01:58:00Z'),
  containerNumber: 'GCXU5598460',
  ufvGkey: '11341499051',
  visitRefIn: '26GIRO622',
  visitRefOut: 'POS75955',
  rawData: { Category: 'Import' }, // import leg → vessel on I/B
}

const FETCHED_VISIT = {
  visitRef: '26GIRO622',
  vesselName: 'MAERSK NUBA',
  ibVoyage: '623N',
  obVoyage: '625S',
  line: 'MAE',
  phase: 'Inbound',
  eta: new Date('2026-06-14T10:00:00Z'),
  etd: new Date('2026-06-15T18:00:00Z'),
  ata: null,
  atd: null,
  beginReceive: new Date('2026-06-07T10:00:00Z'),
  dryCutoff: null,
  rawData: { Line: 'MAE' },
}

// A stored TerminalEvent whose container signature matches FETCHED_EVENT once
// enriched (vessel on the I/B side). Override fields to force a change.
function storedEvent(overrides: Record<string, any> = {}) {
  return {
    id: 'evt-1',
    job: { id: 'job-1' },
    tenantId: 'ten-1',
    organizationId: 'org-1',
    source: 'terminal',
    sourceEventId: 'bct:11341499051:DISC',
    eventType: 'EQUIPMENT',
    eventCode: 'DISC',
    eventClassifierCode: 'ACT',
    eventDateTime: new Date('2026-06-03T01:58:00Z'),
    containerNumber: 'GCXU5598460',
    ufvGkey: '11341499051',
    transitState: null,
    visitState: null,
    facilityCode: null,
    facilityCodeListProvider: null,
    unlocode: null,
    visitRefIn: '26GIRO622',
    visitRefOut: 'POS75955',
    vesselName: 'MAERSK NUBA',
    voyageNumber: '623N',
    modeOfTransport: null,
    seals: null,
    vgmWeightKg: null,
    impediments: null,
    rawData: null,
    ...overrides,
  }
}

function makeHarness(opts: { vesselRows?: any[]; events?: any[]; existingEvents?: any[]; job?: any } = {}) {
  // Model /VESSEL: real vessel visits (NN<letters>…) return data; gate/truck
  // refs return null (empty envelope).
  const fetchVesselVisit = vi.fn(async ({ visitRef }: { visitRef: string }) =>
    /^\d{2}[A-Z]/.test(visitRef) ? { ...FETCHED_VISIT, visitRef } : null,
  )
  const events = opts.events ?? [{ ...FETCHED_EVENT }]
  const adapter = {
    adapterType: 'n4',
    defaultEndpoints: { unit: '/unit', vessel: '/VESSEL' },
    fetchEvents: vi.fn(async () => ({ containerNumber: JOB.containerNumber, events })),
    fetchVesselVisit,
    testConnection: vi.fn(),
  }

  const job: any = { ...JOB, ...(opts.job ?? {}) }
  const em = {
    fork() {
      return this
    },
    async findOne() {
      return job
    },
    async find(_entity: any, where: any) {
      // Vessel-visit cache lookup carries a `visitRef` filter; the persistEvents
      // existing-events lookup carries `sourceEventId`.
      if (where && 'visitRef' in where) return opts.vesselRows ?? []
      if (where && 'sourceEventId' in where) return opts.existingEvents ?? []
      return []
    },
    create(_entity: any, data: any) {
      return { ...data }
    },
    async flush() {},
  }

  const eventBus = { emit: vi.fn(async () => {}) }
  const terminalRegistry = { get: () => adapter }
  const cacheService = { get: async () => null, set: async () => {} }

  const service = new TerminalTrackingService({
    em: () => em as never,
    eventBus: eventBus as never,
    terminalRegistry: terminalRegistry as never,
    cacheService: cacheService as never,
  })

  return { service, adapter, eventBus, fetchVesselVisit, job }
}

function createdPayload(eventBus: { emit: ReturnType<typeof vi.fn> }) {
  const call = eventBus.emit.mock.calls.find((c) => c[0] === 'terminal_tracking.terminal_event.created')
  return call?.[1] as any
}

function emitted(eventBus: { emit: ReturnType<typeof vi.fn> }, id: string) {
  return eventBus.emit.mock.calls.filter((c) => c[0] === id)
}
function updatedPayload(eventBus: { emit: ReturnType<typeof vi.fn> }) {
  return emitted(eventBus, 'terminal_tracking.terminal_event.updated')[0]?.[1] as any
}

beforeEach(() => {
  vi.clearAllMocks()
  checkRateLimit.mockResolvedValue({ allowed: true })
  findOneWithDecryption.mockResolvedValue({ ...CONFIG })
})

describe('vessel enrichment in pollJob', () => {
  it('fetches and nests the vessel visit, with the direction-correct voyage', async () => {
    const { service, fetchVesselVisit, eventBus } = makeHarness({ vesselRows: [] })

    const res = await service.pollJob('job-1')
    expect(res.newEvents).toBe(1)
    expect(fetchVesselVisit).toHaveBeenCalledTimes(1)

    const payload = createdPayload(eventBus)
    expect(payload.vesselName).toBe('MAERSK NUBA')
    expect(payload.voyageNumber).toBe('623N') // import leg → inbound voyage
    expect(payload.vesselVisit).toMatchObject({
      visitRef: '26GIRO622',
      line: 'MAE',
      phase: 'Inbound',
      eta: '2026-06-14T10:00:00.000Z',
      etd: '2026-06-15T18:00:00.000Z',
      ata: null,
      beginReceive: '2026-06-07T10:00:00.000Z',
      dryCutoff: null,
    })
  })

  it('uses the O/B vessel for an export leg', async () => {
    // Export leg: vessel is on the outbound side (26OOFX010); the I/B is a gate
    // ref that must NOT be queried.
    const event = {
      ...FETCHED_EVENT,
      sourceEventId: 'bct:99:DISC',
      eventCode: 'DISC',
      visitRefIn: 'GDA56850',
      visitRefOut: '26OOFX010',
      rawData: { Category: 'Export' },
    }
    const { service, fetchVesselVisit, eventBus } = makeHarness({ vesselRows: [], events: [event] })

    await service.pollJob('job-1')

    // Only the O/B side is queried (one call), not the I/B gate ref.
    expect(fetchVesselVisit).toHaveBeenCalledTimes(1)
    expect(fetchVesselVisit.mock.calls[0][0].visitRef).toBe('26OOFX010')
    const payload = createdPayload(eventBus)
    expect(payload.vesselVisit.visitRef).toBe('26OOFX010')
    expect(payload.voyageNumber).toBe('625S') // outbound voyage
  })

  it('serves a fresh cache row without calling the API', async () => {
    const freshRow = {
      visitRef: '26GIRO622',
      terminalCode: 'bct',
      vesselName: 'CACHED VESSEL',
      ibVoyage: '111N',
      obVoyage: '222S',
      line: 'MSC',
      phase: 'Inbound',
      eta: new Date('2026-07-01T00:00:00Z'),
      etd: null,
      ata: null,
      atd: null,
      beginReceive: null,
      dryCutoff: null,
      rawData: null,
      updatedAt: new Date(), // now → fresh
    }
    const { service, fetchVesselVisit, eventBus } = makeHarness({ vesselRows: [freshRow] })

    await service.pollJob('job-1')
    expect(fetchVesselVisit).not.toHaveBeenCalled()

    const payload = createdPayload(eventBus)
    expect(payload.vesselName).toBe('CACHED VESSEL')
    expect(payload.voyageNumber).toBe('111N')
    expect(payload.vesselVisit.visitRef).toBe('26GIRO622')
  })

  it('refetches a stale cache row', async () => {
    const staleRow = {
      visitRef: '26GIRO622',
      terminalCode: 'bct',
      vesselName: 'OLD',
      ibVoyage: '000N',
      updatedAt: new Date(Date.now() - 2 * 3600 * 1000), // 2h ago > 1h TTL
    }
    const { service, fetchVesselVisit, eventBus } = makeHarness({ vesselRows: [staleRow] })

    await service.pollJob('job-1')
    expect(fetchVesselVisit).toHaveBeenCalledTimes(1)
    expect(createdPayload(eventBus).vesselName).toBe('MAERSK NUBA')
  })

  it('emits terminal_event.updated when container data changes (not created)', async () => {
    // Existing event has an old impediment; the fresh poll has none → container
    // changed. Fresh vessel cache → no vessel fetch, no vessel change.
    const freshRow = {
      visitRef: '26GIRO622',
      terminalCode: 'bct',
      vesselName: 'MAERSK NUBA',
      ibVoyage: '623N',
      obVoyage: '625S',
      line: 'MAE',
      phase: 'Inbound',
      eta: new Date('2026-06-14T10:00:00Z'),
      etd: new Date('2026-06-15T18:00:00Z'),
      ata: null,
      atd: null,
      beginReceive: new Date('2026-06-07T10:00:00Z'),
      dryCutoff: null,
      rawData: null,
      updatedAt: new Date(),
    }
    const { service, fetchVesselVisit, eventBus } = makeHarness({
      vesselRows: [freshRow],
      existingEvents: [storedEvent({ impediments: ['!CUSTOMS EXPORT HOLD'] })],
    })

    const res = await service.pollJob('job-1')

    expect(fetchVesselVisit).not.toHaveBeenCalled() // fresh cache
    expect(res).toEqual({ newEvents: 0, updatedEvents: 1 })
    expect(emitted(eventBus, 'terminal_tracking.terminal_event.created')).toHaveLength(0)
    expect(emitted(eventBus, 'terminal_tracking.terminal_event.updated')).toHaveLength(1)
    expect(updatedPayload(eventBus).impediments).toBeNull() // new state persisted
  })

  it('emits terminal_event.updated when vessel data (ETA) changes', async () => {
    // Container unchanged; the cached vessel row is stale with a different ETA →
    // refetched, ETA differs → vessel changed.
    const staleRow = {
      visitRef: '26GIRO622',
      terminalCode: 'bct',
      vesselName: 'MAERSK NUBA',
      ibVoyage: '623N',
      obVoyage: '625S',
      line: 'MAE',
      phase: 'Inbound',
      eta: new Date('2026-01-01T00:00:00Z'), // old ETA
      etd: new Date('2026-06-15T18:00:00Z'),
      ata: null,
      atd: null,
      beginReceive: new Date('2026-06-07T10:00:00Z'),
      dryCutoff: null,
      rawData: null,
      updatedAt: new Date(Date.now() - 2 * 3600 * 1000), // stale
    }
    const { service, fetchVesselVisit, eventBus } = makeHarness({
      vesselRows: [staleRow],
      existingEvents: [storedEvent()],
    })

    const res = await service.pollJob('job-1')

    expect(fetchVesselVisit).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ newEvents: 0, updatedEvents: 1 })
    expect(emitted(eventBus, 'terminal_tracking.terminal_event.updated')).toHaveLength(1)
    expect(updatedPayload(eventBus).vesselVisit.eta).toBe('2026-06-14T10:00:00.000Z') // new ETA
  })

  it('does not emit when nothing changed', async () => {
    const freshRow = {
      visitRef: '26GIRO622',
      terminalCode: 'bct',
      vesselName: 'MAERSK NUBA',
      ibVoyage: '623N',
      obVoyage: '625S',
      line: 'MAE',
      phase: 'Inbound',
      eta: new Date('2026-06-14T10:00:00Z'),
      etd: new Date('2026-06-15T18:00:00Z'),
      ata: null,
      atd: null,
      beginReceive: new Date('2026-06-07T10:00:00Z'),
      dryCutoff: null,
      rawData: null,
      updatedAt: new Date(),
    }
    const { service, eventBus } = makeHarness({
      vesselRows: [freshRow],
      existingEvents: [storedEvent()],
    })

    const res = await service.pollJob('job-1')

    expect(res).toEqual({ newEvents: 0, updatedEvents: 0 })
    expect(emitted(eventBus, 'terminal_tracking.terminal_event.updated')).toHaveLength(0)
    expect(emitted(eventBus, 'terminal_tracking.terminal_event.created')).toHaveLength(0)
  })

  it('degrades gracefully when rate-limited: emits without vessel data', async () => {
    // /unit allowed, /VESSEL denied.
    checkRateLimit
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 1 })
    const { service, fetchVesselVisit, eventBus } = makeHarness({ vesselRows: [] })

    const res = await service.pollJob('job-1')
    expect(res.newEvents).toBe(1)
    expect(fetchVesselVisit).not.toHaveBeenCalled()

    const payload = createdPayload(eventBus)
    expect(payload.vesselVisit).toBeNull()
    expect(payload.vesselName).toBeNull()
  })
})

const departedEvent = (overrides: Record<string, any> = {}) => ({
  ...FETCHED_EVENT,
  sourceEventId: 'bct:dep:DEPA',
  eventType: 'TRANSPORT',
  eventCode: 'DEPA',
  ufvGkey: 'dep',
  ...overrides,
})

const cachedRow = (visitRef: string) => ({
  visitRef,
  terminalCode: 'bct',
  vesselName: 'MAERSK NUBA',
  ibVoyage: '623N',
  obVoyage: '625S',
  line: 'MAE',
  phase: 'Inbound',
  eta: new Date('2026-06-14T10:00:00Z'),
  etd: new Date('2026-06-15T18:00:00Z'),
  ata: new Date('2026-06-14T11:00:00Z'),
  atd: null,
  beginReceive: null,
  dryCutoff: null,
  rawData: null,
  updatedAt: new Date(),
})

describe('departed legs and completed status', () => {
  it('skips /VESSEL for a departed leg but still attaches cached vessel data', async () => {
    const { service, fetchVesselVisit, eventBus } = makeHarness({
      events: [departedEvent()],
      vesselRows: [cachedRow('26GIRO622')],
    })

    await service.pollJob('job-1')

    expect(fetchVesselVisit).not.toHaveBeenCalled() // departed → no fetch
    expect(createdPayload(eventBus).vesselVisit.visitRef).toBe('26GIRO622') // cached attached
  })

  it('marks the job completed when every current leg is departed', async () => {
    const { service, fetchVesselVisit, job } = makeHarness({ events: [departedEvent()], vesselRows: [] })

    const res = await service.pollJob('job-1')

    expect(fetchVesselVisit).not.toHaveBeenCalled()
    expect(res.newEvents).toBe(1)
    expect(job.status).toBe('completed')
  })

  it('stays active when at least one leg is not departed', async () => {
    // A departed leg + an active DISC leg (distinct ufvGkey).
    const { service, job } = makeHarness({
      events: [departedEvent(), { ...FETCHED_EVENT }],
      vesselRows: [],
    })

    await service.pollJob('job-1')

    expect(job.status).toBe('active')
  })

  it('reverts a completed job to active when an active leg reappears', async () => {
    const { service, job } = makeHarness({
      job: { status: 'completed' },
      events: [{ ...FETCHED_EVENT }], // active DISC leg
      vesselRows: [],
    })

    await service.pollJob('job-1')

    expect(job.status).toBe('active')
  })
})
