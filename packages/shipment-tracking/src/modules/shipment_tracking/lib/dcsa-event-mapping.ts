import type { TrackingEventType, TrackingEventClassifierCode } from '../data/entities'

/**
 * DCSA Track & Trace Event Code Mapping
 *
 * Maps DCSA standard event codes to internal webhook event types.
 * Reference: DCSA T&T v3.0 specification
 *
 * Event Types:
 * - TRANSPORT: Vessel/transport movement events (ARRI, DEPA, OMIT)
 * - EQUIPMENT: Container handling events (LOAD, DISC, GTIN, GTOT, etc.)
 * - SHIPMENT: Document lifecycle events (not typically from carrier tracking)
 *
 * Event Classifiers:
 * - ACT: Actual (event has happened)
 * - PLN: Planned
 * - EST: Estimated
 */

export type DcsaWebhookEventType =
  // Transport events
  | 'shipment_tracking.transport.departed'
  | 'shipment_tracking.transport.arrived'
  | 'shipment_tracking.transport.eta_updated'
  | 'shipment_tracking.transport.etd_updated'
  | 'shipment_tracking.transport.omitted'
  // Equipment events
  | 'shipment_tracking.equipment.loaded'
  | 'shipment_tracking.equipment.discharged'
  | 'shipment_tracking.equipment.gate_in'
  | 'shipment_tracking.equipment.gate_out'
  | 'shipment_tracking.equipment.available_pickup'
  | 'shipment_tracking.equipment.customs_released'
  | 'shipment_tracking.equipment.inspected'
  // Shipment lifecycle
  | 'shipment_tracking.shipment.booked'
  | 'shipment_tracking.shipment.delivered'
  // Generic fallback
  | 'shipment_tracking.tracking_event.created'

export type EventMappingInput = {
  eventType: TrackingEventType
  eventCode: string
  eventClassifierCode?: TrackingEventClassifierCode | null
}

/**
 * Maps a DCSA cargo event to the appropriate webhook event type.
 *
 * @param input - The cargo event details from carrier API
 * @returns The internal webhook event type to emit
 */
export function mapDcsaEventToWebhookType(input: EventMappingInput): DcsaWebhookEventType {
  const { eventType, eventCode, eventClassifierCode } = input
  const code = eventCode.toUpperCase()
  const isActual = eventClassifierCode === 'ACT'
  const isEstimatedOrPlanned = eventClassifierCode === 'EST' || eventClassifierCode === 'PLN'

  // ─── Transport Events ──────────────────────────────────────────
  if (eventType === 'TRANSPORT') {
    switch (code) {
      case 'DEPA': // Departure
        if (isActual) return 'shipment_tracking.transport.departed'
        if (isEstimatedOrPlanned) return 'shipment_tracking.transport.etd_updated'
        return 'shipment_tracking.transport.etd_updated' // Default to ETD update
      case 'ARRI': // Arrival
        if (isActual) return 'shipment_tracking.transport.arrived'
        if (isEstimatedOrPlanned) return 'shipment_tracking.transport.eta_updated'
        return 'shipment_tracking.transport.eta_updated' // Default to ETA update
      case 'OMIT': // Port omitted
        return 'shipment_tracking.transport.omitted'
    }
  }

  // ─── Equipment Events ──────────────────────────────────────────
  if (eventType === 'EQUIPMENT') {
    switch (code) {
      // Loading/Discharge
      case 'LOAD': // Loaded onto vessel
        return 'shipment_tracking.equipment.loaded'
      case 'DISC': // Discharged from vessel
        return 'shipment_tracking.equipment.discharged'

      // Gate movements
      case 'GTIN': // Gate in
        return 'shipment_tracking.equipment.gate_in'
      case 'GTOT': // Gate out (terminal)
        return 'shipment_tracking.equipment.gate_out'

      // Availability
      case 'AVPU': // Available for pick-up
        return 'shipment_tracking.equipment.available_pickup'
      case 'AVDO': // Available for drop-off (less common, map to gate_in context)
        return 'shipment_tracking.equipment.gate_in'

      // Customs
      case 'CUSR': // Customs released
        return 'shipment_tracking.equipment.customs_released'
      case 'CUSS': // Customs selected for scan
      case 'CUSI': // Customs selected for inspection
        return 'shipment_tracking.equipment.inspected'

      // Inspection
      case 'INSP': // Inspected
        return 'shipment_tracking.equipment.inspected'

      // Delivery
      case 'DLVR': // Delivered
        if (isActual) return 'shipment_tracking.shipment.delivered'
        break

      // Pick-up/Drop-off (physical movement)
      case 'PICK': // Pick-up
        return 'shipment_tracking.equipment.gate_out'
      case 'DROP': // Drop-off
        return 'shipment_tracking.equipment.gate_in'

      // Stuffing/Stripping
      case 'STUF': // Stuffed (cargo loaded into container)
      case 'STRP': // Stripped (cargo unloaded from container)
        // These are container content events, map to generic
        break

      // Sealing
      case 'RSEA': // Resealed
      case 'RMVD': // Seal removed
        // Seal events, map to generic
        break

      // Transshipment crossing
      case 'CROS': // Crossed (transshipment)
        // Map to discharge as it indicates container moved
        return 'shipment_tracking.equipment.discharged'
    }
  }

  // ─── Shipment Events ───────────────────────────────────────────
  if (eventType === 'SHIPMENT') {
    // Shipment events are typically document-related (booking, BL issuance)
    // These come from different APIs, not container tracking
    // Map common booking-related codes
    switch (code) {
      case 'CONF': // Confirmed
      case 'BOOK': // Booked (non-standard but common)
        return 'shipment_tracking.shipment.booked'
    }
  }

  // ─── Fallback ──────────────────────────────────────────────────
  return 'shipment_tracking.tracking_event.created'
}

/**
 * Determines if a tracking event represents a significant milestone
 * that warrants a specific webhook event (vs generic tracking_event.created).
 */
export function isSignificantMilestone(input: EventMappingInput): boolean {
  const webhookType = mapDcsaEventToWebhookType(input)
  return webhookType !== 'shipment_tracking.tracking_event.created'
}

/**
 * DCSA Equipment Event Type Codes reference
 */
export const DCSA_EQUIPMENT_EVENT_CODES = {
  LOAD: 'Loaded onto transport',
  DISC: 'Discharged from transport',
  GTIN: 'Gated in (entered facility)',
  GTOT: 'Gated out (terminal)',
  STUF: 'Stuffed (cargo loaded into container)',
  STRP: 'Stripped (cargo removed from container)',
  PICK: 'Pick-up by consignee/trucker',
  DROP: 'Drop-off at facility',
  INSP: 'Inspected',
  RSEA: 'Resealed',
  RMVD: 'Seal removed',
  AVPU: 'Available for pick-up',
  AVDO: 'Available for drop-off',
  CUSS: 'Customs selected for scan',
  CUSI: 'Customs selected for inspection',
  CUSR: 'Customs released',
  CROS: 'Crossed (transshipment)',
  DLVR: 'Delivered to consignee',
} as const

/**
 * DCSA Transport Event Type Codes reference
 */
export const DCSA_TRANSPORT_EVENT_CODES = {
  ARRI: 'Arrived at location',
  DEPA: 'Departed from location',
  OMIT: 'Port/location omitted from schedule',
} as const

/**
 * DCSA Event Classifier Codes reference
 */
export const DCSA_EVENT_CLASSIFIERS = {
  ACT: 'Actual (event has occurred)',
  PLN: 'Planned',
  EST: 'Estimated',
} as const
