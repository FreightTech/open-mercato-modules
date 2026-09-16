/**
 * Test Fixtures for Shipment Tracking
 *
 * Contains anonymized DCSA carrier API responses (MSC, Maersk, Hapag-Lloyd)
 * and AIS POI proximity events. All container/booking/BOL/vessel/IMO/MMSI
 * identifiers have been replaced with format-preserving fake values; the
 * payload shapes mirror the real carrier and AIS responses.
 */

import mscDirectRaw from './msc-direct.json'
import mscTransshipRaw from './msc-transship.json'
import mscMultiRaw from './msc-multi.json'
import mscMultiTransshipCompletedRaw from './msc-multi-transship-completed.json'
import maerskMultiTransshipCompletedRaw from './maersk-multi-transship-completed.json'
import maerskTransshipInTransitRaw from './maersk-transship-intransit.json'
import hapagLloydTransshipContainerRaw from './hapag-lloyd-transship-container.json'
import poiEventsRaw from './poi-events.json'
import type { PoiProximityEvent } from '../../lib/poi-types'

// Type for raw DCSA event from carrier APIs (MSC, Maersk, etc.)
// Note: Field names may vary slightly between carriers (e.g., eventId vs eventID)
export type RawDcsaEvent = {
  eventType: 'TRANSPORT' | 'EQUIPMENT' | 'SHIPMENT'
  transportEventTypeCode?: string
  equipmentEventTypeCode?: string
  shipmentEventTypeCode?: string
  eventId?: string // MSC uses eventId
  eventID?: string // Maersk uses eventID
  eventDateTime: string
  eventClassifierCode: 'ACT' | 'PLN' | 'EST'
  eventCreatedDateTime?: string
  description?: string
  equipmentReference?: string
  ISOEquipmentCode?: string
  emptyIndicatorCode?: 'EMPTY' | 'LADEN'
  transportCall?: {
    transportCallID?: string
    unLocationCode?: string // MSC format
    UNLocationCode?: string // Maersk format
    facilityCode?: string
    facilityCodeListProvider?: 'SMDG' | 'BIC'
    facilityTypeCode?: string
    modeOfTransport?: 'VESSEL' | 'RAIL' | 'TRUCK' | 'BARGE'
    vessel?: {
      vesselIMONumber?: string
      vesselName?: string
      vesselFlag?: string
      vesselCallSignNumber?: string
    } | null
    exportVoyageNumber?: string | null
    importVoyageNumber?: string | null
    location?: {
      locationName?: string
      latitude?: string
      longitude?: string
    }
  }
  eventLocation?: {
    locationName?: string
    unLocationCode?: string
    facilityCode?: string
    facilityCodeListProvider?: 'SMDG' | 'BIC'
  }
  documentReferences?: Array<{
    documentReferenceType: string
    documentReferenceValue: string
  }>
  seals?: Array<{
    sealNumber: string
    sealSource?: string
  }>
  references?: unknown[]
}

// Fixture metadata
export const fixtures = {
  /**
   * Single container, direct connection (no transshipment)
   * Booking: 100AA00A0000001S1
   * Container: MSCU1000001
   * Route: CNYTN (Yantian) -> PLGDN (Gdansk)
   * Vessel: EXAMPLE VESSEL 01
   */
  direct: {
    name: 'msc-direct',
    carrier: 'msc',
    booking: '100AA00A0000001S1',
    container: 'MSCU1000001',
    origin: 'CNYTN',
    destination: 'PLGDN',
    vessel: 'EXAMPLE VESSEL 01',
    events: mscDirectRaw as RawDcsaEvent[],
  },

  /**
   * Single container, transshipment scenario
   * Booking: 100AAAAAA0002V
   * Container: MSCU1000036
   * Route: CNTAO (Qingdao) -> CNNGB (Ningbo) -> PLGDN (Gdansk)
   * Vessels: EXAMPLE VESSEL 03 (1st leg), EXAMPLE VESSEL 04 (2nd leg)
   */
  transshipment: {
    name: 'msc-transship',
    carrier: 'msc',
    booking: '100AAAAAA0002V',
    container: 'MSCU1000036', // Note: MEDUAA000001 is the document reference, not container
    origin: 'CNTAO',
    transshipPort: 'CNNGB',
    destination: 'PLGDN',
    vessels: ['EXAMPLE VESSEL 03', 'EXAMPLE VESSEL 04'],
    events: mscTransshipRaw as RawDcsaEvent[],
  },

  /**
   * Multiple containers (32)
   * Booking: 100AAAAAA00003
   * Route: CNYTN (Yantian) -> PLGDN (Gdansk)
   */
  multiContainer: {
    name: 'msc-multi',
    carrier: 'msc',
    booking: '100AAAAAA00003',
    origin: 'CNYTN',
    destination: 'PLGDN',
    containerCount: 32,
    events: mscMultiRaw as RawDcsaEvent[],
    get containers(): string[] {
      const set = new Set<string>()
      for (const event of this.events) {
        if (event.equipmentReference) {
          set.add(event.equipmentReference)
        }
      }
      return [...set].sort()
    },
  },

  /**
   * Multiple containers with transshipment, completed voyage
   * Booking: ABCD00000001
   * Containers: MSCU1000034, MSCU1000035
   * Route: CRCAR (Costa Rica) -> CRMOB (Moín) -> BEANR (Antwerp, transship) -> PLGDY (Gdynia)
   * Status: DELIVERED (all containers have final GTIN at destination)
   */
  multiTransshipCompleted: {
    name: 'msc-multi-transship-completed',
    carrier: 'msc',
    booking: 'ABCD00000001',
    containers: ['MSCU1000034', 'MSCU1000035'],
    containerCount: 2,
    origin: 'CRMOB', // Moín, Costa Rica (port of loading)
    transshipPort: 'BEANR', // Antwerp, Belgium
    destination: 'PLGDY', // Gdynia, Poland
    events: mscMultiTransshipCompletedRaw as RawDcsaEvent[],
    eventCount: 20,
    // Journey stages:
    // 1. CRCAR: GTOT (gate out from inland depot)
    // 2. CRMOB: GTIN, LOAD (port of origin)
    // 3. Leg 1: DEPA -> ARRI (to Antwerp)
    // 4. BEANR: DISC, LOAD (transshipment)
    // 5. Leg 2: DEPA -> ARRI (to Gdynia)
    // 6. PLGDY: DISC, GTOT, GTIN (delivery complete)
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Maersk Fixtures (real DCSA API responses)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Maersk: Multiple containers with multi-transshipment, completed voyage
   * BOL: 900000002
   * Containers: MAEU1000002, MAEU1000001
   * Route: TRKMX (Ambarli, Istanbul area) -> TRYAR (Yarimca, port of loading) -> GBFXT (Felixstowe, transship 1)
   *        -> DEBRV (Bremerhaven, transship 2) -> PLGDN (Gdansk, destination)
   * Status: DELIVERED (completed voyage with all equipment events)
   * Vessels: EXAMPLE VESSEL 07 (leg 1), EXAMPLE VESSEL 08 (leg 2), EXAMPLE VESSEL 06 (leg 3)
   */
  maerskMultiTransshipCompleted: {
    name: 'maersk-multi-transship-completed',
    carrier: 'maersk',
    bol: '900000002',
    containers: ['MAEU1000002', 'MAEU1000001'],
    containerCount: 2,
    inlandDepot: 'TRKMX', // Ambarli (Kumport Terminal), Istanbul area
    origin: 'TRYAR', // Yarimca, Turkey (DP World Terminal - port of loading)
    transshipPorts: ['GBFXT', 'DEBRV'], // Felixstowe + Bremerhaven
    destination: 'PLGDN', // Gdansk, Poland
    vessels: ['EXAMPLE VESSEL 07', 'EXAMPLE VESSEL 08', 'EXAMPLE VESSEL 06'],
    events: maerskMultiTransshipCompletedRaw as RawDcsaEvent[],
    eventCount: 37,
    // Journey stages:
    // 1. TRKMX: GTOT (gate out from inland depot - Kumport Terminal Ambarli)
    // 2. TRYAR: GTIN, LOAD (port of loading - DP World Yarimca)
    // 3. Leg 1: DEPA TRYAR -> ARRI GBFXT (EXAMPLE VESSEL 07)
    // 4. GBFXT: DISC, LOAD (transshipment 1 - Felixstowe Trinity Terminal)
    // 5. Leg 2: DEPA GBFXT -> ARRI DEBRV (EXAMPLE VESSEL 08)
    // 6. DEBRV: DISC, LOAD (transshipment 2 - Bremerhaven)
    // 7. Leg 3: DEPA DEBRV -> ARRI PLGDN (EXAMPLE VESSEL 06)
    // 8. PLGDN: DISC, GTOT (delivery - DCT Gdansk)
  },

  /**
   * Maersk: Single container with multi-transshipment, in-transit
   * Container: MAEU1000003
   * Route: CNTXG (Tianjin/Xingang) -> MYTPP (Tanjung Pelepas, transship 1)
   *        -> DEWVN (Wilhelmshaven, EST) -> PLGDN (Gdansk, EST destination)
   * Status: IN_TRANSIT (last 3 events are EST - not yet arrived at Wilhelmshaven)
   * Vessels: EXAMPLE VESSEL 10 (leg 1), EXAMPLE VESSEL 09 (leg 2), EXAMPLE VESSEL 11 (leg 3)
   */
  maerskTransshipInTransit: {
    name: 'maersk-transship-intransit',
    carrier: 'maersk',
    container: 'MAEU1000003',
    origin: 'CNTXG', // Tianjin/Xingang, China (Tianjin PAC Intl Container Terminal)
    transshipPorts: ['MYTPP', 'DEWVN'], // Tanjung Pelepas + Wilhelmshaven
    destination: 'PLGDN', // Gdansk, Poland
    vessels: ['EXAMPLE VESSEL 10', 'EXAMPLE VESSEL 09', 'EXAMPLE VESSEL 11'],
    events: maerskTransshipInTransitRaw as RawDcsaEvent[],
    eventCount: 14,
    // Journey stages:
    // 1. CNTXG: Equipment events at origin (Tianjin PAC Terminal)
    // 2. Leg 1: ACT DEPA CNTXG -> ACT ARRI MYTPP (EXAMPLE VESSEL 10)
    // 3. MYTPP: Equipment events at transshipment 1 (Pelabuhan Tanjung Pelepas)
    // 4. Leg 2: ACT DEPA MYTPP -> EST ARRI DEWVN (EXAMPLE VESSEL 09) - currently in transit
    // 5. DEWVN: (future) transshipment 2 - Wilhelmshaven
    // 6. Leg 3: EST DEPA DEWVN -> EST ARRI PLGDN (EXAMPLE VESSEL 11) - planned
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Hapag-Lloyd Fixtures (real DCSA API responses)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Hapag-Lloyd: Single container with transshipment
   * BOL: 90000001
   * Container: HLCU1000001
   * Route: PLGDY (Gdynia, Poland) -> DEWVN (Wilhelmshaven, transship) -> USORF (Norfolk, VA) -> USCHI (Chicago, destination)
   * Status: IN_TRANSIT (rail leg to Chicago - last events show LOAD at Chicago rail terminal)
   * Vessels: EXAMPLE VESSEL 12 (leg 1: Gdynia -> Wilhelmshaven), EXAMPLE VESSEL 13 (leg 2: Wilhelmshaven -> Norfolk)
   * Note: This is an export shipment from Poland to USA with inland rail delivery to Chicago
   */
  hapagLloydTransshipContainer: {
    name: 'hapag-lloyd-transship-container',
    carrier: 'hapag-lloyd',
    bol: '90000001',
    container: 'HLCU1000001',
    origin: 'PLGDY', // Gdynia, Poland (Gdynia Container Terminal)
    transshipPorts: ['DEWVN'], // Wilhelmshaven, Germany (Eurogate Container Terminal)
    portOfDischarge: 'USORF', // Norfolk, VA (Norfolk Intl Terminal)
    destination: 'USCHI', // Chicago, IL (final inland destination via rail)
    vessels: ['EXAMPLE VESSEL 12', 'EXAMPLE VESSEL 13'],
    events: hapagLloydTransshipContainerRaw as RawDcsaEvent[],
    eventCount: 20,
    // Journey stages (chronological):
    // 1. PLGDY: GTIN (truck), LOAD (vessel) - origin gate-in and loading
    // 2. Leg 1: DEPA PLGDY -> ARRI DEWVN (EXAMPLE VESSEL 12, voyage 2601W)
    // 3. DEWVN: DISC, LOAD - transshipment at Wilhelmshaven
    // 4. Leg 2: DEPA DEWVN -> ARRI USORF (EXAMPLE VESSEL 13, voyage 601W)
    // 5. USORF: DISC (vessel), LOAD (rail), GTOT (rail) - port discharge and rail handoff
    // 6. USCHI: GTIN (rail), GTOT (truck), GTIN (truck), LOAD (rail) - inland delivery via Norfolk Southern
    // Note: Events include both ACT (actual) and PLN (planned) events
  },
} as const

/**
 * Helper to extract unique containers from events
 */
export function extractContainers(events: RawDcsaEvent[]): string[] {
  const set = new Set<string>()
  for (const event of events) {
    if (event.equipmentReference) {
      set.add(event.equipmentReference)
    }
  }
  return [...set].sort()
}

/**
 * Helper to filter events by container
 */
export function filterEventsByContainer(events: RawDcsaEvent[], container: string): RawDcsaEvent[] {
  return events.filter((event) => {
    // TRANSPORT events apply to all containers
    if (event.eventType === 'TRANSPORT') return true
    // EQUIPMENT events are container-specific
    return event.equipmentReference === container
  })
}

/**
 * Helper to get events in chronological order
 */
export function sortEventsByTime(events: RawDcsaEvent[]): RawDcsaEvent[] {
  return [...events].sort((a, b) => {
    return new Date(a.eventDateTime).getTime() - new Date(b.eventDateTime).getTime()
  })
}

/**
 * Helper to create a subset of events for incremental testing
 * Useful for simulating multiple poll cycles
 */
export function sliceEvents(events: RawDcsaEvent[], count: number): RawDcsaEvent[] {
  const sorted = sortEventsByTime(events)
  return sorted.slice(0, count)
}

/**
 * Helper to create test scope
 */
export function createTestScope() {
  return {
    tenantId: '00000000-0000-0000-0000-000000000001',
    organizationId: '00000000-0000-0000-0000-000000000002',
  }
}

/**
 * Helper to create mock carrier fetch result from fixture events
 */
export function createMockFetchResult(events: RawDcsaEvent[]) {
  // Extract booking number from first event with document references
  let bookingNumber: string | null = null
  let vesselName: string | null = null
  let vesselImo: string | null = null

  for (const event of events) {
    if (!bookingNumber && event.documentReferences) {
      const bkg = event.documentReferences.find((ref) => ref.documentReferenceType === 'BKG')
      if (bkg) bookingNumber = bkg.documentReferenceValue
    }
    if (!vesselName && event.transportCall?.vessel) {
      vesselName = event.transportCall.vessel.vesselName ?? null
      vesselImo = event.transportCall.vessel.vesselIMONumber ?? null
    }
    if (bookingNumber && vesselName) break
  }

  return {
    events,
    bookingNumber,
    vesselName,
    vesselImo,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POI Proximity Event Fixtures (real NATS messages from AIS system)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POI proximity events representative of the AIS NATS stream.
 * These mirror the shape of messages emitted by the poi-proximity-detector
 * service (JetStream stream `AIS_STREAM`, subject `ais.ship.proximity.events`).
 * The connection URL is deployment-specific (configure via `NATS_URL`).
 */
export const poiFixtures = {
  /**
   * WAYPOINT_REACHED events - vessel passed through a navigation waypoint
   */
  waypointReached: poiEventsRaw.waypointReached as PoiProximityEvent[],

  /**
   * PORT_ARRIVAL events - vessel arrived at a port (actual arrival)
   */
  portArrival: poiEventsRaw.portArrival as PoiProximityEvent[],

  /**
   * TERMINAL_ARRIVAL events - vessel arrived at a terminal within a port
   */
  terminalArrival: poiEventsRaw.terminalArrival as PoiProximityEvent[],

  /**
   * PORT_PROXIMITY_ARRIVAL events - vessel approaching a port
   */
  portProximityArrival: poiEventsRaw.portProximityArrival as PoiProximityEvent[],

  /**
   * TERMINAL_PROXIMITY_ARRIVAL events - vessel approaching a terminal
   */
  terminalProximityArrival: poiEventsRaw.terminalProximityArrival as PoiProximityEvent[],

  /**
   * PORT_PROXIMITY_DEPARTURE events - vessel departing from a port area
   */
  portProximityDeparture: poiEventsRaw.portProximityDeparture as PoiProximityEvent[],

  /**
   * TERMINAL_PROXIMITY_DEPARTURE events - vessel departing from a terminal area
   */
  terminalProximityDeparture: poiEventsRaw.terminalProximityDeparture as PoiProximityEvent[],

  /**
   * Invalid/malformed messages for testing validation
   */
  invalidMessages: poiEventsRaw.invalidMessages as unknown[],

  /**
   * Get all valid POI events (all types combined)
   */
  get allValidEvents(): PoiProximityEvent[] {
    return [
      ...this.waypointReached,
      ...this.portArrival,
      ...this.terminalArrival,
      ...this.portProximityArrival,
      ...this.terminalProximityArrival,
      ...this.portProximityDeparture,
      ...this.terminalProximityDeparture,
    ]
  },

  /**
   * Get all arrival events (PORT_ARRIVAL, TERMINAL_ARRIVAL, proximity arrivals)
   */
  get allArrivalEvents(): PoiProximityEvent[] {
    return [
      ...this.portArrival,
      ...this.terminalArrival,
      ...this.portProximityArrival,
      ...this.terminalProximityArrival,
    ]
  },

  /**
   * Get all departure events (proximity departures)
   */
  get allDepartureEvents(): PoiProximityEvent[] {
    return [
      ...this.portProximityDeparture,
      ...this.terminalProximityDeparture,
    ]
  },
}
