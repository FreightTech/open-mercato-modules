/**
 * Location Types for Shipment Tracking
 * 
 * Rich location data combining port (UN/LOCODE) and facility/terminal details.
 * Used for Shipment origin/destination and RouteStopEntry.
 */

// ─── Types ───────────────────────────────────────────────────

/**
 * Rich location data for origin, destination, or transshipment points.
 * Combines port-level (UN/LOCODE) with facility-level (terminal) details.
 */
export interface FacilityLocation {
  // Display name (terminal or port name)
  name: string

  // Port-level identifiers
  unlocode: string | null          // UN/LOCODE (e.g., "PLGDN")
  countryCode: string | null       // ISO 3166-1 alpha-2 (e.g., "PL")

  // Facility/terminal identifiers (separate fields)
  facilityCode: string | null      // SMDG/BIC code (e.g., "DCT")
  facilityCodeListProvider: 'BIC' | 'SMDG' | null
  facilityTypeCode: string | null  // POTE (port terminal), DEPO (depot), etc.

  // Address (from DCSA otherFacility or BIC API)
  address: string | null           // Full address string

  // Coordinates
  coords: {
    latitude: number
    longitude: number
  } | null

  // Operator (from BIC API enrichment only)
  operatorName: string | null

  // Source of the data
  source: 'dcsa' | 'bic' | 'manual'
}

/**
 * Input type for building FacilityLocation from TrackingEvent data.
 */
export interface LocationEventInput {
  locationName?: string | null
  locationUnlocode?: string | null
  locationCountry?: string | null
  facilityCode?: string | null
  facilityCodeListProvider?: 'BIC' | 'SMDG' | null
  facilityTypeCode?: string | null
  facilityAddress?: string | null
  latitude?: number | null
  longitude?: number | null
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Determines if location data is "complete enough" to skip BIC enrichment.
 * Complete = has name AND (coords OR address)
 */
export function isLocationComplete(loc: Partial<FacilityLocation> | null | undefined): boolean {
  if (!loc) return false
  const hasName = !!loc.name && loc.name !== 'Unknown'
  const hasCoords = loc.coords?.latitude != null && loc.coords?.longitude != null
  const hasAddress = !!loc.address

  // Complete if we have name AND (coords OR address)
  return hasName && (hasCoords || hasAddress)
}

/**
 * Builds a FacilityLocation from TrackingEvent data.
 * Extracts country code from UN/LOCODE if not provided.
 */
export function buildLocationFromEvent(event: LocationEventInput): FacilityLocation {
  // Extract country code from UN/LOCODE (first 2 chars) if not provided
  const countryCode = event.locationCountry ||
    (event.locationUnlocode?.length === 5 ? event.locationUnlocode.slice(0, 2) : null)

  return {
    name: event.locationName || event.locationUnlocode || 'Unknown',
    unlocode: event.locationUnlocode || null,
    countryCode,
    facilityCode: event.facilityCode || null,
    facilityCodeListProvider: event.facilityCodeListProvider || null,
    facilityTypeCode: event.facilityTypeCode || null,
    address: event.facilityAddress || null,
    coords: (event.latitude != null && event.longitude != null)
      ? { latitude: event.latitude, longitude: event.longitude }
      : null,
    operatorName: null, // Only populated by BIC enrichment
    source: 'dcsa',
  }
}

/**
 * Merges BIC enrichment data into an existing FacilityLocation.
 * BIC provides more detailed facility names (e.g., "GDYNIA CONTAINER TERMINAL S.A.")
 * so we prefer BIC name over generic port names from DCSA.
 */
export function mergeLocationWithBicData(
  location: FacilityLocation,
  bicData: {
    name?: string
    address?: string
    coords?: { latitude: number; longitude: number }
    operatorName?: string
    facilityCode?: string
    facilityCodeListProvider?: 'BIC' | 'SMDG'
  }
): FacilityLocation {
  // BIC provides more descriptive terminal names, so prefer BIC name when available
  // Only keep DCSA name if BIC doesn't provide one
  const enrichedName = bicData.name || location.name

  return {
    ...location,
    name: enrichedName,
    address: location.address || bicData.address || null,
    coords: location.coords || bicData.coords || null,
    operatorName: location.operatorName || bicData.operatorName || null,
    facilityCode: location.facilityCode || bicData.facilityCode || null,
    facilityCodeListProvider: location.facilityCodeListProvider || bicData.facilityCodeListProvider || null,
    source: bicData.name || bicData.address || bicData.coords ? 'bic' : location.source,
  }
}

/**
 * Creates an empty/unknown FacilityLocation with just a name/unlocode.
 * Used when no event data is available but we need a location object.
 */
export function createBasicLocation(
  nameOrUnlocode: string,
  unlocode?: string | null
): FacilityLocation {
  const actualUnlocode = unlocode || (nameOrUnlocode.length === 5 ? nameOrUnlocode : null)
  const countryCode = actualUnlocode?.slice(0, 2) || null

  return {
    name: nameOrUnlocode,
    unlocode: actualUnlocode,
    countryCode,
    facilityCode: null,
    facilityCodeListProvider: null,
    facilityTypeCode: null,
    address: null,
    coords: null,
    operatorName: null,
    source: 'manual',
  }
}
