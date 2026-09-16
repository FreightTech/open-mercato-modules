/**
 * Vessel API client for fetching real-time vessel position and trace data.
 *
 * The base URL is deployment-specific and MUST be provided via the
 * `NEXT_PUBLIC_VESSEL_API_URL` environment variable. There is no default: when
 * it is unset the vessel/trace/POI calls throw a clear "not configured" error
 * and the map features that depend on them are simply unavailable.
 */

// ─── Types ───────────────────────────────────────────────────

export interface VesselDimensions {
  a: number
  b: number
  c: number
  d: number
}

export interface PortInfo {
  locode: string
  name: string
  city: string
  country: string
}

export interface Position {
  lat: number
  lng: number
}

export type VesselStatus = 'AT_SEA' | 'IN_PORT'
export type PoiType = 'PORT' | 'TERMINAL' | 'WAYPOINT' | 'PORT_GEOMETRIC_CENTER'

export interface VesselInfo {
  imo: number
  mmsi: number | null
  name: string
  callsign: string | null
  shipType: string | null
  operatorName: string | null
  owner: string | null
  dimensions: VesselDimensions | null
  status: VesselStatus | null
  lastPosition: Position | null
  lastHeading: number | null
  lastDestination: string | null
  lastDestinationPort: PortInfo | null
  currentPort: PortInfo | null
  currentPoiCode: string | null
  currentPoiType: PoiType | null
  isStationary: boolean
  updatedAt: string
}

export type TraceEventType =
  | 'POSITION_UPDATE'
  | 'PORT_ARRIVAL'
  | 'PORT_DEPARTURE'
  | 'TERMINAL_ARRIVAL'
  | 'TERMINAL_DEPARTURE'
  | 'DESTINATION_CHANGE'

export interface TracePoint {
  lat: number
  lng: number
  speed: number | null
  heading: number | null
  eventType: TraceEventType
  destination: string | null
  timestamp: string
}

export interface BoundingBox {
  north: number
  south: number
  east: number
  west: number
}

/**
 * A point of interest (port, terminal, waypoint, or port geometric center) returned by the
 * vessel-api `/poi` endpoint, modeled as a circle (center + radius) ready to draw on a map.
 */
export interface PoiInfo {
  code: string
  locode: string
  type: PoiType
  center: Position
  radiusMeters: number
  portName: string | null
  terminalName: string | null
  city: string | null
  country: string | null
  /** Maritime region name in Polish (waypoints; may fall back to English). */
  regionNamePl: string | null
  /** Maritime region name in English. */
  regionNameEn: string | null
}

export interface PoiListResponse {
  pois: PoiInfo[]
  count: number
  limit: number
  /** Present only when a bounding-box filter was applied. */
  bounds?: BoundingBox
  /** Present only when a type filter was applied. */
  type?: PoiType
}

export interface TimeRange {
  from?: string  // ISO 8601 date
  to?: string    // ISO 8601 date
}

export interface VesselResponse {
  vessel: VesselInfo
}

export interface TraceResponse {
  vessel: {
    imo: number
    mmsi: number | null
    name: string
  }
  trace: TracePoint[]
  count: number
  limit: number
  bounds?: BoundingBox
  timeRange?: TimeRange
}

// ─── Configuration ───────────────────────────────────────────

function vesselApiBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_VESSEL_API_URL || ''
  if (!baseUrl) {
    throw new Error(
      'Vessel API is not configured — set NEXT_PUBLIC_VESSEL_API_URL to your vessel-tracking API base URL'
    )
  }
  return baseUrl.replace(/\/+$/, '')
}

// ─── API Functions ───────────────────────────────────────────

/**
 * Fetch vessel information by IMO number or MMSI.
 *
 * @param imoOrMmsi - IMO number (7 digits) or MMSI (9 digits)
 * @returns Vessel info or null if not found
 */
export async function fetchVessel(imoOrMmsi: number | string): Promise<VesselInfo | null> {
  const id = typeof imoOrMmsi === 'string' ? imoOrMmsi : String(imoOrMmsi)

  try {
    const response = await fetch(`${vesselApiBaseUrl()}/vessel/${encodeURIComponent(id)}`)

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    const data: VesselResponse = await response.json()
    return data.vessel
  } catch (error) {
    console.error('[vessel-api] Failed to fetch vessel:', error)
    throw error
  }
}

/**
 * Fetch vessel trace (position history) with optional bounding box and time filters.
 *
 * @param imoOrMmsi - IMO number or MMSI
 * @param bounds - Optional bounding box to filter trace points
 * @param limit - Maximum number of points to return (default: 5000)
 * @param timeRange - Optional time range filter (from/to in ISO 8601)
 * @returns Trace data with array of position points
 */
export async function fetchVesselTrace(
  imoOrMmsi: number | string,
  bounds?: BoundingBox,
  limit?: number,
  timeRange?: TimeRange
): Promise<TraceResponse> {
  const id = typeof imoOrMmsi === 'string' ? imoOrMmsi : String(imoOrMmsi)

  const params = new URLSearchParams()

  if (bounds) {
    params.set('north', String(bounds.north))
    params.set('south', String(bounds.south))
    params.set('east', String(bounds.east))
    params.set('west', String(bounds.west))
  }

  if (limit) {
    params.set('limit', String(limit))
  }

  if (timeRange?.from) {
    params.set('from', timeRange.from)
  }

  if (timeRange?.to) {
    params.set('to', timeRange.to)
  }

  const queryString = params.toString()
  const url = `${vesselApiBaseUrl()}/vessel/${encodeURIComponent(id)}/trace${queryString ? `?${queryString}` : ''}`

  try {
    const response = await fetch(url)

    if (response.status === 404) {
      return {
        vessel: { imo: 0, mmsi: null, name: 'Unknown' },
        trace: [],
        count: 0,
        limit: limit || 5000,
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    const data: TraceResponse = await response.json()
    return data
  } catch (error) {
    console.error('[vessel-api] Failed to fetch vessel trace:', error)
    throw error
  }
}

/**
 * Fetch points of interest (ports, terminals, waypoints) as map circles, optionally
 * constrained to a viewport bounding box and/or a single POI type.
 *
 * @param bounds - Optional bounding box to fetch only POIs in the current viewport
 * @param options - Optional `type` filter and `limit` (API default/cap is 5000)
 * @returns Array of POIs (empty on 404)
 */
export async function fetchPois(
  bounds?: BoundingBox,
  options?: { type?: PoiType; limit?: number }
): Promise<PoiInfo[]> {
  const params = new URLSearchParams()

  if (bounds) {
    params.set('north', String(bounds.north))
    params.set('south', String(bounds.south))
    params.set('east', String(bounds.east))
    params.set('west', String(bounds.west))
  }

  if (options?.type) {
    params.set('type', options.type)
  }

  if (options?.limit) {
    params.set('limit', String(options.limit))
  }

  const queryString = params.toString()
  const url = `${vesselApiBaseUrl()}/poi${queryString ? `?${queryString}` : ''}`

  try {
    const response = await fetch(url)

    if (response.status === 404) {
      return []
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    const data: PoiListResponse = await response.json()
    // The API contract says `code` is unique, but the live endpoint can return the same code
    // more than once. Dedupe by code so downstream React keys stay unique and we don't draw
    // overlapping duplicate circles.
    const seen = new Set<string>()
    return (data.pois ?? []).filter((poi) => {
      if (seen.has(poi.code)) return false
      seen.add(poi.code)
      return true
    })
  } catch (error) {
    console.error('[vessel-api] Failed to fetch POIs:', error)
    throw error
  }
}
