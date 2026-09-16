import type { TrackingEventType, TrackingEventClassifierCode, TrackingEventSource, TrackingReferenceType } from '../data/entities'
import type { SealInfo } from './route-extraction'

export type { SealInfo } from './route-extraction'

export type DocumentReference = {
  type: string // BKG, TRD, SHI, CBR, ARN, VGM, etc.
  value: string
}

export type CarrierFetchedEvent = {
  // ─── Event Source ──────────────────────────────────────────────
  source: TrackingEventSource
  sourceEventId: string // Original ID from the source system (e.g., DCSA eventId)

  // ─── Core Event Fields ─────────────────────────────────────────
  eventType: TrackingEventType
  eventCode: string
  eventClassifierCode?: TrackingEventClassifierCode | null
  eventDateTime: Date
  eventDateTimeOffset?: string | null
  description?: string | null
  rawData?: Record<string, unknown> | null

  // ─── Equipment Fields (DCSA EQUIPMENT events) ──────────────────
  equipmentReference?: string | null // Container number (BIC ISO)
  isoEquipmentCode?: string | null // Container type (22G1, 45R1, etc.)
  emptyIndicatorCode?: 'EMPTY' | 'LADEN' | null
  isTransshipmentMove?: boolean | null

  // ─── Location Fields ───────────────────────────────────────────
  locationName?: string | null
  locationUnlocode?: string | null
  locationCountry?: string | null
  facilityCode?: string | null // Terminal/depot code (SMDG/BIC)
  facilityCodeListProvider?: 'SMDG' | 'BIC' | null
  facilityTypeCode?: string | null // POTE, DEPO, CLOC, COFS, etc.
  facilityAddress?: string | null // Full address string (from DCSA otherFacility)
  latitude?: number | null
  longitude?: number | null

  // ─── Transport Call Fields ─────────────────────────────────────
  transportCallReference?: string | null
  modeOfTransport?: 'VESSEL' | 'RAIL' | 'TRUCK' | 'BARGE' | 'AIR' | null
  vesselName?: string | null
  vesselImo?: string | null
  voyageNumber?: string | null
  carrierServiceCode?: string | null
  carrierExportVoyageNumber?: string | null
  carrierImportVoyageNumber?: string | null
  universalServiceReference?: string | null
  universalExportVoyageReference?: string | null
  universalImportVoyageReference?: string | null
  portVisitReference?: string | null

  // ─── Document References ───────────────────────────────────────
  relatedDocumentReferences?: DocumentReference[] | null

  // ─── Metadata Fields ───────────────────────────────────────────
  eventCreatedDateTime?: Date | null
  retractedEventId?: string | null
  publisherName?: string | null
  publisherRole?: string | null // CA, AG, VSL, TR, etc.

  // ─── Additional Event Fields ───────────────────────────────────
  delayReasonCode?: string | null // SMDG delay reason code
  changeRemark?: string | null
  seals?: SealInfo[] | null
}

export type CarrierAdapterTestResult = {
  success: boolean
  message: string
  latencyMs?: number
}

export type CarrierFetchResult = {
  events: CarrierFetchedEvent[]
  containerNumber?: string | null
  bookingNumber?: string | null
  bolNumber?: string | null
  vesselName?: string | null
  vesselImo?: string | null
  // ─── Air (mode='air') ──────────────────────────────────────────
  // Air shipments have no container/vessel; identity is the AWB + flight/airline.
  awbNumber?: string | null
  flightNumber?: string | null
  airlineCode?: string | null
  airlineName?: string | null
  /** ShipsGo top-level air status (NEW/BOOKED/EN_ROUTE/LANDED/DELIVERED/…). */
  airStatus?: string | null
  /**
   * Provider shipment-level metadata that has no dedicated column — merged into
   * `Shipment.extra`. Ocean: ShipsGo route summary (POL/POD + dates, transit
   * time, CO2, transshipments). Air: cargo (pieces/weight/volume) + status_extended.
   */
  extra?: Record<string, unknown> | null
}

/**
 * Extracts booking and BOL numbers from DCSA document references across all events.
 * BKG = Booking reference, TRD/SHI = Transport Document / Shipping Instruction (BOL).
 */
export function extractDocumentReferences(events: CarrierFetchedEvent[]): {
  bookingNumber: string | null
  bolNumber: string | null
} {
  let bookingNumber: string | null = null
  let bolNumber: string | null = null
  for (const event of events) {
    if (!event.relatedDocumentReferences) continue
    for (const ref of event.relatedDocumentReferences) {
      if (!bookingNumber && ref.type === 'BKG' && ref.value) bookingNumber = ref.value
      if (!bolNumber && (ref.type === 'TRD' || ref.type === 'SHI') && ref.value) bolNumber = ref.value
      if (bookingNumber && bolNumber) return { bookingNumber, bolNumber }
    }
  }
  return { bookingNumber, bolNumber }
}

export interface CarrierAdapter {
  readonly carrierCode: string
  readonly supportedReferenceTypes: TrackingReferenceType[]

  fetchEvents(input: {
    referenceType: TrackingReferenceType
    referenceValue: string
    apiEndpoint?: string | null
    authConfig?: Record<string, unknown> | null
  }): Promise<CarrierFetchResult>

  testConnection(input: {
    apiEndpoint?: string | null
    authConfig?: Record<string, unknown> | null
  }): Promise<CarrierAdapterTestResult>
}
