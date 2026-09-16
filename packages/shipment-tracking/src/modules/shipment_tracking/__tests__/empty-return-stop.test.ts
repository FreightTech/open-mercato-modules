import { vi } from 'vitest'
import { TrackingService } from '../services/trackingService'
import { parseDcsaEvents } from '../lib/dcsa-event-parser'
import type { CarrierFetchedEvent } from '../lib/carrier-adapter'

/**
 * Service-level test for the auto-stop: a carrier poll must stop a tracking job
 * (status → 'completed') once EVERY tracked container has been returned empty
 * (an actual empty gate-in) — or delivered (COSCO), or stale after destination
 * arrival — and must keep polling while any container is still out.
 * Multi-container jobs (BoL / Booking) are the crux.
 *
 * Uses a trimmed in-memory EntityManager mock (modelled on
 * trackingService.integration.test.ts) so the real pollTrackingJob → sync →
 * derive → stopJobInline path runs end to end.
 */

const scope = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}

const DEST = 'PLGDN'

type RawEvent = Record<string, unknown>

function rawEquipmentEvent(
  container: string,
  code: 'GTIN' | 'LOAD' | 'GTOT' | 'DLVR' | 'DISC',
  empty: 'EMPTY' | 'LADEN' | null,
  classifier: 'ACT' | 'EST' = 'ACT',
  eventDateTime = '2026-06-01T10:00:00Z',
): RawEvent {
  const event: RawEvent = {
    eventType: 'EQUIPMENT',
    equipmentEventTypeCode: code,
    eventId: `evt-${container}-${code}-${empty ?? 'NA'}-${eventDateTime}`,
    eventDateTime,
    eventClassifierCode: classifier,
    equipmentReference: container,
    eventLocation: { unLocationCode: DEST, locationName: 'Gdansk' },
  }
  if (empty) event.emptyIndicatorCode = empty
  return event
}

/** An ISO timestamp `daysAgo` days before now (for the time-based backup). */
function daysAgoIso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
}

function createMockEm() {
  let counter = 0
  const jobs = new Map<string, any>()
  const shipments = new Map<string, any>()
  const events = new Map<string, any>()

  const em: any = {
    findOne: vi.fn(async (Entity: any, filter: any, options?: any) => {
      const name = typeof Entity === 'function' ? Entity.name : Entity?.name
      if (name === 'TrackingJob') {
        const job = jobs.get(filter.id)
        if (job && options?.populate) {
          job.shipments.set([...shipments.values()].filter((s) => s.trackingJob?.id === job.id))
        }
        return job ?? null
      }
      // CarrierConfig / BicConfig / LocationOverride → not configured in this test
      return null
    }),
    find: vi.fn(async (Entity: any, filter: any, options?: any) => {
      const name = typeof Entity === 'function' ? Entity.name : Entity?.name
      if (name === 'TrackingEvent') {
        let list = [...events.values()].filter((e) => e.trackingJob?.id === filter.trackingJob?.id)
        if (filter.sourceEventId?.$in) {
          list = list.filter((e) => filter.sourceEventId.$in.includes(e.sourceEventId))
        }
        if (options?.orderBy?.eventDateTime === 'asc') {
          list = list.sort((a, b) => a.eventDateTime.getTime() - b.eventDateTime.getTime())
        }
        return list
      }
      if (name === 'Shipment') {
        return [...shipments.values()].filter(
          (s) => s.trackingJob?.id === filter.trackingJob?.id && s.deletedAt == null,
        )
      }
      return []
    }),
    create: vi.fn((Entity: any, data: any) => {
      const id = data.id ?? `mock-${counter++}`
      const entity: any = { ...data, id, createdAt: new Date(), updatedAt: new Date() }
      const name = typeof Entity === 'function' ? Entity.name : Entity?.name
      if (name === 'TrackingJob') {
        entity.shipments = { set: vi.fn(), getItems: () => [] }
        jobs.set(id, entity)
      } else if (name === 'Shipment') {
        shipments.set(id, entity)
      } else if (name === 'TrackingEvent') {
        events.set(id, entity)
      }
      return entity
    }),
    persist: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn(),
  }

  return { em, jobs, shipments, events }
}

function makeService(fetchedEvents: CarrierFetchedEvent[]) {
  const { em, jobs } = createMockEm()
  const emitted: Array<{ event: string; payload: any }> = []

  const adapter = {
    carrierCode: 'msc',
    supportedReferenceTypes: ['container', 'booking', 'bol'],
    fetchEvents: vi.fn().mockResolvedValue({ events: fetchedEvents, bookingNumber: 'BKG1' }),
    testConnection: vi.fn(),
  }

  const service = new TrackingService({
    em: () => em,
    eventBus: { emit: vi.fn((event: string, payload: any) => { emitted.push({ event, payload }); return Promise.resolve() }), on: vi.fn() } as any,
    carrierRegistry: { get: (code: string) => (code === 'msc' ? adapter : undefined) } as any,
    cacheService: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn(), incr: vi.fn() } as any,
    webhookService: { dispatchEvent: vi.fn(), dispatchWithRetry: vi.fn(), buildFullShipmentPayload: vi.fn() } as any,
  })

  const job: any = {
    id: 'job-1',
    ...scope,
    carrierCode: 'msc',
    referenceType: 'bol',
    referenceValue: 'BOL123',
    originUnlocode: 'CNYTN',
    destinationUnlocode: DEST,
    status: 'active',
    retryCount: 0,
    nextPollAt: new Date(),
    shipments: { set: vi.fn(), getItems: () => [] },
    events: { set: vi.fn(), getItems: () => [] },
    deletedAt: null,
  }
  jobs.set(job.id, job)

  return { service, job, emitted }
}

describe('empty-return auto-stop (pollTrackingJob)', () => {
  it('stops the job once all containers are returned empty', async () => {
    const events = parseDcsaEvents(
      [rawEquipmentEvent('CONT0000001', 'GTIN', 'EMPTY'), rawEquipmentEvent('CONT0000002', 'GTIN', 'EMPTY')],
      'MSC',
    )
    const { service, job, emitted } = makeService(events)

    await service.pollTrackingJob(job.id)

    expect(job.status).toBe('completed')
    expect(job.nextPollAt).toBeNull()
    const completed = emitted.filter((e) => e.event === 'shipment_tracking.tracking_job.completed')
    expect(completed).toHaveLength(1)
    expect(completed[0].payload).toMatchObject({ id: job.id, tenantId: scope.tenantId, organizationId: scope.organizationId })
  })

  it('keeps polling while one container is not yet returned empty', async () => {
    const events = parseDcsaEvents(
      [rawEquipmentEvent('CONT0000001', 'GTIN', 'EMPTY'), rawEquipmentEvent('CONT0000002', 'LOAD', 'LADEN')],
      'MSC',
    )
    const { service, job, emitted } = makeService(events)

    await service.pollTrackingJob(job.id)

    expect(job.status).toBe('active')
    expect(emitted.some((e) => e.event === 'shipment_tracking.tracking_job.completed')).toBe(false)
  })

  it('stops a COSCO job once all containers are delivered (DLVR)', async () => {
    const events = parseDcsaEvents(
      [rawEquipmentEvent('CONT0000001', 'DLVR', null), rawEquipmentEvent('CONT0000002', 'DLVR', null)],
      'COSCO',
    )
    const { service, job, emitted } = makeService(events)

    await service.pollTrackingJob(job.id)

    expect(job.status).toBe('completed')
    expect(job.nextPollAt).toBeNull()
    expect(emitted.filter((e) => e.event === 'shipment_tracking.tracking_job.completed')).toHaveLength(1)
  })

  it('does NOT stop a DCSA job on laden gate-out at destination (pickup, not empty return)', async () => {
    const events = parseDcsaEvents([rawEquipmentEvent('CONT0000001', 'GTOT', 'LADEN')], 'MSC')
    const { service, job, emitted } = makeService(events)

    await service.pollTrackingJob(job.id)

    expect(job.status).toBe('active')
    expect(emitted.some((e) => e.event === 'shipment_tracking.tracking_job.completed')).toBe(false)
  })

  it('backup: stops a job that arrived at destination >30 days ago with no empty return', async () => {
    const events = parseDcsaEvents(
      [rawEquipmentEvent('CONT0000001', 'DISC', null, 'ACT', daysAgoIso(40))],
      'MSC',
    )
    const { service, job, emitted } = makeService(events)

    await service.pollTrackingJob(job.id)

    expect(job.status).toBe('completed')
    expect(job.nextPollAt).toBeNull()
    expect(emitted.filter((e) => e.event === 'shipment_tracking.tracking_job.completed')).toHaveLength(1)
  })

  it('backup: keeps polling a recent destination arrival (<30 days) with no empty return', async () => {
    const events = parseDcsaEvents(
      [rawEquipmentEvent('CONT0000001', 'DISC', null, 'ACT', daysAgoIso(10))],
      'MSC',
    )
    const { service, job, emitted } = makeService(events)

    await service.pollTrackingJob(job.id)

    expect(job.status).toBe('active')
    expect(emitted.some((e) => e.event === 'shipment_tracking.tracking_job.completed')).toBe(false)
  })
})
