/**
 * Route extraction utilities for shipment tracking.
 * 
 * Extracts route stops from tracking events for display in the shipment details drawer.
 * This logic is shared between:
 * - TrackingService (when populating denormalized data on shipment)
 * - ShipmentDetailsDrawer (as types reference)
 */

// ─── Types ───────────────────────────────────────────────────

/**
 * Seal information for a container.
 */
export interface SealInfo {
  number: string
  source?: string | null  // CAR (carrier), SHI (shipper), TER (terminal), CUS (customs)
  type?: string | null
}

/**
 * A stop along the shipment's route (origin, transshipment, or destination).
 * Stored as JSONB on the Shipment entity.
 * 
 * Includes facility/terminal details from DCSA events for rich location display.
 */
export interface RouteStopEntry {
  // Core fields
  location: string                     // Terminal or port name
  unlocode?: string | null             // UN/LOCODE (e.g., "PLGDN")
  // 'transshipment' = cargo changes vessels here; 'port_call' = same vessel calls en route
  type: 'origin' | 'transshipment' | 'port_call' | 'destination'
  vesselName?: string | null           // Vessel name for this leg
  vesselImo?: string | null            // Vessel IMO number for vessel tracking
  
  // Timestamps
  ata?: string | null                  // Actual arrival - ISO datetime string
  atd?: string | null                  // Actual departure - ISO datetime string
  eta?: string | null                  // Estimated arrival - ISO datetime string (for delay calculation)
  etd?: string | null                  // Estimated departure - ISO datetime string (for delay calculation)
  
  // Facility/terminal details (from DCSA events)
  countryCode?: string | null          // ISO 3166-1 alpha-2 (e.g., "PL")
  facilityCode?: string | null         // SMDG/BIC code (e.g., "DCT")
  facilityCodeListProvider?: 'BIC' | 'SMDG' | null
  facilityTypeCode?: string | null     // POTE (port terminal), DEPO (depot), etc.
  facilityAddress?: string | null      // Full address string from DCSA otherFacility
  coords?: {
    latitude: number
    longitude: number
  } | null
  
  // From BIC enrichment (optional)
  operatorName?: string | null
}

/**
 * A cargo/tracking event entry for a specific container.
 * Stored as JSONB on the Shipment entity.
 * 
 * Includes facility details from DCSA events for route extraction.
 */
export interface CargoEventEntry {
  // Core fields
  id: string
  eventType: string
  eventCode: string
  eventClassifierCode?: 'ACT' | 'PLN' | 'EST' | null
  eventDateTime: string                // ISO datetime string
  description?: string | null
  
  // Location fields
  locationName?: string | null
  locationUnlocode?: string | null

  // Human-friendly region names for AIS POI events (localized at render). Null for carrier events.
  regionNamePl?: string | null
  regionNameEn?: string | null

  // Vessel/voyage fields
  vesselName?: string | null
  vesselImo?: string | null
  voyageNumber?: string | null
  isTransshipmentMove?: boolean | null
  
  emptyIndicatorCode?: 'EMPTY' | 'LADEN' | null

  // Facility/terminal details (from DCSA events)
  facilityCode?: string | null         // SMDG/BIC code (e.g., "DCT")
  facilityCodeListProvider?: 'BIC' | 'SMDG' | null
  facilityTypeCode?: string | null     // POTE, DEPO, etc.
  facilityAddress?: string | null      // Full address string
  latitude?: number | null
  longitude?: number | null
  
  // Seal information (from DCSA events)
  seals?: SealInfo[] | null
}

/**
 * Context for route extraction - provides origin/destination hints.
 */
export interface RouteExtractionContext {
  originUnlocode?: string | null
  destinationUnlocode?: string | null
}

// ─── Route Extraction ────────────────────────────────────────

/**
 * AIS POI event codes that are too fine-grained for Route Details and are
 * skipped during route extraction:
 * - WAYR (waypoint reached) — open-water grid codes (e.g. "N051E001-00773"), no real place
 * - TARR / TPRA / TPRD (terminal arrival / proximity arrival / proximity departure)
 *
 * Port-level AIS events (PARR/PPRA/PPRD) and all carrier/DCSA milestones
 * (ARRI/DEPA/GTIN/GTOT/LOAD/DISC, …) are kept — they define the route.
 * Excluded events remain in the Journey Timeline (cargoEvents).
 */
const ROUTE_DETAIL_EXCLUDED_EVENT_CODES = new Set(['WAYR', 'TARR', 'TPRA', 'TPRD'])

// ISO datetime strings are UTC (toISOString), so lexicographic compare == chronological.
function earliestIso(a?: string | null, b?: string | null): string | null {
  if (!a) return b ?? null
  if (!b) return a
  return a < b ? a : b
}
function latestIso(a?: string | null, b?: string | null): string | null {
  if (!a) return b ?? null
  if (!b) return a
  return a > b ? a : b
}

/**
 * Extracts route stops from a list of cargo events.
 * 
 * The algorithm:
 * 1. Sorts events chronologically
 * 2. Groups events by location (unlocode or name)
 * 3. Tracks vessels, arrival/departure times, and transshipment indicators
 * 4. Assigns type (origin/transshipment/destination) based on position and context
 * 
 * @param events - Array of cargo events (already filtered for specific container)
 * @param context - Optional context with origin/destination hints
 * @returns Array of route stops in chronological order
 */
export function extractRouteFromEvents(
  events: CargoEventEntry[],
  context?: RouteExtractionContext
): RouteStopEntry[] {
  if (!events || events.length === 0) {
    return []
  }

  // Sort events by datetime
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.eventDateTime).getTime() - new Date(b.eventDateTime).getTime()
  )

  // Build location map with timestamps and facility data
  // vessels is a Map of vesselName -> vesselImo (to track IMO alongside name)
  const locationMap = new Map<string, {
    name: string
    unlocode?: string | null
    countryCode?: string | null
    vessels: Map<string, string | null>  // vesselName -> vesselImo
    ata?: string
    atd?: string
    eta?: string
    etd?: string
    isTransshipment: boolean
    // Facility data from events
    facilityCode?: string | null
    facilityCodeListProvider?: 'BIC' | 'SMDG' | null
    facilityTypeCode?: string | null
    facilityAddress?: string | null
    coords?: { latitude: number; longitude: number } | null
  }>()

  for (const event of sortedEvents) {
    // Skip fine-grained AIS POI events (waypoints + terminals) — Route Details
    // shows port-level stops only. See ROUTE_DETAIL_EXCLUDED_EVENT_CODES.
    if (ROUTE_DETAIL_EXCLUDED_EVENT_CODES.has(event.eventCode)) continue

    const loc = event.locationUnlocode || event.locationName
    if (!loc) continue

    if (!locationMap.has(loc)) {
      // Extract country code from UN/LOCODE (first 2 chars)
      const countryCode = event.locationUnlocode?.length === 5
        ? event.locationUnlocode.slice(0, 2)
        : null

      locationMap.set(loc, {
        name: event.locationName || loc,
        unlocode: event.locationUnlocode || null,
        countryCode,
        vessels: new Map<string, string | null>(),
        isTransshipment: false,
        // Initialize facility fields
        facilityCode: null,
        facilityCodeListProvider: null,
        facilityTypeCode: null,
        facilityAddress: null,
        coords: null,
      })
    }

    const entry = locationMap.get(loc)!

    // Update facility data if this event has more complete info
    // Prefer events with facility codes over those without
    if (event.facilityCode && !entry.facilityCode) {
      entry.facilityCode = event.facilityCode
      entry.facilityCodeListProvider = event.facilityCodeListProvider || null
    }
    if (event.facilityTypeCode && !entry.facilityTypeCode) {
      entry.facilityTypeCode = event.facilityTypeCode
    }
    if (event.facilityAddress && !entry.facilityAddress) {
      entry.facilityAddress = event.facilityAddress
    }
    if (event.latitude != null && event.longitude != null && !entry.coords) {
      entry.coords = { latitude: event.latitude, longitude: event.longitude }
    }

    if (event.vesselName) {
      // Store vessel name with its IMO (may be null)
      // If we already have this vessel, only update if the new event has an IMO
      const existingImo = entry.vessels.get(event.vesselName)
      if (!existingImo && event.vesselImo) {
        entry.vessels.set(event.vesselName, event.vesselImo)
      } else if (!entry.vessels.has(event.vesselName)) {
        entry.vessels.set(event.vesselName, event.vesselImo || null)
      }
    }

    // Track actual arrivals/departures
    // ARRI = vessel arrival at port
    // GTIN = gate-in (container enters terminal via truck/rail - indicates arrival for inland segments)
    // For the first segment (depot to port), GTIN at the port indicates the container arrived there
    if (event.eventCode === 'ARRI' && event.eventClassifierCode === 'ACT') {
      entry.ata = event.eventDateTime
    }
    // Use GTIN as arrival indicator for port terminals when no ARRI event exists
    // This handles the depot-to-port segment where container arrives by truck
    if (event.eventCode === 'GTIN' && event.eventClassifierCode === 'ACT' && !entry.ata) {
      // Only use GTIN as arrival if it's at a port terminal (POTE) or intermodal (INTE)
      if (event.facilityTypeCode === 'POTE' || event.facilityTypeCode === 'INTE') {
        entry.ata = event.eventDateTime
      }
    }
    if (event.eventCode === 'DEPA' && event.eventClassifierCode === 'ACT') {
      entry.atd = event.eventDateTime
    }
    // Use GTOT (gate-out) as departure indicator for depots/terminals
    // This handles the first segment where container departs depot by truck
    if (event.eventCode === 'GTOT' && event.eventClassifierCode === 'ACT' && !entry.atd) {
      entry.atd = event.eventDateTime
    }

    // AIS port proximity events. Only ports survive into Route Details (waypoints +
    // terminals are filtered out above), so these are the arrival/departure signals for
    // AIS-tracked port calls — without them an AIS-only stop (e.g. a transshipment port
    // not in the DCSA feed) has no ATA/ATD and its segment bars never turn green.
    // Applied only when no carrier (DCSA) timestamp exists, so DCSA ATA/ATD always win.
    // PARR = port arrival, PPRA = port proximity arrival, PPRD = port proximity departure.
    if (
      (event.eventCode === 'PARR' || event.eventCode === 'PPRA') &&
      event.eventClassifierCode === 'ACT' &&
      !entry.ata
    ) {
      entry.ata = event.eventDateTime
    }
    if (event.eventCode === 'PPRD' && event.eventClassifierCode === 'ACT' && !entry.atd) {
      entry.atd = event.eventDateTime
    }

    // Track estimated/planned arrivals/departures (for delay calculation)
    // Only store the first estimate (original plan) to compare against actual
    if (event.eventCode === 'ARRI' && (event.eventClassifierCode === 'PLN' || event.eventClassifierCode === 'EST')) {
      if (!entry.eta) entry.eta = event.eventDateTime
    }
    if (event.eventCode === 'DEPA' && (event.eventClassifierCode === 'PLN' || event.eventClassifierCode === 'EST')) {
      if (!entry.etd) entry.etd = event.eventDateTime
    }

    // Mark transshipment if container was discharged and loaded
    if (event.isTransshipmentMove || 
        (event.eventCode === 'DISC' || event.eventCode === 'LOAD')) {
      entry.isTransshipment = true
    }
  }

  // Convert to route stops
  const stops: RouteStopEntry[] = []
  const locations = Array.from(locationMap.entries())

  for (let i = 0; i < locations.length; i++) {
    const [key, data] = locations[i]
    const isFirst = i === 0
    const isLast = i === locations.length - 1

    // Determine type based on position and context.
    // An intermediate stop is a real 'transshipment' only when the cargo actually
    // changed vessels here (isTransshipmentMove / DISC+LOAD); otherwise it's a plain
    // 'port_call' — the same vessel calling en route (e.g. AIS port proximity events).
    let type: 'origin' | 'transshipment' | 'port_call' | 'destination' =
      data.isTransshipment ? 'transshipment' : 'port_call'

    if (isFirst || key === context?.originUnlocode) {
      type = 'origin'
    } else if (isLast || key === context?.destinationUnlocode) {
      type = 'destination'
    }

    // Get the last vessel entry (most recent vessel at this stop)
    const vesselEntries = Array.from(data.vessels.entries())
    const lastVessel = vesselEntries.length > 0 ? vesselEntries[vesselEntries.length - 1] : null
    const vesselName = lastVessel ? lastVessel[0] : null
    const vesselImo = lastVessel ? lastVessel[1] : null

    stops.push({
      location: data.name,
      unlocode: data.unlocode,
      type,
      vesselName,
      vesselImo,
      ata: data.ata || null,
      atd: data.atd || null,
      eta: data.eta || null,
      etd: data.etd || null,
      // Facility details
      countryCode: data.countryCode || null,
      facilityCode: data.facilityCode || null,
      facilityCodeListProvider: data.facilityCodeListProvider || null,
      facilityTypeCode: data.facilityTypeCode || null,
      facilityAddress: data.facilityAddress || null,
      coords: data.coords || null,
      operatorName: null, // Will be populated by BIC enrichment if needed
    })
  }

  // Collapse consecutive stops at the same place into one port call. AIS port events for a
  // single city can arrive under several POI codes (proximity vs actual arrival, different
  // berths), which would otherwise render as duplicate rows (e.g. two "Le Havre") with split
  // timestamps — breaking segment colors. Merge by location name, keeping the earliest
  // arrival and latest departure so segment status is computed correctly.
  const merged: RouteStopEntry[] = []
  for (const stop of stops) {
    const prev = merged[merged.length - 1]
    if (prev && prev.location === stop.location) {
      prev.ata = earliestIso(prev.ata, stop.ata)
      prev.atd = latestIso(prev.atd, stop.atd)
      prev.eta = earliestIso(prev.eta, stop.eta)
      prev.etd = latestIso(prev.etd, stop.etd)
      prev.vesselName = prev.vesselName ?? stop.vesselName
      prev.vesselImo = prev.vesselImo ?? stop.vesselImo
      // Prefer a real UN/LOCODE over a raw AIS POI grid code
      if (prev.unlocode?.length !== 5 && stop.unlocode?.length === 5) prev.unlocode = stop.unlocode
      prev.countryCode = prev.countryCode ?? stop.countryCode
      prev.facilityCode = prev.facilityCode ?? stop.facilityCode
      prev.facilityCodeListProvider = prev.facilityCodeListProvider ?? stop.facilityCodeListProvider
      prev.facilityTypeCode = prev.facilityTypeCode ?? stop.facilityTypeCode
      prev.facilityAddress = prev.facilityAddress ?? stop.facilityAddress
      prev.coords = prev.coords ?? stop.coords
      // Promote type if a merged member is an endpoint (origin/destination beats transshipment)
      if (stop.type === 'origin') prev.type = 'origin'
      else if (stop.type === 'destination' && prev.type !== 'origin') prev.type = 'destination'
      else if (stop.type === 'transshipment' && prev.type === 'port_call') prev.type = 'transshipment'
      continue
    }
    merged.push({ ...stop })
  }

  return merged
}

// ─── Event Mapping ───────────────────────────────────────────

/**
 * Maps a TrackingEvent entity to a CargoEventEntry for storage.
 * 
 * @param event - The tracking event entity
 * @returns A simplified event entry suitable for JSONB storage
 */
export function mapTrackingEventToEntry(event: {
  id: string
  eventType: string
  eventCode: string
  eventClassifierCode?: string | null
  eventDateTime: Date
  description?: string | null
  locationName?: string | null
  locationUnlocode?: string | null
  regionNamePl?: string | null
  regionNameEn?: string | null
  vesselName?: string | null
  vesselImo?: string | null
  voyageNumber?: string | null
  isTransshipmentMove?: boolean | null
  emptyIndicatorCode?: 'EMPTY' | 'LADEN' | null
  // Facility fields
  facilityCode?: string | null
  facilityCodeListProvider?: 'BIC' | 'SMDG' | null
  facilityTypeCode?: string | null
  facilityAddress?: string | null
  latitude?: number | null
  longitude?: number | null
  // Seal fields
  seals?: SealInfo[] | null
}): CargoEventEntry {
  return {
    id: event.id,
    eventType: event.eventType,
    eventCode: event.eventCode,
    eventClassifierCode: event.eventClassifierCode as 'ACT' | 'PLN' | 'EST' | null,
    eventDateTime: event.eventDateTime.toISOString(),
    description: event.description || null,
    locationName: event.locationName || null,
    locationUnlocode: event.locationUnlocode || null,
    regionNamePl: event.regionNamePl || null,
    regionNameEn: event.regionNameEn || null,
    vesselName: event.vesselName || null,
    vesselImo: event.vesselImo || null,
    voyageNumber: event.voyageNumber || null,
    isTransshipmentMove: event.isTransshipmentMove ?? null,
    emptyIndicatorCode: event.emptyIndicatorCode ?? null,
    // Facility fields
    facilityCode: event.facilityCode || null,
    facilityCodeListProvider: event.facilityCodeListProvider || null,
    facilityTypeCode: event.facilityTypeCode || null,
    facilityAddress: event.facilityAddress || null,
    latitude: event.latitude ?? null,
    longitude: event.longitude ?? null,
    // Seal fields
    seals: event.seals ?? null,
  }
}
