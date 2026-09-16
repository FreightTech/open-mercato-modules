/**
 * POI Proximity Event Types
 *
 * Type definitions for AIS POI proximity events received from the
 * poi-proximity-detector service via NATS.
 */

// ─── Enums ───────────────────────────────────────────────────

/**
 * Types of proximity events emitted by the POI detector.
 */
export type ProximityEventType =
  | 'PORT_ARRIVAL'
  | 'PORT_PROXIMITY_ARRIVAL'
  | 'PORT_PROXIMITY_DEPARTURE'
  | 'TERMINAL_ARRIVAL'
  | 'TERMINAL_PROXIMITY_ARRIVAL'
  | 'TERMINAL_PROXIMITY_DEPARTURE'
  | 'WAYPOINT_REACHED'

/**
 * Map POI event types to distinct event codes for TrackingEvent records.
 * These codes are AIS-specific and don't conflict with standard DCSA codes.
 * Labels are resolved via i18n: shipment_tracking.event_codes.<CODE>
 */
export const PROXIMITY_EVENT_CODES: Record<ProximityEventType, string> = {
  PORT_ARRIVAL: 'PARR',
  PORT_PROXIMITY_ARRIVAL: 'PPRA',
  PORT_PROXIMITY_DEPARTURE: 'PPRD',
  TERMINAL_ARRIVAL: 'TARR',
  TERMINAL_PROXIMITY_ARRIVAL: 'TPRA',
  TERMINAL_PROXIMITY_DEPARTURE: 'TPRD',
  WAYPOINT_REACHED: 'WAYR',
}

/**
 * Categorize events as arrival, departure, or proximity.
 */
export type ProximityEventCategory = 'arrival' | 'departure' | 'proximity' | 'waypoint'

export const PROXIMITY_EVENT_CATEGORY: Record<ProximityEventType, ProximityEventCategory> = {
  PORT_ARRIVAL: 'arrival',
  PORT_PROXIMITY_ARRIVAL: 'proximity',
  PORT_PROXIMITY_DEPARTURE: 'departure',
  TERMINAL_ARRIVAL: 'arrival',
  TERMINAL_PROXIMITY_ARRIVAL: 'proximity',
  TERMINAL_PROXIMITY_DEPARTURE: 'departure',
  WAYPOINT_REACHED: 'waypoint',
}

// ─── Event Payload ───────────────────────────────────────────

/**
 * POI proximity event payload received from the AIS POI detector.
 *
 * This matches the ShipPoiProximityData interface from the poi-proximity-detector service.
 */
export interface PoiProximityEvent {
  /**
   * Vessel IMO number. In the AIS system `ships.id` IS the IMO, and the detector
   * sets this field from `ship.id` — so this is the real IMO, not an internal id.
   * Used to match shipments directly by `vesselImo` (no MMSI→IMO lookup).
   */
  shipId: number

  /** Ship name */
  shipName: string

  /** Maritime Mobile Service Identity (9 digits) */
  mmsi: number

  /** Latitude of ship position */
  lat: number

  /** Longitude of ship position */
  lng: number

  /** Actual Time of Arrival (ISO 8601) - present for arrival events */
  ata?: string

  /** Actual Time of Departure (ISO 8601) - present for departure events */
  atd?: string

  /** Type of proximity event */
  type: ProximityEventType

  /** POI code for arrival events (e.g., port/terminal LOCODE or custom code) */
  arrivedPoiCode?: string

  /** POI code for departure events */
  departedPoiCode?: string

  /** Distance to POI in meters (null if not applicable) */
  distanceToPoiMeters: number | null

  /** Sequence order for multiple events in same message batch */
  sequenceOrder: number

  /**
   * Human-friendly POI identity for arrival/proximity events at a matched port or terminal.
   * All nullable — which fields are populated depends on the event type and how rich the
   * matched POI is (e.g. a PORT_ARRIVAL from a port's geometric center may only have `city`).
   * Resolved for display via {@link resolvePoiLocationName}.
   */
  portName?: string | null
  terminalName?: string | null
  city?: string | null

  /**
   * Human-friendly region name in Polish (e.g. "Morze Północne"), set for open-water
   * WAYPOINT_REACHED events that have no port/terminal/city. Null for port/terminal events.
   */
  regionNamePl?: string | null

  /** Human-friendly region name in English (e.g. "North Sea"). Null for port/terminal events — see {@link regionNamePl}. */
  regionNameEn?: string | null
}

// ─── Processed Event ─────────────────────────────────────────

/**
 * Processed POI event enriched with shipment context.
 */
export interface ProcessedPoiEvent {
  /** Original POI event */
  poiEvent: PoiProximityEvent

  /** IMO number (resolved from MMSI if needed) */
  vesselImo: string | null

  /** Matched shipment IDs */
  shipmentIds: string[]

  /** Event timestamp (from ata/atd or current time) */
  eventDateTime: Date

  /** POI code (arrived or departed) */
  poiCode: string | null

  /** Mapped event code for TrackingEvent */
  eventCode: string

  /** Source event ID for deduplication */
  sourceEventId: string
}

// ─── Event ID Mapping ────────────────────────────────────────

/**
 * POI event type string used in event IDs.
 * Maps ProximityEventType to the underscore-separated format used in event declarations.
 */
export type PoiEventTypeString =
  | 'port_arrival'
  | 'port_proximity_arrival'
  | 'port_departure'
  | 'terminal_arrival'
  | 'terminal_proximity_arrival'
  | 'terminal_departure'
  | 'waypoint_reached'

/**
 * Map ProximityEventType to the event type string used in event IDs.
 */
export const PROXIMITY_EVENT_TO_STRING: Record<ProximityEventType, PoiEventTypeString> = {
  PORT_ARRIVAL: 'port_arrival',
  PORT_PROXIMITY_ARRIVAL: 'port_proximity_arrival',
  PORT_PROXIMITY_DEPARTURE: 'port_departure',
  TERMINAL_ARRIVAL: 'terminal_arrival',
  TERMINAL_PROXIMITY_ARRIVAL: 'terminal_proximity_arrival',
  TERMINAL_PROXIMITY_DEPARTURE: 'terminal_departure',
  WAYPOINT_REACHED: 'waypoint_reached',
}

/**
 * Get the per-tracking-job event ID for a POI event type.
 * Used for notifications to avoid duplicates for multi-container bookings.
 *
 * @example
 * getJobPoiEventId('PORT_ARRIVAL') // 'shipment_tracking.tracking_job.poi.port_arrival'
 */
export function getJobPoiEventId(eventType: ProximityEventType): string {
  const typeString = PROXIMITY_EVENT_TO_STRING[eventType]
  return `shipment_tracking.tracking_job.poi.${typeString}`
}

/**
 * Get the per-shipment event ID for a POI event type.
 * Used for webhooks and external integrations.
 *
 * @example
 * getShipmentPoiEventId('PORT_ARRIVAL') // 'shipment_tracking.poi.port_arrival'
 */
export function getShipmentPoiEventId(eventType: ProximityEventType): string {
  const typeString = PROXIMITY_EVENT_TO_STRING[eventType]
  return `shipment_tracking.poi.${typeString}`
}
