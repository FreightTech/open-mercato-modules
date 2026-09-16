import { describe, it, expect, vi } from 'vitest'
import { TrackingService } from '../services/trackingService'
import { mapOceanShipmentToEvents, mapAirShipmentToEvents } from '../lib/shipsgo-mapper'
import { ShipsGoCreditsExhaustedError } from '../lib/shipsgo-client'
import type { CarrierFetchResult } from '../lib/carrier-adapter'
import type { ShipsGoOceanShipment, ShipsGoAirShipment } from '../lib/shipsgo-client'

/**
 * TC-TRACK-412 (ingest) / TC-TRACK-414 (402) — pollTrackingJob, ShipsGo branch.
 *
 * pollTrackingJob dispatches on job.provider: a 'shipsgo' job is fetched via the
 * injected ShipsGoProvider and then flows through the SAME downstream ingestion
 * pipeline as a direct carrier. This pins two behaviours at that seam:
 *
 *   - a successful fetch ingests a Shipment + events (TC-TRACK-412 tail);
 *   - a 402 (credits exhausted) is recorded as a distinct job error and does
 *     NOT crash the poll or fail the job on the first strike (TC-TRACK-414).
 *
 * The EM mock is the trimmed in-memory model used by empty-return-stop.test.ts
 * so the real poll → sync → derive path runs end to end.
 */

const scope = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  organizationId: '00000000-0000-0000-0000-000000000002',
}

function oceanShipment(): ShipsGoOceanShipment {
  return {
    id: 987654,
    reference: 'job-shipsgo',
    booking_number: 'MEDUQY000000',
    container_number: 'MSCU1234567',
    carrier: { scac: 'MSCU', name: 'MSC', status: 'active' },
    status: 'SAILING',
    route: {
      port_of_loading: { location: { code: 'CNYTN', name: 'YANTIAN' }, date_of_loading: '2026-07-29T12:00:00+08:00' },
      port_of_discharge: { location: { code: 'PLGDN', name: 'GDANSK' }, date_of_discharge: '2026-09-07T12:00:00+02:00' },
      transit_time: 40,
      co2_emission: 63.08,
      ts_count: 0,
    },
    containers: [
      {
        number: 'MSCU1234567',
        status: 'SAILING',
        size: 40,
        type: 'HC',
        movements: [
          {
            event: 'GTIN',
            status: 'ACT',
            location: { code: 'PLGDN', name: 'Gdańsk', country: { code: 'PL', name: 'Poland' } },
            timestamp: '2026-08-01T10:00:00Z',
          },
          {
            event: 'DEPA',
            status: 'ACT',
            location: { code: 'PLGDN', name: 'Gdańsk', country: { code: 'PL', name: 'Poland' } },
            vessel: { imo: 9839179, name: 'MSC GULSUN' },
            voyage: 'FL512A',
            timestamp: '2026-08-02T18:00:00Z',
          },
        ],
      },
    ],
  }
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
      // CarrierConfig / BicConfig / LocationOverride → not configured here.
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

function airShipment(): ShipsGoAirShipment {
  return {
    id: 55555,
    reference: 'job-shipsgo',
    awb_number: '020-12345678',
    airline: { iata: 'LH', name: 'Lufthansa' },
    status: 'EN_ROUTE',
    cargo: { pieces: 12, weight: 340.5, weight_unit: 'kg', volume: 2.1, volume_unit: 'm3' },
    movements: [
      { event: 'DEP', status: 'ACT', location: { iata: 'WAW', name: 'Warsaw' }, flight: 'LH1234', timestamp: '2026-08-01T12:00:00Z' },
      { event: 'ARR', status: 'ACT', location: { iata: 'JFK', name: 'New York' }, flight: 'LH1234', timestamp: '2026-08-01T20:00:00Z' },
    ],
  }
}

function makeService(
  shipsGoProvider: {
    fetchOrRegister: (job: any, config?: any) => Promise<CarrierFetchResult>
    resolvePollContext?: (scope: any, mode: any) => Promise<{ config: any; rateLimit: { requests: number; windowSeconds: number }; rateLimitIdentity: string }>
  },
  jobOverrides: Record<string, unknown> = {},
) {
  // Default the poll-context resolver so the ShipsGo branch can gate before
  // fetching; cacheService.get → null keeps every test under the limit.
  if (!shipsGoProvider.resolvePollContext) {
    shipsGoProvider.resolvePollContext = vi.fn().mockResolvedValue({
      config: { apiToken: 'tenant-secret', baseUrl: 'https://api.shipsgo.com/v2' },
      rateLimit: { requests: 60, windowSeconds: 60 },
      rateLimitIdentity: 'tenant-1',
    })
  }
  const { em, jobs, shipments, events } = createMockEm()
  const emitted: Array<{ event: string; payload: any }> = []

  const service = new TrackingService({
    em: () => em,
    eventBus: {
      emit: vi.fn((event: string, payload: any) => { emitted.push({ event, payload }); return Promise.resolve() }),
      on: vi.fn(),
    } as any,
    carrierRegistry: { get: () => undefined, has: () => false } as any,
    cacheService: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn(), incr: vi.fn() } as any,
    webhookService: { dispatchEvent: vi.fn(), dispatchWithRetry: vi.fn(), buildFullShipmentPayload: vi.fn() } as any,
    shipsGoProvider: shipsGoProvider as any,
  })

  const job: any = {
    id: 'job-shipsgo',
    ...scope,
    provider: 'shipsgo',
    mode: 'ocean',
    carrierCode: 'shipsgo',
    referenceType: 'booking',
    referenceValue: 'MEDUQY000000',
    providerShipmentId: null,
    originUnlocode: null,
    destinationUnlocode: 'NLRTM',
    status: 'active',
    retryCount: 0,
    errorHistory: [],
    nextPollAt: new Date(),
    shipments: { set: vi.fn(), getItems: () => [] },
    events: { set: vi.fn(), getItems: () => [] },
    deletedAt: null,
    ...jobOverrides,
  }
  jobs.set(job.id, job)

  return { service, job, emitted, shipments, events }
}

describe('pollTrackingJob — ShipsGo provider branch', () => {
  it('ingests a shipment from a successful ShipsGo fetch (TC-TRACK-412)', async () => {
    const fetchOrRegister = vi.fn().mockResolvedValue(mapOceanShipmentToEvents(oceanShipment()))
    const { service, job, shipments } = makeService({ fetchOrRegister })

    await service.pollTrackingJob(job.id)

    expect(fetchOrRegister).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-shipsgo', provider: 'shipsgo' }), expect.anything())
    // The mapped container becomes exactly one Shipment on the job.
    const created = [...shipments.values()].filter((s) => s.trackingJob?.id === job.id)
    expect(created.length).toBe(1)
    expect(created[0].containerNumber).toBe('MSCU1234567')
    expect(job.status).toBe('active')
  })

  it('enriches the ocean shipment with isoEquipmentCode + route summary in extra (TC-TRACK-417)', async () => {
    const fetchOrRegister = vi.fn().mockResolvedValue(mapOceanShipmentToEvents(oceanShipment()))
    const { service, job, shipments } = makeService({ fetchOrRegister })

    await service.pollTrackingJob(job.id)

    const created = [...shipments.values()].filter((s) => s.trackingJob?.id === job.id)
    expect(created[0].isoEquipmentCode).toBe('40HC')
    expect(created[0].extra.shipsgoRoute).toMatchObject({
      portOfLoading: { unlocode: 'CNYTN', name: 'YANTIAN' },
      portOfDischarge: { unlocode: 'PLGDN', name: 'GDANSK' },
      transitTimeDays: 40,
      co2Emission: 63.08,
      transshipmentCount: 0,
    })
  })

  it('enriches the air shipment with cargo in extra (TC-TRACK-417)', async () => {
    const fetchOrRegister = vi.fn().mockResolvedValue(mapAirShipmentToEvents(airShipment()))
    const { service, job, shipments } = makeService({ fetchOrRegister }, { mode: 'air', referenceType: 'awb', referenceValue: '020-12345678' })

    await service.pollTrackingJob(job.id)

    const created = [...shipments.values()].filter((s) => s.trackingJob?.id === job.id)
    expect(created[0].extra.shipsgoAir.cargo).toEqual({
      pieces: 12, weight: 340.5, weightUnit: 'kg', volume: 2.1, volumeUnit: 'm3',
    })
  })

  it('ingests a single AWB-keyed air shipment with flight/airline + status (TC-TRACK-416)', async () => {
    const fetchOrRegister = vi.fn().mockResolvedValue(mapAirShipmentToEvents(airShipment()))
    const { service, job, shipments } = makeService(
      { fetchOrRegister },
      { mode: 'air', referenceType: 'awb', referenceValue: '020-12345678', destinationUnlocode: null },
    )

    await service.pollTrackingJob(job.id)

    const created = [...shipments.values()].filter((s) => s.trackingJob?.id === job.id)
    expect(created.length).toBe(1) // exactly one air shipment, no container fan-out
    const air = created[0]
    expect(air.mode).toBe('air')
    expect(air.awbNumber).toBe('020-12345678')
    expect(air.flightNumber).toBe('LH1234')
    expect(air.airlineCode).toBe('LH')
    expect(air.containerNumber).toBeUndefined()
    // EN_ROUTE → IN_TRANSIT via the air status machine.
    expect(air.status).toBe('IN_TRANSIT')
  })

  it('auto-completes a stale ARRIVED air job even without DELIVERED (M1)', async () => {
    // LANDED → ARRIVED via the air machine; the movement is >30 days old.
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    const stale: ShipsGoAirShipment = {
      id: 55555,
      reference: 'job-shipsgo',
      awb_number: '020-12345678',
      airline: { iata: 'LH', name: 'Lufthansa' },
      status: 'LANDED',
      movements: [
        { event: 'ARR', status: 'ACT', location: { iata: 'JFK' }, flight: 'LH1234', timestamp: fortyDaysAgo },
      ],
    }
    const fetchOrRegister = vi.fn().mockResolvedValue(mapAirShipmentToEvents(stale))
    const { service, job } = makeService(
      { fetchOrRegister },
      { mode: 'air', referenceType: 'awb', referenceValue: '020-12345678', destinationUnlocode: null },
    )

    await service.pollTrackingJob(job.id)

    expect(job.status).toBe('completed')
    expect(job.nextPollAt).toBeNull()
  })

  it('keeps polling a recent ARRIVED air job (not yet stale)', async () => {
    const recent: ShipsGoAirShipment = {
      id: 55555, reference: 'job-shipsgo', awb_number: '020-12345678', airline: { iata: 'LH', name: 'Lufthansa' },
      status: 'LANDED',
      movements: [
        { event: 'ARR', status: 'ACT', location: { iata: 'JFK' }, flight: 'LH1234', timestamp: '2026-08-20T10:00:00Z' },
      ],
    }
    const fetchOrRegister = vi.fn().mockResolvedValue(mapAirShipmentToEvents(recent))
    const { service, job } = makeService(
      { fetchOrRegister },
      { mode: 'air', referenceType: 'awb', referenceValue: '020-12345678', destinationUnlocode: null },
    )
    await service.pollTrackingJob(job.id)
    expect(job.status).toBe('active')
  })

  it('refreshes a shifting EST estimate in place instead of inserting a new row per poll (M3)', async () => {
    function withEta(etaIso: string): ShipsGoAirShipment {
      return {
        id: 55555, reference: 'job-shipsgo', awb_number: '020-12345678', airline: { iata: 'LH', name: 'Lufthansa' },
        status: 'EN_ROUTE',
        movements: [
          { event: 'DEP', status: 'ACT', location: { iata: 'WAW' }, flight: 'LH1', timestamp: '2026-08-01T12:00:00Z' },
          { event: 'ARR', status: 'EST', location: { iata: 'JFK' }, flight: 'LH1', timestamp: etaIso },
        ],
      }
    }
    const fetchOrRegister = vi.fn()
      .mockResolvedValueOnce(mapAirShipmentToEvents(withEta('2026-08-10T06:00:00Z')))
      .mockResolvedValueOnce(mapAirShipmentToEvents(withEta('2026-08-12T06:00:00Z'))) // estimate slipped 2 days
    const { service, job, events } = makeService(
      { fetchOrRegister },
      { mode: 'air', referenceType: 'awb', referenceValue: '020-12345678', destinationUnlocode: null },
    )

    await service.pollTrackingJob(job.id)
    const afterFirst = [...events.values()].length
    await service.pollTrackingJob(job.id)
    const afterSecond = [...events.values()]

    // The EST row is updated in place — no duplicate ARR event across polls.
    const arrRows = afterSecond.filter((e) => e.eventCode === 'ARRI')
    expect(arrRows).toHaveLength(1)
    expect(afterSecond.length).toBe(afterFirst) // no new rows on the second poll
    expect(arrRows[0].eventDateTime.toISOString()).toBe('2026-08-12T06:00:00.000Z') // refreshed
  })

  it('backs off on 402 without touching the failure budget (TC-TRACK-414)', async () => {
    const fetchOrRegister = vi.fn().mockRejectedValue(new ShipsGoCreditsExhaustedError('payment required'))
    const { service, job, shipments } = makeService({ fetchOrRegister }, { retryCount: 0 })

    // Must not throw — a 402 is handled, not propagated.
    await expect(service.pollTrackingJob(job.id)).resolves.toBeDefined()

    const messages = (job.errorHistory ?? []).map((e: any) => e.message)
    expect(messages).toContain('ShipsGo credits exhausted (HTTP 402)')
    // 402 is account-level, not a per-job fault: retryCount is NOT incremented
    // (so it never flips the job to 'failed'), and the job is backed off ~6h.
    expect(job.retryCount).toBe(0)
    expect(job.status).toBe('active')
    expect(job.nextPollAt).toBeInstanceOf(Date)
    expect(job.nextPollAt.getTime()).toBeGreaterThan(Date.now() + 5 * 60 * 60 * 1000)
    // Nothing ingested on a failed fetch.
    expect([...shipments.values()].filter((s) => s.trackingJob?.id === job.id)).toHaveLength(0)
  })
})
