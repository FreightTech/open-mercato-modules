import { describe, it, expect, vi } from 'vitest'
import handle, { metadata } from '../terminal-event-ingest'

const PAYLOAD = {
  sourceEventId: 'bct:11341499051:DEPA',
  eventType: 'TRANSPORT' as const,
  eventCode: 'DEPA',
  eventClassifierCode: 'ACT' as const,
  eventDateTime: '2026-06-03T01:58:00.000Z',
  containerNumber: 'GCXU5598460',
  tenantId: 'ten-1',
  organizationId: 'org-1',
  unlocode: 'PLGDN',
  facilityCode: 'GDNBCT',
  facilityCodeListProvider: 'SMDG' as const,
  vesselName: null,
  voyageNumber: null,
  modeOfTransport: 'VESSEL' as const,
  seals: [{ number: 'CN7842852' }],
  rawData: { 'Unit Nbr': 'GCXU5598460', Category: 'Import' },
}

const shipment = (id: string, jobId: string | null) => ({
  id,
  organizationId: 'org-1',
  tenantId: 'ten-1',
  trackingJob: jobId ? { id: jobId } : null,
})

function setup(opts: { shipments: unknown[]; existing?: unknown }) {
  const fork = {
    find: vi.fn(async () => opts.shipments),
    findOne: vi.fn(async () => opts.existing ?? null),
    persist: vi.fn(),
    flush: vi.fn(async () => {}),
  }
  const em = { fork: () => fork }
  const service = { refreshShipmentsFromEvents: vi.fn(async () => {}) }
  const resolve = vi.fn((name: string) => (name === 'em' ? em : service))
  return { fork, service, resolve, ctx: { resolve } as never }
}

describe('terminal-event-ingest bridge subscriber', () => {
  it('reacts to the terminal_tracking event id (string coupling only)', () => {
    expect(metadata.event).toBe('terminal_tracking.terminal_event.created')
    expect(metadata.id).toBe('shipment_tracking:terminal-event-ingest')
  })

  it("ingests a source:'port' TrackingEvent onto a matching shipment and refreshes it", async () => {
    const { fork, service, ctx } = setup({ shipments: [shipment('ship-1', 'job-1')] })

    await handle(PAYLOAD, ctx)

    expect(fork.persist).toHaveBeenCalledTimes(1)
    const ev = fork.persist.mock.calls[0][0] as Record<string, unknown>
    expect(ev.source).toBe('port')
    expect(ev.sourceEventId).toBe('bct:11341499051:DEPA')
    expect(ev.eventCode).toBe('DEPA')
    expect(ev.eventType).toBe('TRANSPORT')
    expect(ev.eventClassifierCode).toBe('ACT')
    expect(ev.equipmentReference).toBe('GCXU5598460')
    expect(ev.facilityCode).toBe('GDNBCT')
    expect(ev.locationUnlocode).toBe('PLGDN')

    expect(fork.flush).toHaveBeenCalledTimes(1)
    expect(service.refreshShipmentsFromEvents).toHaveBeenCalledTimes(1)
    const [, jobId, shipmentIds] = service.refreshShipmentsFromEvents.mock.calls[0]
    expect(jobId).toBe('job-1')
    expect(shipmentIds).toEqual(['ship-1'])
  })

  it('dedupes: skips when a port event with the same sourceEventId already exists', async () => {
    const { fork, service, ctx } = setup({
      shipments: [shipment('ship-1', 'job-1')],
      existing: { id: 'already-there' },
    })

    await handle(PAYLOAD, ctx)

    expect(fork.persist).not.toHaveBeenCalled()
    expect(fork.flush).not.toHaveBeenCalled()
    expect(service.refreshShipmentsFromEvents).not.toHaveBeenCalled()
  })

  it('no-ops when the matching shipment has no tracking job', async () => {
    const { fork, service, ctx } = setup({ shipments: [shipment('ship-1', null)] })

    await handle(PAYLOAD, ctx)

    expect(fork.findOne).not.toHaveBeenCalled()
    expect(fork.persist).not.toHaveBeenCalled()
    expect(service.refreshShipmentsFromEvents).not.toHaveBeenCalled()
  })

  it('no-ops (and does no work) when no shipment matches the container', async () => {
    const { fork, service, ctx } = setup({ shipments: [] })

    await handle(PAYLOAD, ctx)

    expect(fork.persist).not.toHaveBeenCalled()
    expect(fork.flush).not.toHaveBeenCalled()
    expect(service.refreshShipmentsFromEvents).not.toHaveBeenCalled()
  })

  it('refreshes a job once for multiple shipments sharing it', async () => {
    const { fork, service, ctx } = setup({
      shipments: [shipment('ship-1', 'job-1'), shipment('ship-2', 'job-1')],
    })

    await handle(PAYLOAD, ctx)

    expect(fork.persist).toHaveBeenCalledTimes(2)
    expect(service.refreshShipmentsFromEvents).toHaveBeenCalledTimes(1)
    const [, jobId, shipmentIds] = service.refreshShipmentsFromEvents.mock.calls[0]
    expect(jobId).toBe('job-1')
    expect(shipmentIds).toEqual(['ship-1', 'ship-2'])
  })

  it('scopes the shipment match to active, non-delivered shipments (no historic override)', async () => {
    // A returned container reuses its number across journeys; the bridge must
    // not refresh a closed/delivered shipment from a prior journey.
    const { fork, ctx } = setup({ shipments: [] })

    await handle(PAYLOAD, ctx)

    const where = fork.find.mock.calls[0][1] as Record<string, unknown>
    expect(where.containerNumber).toBe('GCXU5598460')
    expect(where.deletedAt).toBeNull()
    expect(where.isActive).toBe(true)
    expect(where.status).toEqual({ $nin: ['DELIVERED'] })
  })

  it('guards against a malformed payload (missing containerNumber/sourceEventId)', async () => {
    const { resolve, ctx } = setup({ shipments: [] })

    await handle({ ...PAYLOAD, containerNumber: '' }, ctx)
    await handle({ ...PAYLOAD, sourceEventId: '' }, ctx)

    expect(resolve).not.toHaveBeenCalled()
  })
})
