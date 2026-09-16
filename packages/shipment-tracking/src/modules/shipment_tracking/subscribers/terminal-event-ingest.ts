/**
 * Terminal Event Ingest (bridge)
 *
 * Surfaces terminal-tracking events on the shipment-tracking timeline. Reacts
 * to the `terminal_tracking.terminal_event.created` event (string coupling
 * only — this module does NOT import @freighttech/terminal-tracking), finds the
 * matching tracked Shipment by container number, and records a `source:'port'`
 * TrackingEvent. Fully additive; no-ops when no matching shipment is tracked.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { Shipment, TrackingEvent } from '../data/entities'
import type { TrackingService } from '../services/trackingService'

export const metadata = {
  event: 'terminal_tracking.terminal_event.created',
  persistent: false,
  id: 'shipment_tracking:terminal-event-ingest',
}

type TerminalEventPayload = {
  sourceEventId: string
  eventType: 'EQUIPMENT' | 'TRANSPORT'
  eventCode: string
  eventClassifierCode?: 'ACT' | 'PLN' | 'EST' | null
  eventDateTime: string
  containerNumber: string
  tenantId: string
  organizationId: string
  unlocode?: string | null
  facilityCode?: string | null
  facilityCodeListProvider?: 'SMDG' | 'BIC' | null
  vesselName?: string | null
  voyageNumber?: string | null
  modeOfTransport?: 'VESSEL' | 'RAIL' | 'TRUCK' | 'BARGE' | null
  seals?: Array<{ number: string; type?: string | null; source?: string | null }> | null
  rawData?: Record<string, unknown> | null
}

type ResolverContext = { resolve: <T = unknown>(name: string) => T }

export default async function handle(payload: TerminalEventPayload, ctx: ResolverContext) {
  if (!payload?.containerNumber || !payload?.sourceEventId) return

  const em = ctx.resolve<EntityManager>('em').fork()
  const trackingService = ctx.resolve<TrackingService>('shipmentTrackingService')

  // Scope to currently-tracked, non-delivered shipments (mirror
  // poi-event-processor). A container number is reused across journeys over
  // time, so without this a returned container's new-visit events would refresh
  // and override a historic, already-delivered shipment with the same number.
  const shipments = await em.find(
    Shipment,
    {
      organizationId: payload.organizationId,
      tenantId: payload.tenantId,
      containerNumber: payload.containerNumber,
      deletedAt: null,
      isActive: true,
      status: { $nin: ['DELIVERED'] },
    },
    { populate: ['trackingJob'] },
  )

  const eventDateTime = new Date(payload.eventDateTime)
  const touchedJobs = new Map<string, Set<string>>()

  for (const shipment of shipments) {
    if (!shipment.trackingJob) continue

    const exists = await em.findOne(TrackingEvent, {
      trackingJob: shipment.trackingJob.id,
      source: 'port',
      sourceEventId: payload.sourceEventId,
    })
    if (exists) continue

    const event = new TrackingEvent()
    event.organizationId = shipment.organizationId
    event.tenantId = shipment.tenantId
    event.trackingJob = shipment.trackingJob
    event.source = 'port'
    event.sourceEventId = payload.sourceEventId
    event.eventType = payload.eventType
    event.eventCode = payload.eventCode
    event.eventClassifierCode = payload.eventClassifierCode ?? 'ACT'
    event.eventDateTime = eventDateTime
    event.equipmentReference = payload.containerNumber
    event.locationUnlocode = payload.unlocode ?? null
    event.facilityCode = payload.facilityCode ?? null
    event.facilityCodeListProvider = payload.facilityCodeListProvider ?? null
    event.vesselName = payload.vesselName ?? null
    event.voyageNumber = payload.voyageNumber ?? null
    event.modeOfTransport = payload.modeOfTransport ?? null
    event.seals = payload.seals ?? null
    event.rawData = payload.rawData ?? null
    em.persist(event)

    const set = touchedJobs.get(shipment.trackingJob.id) ?? new Set<string>()
    set.add(shipment.id)
    touchedJobs.set(shipment.trackingJob.id, set)
  }

  if (touchedJobs.size === 0) return
  await em.flush()

  for (const [jobId, shipmentIds] of touchedJobs) {
    await trackingService.refreshShipmentsFromEvents(em, jobId, Array.from(shipmentIds))
  }
}
