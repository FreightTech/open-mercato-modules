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
  endpoints: { unit: '/unit' }, // no vessel endpoint → skip enrichment
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

const DT = new Date('2026-06-03T01:58:00Z')

function unitEvent(overrides: Record<string, unknown>) {
  return {
    source: 'terminal',
    sourceEventId: 'bct:C1:DISC',
    eventType: 'EQUIPMENT',
    eventCode: 'DISC', // yard, not DEPA → job stays active
    eventClassifierCode: 'ACT',
    eventDateTime: DT,
    containerNumber: 'C1',
    ufvGkey: 'C1',
    transitState: 'S40_YARD',
    visitState: null,
    impediments: null,
    visitRefIn: null,
    visitRefOut: null,
    rawData: {},
    ...overrides,
  }
}

/**
 * Harness: one job for container C1. `events` is what /unit returns each poll;
 * `existingEvents` are the persisted TerminalEvents already on the job (to model
 * a prior poll's state for the holds-cleared transition).
 */
function makeHarness(events: any[], existingEvents: any[] = []) {
  const job = {
    id: 'job-1',
    organizationId: 'org-1',
    tenantId: 'ten-1',
    terminalCode: 'bct',
    containerNumber: 'C1',
    schedule: null,
    status: 'active',
    emptyReadyAt: null,
    holdsClearedAt: null,
  }

  // Adapter without fetchVesselVisit → enrichment is skipped entirely.
  const adapter = {
    adapterType: 'n4',
    defaultEndpoints: { unit: '/unit' },
    fetchEvents: vi.fn(),
    fetchEventsBatch: vi.fn(async () => ({ events })),
    testConnection: vi.fn(),
  }

  const em = {
    fork() {
      return this
    },
    async find(_entity: any, where: any) {
      if (where && 'status' in where) return [job] // stable job instance across polls
      if (where && 'sourceEventId' in where) return existingEvents // persistEvents lookup
      return []
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
  return { service, eventBus, job }
}

function emitsOf(eventBus: any, id: string) {
  return eventBus.emit.mock.calls.filter((c: any[]) => c[0] === id)
}

beforeEach(() => {
  vi.clearAllMocks()
  checkRateLimit.mockResolvedValue({ allowed: true })
  findOneWithDecryption.mockResolvedValue({ ...CONFIG })
})

describe('availability emission', () => {
  it('emits empty_ready for an empty export in the yard with no blocking holds', async () => {
    const { service, eventBus } = makeHarness([
      unitEvent({ rawData: { Category: 'Export', 'Frght Kind': 'MTY' } }),
    ])

    await service.pollAllActiveJobs('ten-1')

    const emits = emitsOf(eventBus, 'terminal_tracking.equipment.empty_ready')
    expect(emits).toHaveLength(1)
    expect(emits[0][1]).toMatchObject({ containerNumber: 'C1', emptyReady: true })
    // Not an import → no holds_cleared.
    expect(emitsOf(eventBus, 'terminal_tracking.equipment.holds_cleared')).toHaveLength(0)
  })

  it('is one-shot: does not re-emit empty_ready on a second poll', async () => {
    const { service, eventBus } = makeHarness([
      unitEvent({ rawData: { Category: 'Export', 'Frght Kind': 'MTY' } }),
    ])

    await service.pollAllActiveJobs('ten-1')
    await service.pollAllActiveJobs('ten-1') // job.emptyReadyAt now set → guard holds

    expect(emitsOf(eventBus, 'terminal_tracking.equipment.empty_ready')).toHaveLength(1)
  })

  it('does not emit empty_ready when a movement-blocking hold is present', async () => {
    const { service, eventBus } = makeHarness([
      unitEvent({
        rawData: { Category: 'Export', 'Frght Kind': 'MTY' },
        impediments: ['!EMPTY PERMISSION'],
      }),
    ])

    await service.pollAllActiveJobs('ten-1')

    expect(emitsOf(eventBus, 'terminal_tracking.equipment.empty_ready')).toHaveLength(0)
  })

  it('emits holds_cleared on the blocked → clear transition for an import in the yard', async () => {
    const existing = [
      {
        source: 'terminal',
        sourceEventId: 'bct:C1:DISC',
        job: { id: 'job-1' },
        containerNumber: 'C1',
        ufvGkey: 'C1',
        eventDateTime: new Date('2026-06-01T00:00:00Z'),
        transitState: 'S40_YARD',
        impediments: ['!CUSTOMS IMPORT PERMISSION'], // was blocked
        rawData: { Category: 'Import', 'Frght Kind': 'FCL' },
      },
    ]
    const { service, eventBus } = makeHarness(
      [
        unitEvent({
          impediments: null, // now clear
          rawData: { Category: 'Import', 'Frght Kind': 'FCL' },
        }),
      ],
      existing,
    )

    await service.pollAllActiveJobs('ten-1')

    const emits = emitsOf(eventBus, 'terminal_tracking.equipment.holds_cleared')
    expect(emits).toHaveLength(1)
    expect(emits[0][1]).toMatchObject({ containerNumber: 'C1', holdsCleared: true })
  })

  it('emits stops_updated when a STOP flag first appears', async () => {
    const { service, eventBus } = makeHarness([
      unitEvent({ rawData: { Category: 'Import', 'Frght Kind': 'FCL', 'Stop-Road': 'true' } }),
    ])

    await service.pollAllActiveJobs('ten-1')

    const emits = emitsOf(eventBus, 'terminal_tracking.equipment.stops_updated')
    expect(emits).toHaveLength(1)
    expect(emits[0][1]).toMatchObject({
      containerNumber: 'C1',
      stops: { vsl: null, road: true, rail: null },
    })
  })

  it('emits stops_updated on a stop-only change (rawData is not in eventSignature)', async () => {
    const existing = [
      {
        source: 'terminal',
        sourceEventId: 'bct:C1:DISC',
        job: { id: 'job-1' },
        containerNumber: 'C1',
        ufvGkey: 'C1',
        eventDateTime: DT,
        eventClassifierCode: 'ACT',
        transitState: 'S40_YARD',
        visitState: null,
        impediments: null,
        rawData: { Category: 'Import', 'Frght Kind': 'FCL', 'Stop-Road': 'false' },
      },
    ]
    const { service, eventBus } = makeHarness(
      [unitEvent({ rawData: { Category: 'Import', 'Frght Kind': 'FCL', 'Stop-Road': 'true' } })],
      existing,
    )

    await service.pollAllActiveJobs('ten-1')

    const emits = emitsOf(eventBus, 'terminal_tracking.equipment.stops_updated')
    expect(emits).toHaveLength(1)
    expect(emits[0][1].stops).toMatchObject({ road: true })
  })

  it('does not re-emit stops_updated when the stop set is unchanged', async () => {
    const existing = [
      {
        source: 'terminal',
        sourceEventId: 'bct:C1:DISC',
        job: { id: 'job-1' },
        containerNumber: 'C1',
        ufvGkey: 'C1',
        eventDateTime: DT,
        eventClassifierCode: 'ACT',
        transitState: 'S40_YARD',
        visitState: null,
        impediments: null,
        rawData: { Category: 'Import', 'Frght Kind': 'FCL', 'Stop-Road': 'true' },
      },
    ]
    const { service, eventBus } = makeHarness(
      [unitEvent({ rawData: { Category: 'Import', 'Frght Kind': 'FCL', 'Stop-Road': 'true' } })],
      existing,
    )

    await service.pollAllActiveJobs('ten-1')

    expect(emitsOf(eventBus, 'terminal_tracking.equipment.stops_updated')).toHaveLength(0)
  })

  it('does not emit holds_cleared when the container was never blocked', async () => {
    const existing = [
      {
        source: 'terminal',
        sourceEventId: 'bct:C1:DISC',
        job: { id: 'job-1' },
        containerNumber: 'C1',
        ufvGkey: 'C1',
        eventDateTime: new Date('2026-06-01T00:00:00Z'),
        transitState: 'S30_ECIN', // different state → signature differs, marked updated
        impediments: null, // never blocked
        rawData: { Category: 'Import', 'Frght Kind': 'FCL' },
      },
    ]
    const { service, eventBus } = makeHarness(
      [unitEvent({ impediments: null, rawData: { Category: 'Import', 'Frght Kind': 'FCL' } })],
      existing,
    )

    await service.pollAllActiveJobs('ten-1')

    expect(emitsOf(eventBus, 'terminal_tracking.equipment.holds_cleared')).toHaveLength(0)
  })
})
