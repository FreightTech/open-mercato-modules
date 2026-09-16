import crypto from 'node:crypto'
import type { CarrierFetchedEvent, DocumentReference, SealInfo } from './carrier-adapter'
import type { TrackingEventType, TrackingEventClassifierCode } from '../data/entities'

type RawDcsaEvent = Record<string, unknown>

/**
 * Parse coordinate value - handles both number and string formats from DCSA APIs.
 * Some carriers return coordinates as strings (e.g., "54.381628"), others as numbers.
 */
function parseCoordinate(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isNaN(value) ? null : value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const parsed = parseFloat(trimmed)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

type DcsaResponseShape =
  | { events: RawDcsaEvent[] }
  | RawDcsaEvent[]

export function extractDcsaEventArray(data: unknown): RawDcsaEvent[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && 'events' in data && Array.isArray((data as Record<string, unknown>).events)) {
    return (data as { events: RawDcsaEvent[] }).events
  }
  return []
}

/**
 * Parses DCSA T&T v3.0 events into normalized CarrierFetchedEvent objects.
 * Handles both flat event structure and nested metadata/payload structure.
 */
export function parseDcsaEvents(data: DcsaResponseShape, _carrierName: string): CarrierFetchedEvent[] {
  const events = extractDcsaEventArray(data)

  return events.map((event) => {
    // DCSA v3.0 can have nested metadata/payload or flat structure
    const metadata = event.metadata as Record<string, unknown> | undefined
    const payload = event.payload as Record<string, unknown> | undefined
    const effectiveEvent = payload ?? event // Use payload if present, otherwise use flat event

    // Extract nested objects
    const transportCall = effectiveEvent.transportCall as Record<string, unknown> | undefined
    const vessel = transportCall?.vessel as Record<string, unknown> | undefined
    const location = (effectiveEvent.eventLocation ??
      transportCall?.location) as Record<string, unknown> | undefined
    const geoLocation = location?.geoLocation as Record<string, unknown> | undefined
    const address = location?.address as Record<string, unknown> | undefined
    const publisher = (metadata?.publisher ?? event.publisher) as Record<string, unknown> | undefined

    // ─── Event Source ──────────────────────────────────────────────
    const sourceEventId = (metadata?.eventID ?? event.eventID ?? event.eventId ?? crypto.randomUUID()) as string

    // ─── Core Event Fields ─────────────────────────────────────────
    const eventType = (metadata?.eventType ?? event.eventType) as TrackingEventType
    const eventCode = (effectiveEvent.equipmentEventTypeCode ??
      effectiveEvent.transportEventTypeCode ??
      effectiveEvent.shipmentEventTypeCode) as string
    const eventClassifierCode = (effectiveEvent.eventClassifierCode ?? null) as TrackingEventClassifierCode | null
    const eventDateTime = new Date((effectiveEvent.eventDateTime ?? event.eventDateTime) as string)

    // ─── Document References ───────────────────────────────────────
    const rawDocRefs = (effectiveEvent.relatedDocumentReferences ?? effectiveEvent.documentReferences) as Array<Record<string, unknown>> | undefined
    const relatedDocumentReferences: DocumentReference[] | null = rawDocRefs?.map((ref) => ({
      type: (ref.type ?? ref.documentReferenceType) as string,
      value: (ref.value ?? ref.documentReferenceValue) as string,
    })) ?? null

    // ─── Seals ─────────────────────────────────────────────────────
    const rawSeals = effectiveEvent.seals as Array<Record<string, unknown>> | undefined
    const seals: SealInfo[] | null = rawSeals?.map((seal) => ({
      number: (seal.sealNumber ?? seal.number) as string,
      source: (seal.sealSource ?? seal.source) as string | null ?? null,
      type: (seal.sealType ?? seal.type) as string | null ?? null,
    })) ?? null

    // ─── Event Created DateTime ────────────────────────────────────
    const eventCreatedDateTimeRaw = metadata?.eventCreatedDateTime ?? event.eventCreatedDateTime
    const eventCreatedDateTime = eventCreatedDateTimeRaw
      ? new Date(eventCreatedDateTimeRaw as string)
      : null

    return {
      // ─── Event Source ──────────────────────────────────────────────
      source: 'dcsa' as const,
      sourceEventId,

      // ─── Core Event Fields ─────────────────────────────────────────
      eventType,
      eventCode,
      eventClassifierCode,
      eventDateTime,
      eventDateTimeOffset: null, // Not typically in DCSA response, derived from datetime
      description: (effectiveEvent.description as string) ?? null,
      rawData: event,

      // ─── Equipment Fields ──────────────────────────────────────────
      equipmentReference: (effectiveEvent.equipmentReference as string) ?? null,
      isoEquipmentCode: (effectiveEvent.ISOEquipmentCode as string) ?? null,
      emptyIndicatorCode: (effectiveEvent.emptyIndicatorCode as 'EMPTY' | 'LADEN') ?? null,
      isTransshipmentMove: (effectiveEvent.isTransshipmentMove as boolean) ?? null,

      // ─── Location Fields ───────────────────────────────────────────
      locationName: (location?.locationName as string) ?? null,
      locationUnlocode: ((location?.UNLocationCode ?? location?.unLocationCode ?? 
                          transportCall?.UNLocationCode ?? transportCall?.unLocationCode) as string) ?? null,
      locationCountry: (address?.country as string) ?? null,
      
      // Facility code - transportCall has priority (where most carriers put it), then location
      facilityCode: ((transportCall?.facilityCode ?? location?.facilityCode) as string) ?? null,
      facilityCodeListProvider: ((transportCall?.facilityCodeListProvider ?? 
                                  location?.facilityCodeListProvider) as 'SMDG' | 'BIC') ?? null,
      facilityTypeCode: ((transportCall?.facilityTypeCode ?? effectiveEvent.facilityTypeCode ?? 
                          location?.facilityTypeCode) as string) ?? null,
      
      // Address from otherFacility (full address string from DCSA)
      facilityAddress: (transportCall?.otherFacility as string) ?? null,
      
      // Coordinates - check location directly (as strings), then geoLocation nested
      latitude: parseCoordinate(location?.latitude) ?? parseCoordinate(geoLocation?.latitude),
      longitude: parseCoordinate(location?.longitude) ?? parseCoordinate(geoLocation?.longitude),

      // ─── Transport Call Fields ─────────────────────────────────────
      transportCallReference: (transportCall?.transportCallReference as string) ?? null,
      modeOfTransport: (transportCall?.modeOfTransport as 'VESSEL' | 'RAIL' | 'TRUCK' | 'BARGE') ?? null,
      vesselName: ((vessel?.vesselName ?? vessel?.name) as string) ?? null,
      vesselImo: (vessel?.vesselIMONumber as string) ?? null,
      voyageNumber: (transportCall?.carrierExportVoyageNumber as string) ??
        (transportCall?.exportVoyageNumber as string) ??
        (transportCall?.importVoyageNumber as string) ??
        (transportCall?.voyageNumber as string) ??
        (vessel?.voyage as string) ?? null,
      carrierServiceCode: (transportCall?.carrierServiceCode as string) ?? null,
      carrierExportVoyageNumber: ((transportCall?.carrierExportVoyageNumber ?? transportCall?.exportVoyageNumber) as string) ?? null,
      carrierImportVoyageNumber: ((transportCall?.carrierImportVoyageNumber ?? transportCall?.importVoyageNumber) as string) ?? null,
      universalServiceReference: (transportCall?.universalServiceReference as string) ?? null,
      universalExportVoyageReference: (transportCall?.universalExportVoyageReference as string) ?? null,
      universalImportVoyageReference: (transportCall?.universalImportVoyageReference as string) ?? null,
      portVisitReference: (transportCall?.portVisitReference as string) ?? null,

      // ─── Document References ───────────────────────────────────────
      relatedDocumentReferences,

      // ─── Metadata Fields ───────────────────────────────────────────
      eventCreatedDateTime,
      retractedEventId: (metadata?.retractedEventID as string) ?? null,
      publisherName: (publisher?.partyName as string) ?? _carrierName,
      publisherRole: (metadata?.publisherRole as string) ??
        (event.publisherRole as string) ?? null,

      // ─── Additional Event Fields ───────────────────────────────────
      delayReasonCode: (effectiveEvent.delayReasonCode as string) ?? null,
      changeRemark: (effectiveEvent.changeRemark as string) ?? null,
      seals,
    }
  })
}
