import type { TrackingEventType, TrackingEventClassifierCode, TrackingEventSource, TrackingReferenceType } from '../data/entities'
import type { SealInfo } from './route-extraction'

export type { SealInfo } from './route-extraction'

/**
 * Thrown by an adapter when the carrier positively does NOT recognise the
 * reference (e.g. HTTP 404, or a documented "unknown shipment" body) — as
 * opposed to a transport/5xx/auth error. The poll loop treats this as a
 * permanent condition: it does NOT burn the per-job retry budget (which would
 * silently flip the job to 'failed' after ~10 polls) and instead marks the job
 * with `notFoundSince`/`notFoundCount` and raises
 * `shipment_tracking.tracking_job.reference_not_found` once the threshold trips.
 *
 * NOTE for adapter authors: a KNOWN reference with nothing new must return
 * `{ events: [] }` (success). Only an UNKNOWN reference may throw this.
 */
export class CarrierReferenceNotFoundError extends Error {
  readonly carrierCode: string
  readonly referenceType: string
  readonly referenceValue: string
  constructor(args: { carrierCode: string; referenceType: string; referenceValue: string; message?: string }) {
    super(
      args.message ??
        `${args.carrierCode}: reference not found (${args.referenceType} ${args.referenceValue})`,
    )
    this.name = 'CarrierReferenceNotFoundError'
    this.carrierCode = args.carrierCode
    this.referenceType = args.referenceType
    this.referenceValue = args.referenceValue
  }
}

/**
 * Thrown by an adapter when the carrier POSITIVELY denies access to the
 * reference's data: the credentials are valid, but the account/profile is not
 * permitted to see this shipment (e.g. CargoSmart `EWS404` "User does not have
 * permission to access", `EWS102` "User is not registered with the carrier", or
 * a booking owned by a different account). Retrying cannot change the outcome,
 * so the poll loop PAUSES the job (status `paused`) and does NOT burn the per-job
 * retry budget — which would waste request quota re-asking for data that can
 * never come back, and flip the job to 'failed' after ~10 polls. A paused job is
 * excluded by the `status: 'active'` poll filter, so polling stops; re-enrolling
 * after access is granted reuses the paused job and resumes it.
 *
 * NOTE for adapter authors: throw this ONLY for a permission/entitlement denial,
 * never for a transient/auth/5xx error (those must surface as ordinary errors so
 * the retry/backoff logic applies), and never for a genuinely unknown reference
 * (use CarrierReferenceNotFoundError for that).
 */
export class CarrierPermissionDeniedError extends Error {
  readonly carrierCode: string
  readonly referenceType: string
  readonly referenceValue: string
  constructor(args: { carrierCode: string; referenceType: string; referenceValue: string; message?: string }) {
    super(
      args.message ??
        `${args.carrierCode}: permission denied (${args.referenceType} ${args.referenceValue})`,
    )
    this.name = 'CarrierPermissionDeniedError'
    this.carrierCode = args.carrierCode
    this.referenceType = args.referenceType
    this.referenceValue = args.referenceValue
  }
}

/** Result of a per-carrier reference-format check (soft, non-blocking). */
export type ReferenceValidationResult = {
  ok: boolean
  /** Human hint when `ok` is false, e.g. "looks like a house BL, not an MSC reference". */
  hint?: string
}

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

  // ─── Cargo Weight (kg) ─────────────────────────────────────────
  // Carriers that enrich DCSA events report the container's weights. MSC uses snake_case
  // (gross_weight / vgm_weight), Hapag-Lloyd PascalCase (GrossWeight / VGMWeight). Most events
  // carry neither — populated only on the weighing / VGM-declaration event.
  grossWeightKg?: number | null
  vgmKg?: number | null
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

  /**
   * Optional, synchronous, offline reference-format check. Lets callers warn an
   * operator BEFORE a job is created when a value clearly isn't this carrier's
   * own reference (e.g. a house `SBLNGB…` number handed to MSC). Soft only —
   * never blocks. Omit when the carrier has no stable format.
   */
  validateReference?(input: {
    referenceType: TrackingReferenceType
    referenceValue: string
  }): ReferenceValidationResult

  testConnection(input: {
    apiEndpoint?: string | null
    authConfig?: Record<string, unknown> | null
  }): Promise<CarrierAdapterTestResult>
}
