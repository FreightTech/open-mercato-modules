/**
 * POI Event Processor
 *
 * Processes POI proximity events from AIS system and matches them
 * to tracked shipments for notification and event creation.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { Shipment, TrackingEvent, TrackingJob } from '../data/entities'
import type { PoiProximityEvent, ProcessedPoiEvent, ProximityEventType } from './poi-types'
import { PROXIMITY_EVENT_CODES } from './poi-types'
import { trackingLogger } from './logger'

const LOG_COMPONENT = 'poi-processor'

// ─── Shipment Matching ───────────────────────────────────────

/**
 * Find active shipments that match the given vessel IMO.
 *
 * A shipment matches if:
 * - It has the same vesselImo
 * - It's active (not deleted, not delivered)
 * - It has an associated tracking job (tracking is enabled)
 */
export async function findShipmentsByVesselImo(
  em: EntityManager,
  vesselImo: string
): Promise<Shipment[]> {
  return em.find(Shipment, {
    vesselImo,
    isActive: true,
    deletedAt: null,
    status: { $nin: ['DELIVERED'] },
    trackingJob: { $ne: null },
  })
}

// ─── Event Processing ────────────────────────────────────────

/**
 * Generate a deterministic source event ID for deduplication.
 *
 * Must be stable across redeliveries (nak / max_deliver retries / consumer replay),
 * so it derives only from payload fields — never the wall clock. Arrival/departure
 * events anchor on ata/atd; timeless events (e.g. WAYPOINT_REACHED) anchor on the POI code.
 *
 * Caveat: two distinct position-update batches that emit the same type + sequenceOrder
 * for the same vessel with no ata/atd and no POI code collapse to one event. Acceptable
 * for waypoints; revisit with a producer-supplied event id or JetStream msg.seq if real
 * duplicates surface.
 */
export function generateSourceEventId(event: PoiProximityEvent): string {
  const anchor = event.ata || event.atd || getPoiCode(event) || 'unknown'
  return `poi-${event.mmsi}-${event.type}-${anchor}-${event.sequenceOrder}`
}

/**
 * Extract event datetime from POI event.
 */
export function extractEventDateTime(event: PoiProximityEvent): Date {
  if (event.ata) {
    return new Date(event.ata)
  }
  if (event.atd) {
    return new Date(event.atd)
  }
  return new Date()
}

/**
 * Get POI code from event (arrival or departure).
 */
export function getPoiCode(event: PoiProximityEvent): string | null {
  return event.arrivedPoiCode || event.departedPoiCode || null
}

/**
 * Resolve the human-friendly location name for a POI event, following the producer's
 * per-type identity fallback:
 * - terminal events → terminalName → portName → city
 * - port events     → city → portName
 * - waypoint events → null (no port/terminal/city; the localized region name is used instead,
 *   stored separately in regionNamePl/regionNameEn and chosen at render time)
 *
 * Returns null when nothing usable is present, so callers fall back to the raw POI code.
 */
export function resolvePoiLocationName(event: PoiProximityEvent): string | null {
  if (event.type.startsWith('TERMINAL')) {
    return event.terminalName || event.portName || event.city || null
  }
  if (event.type.startsWith('PORT')) {
    return event.city || event.portName || null
  }
  return null
}

/**
 * Map POI event type to Open Mercato event ID.
 */
export function mapToOpenMercatoEventId(type: ProximityEventType): string {
  const eventMap: Record<ProximityEventType, string> = {
    PORT_ARRIVAL: 'shipment_tracking.poi.port_arrival',
    PORT_PROXIMITY_ARRIVAL: 'shipment_tracking.poi.port_proximity_arrival',
    PORT_PROXIMITY_DEPARTURE: 'shipment_tracking.poi.port_departure',
    TERMINAL_ARRIVAL: 'shipment_tracking.poi.terminal_arrival',
    TERMINAL_PROXIMITY_ARRIVAL: 'shipment_tracking.poi.terminal_proximity_arrival',
    TERMINAL_PROXIMITY_DEPARTURE: 'shipment_tracking.poi.terminal_departure',
    WAYPOINT_REACHED: 'shipment_tracking.poi.waypoint_reached',
  }
  return eventMap[type]
}

/**
 * Process a POI event and match it to shipments.
 *
 * @param em - Entity manager
 * @param event - Raw POI proximity event from NATS
 * @returns Processed event with matched shipments, or null if no matches
 */
export async function processPoiEvent(
  em: EntityManager,
  event: PoiProximityEvent
): Promise<ProcessedPoiEvent | null> {
  // The AIS detector sets `shipId` from `ship.id`, which is the vessel IMO.
  // Match directly against the IMO we already store on the shipment — no lookup needed.
  const vesselImo = String(event.shipId)
  const shipments = await findShipmentsByVesselImo(em, vesselImo)

  if (shipments.length === 0) {
    trackingLogger.debug('No active shipments found for vessel IMO', {
      component: LOG_COMPONENT,
      mmsi: event.mmsi,
      vesselImo,
      eventType: event.type,
    })
    return null
  }

  return {
    poiEvent: event,
    vesselImo,
    shipmentIds: shipments.map((s) => s.id),
    eventDateTime: extractEventDateTime(event),
    poiCode: getPoiCode(event),
    eventCode: PROXIMITY_EVENT_CODES[event.type],
    sourceEventId: generateSourceEventId(event),
  }
}

// ─── TrackingEvent Creation ──────────────────────────────────

/**
 * Check if a POI event has already been processed (deduplication).
 */
export async function isEventAlreadyProcessed(
  em: EntityManager,
  trackingJobId: string,
  sourceEventId: string
): Promise<boolean> {
  const existing = await em.findOne(TrackingEvent, {
    trackingJob: trackingJobId,
    source: 'ais',
    sourceEventId,
  })
  return existing !== null
}

/**
 * Create a TrackingEvent record from a processed POI event.
 */
export function createTrackingEventFromPoi(
  processedEvent: ProcessedPoiEvent,
  trackingJob: TrackingJob
): TrackingEvent {
  const { poiEvent, eventDateTime, eventCode, sourceEventId, poiCode, vesselImo } = processedEvent

  const event = new TrackingEvent()
  event.organizationId = trackingJob.organizationId
  event.tenantId = trackingJob.tenantId
  event.trackingJob = trackingJob
  event.source = 'ais'
  event.sourceEventId = sourceEventId
  event.eventType = 'TRANSPORT'
  event.eventCode = eventCode
  event.eventClassifierCode = 'ACT' // Actual event
  event.eventDateTime = eventDateTime
  event.description = null // Labels resolved via i18n: event_codes.<CODE>
  event.latitude = poiEvent.lat
  event.longitude = poiEvent.lng
  event.vesselName = poiEvent.shipName
  // The POI producer sets shipId to the vessel IMO (that's how we matched the shipment),
  // so persist it — route legs/maps need the IMO, not just the name.
  event.vesselImo = vesselImo
  event.locationUnlocode = poiCode // raw POI code (grid/LOCODE), kept as the dedup reference
  // Friendly port/terminal name (null for waypoints, which use the localized region name below).
  // Populating locationName also gives route extraction a real name instead of the grid code.
  event.locationName = resolvePoiLocationName(poiEvent)
  event.regionNamePl = poiEvent.regionNamePl ?? null
  event.regionNameEn = poiEvent.regionNameEn ?? null

  // Store raw event data for debugging
  event.rawData = {
    poiEventType: poiEvent.type,
    mmsi: poiEvent.mmsi,
    shipId: poiEvent.shipId,
    arrivedPoiCode: poiEvent.arrivedPoiCode,
    departedPoiCode: poiEvent.departedPoiCode,
    distanceToPoiMeters: poiEvent.distanceToPoiMeters,
    sequenceOrder: poiEvent.sequenceOrder,
    // POI identity fields without dedicated columns — kept here for debugging. The resolved
    // name lands in locationName; region names have their own columns.
    portName: poiEvent.portName,
    terminalName: poiEvent.terminalName,
    city: poiEvent.city,
  }

  return event
}

// ─── Batch Processing ────────────────────────────────────────

export type PoiProcessingResult = {
  processed: number
  matched: number
  eventsCreated: number
  errors: number
}

/**
 * Process a batch of POI events.
 */
export async function processPoiEventBatch(
  em: EntityManager,
  events: PoiProximityEvent[]
): Promise<PoiProcessingResult> {
  const result: PoiProcessingResult = {
    processed: 0,
    matched: 0,
    eventsCreated: 0,
    errors: 0,
  }

  for (const event of events) {
    result.processed++

    try {
      const processed = await processPoiEvent(em, event)

      if (!processed) {
        continue
      }

      result.matched++

      // For each matched shipment, check if we need to create events
      for (const shipmentId of processed.shipmentIds) {
        const shipment = await em.findOne(Shipment, { id: shipmentId }, { populate: ['trackingJob'] })

        if (!shipment?.trackingJob) {
          continue
        }

        // Check for duplicates
        const alreadyProcessed = await isEventAlreadyProcessed(
          em,
          shipment.trackingJob.id,
          processed.sourceEventId
        )

        if (alreadyProcessed) {
          trackingLogger.debug('Event already processed', {
            component: LOG_COMPONENT,
            sourceEventId: processed.sourceEventId,
            trackingJobId: shipment.trackingJob.id,
          })
          continue
        }

        // Create TrackingEvent
        const trackingEvent = createTrackingEventFromPoi(processed, shipment.trackingJob)
        em.persist(trackingEvent)
        result.eventsCreated++
      }
    } catch (error) {
      trackingLogger.error('Error processing POI event', {
        component: LOG_COMPONENT,
        mmsi: event.mmsi,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      result.errors++
    }
  }

  if (result.eventsCreated > 0) {
    await em.flush()
  }

  return result
}
