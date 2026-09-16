'use client'

/**
 * React hooks for vessel tracking with real-time position and trace data.
 *
 * Features:
 * - useVessel: Fetch vessel info with auto-refresh
 * - useVesselTrace: Fetch trace with viewport bounding box filter
 * - useDebouncedBounds: Debounce map viewport changes
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchVessel,
  fetchVesselTrace,
  fetchPois,
  type VesselInfo,
  type TraceResponse,
  type BoundingBox,
  type TimeRange,
  type PoiInfo,
} from '../lib/vessel-api'

// ─── useVessel ───────────────────────────────────────────────

interface UseVesselOptions {
  /** Enable auto-refresh (default: true) */
  autoRefresh?: boolean
  /** Auto-refresh interval in ms (default: 30000) */
  refreshInterval?: number
  /** Enable the query (default: true) */
  enabled?: boolean
}

/**
 * Hook to fetch vessel information by IMO number.
 * Auto-refreshes every 30 seconds by default.
 */
export function useVessel(
  vesselImo: string | null | undefined,
  options: UseVesselOptions = {}
) {
  const { autoRefresh = true, refreshInterval = 30_000, enabled = true } = options

  return useQuery<VesselInfo | null, Error>({
    queryKey: ['vessel-info', vesselImo],
    queryFn: () => fetchVessel(vesselImo!),
    enabled: enabled && !!vesselImo,
    staleTime: refreshInterval,
    refetchInterval: autoRefresh ? refreshInterval : false,
    retry: 2,
  })
}

// ─── useDebouncedBounds ──────────────────────────────────────

interface UseDebouncedBoundsResult {
  /** Current bounds (updated immediately) */
  bounds: BoundingBox | null
  /** Debounced bounds (updated after delay) */
  debouncedBounds: BoundingBox | null
  /** Update bounds - call this on map viewport change */
  setBounds: (bounds: BoundingBox | null) => void
  /** Whether bounds are currently being debounced */
  isDebouncing: boolean
}

/**
 * Hook to debounce map viewport bounds changes.
 * Prevents excessive API calls when user is panning/zooming.
 *
 * @param delay - Debounce delay in ms (default: 500)
 */
export function useDebouncedBounds(delay = 500): UseDebouncedBoundsResult {
  const [bounds, setBounds] = useState<BoundingBox | null>(null)
  const [debouncedBounds, setDebouncedBounds] = useState<BoundingBox | null>(null)
  const [isDebouncing, setIsDebouncing] = useState(false)

  useEffect(() => {
    if (!bounds) {
      setDebouncedBounds(null)
      setIsDebouncing(false)
      return
    }

    setIsDebouncing(true)
    const timer = setTimeout(() => {
      setDebouncedBounds(bounds)
      setIsDebouncing(false)
    }, delay)

    return () => {
      clearTimeout(timer)
    }
  }, [bounds, delay])

  return { bounds, debouncedBounds, setBounds, isDebouncing }
}

// ─── useVesselTrace ──────────────────────────────────────────

interface UseVesselTraceOptions {
  /** Maximum number of trace points to fetch (default: 2000) */
  limit?: number
  /** Stale time in ms (default: 60000) */
  staleTime?: number
  /** Enable the query (default: true) */
  enabled?: boolean
  /** Start time filter (ISO 8601) - limits trace to events after this date */
  from?: string
}

/**
 * Hook to fetch vessel trace (position history) within a bounding box.
 * Only fetches when bounds are provided (debounce with useDebouncedBounds).
 */
export function useVesselTrace(
  vesselImo: string | null | undefined,
  bounds: BoundingBox | null,
  options: UseVesselTraceOptions = {}
) {
  const { limit = 2000, staleTime = 60_000, enabled = true, from } = options

  // Memoize bounds to prevent unnecessary refetches
  const boundsKey = useMemo(() => {
    if (!bounds) return null
    // Round to 3 decimal places to prevent micro-changes from triggering refetch
    return `${bounds.north.toFixed(3)},${bounds.south.toFixed(3)},${bounds.east.toFixed(3)},${bounds.west.toFixed(3)}`
  }, [bounds])

  // Build time range if from is provided
  const timeRange: TimeRange | undefined = from ? { from } : undefined

  return useQuery<TraceResponse, Error>({
    queryKey: ['vessel-trace', vesselImo, boundsKey, limit, from],
    queryFn: () => fetchVesselTrace(vesselImo!, bounds ?? undefined, limit, timeRange),
    enabled: enabled && !!vesselImo && !!bounds,
    staleTime,
    retry: 1,
  })
}

// ─── usePois ─────────────────────────────────────────────────

interface UsePoisOptions {
  /** Maximum number of POIs to fetch (default: 1000) */
  limit?: number
  /** Stale time in ms (default: 300000 — POIs are near-static) */
  staleTime?: number
  /** Enable the query (default: true). Gate this on zoom to avoid clutter/over-fetch. */
  enabled?: boolean
}

/**
 * Hook to fetch points of interest within a bounding box.
 * Only fetches when bounds are provided and `enabled` is true (gate on zoom level).
 */
export function usePois(
  bounds: BoundingBox | null,
  options: UsePoisOptions = {}
) {
  const { limit = 1000, staleTime = 300_000, enabled = true } = options

  // Round bounds so micro pan/zoom doesn't re-trigger; reuses the trace pattern.
  const boundsKey = useMemo(() => {
    if (!bounds) return null
    return `${bounds.north.toFixed(2)},${bounds.south.toFixed(2)},${bounds.east.toFixed(2)},${bounds.west.toFixed(2)}`
  }, [bounds])

  return useQuery<PoiInfo[], Error>({
    queryKey: ['pois', boundsKey, limit],
    queryFn: async () => {
      // Waypoints are open-water grid markers — exclude them at the source. The API `type`
      // filter is single-value, so request the real-place types in parallel and merge.
      const results = await Promise.all(
        (['PORT', 'TERMINAL', 'PORT_GEOMETRIC_CENTER'] as const).map((type) =>
          fetchPois(bounds ?? undefined, { type, limit }),
        ),
      )
      const seen = new Set<string>()
      return results.flat().filter((poi) => {
        if (seen.has(poi.code)) return false
        seen.add(poi.code)
        return true
      })
    },
    enabled: enabled && !!bounds,
    staleTime,
    retry: 1,
  })
}

// ─── useVesselTracking (combined) ────────────────────────────

interface UseVesselTrackingOptions {
  /** Auto-refresh vessel position (default: true) */
  autoRefresh?: boolean
  /** Vessel refresh interval in ms (default: 30000) */
  vesselRefreshInterval?: number
  /** Trace fetch limit (default: 2000) */
  traceLimit?: number
  /** Bounds debounce delay in ms (default: 500) */
  boundsDebounceDelay?: number
  /** Start time filter for trace (ISO 8601) - limits trace to events after this date */
  traceFrom?: string
  /** Fetch POIs for the current viewport (default: false) */
  enablePois?: boolean
  /** Max POIs to fetch per viewport (default: 1000) */
  poiLimit?: number
}

interface UseVesselTrackingResult {
  /** Vessel info */
  vessel: VesselInfo | null | undefined
  /** Whether vessel is loading */
  isVesselLoading: boolean
  /** Vessel fetch error */
  vesselError: Error | null
  /** Trace data */
  trace: TraceResponse | undefined
  /** Whether trace is loading */
  isTraceLoading: boolean
  /** Trace fetch error */
  traceError: Error | null
  /** Whether bounds are being debounced */
  isDebouncing: boolean
  /** Current viewport bounds */
  bounds: BoundingBox | null
  /** Update bounds (call on map viewport change) */
  setBounds: (bounds: BoundingBox | null) => void
  /** POIs within the current viewport (empty unless enablePois) */
  pois: PoiInfo[] | undefined
  /** Whether POIs are loading */
  isPoisLoading: boolean
}

/**
 * Combined hook for vessel tracking with map integration.
 * Handles vessel info, trace, and debounced bounds in one hook.
 */
export function useVesselTracking(
  vesselImo: string | null | undefined,
  options: UseVesselTrackingOptions = {}
): UseVesselTrackingResult {
  const {
    autoRefresh = true,
    vesselRefreshInterval = 30_000,
    traceLimit = 2000,
    boundsDebounceDelay = 500,
    traceFrom,
    enablePois = false,
    poiLimit = 1000,
  } = options

  const { bounds, debouncedBounds, setBounds, isDebouncing } = useDebouncedBounds(boundsDebounceDelay)

  const {
    data: vessel,
    isLoading: isVesselLoading,
    error: vesselError,
  } = useVessel(vesselImo, {
    autoRefresh,
    refreshInterval: vesselRefreshInterval,
  })

  const {
    data: trace,
    isLoading: isTraceLoading,
    error: traceError,
  } = useVesselTrace(vesselImo, debouncedBounds, {
    limit: traceLimit,
    from: traceFrom,
  })

  const {
    data: pois,
    isLoading: isPoisLoading,
  } = usePois(debouncedBounds, {
    enabled: enablePois,
    limit: poiLimit,
  })

  return {
    vessel,
    isVesselLoading,
    vesselError: vesselError ?? null,
    trace,
    isTraceLoading,
    traceError: traceError ?? null,
    isDebouncing,
    bounds,
    setBounds,
    pois,
    isPoisLoading,
  }
}
