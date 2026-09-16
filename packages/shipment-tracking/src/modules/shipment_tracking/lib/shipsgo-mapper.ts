/**
 * Maps ShipsGo shipment responses into the internal `CarrierFetchResult` shape,
 * so the existing ingestion pipeline (Shipment upsert, timestamps, status
 * machine, route inference, unit-sync) consumes ShipsGo exactly like a DCSA
 * carrier adapter.
 *
 * Ocean movement codes are translated onto the DCSA equipment/transport
 * vocabulary the downstream event-mapping already understands
 * (see dcsa-event-mapping.ts), so notifier events resolve unchanged.
 */
import type { CarrierFetchResult, CarrierFetchedEvent } from './carrier-adapter'
import type {
  TrackingEventType,
  TrackingEventClassifierCode,
  ModeOfTransport,
} from '../data/entities'
import type {
  ShipsGoOceanContainer,
  ShipsGoOceanMovement,
  ShipsGoOceanShipment,
  ShipsGoAirMovement,
  ShipsGoAirShipment,
} from './shipsgo-client'

// ShipsGo ocean event → { internal DCSA-style eventType + eventCode }.
// GTIN/LOAD/DISC/GTOT map 1:1; ARRV→ARRI (DCSA spelling); EMSH/EMRT use the
// closest DCSA equipment code so the notifier resolves (pick-up / drop-off).
const OCEAN_EVENT_MAP: Record<string, { eventType: TrackingEventType; eventCode: string }> = {
  EMSH: { eventType: 'EQUIPMENT', eventCode: 'PICK' }, // empty released to shipper
  GTIN: { eventType: 'EQUIPMENT', eventCode: 'GTIN' },
  LOAD: { eventType: 'EQUIPMENT', eventCode: 'LOAD' },
  DEPA: { eventType: 'TRANSPORT', eventCode: 'DEPA' },
  ARRV: { eventType: 'TRANSPORT', eventCode: 'ARRI' },
  DISC: { eventType: 'EQUIPMENT', eventCode: 'DISC' },
  GTOT: { eventType: 'EQUIPMENT', eventCode: 'GTOT' },
  EMRT: { eventType: 'EQUIPMENT', eventCode: 'DROP' }, // empty returned to depot
}

function classifier(status: 'EST' | 'ACT'): TrackingEventClassifierCode {
  return status === 'ACT' ? 'ACT' : 'EST'
}

/**
 * Deterministic id for dedup — ShipsGo movements have no stable identifier.
 * ACT (actual) movements key on their timestamp (immutable once they happen);
 * EST (estimated) movements OMIT the timestamp so a shifting estimate maps to
 * the same row and is refreshed in place (see the persistence loop) rather than
 * inserting a new event every poll.
 */
function movementId(container: string, m: ShipsGoOceanMovement): string {
  const tsKey = m.status === 'EST' ? 'EST' : m.timestamp
  return `${container}:${m.event}:${m.status}:${tsKey}`
}

function isLocode(code: string | null | undefined): boolean {
  return typeof code === 'string' && /^[A-Z]{2}[A-Z0-9]{3}$/.test(code)
}

/**
 * Extracts the local UTC offset from a ShipsGo ISO-8601 timestamp. ShipsGo dates
 * carry the movement's local (port/airport) offset — e.g. `+08:00` for a Beijing
 * departure — so `eventDateTime` (the UTC instant) alone loses the local wall
 * clock the carrier reported. We persist the offset in `eventDateTimeOffset` for
 * local-time display, matching the DCSA adapters. Returns null for UTC (`Z` or
 * `+00:00`), which is already the default.
 */
function isoOffset(ts: string): string | null {
  const match = ts.match(/([+-]\d{2}:\d{2})$/)
  if (!match || match[1] === '+00:00') return null
  return match[1]
}

/**
 * ShipsGo container size (feet, e.g. 40) + type (e.g. HC, GP, RF) → a readable
 * equipment code ("40HC"). Not a true ISO 6346 code, but it's the container-type
 * display slot and ShipsGo doesn't return the ISO code. Null when neither given.
 */
function equipmentCode(container: ShipsGoOceanContainer): string | null {
  const size = container.size != null ? String(container.size) : ''
  const type = container.type ?? ''
  const code = `${size}${type}`.trim()
  return code || null
}

function mapOceanMovement(
  container: ShipsGoOceanContainer,
  m: ShipsGoOceanMovement,
): CarrierFetchedEvent | null {
  const mapping = OCEAN_EVENT_MAP[m.event]
  if (!mapping) return null

  const ts = new Date(m.timestamp)
  if (Number.isNaN(ts.getTime())) return null

  const loc = m.location
  const hasVessel = Boolean(m.vessel?.name || m.vessel?.imo)

  return {
    source: 'shipsgo',
    sourceEventId: movementId(container.number, m),
    eventType: mapping.eventType,
    eventCode: mapping.eventCode,
    eventClassifierCode: classifier(m.status),
    eventDateTime: ts,
    eventDateTimeOffset: isoOffset(m.timestamp),
    description: `ShipsGo ${m.event} (${m.status})`,
    rawData: { provider: 'shipsgo', ...m },
    equipmentReference: container.number,
    isoEquipmentCode: equipmentCode(container),
    locationName: loc?.name ?? null,
    locationUnlocode: isLocode(loc?.code) ? loc?.code ?? null : null,
    locationCountry: loc?.country?.code ?? null,
    modeOfTransport: hasVessel ? ('VESSEL' as ModeOfTransport) : null,
    vesselName: m.vessel?.name ?? null,
    vesselImo: m.vessel?.imo != null ? String(m.vessel.imo) : null,
    voyageNumber: m.voyage ?? null,
  }
}

/**
 * ShipsGo shipment-level route summary → a compact object for `Shipment.extra`.
 * Origin/destination UNLOCODEs are already inferred from movement locations, so
 * this captures the extras: POL/POD names + planned/predicted dates, transit
 * time, transit %, transshipment count and CO2. Returns null when route is absent.
 */
function oceanRouteExtra(shipment: ShipsGoOceanShipment): Record<string, unknown> | null {
  const route = shipment.route
  if (!route) return null
  const pol = route.port_of_loading
  const pod = route.port_of_discharge
  const extra: Record<string, unknown> = {}
  if (pol?.location) extra.portOfLoading = { unlocode: pol.location.code ?? null, name: pol.location.name ?? null }
  if (pol?.date_of_loading) extra.dateOfLoading = pol.date_of_loading
  if (pod?.location) extra.portOfDischarge = { unlocode: pod.location.code ?? null, name: pod.location.name ?? null }
  if (pod?.date_of_discharge) extra.dateOfDischarge = pod.date_of_discharge
  if (pod?.date_of_discharge_predicted) extra.dateOfDischargePredicted = pod.date_of_discharge_predicted
  if (route.transit_time != null) extra.transitTimeDays = route.transit_time
  if (route.transit_percentage != null) extra.transitPercentage = route.transit_percentage
  if (route.ts_count != null) extra.transshipmentCount = route.ts_count
  if (route.co2_emission != null) extra.co2Emission = route.co2_emission
  return Object.keys(extra).length ? { shipsgoRoute: extra } : null
}

/**
 * Maps a full ShipsGo ocean shipment (with containers + movements) into a
 * `CarrierFetchResult`. Emits one event per movement per container; the
 * downstream pipeline discovers containers from `equipmentReference`.
 */
export function mapOceanShipmentToEvents(shipment: ShipsGoOceanShipment): CarrierFetchResult {
  const events: CarrierFetchedEvent[] = []
  let vesselName: string | null = null
  let vesselImo: string | null = null

  const containers = shipment.containers ?? []
  for (const container of containers) {
    const movements = container.movements ?? []
    for (const m of movements) {
      const event = mapOceanMovement(container, m)
      if (!event) continue
      events.push(event)
      // Track the most recent vessel seen (movements are chronological).
      if (event.vesselName) vesselName = event.vesselName
      if (event.vesselImo) vesselImo = event.vesselImo
    }
  }

  return {
    events,
    containerNumber: shipment.container_number ?? containers[0]?.number ?? null,
    bookingNumber: shipment.booking_number ?? null,
    bolNumber: null,
    vesselName,
    vesselImo,
    extra: oceanRouteExtra(shipment),
  }
}

// ─── Air ─────────────────────────────────────────────────────────────────────

// ShipsGo air event → internal event code. DEP/ARR are translated to the DCSA
// departure/arrival codes so the shared time-extraction (ATD/ATA) and timeline
// reuse unchanged; the rest keep their native code (informational only — air
// status is derived from ShipsGo's top-level status, see deriveAirShipmentStatus).
const AIR_EVENT_MAP: Record<string, string> = {
  RCS: 'RCS', // received from shipper
  MAN: 'MAN', // manifested
  DEP: 'DEPA', // departed
  ARR: 'ARRI', // arrived
  RCF: 'RCF', // received from flight
  DLV: 'DLVR', // delivered
}

/** Deterministic id for dedup — air movements have no stable identifier.
 * EST omits the timestamp (refreshed in place); ACT keys on it (immutable). */
function airMovementId(awb: string, m: ShipsGoAirMovement): string {
  const tsKey = m.status === 'EST' ? 'EST' : m.timestamp
  return `${awb}:${m.event}:${m.status}:${tsKey}`
}

function mapAirMovement(awb: string, m: ShipsGoAirMovement): CarrierFetchedEvent | null {
  const eventCode = AIR_EVENT_MAP[m.event]
  if (!eventCode) return null

  const ts = new Date(m.timestamp)
  if (Number.isNaN(ts.getTime())) return null

  const loc = m.location
  return {
    source: 'shipsgo',
    sourceEventId: airMovementId(awb, m),
    // Air movements are all transport-leg events (no container/equipment model).
    eventType: 'TRANSPORT',
    eventCode,
    eventClassifierCode: classifier(m.status),
    eventDateTime: ts,
    eventDateTimeOffset: isoOffset(m.timestamp),
    description: `ShipsGo air ${m.event} (${m.status})`,
    rawData: { provider: 'shipsgo', mode: 'air', ...m },
    // Air locations are IATA airports, not UN/LOCODEs — keep only the name/country.
    locationName: loc?.name ?? loc?.iata ?? null,
    locationUnlocode: null,
    locationCountry: loc?.country?.code ?? null,
    modeOfTransport: m.flight ? ('AIR' as ModeOfTransport) : null,
  }
}

/**
 * Maps a full ShipsGo air shipment into a `CarrierFetchResult`. Emits one event
 * per movement (no container fan-out); the downstream air branch creates a
 * single AWB-keyed Shipment and fills flight/airline + the top-level air status.
 */
export function mapAirShipmentToEvents(shipment: ShipsGoAirShipment): CarrierFetchResult {
  const awb = shipment.awb_number ?? shipment.reference ?? ''
  const events: CarrierFetchedEvent[] = []
  let flightNumber: string | null = null

  const movements = shipment.movements ?? []
  for (const m of movements) {
    const event = mapAirMovement(awb, m)
    if (!event) continue
    events.push(event)
    // Track the most recent flight seen (movements are chronological).
    if (m.flight) flightNumber = m.flight
  }

  return {
    events,
    containerNumber: null,
    bookingNumber: null,
    bolNumber: null,
    awbNumber: shipment.awb_number ?? null,
    flightNumber,
    airlineCode: shipment.airline?.iata ?? null,
    airlineName: shipment.airline?.name ?? null,
    airStatus: shipment.status ?? null,
    extra: airExtra(shipment),
  }
}

/**
 * ShipsGo air shipment-level extras → `Shipment.extra`: cargo (pieces/weight/
 * volume) and the pieces-per-status breakdown. Returns null when neither given.
 */
function airExtra(shipment: ShipsGoAirShipment): Record<string, unknown> | null {
  const extra: Record<string, unknown> = {}
  const c = shipment.cargo
  if (c && (c.pieces != null || c.weight != null || c.volume != null)) {
    extra.cargo = {
      pieces: c.pieces ?? null,
      weight: c.weight ?? null,
      weightUnit: c.weight_unit ?? null,
      volume: c.volume ?? null,
      volumeUnit: c.volume_unit ?? null,
    }
  }
  // Air route mirrors the ocean route (see oceanRouteExtra). Air locations are
  // IATA airports (not UN/LOCODEs), so event-based origin/destination inference
  // yields nothing — this is the only place origin/destination surface for air.
  const route = shipment.route
  if (route) {
    const r: Record<string, unknown> = {}
    const orig = route.origin
    const dest = route.destination
    if (orig?.location) r.origin = { iata: orig.location.iata ?? null, name: orig.location.name ?? null }
    if (orig?.date_of_dep) r.dateOfDeparture = orig.date_of_dep
    if (dest?.location) r.destination = { iata: dest.location.iata ?? null, name: dest.location.name ?? null }
    if (dest?.date_of_rcf) r.dateOfArrival = dest.date_of_rcf
    if (route.transit_time != null) r.transitTimeDays = route.transit_time
    if (route.transit_percentage != null) r.transitPercentage = route.transit_percentage
    if (route.ts_count != null) r.transshipmentCount = route.ts_count
    if (route.co2_emission != null) r.co2Emission = route.co2_emission
    if (Object.keys(r).length) extra.route = r
  }
  if (shipment.status_extended != null) extra.statusExtended = shipment.status_extended
  return Object.keys(extra).length ? { shipsgoAir: extra } : null
}
