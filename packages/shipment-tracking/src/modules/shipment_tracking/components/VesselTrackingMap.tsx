'use client'

/**
 * VesselTrackingMap - Interactive map showing vessel position and trace.
 *
 * Features:
 * - Real-time vessel position with heading-rotated ship icon
 * - Trace polyline limited to viewport bounds (debounced fetch)
 * - Vessel info overlay with status and destination
 * - Auto-refresh vessel position every 30 seconds
 */

import * as React from 'react'
import { useState, useCallback, useMemo, useEffect } from 'react'
import { GoogleMap, useJsApiLoader, MarkerF, PolylineF, CircleF, InfoWindowF } from '@react-google-maps/api'
import { Ship, Navigation, Anchor, MapPin, Clock, Building2, Ruler, Info, X } from 'lucide-react'
import { useVesselTracking } from '../hooks/useVesselTracking'
import { Spinner } from '@freighttech/ui/primitives/spinner'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import type { VesselTrackingStatus } from '../lib/current-vessel'
import type { VesselInfo, PoiInfo, PoiType } from '../lib/vessel-api'

// ─── Types ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GoogleMapInstance = any

export interface VesselTrackingMapProps {
  /** Vessel IMO number */
  vesselImo: string | null | undefined
  /** Vessel name (fallback if API doesn't return name) */
  vesselName?: string | null
  /** Map height (CSS value, default: '250px') */
  height?: string
  /** Auto-refresh vessel position (default: true) */
  autoRefresh?: boolean
  /** Vessel refresh interval in ms (default: 30000) */
  refreshInterval?: number
  /** Show vessel info overlay (default: true) */
  showInfoOverlay?: boolean
  /** Show points of interest (ports/terminals/waypoints) as clickable circles (default: true) */
  showPois?: boolean
  /** Container tracking status - affects display messaging */
  containerStatus?: VesselTrackingStatus
  /** Port where container currently is (for at_port/not_departed status) */
  currentPort?: string
  /** Whether this is a planned vessel (not yet carrying the container) */
  isPlannedVessel?: boolean
  /** Current leg info (for in_transit status) */
  currentLeg?: {
    fromPort: string
    toPort: string
  }
  /** Start date for trace (ISO 8601) - limits trace to current leg */
  traceFrom?: string
}

// ─── Map Configuration ───────────────────────────────────────

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
}

// Map options - typed as Record to avoid google namespace dependency at compile time
const mapOptions: Record<string, unknown> = {
  zoomControl: true,
  mapTypeControl: false,
  scaleControl: false,
  streetViewControl: false,
  rotateControl: false,
  fullscreenControl: false,
  disableDefaultUI: false,
  gestureHandling: 'cooperative',
  styles: [
    {
      featureType: 'water',
      elementType: 'geometry',
      stylers: [{ color: '#bfdbfe' }], // Light blue for water
    },
    {
      featureType: 'landscape',
      elementType: 'geometry',
      stylers: [{ color: '#f5f3ff' }], // Light purple for land
    },
    {
      featureType: 'road',
      elementType: 'geometry',
      stylers: [{ color: '#e0e7ff' }], // Light indigo for roads
    },
  ],
}

// Default center: Baltic Sea
const defaultCenter = { lat: 54.5, lng: 18.5 }

// Below this zoom the viewport is too large — too many POIs to be useful or performant,
// so we skip fetching/drawing them entirely (keeps the map uncluttered when zoomed out).
const MIN_POI_ZOOM = 6

// Subtle per-type colors for POI circles. Kept faint (low opacity) so they don't
// compete with the vessel marker and trace.
const POI_COLORS: Record<PoiType, string> = {
  PORT: '#2563eb', // blue
  TERMINAL: '#059669', // emerald
  WAYPOINT: '#d97706', // amber
  PORT_GEOMETRIC_CENTER: '#64748b', // slate
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Resolve a POI's human-friendly primary name, following the same per-type fallback the
 * backend uses: terminals prefer the terminal name, ports prefer the city, waypoints use
 * the localized maritime region. Falls back to LOCODE / code when nothing else is set.
 */
function getPoiPrimaryName(poi: PoiInfo, locale: string): string {
  if (poi.type === 'TERMINAL') {
    return poi.terminalName || poi.portName || poi.city || poi.locode || poi.code
  }
  if (poi.type === 'PORT' || poi.type === 'PORT_GEOMETRIC_CENTER') {
    return poi.city || poi.portName || poi.locode || poi.code
  }
  // WAYPOINT — localized region name
  const region = locale === 'pl'
    ? (poi.regionNamePl || poi.regionNameEn)
    : (poi.regionNameEn || poi.regionNamePl)
  return region || poi.locode || poi.code
}

function getPoiTypeLabel(type: PoiType, t: ReturnType<typeof useT>): string {
  switch (type) {
    case 'PORT':
      return t('shipment_tracking.map.poi.port', 'Port')
    case 'TERMINAL':
      return t('shipment_tracking.map.poi.terminal', 'Terminal')
    case 'WAYPOINT':
      return t('shipment_tracking.map.poi.waypoint', 'Waypoint')
    case 'PORT_GEOMETRIC_CENTER':
      return t('shipment_tracking.map.poi.portCenter', 'Port center')
    default:
      return type
  }
}


/**
 * Calculate vessel dimensions from AIS dimension fields.
 * a = bow to reference, b = reference to stern → length = a + b
 * c = port to reference, d = reference to starboard → width = c + d
 */
function calculateVesselDimensions(vessel: VesselInfo | null | undefined): {
  length: number
  width: number
  hasValidDimensions: boolean
} {
  const dims = vessel?.dimensions
  if (!dims) {
    return { length: 0, width: 0, hasValidDimensions: false }
  }
  const length = (dims.a ?? 0) + (dims.b ?? 0)
  const width = (dims.c ?? 0) + (dims.d ?? 0)
  // Only consider valid if both length and width are positive
  const hasValidDimensions = length > 0 && width > 0
  return { length, width, hasValidDimensions }
}

/**
 * Format relative time for last update (e.g., "2 min ago", "1 hour ago").
 */
function formatRelativeTime(dateString: string | null | undefined, t: ReturnType<typeof useT>): string {
  if (!dateString) return ''
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ''

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMinutes < 1) {
    return t('shipment_tracking.map.justNow', 'Just now')
  }
  if (diffMinutes < 60) {
    return t('shipment_tracking.map.minutesAgo', '{{count}} min ago', { count: diffMinutes })
  }
  if (diffHours < 24) {
    return t('shipment_tracking.map.hoursAgo', '{{count}}h ago', { count: diffHours })
  }
  return t('shipment_tracking.map.daysAgo', '{{count}}d ago', { count: diffDays })
}

// ─── Vessel Info Card ────────────────────────────────────────

interface VesselInfoCardProps {
  vessel: VesselInfo | null | undefined
  displayName: string
  isPlannedVessel: boolean
  containerStatus?: VesselTrackingStatus
  currentPort?: string
  currentLeg?: { fromPort: string; toPort: string }
  t: ReturnType<typeof useT>
}

function VesselInfoCard({
  vessel,
  displayName,
  isPlannedVessel,
  containerStatus,
  currentPort,
  currentLeg,
  t,
}: VesselInfoCardProps) {
  const { length, width, hasValidDimensions } = calculateVesselDimensions(vessel)
  const lastUpdate = formatRelativeTime(vessel?.updatedAt, t)

  // Determine vessel status display
  const getVesselStatusDisplay = () => {
    if (vessel?.status === 'IN_PORT') {
      return {
        icon: <Anchor className="w-3 h-3 text-green-600 dark:text-green-400" />,
        text: vessel.currentPort?.name || t('shipment_tracking.map.inPort', 'In Port'),
        color: 'text-green-600 dark:text-green-400',
      }
    }
    if (vessel?.status === 'AT_SEA') {
      const destination = vessel.lastDestinationPort?.name || vessel.lastDestination
      return {
        icon: <Navigation className="w-3 h-3 text-blue-600 dark:text-blue-400" />,
        text: destination
          ? t('shipment_tracking.map.atSeaTo', 'At Sea -> {{destination}}', { destination })
          : t('shipment_tracking.map.atSea', 'At Sea'),
        color: 'text-blue-600 dark:text-blue-400',
      }
    }
    return {
      icon: <Info className="w-3 h-3 text-muted-foreground" />,
      text: t('shipment_tracking.map.unknown', 'Unknown'),
      color: 'text-muted-foreground',
    }
  }

  const statusDisplay = getVesselStatusDisplay()

  return (
    <div className="bg-card border border-border rounded-l-lg border-r-0 px-3 py-2.5 h-full overflow-y-auto">
      {/* Header: Vessel name + planned badge */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Ship className="w-4 h-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />
          <h2 className="font-semibold text-sm truncate text-foreground">{displayName}</h2>
        </div>
        {isPlannedVessel && (
          <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded flex-shrink-0">
            {t('shipment_tracking.map.planned', 'Planned')}
          </span>
        )}
      </div>

      {/* IMO number */}
      {vessel?.imo && (
        <div className="text-xs text-muted-foreground font-mono mb-2">
          IMO {vessel.imo}
        </div>
      )}

      {/* Vessel details section */}
      <div className="border-t border-border pt-2 space-y-1.5">
        {/* Status row */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground/70 w-14 flex-shrink-0 truncate" title={t('shipment_tracking.map.status', 'Status')}>
            {t('shipment_tracking.map.status', 'Status')}
          </span>
          <div className={`flex items-center gap-1 ${statusDisplay.color} truncate`}>
            {statusDisplay.icon}
            <span className="truncate">{statusDisplay.text}</span>
          </div>
        </div>

        {/* Ship type row */}
        {vessel?.shipType && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground/70 w-14 flex-shrink-0 truncate" title={t('shipment_tracking.map.type', 'Type')}>
              {t('shipment_tracking.map.type', 'Type')}
            </span>
            <span className="text-foreground truncate" title={vessel.shipType}>{vessel.shipType}</span>
          </div>
        )}

        {/* Size row */}
        {hasValidDimensions && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground/70 w-14 flex-shrink-0 truncate" title={t('shipment_tracking.map.size', 'Size')}>
              {t('shipment_tracking.map.size', 'Size')}
            </span>
            <div className="flex items-center gap-1 text-foreground">
              <Ruler className="w-3 h-3 text-muted-foreground" />
              <span>{length}m x {width}m</span>
            </div>
          </div>
        )}

        {/* Operator row */}
        {vessel?.operatorName && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground/70 w-14 flex-shrink-0 truncate" title={t('shipment_tracking.map.operator', 'Operator')}>
              {t('shipment_tracking.map.operator', 'Operator')}
            </span>
            <div className="flex items-center gap-1 text-foreground truncate" title={vessel.operatorName}>
              <Building2 className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="truncate">{vessel.operatorName}</span>
            </div>
          </div>
        )}

        {/* Last update row */}
        {lastUpdate && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground/70 w-14 flex-shrink-0 truncate" title={t('shipment_tracking.map.updated', 'Updated')}>
              {t('shipment_tracking.map.updated', 'Updated')}
            </span>
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span>{lastUpdate}</span>
            </div>
          </div>
        )}
      </div>

      {/* Container status section (when container tracking is active) */}
      {containerStatus && containerStatus !== 'delivered' && (
        <div className="border-t border-border mt-2 pt-2">
          {containerStatus === 'in_transit' && currentLeg ? (
            <div className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
              <MapPin className="w-3 h-3" />
              <span className="truncate">
                {t('shipment_tracking.map.inTransitTo', 'In transit to {{destination}}', {
                  destination: currentLeg.toPort,
                })}
              </span>
            </div>
          ) : containerStatus === 'at_port' && currentPort ? (
            <div className="space-y-0.5">
              <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <MapPin className="w-3 h-3" />
                <span className="truncate">
                  {t('shipment_tracking.map.containerAtPort', 'Container at {{port}}', {
                    port: currentPort,
                  })}
                </span>
              </div>
              {isPlannedVessel && (
                <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <Clock className="w-3 h-3" />
                  <span className="truncate">
                    {t('shipment_tracking.map.awaitingVessel', 'Awaiting this vessel')}
                  </span>
                </div>
              )}
            </div>
          ) : containerStatus === 'not_departed' ? (
            <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <Clock className="w-3 h-3" />
              <span className="truncate">
                {t('shipment_tracking.map.awaitingDeparture', 'Awaiting departure')}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────

export function VesselTrackingMap({
  vesselImo,
  vesselName,
  height = '250px',
  autoRefresh = true,
  refreshInterval = 30_000,
  showInfoOverlay = true,
  showPois = true,
  containerStatus,
  currentPort,
  isPlannedVessel = false,
  currentLeg,
  traceFrom,
}: VesselTrackingMapProps) {
  const t = useT()
  const locale = useLocale()

  // Load Google Maps API
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  })

  // Map instance reference
  const [map, setMap] = useState<GoogleMapInstance | null>(null)
  // Current zoom (gates POI fetching) and the POI selected for the info window
  const [zoom, setZoom] = useState(8)
  const [selectedPoi, setSelectedPoi] = useState<PoiInfo | null>(null)

  // Only fetch POIs once zoomed in enough to keep the count and clutter manageable
  const enablePois = showPois && zoom >= MIN_POI_ZOOM

  // Drop the details popup when POIs are hidden (e.g. zoomed out) to avoid an orphan window
  useEffect(() => {
    if (!enablePois) setSelectedPoi(null)
  }, [enablePois])

  // Vessel tracking with debounced bounds
  const {
    vessel,
    isVesselLoading,
    vesselError,
    trace,
    isTraceLoading,
    isDebouncing,
    setBounds,
    pois,
  } = useVesselTracking(vesselImo, {
    autoRefresh,
    vesselRefreshInterval: refreshInterval,
    boundsDebounceDelay: 500,
    traceLimit: 5000,
    traceFrom,
    enablePois,
  })

  // Handle map load
  const onMapLoad = useCallback((mapInstance: GoogleMapInstance) => {
    setMap(mapInstance)
  }, [])

  // Handle map idle (fires after load and after pan/zoom completes)
  const handleMapIdle = useCallback(() => {
    if (!map) return
    const bounds = map.getBounds()
    if (!bounds) return

    // Track zoom so POI fetching can be gated on it
    const currentZoom = map.getZoom()
    if (typeof currentZoom === 'number') setZoom(currentZoom)

    const ne = bounds.getNorthEast()
    const sw = bounds.getSouthWest()

    // Add fixed margin (~30-35km) to fetch trace points outside visible viewport
    // This ensures smooth curves at map edges instead of straight lines
    const MARGIN_DEGREES = 0.3

    setBounds({
      north: Math.min(90, ne.lat() + MARGIN_DEGREES),
      south: Math.max(-90, sw.lat() - MARGIN_DEGREES),
      east: Math.min(180, ne.lng() + MARGIN_DEGREES),
      west: Math.max(-180, sw.lng() - MARGIN_DEGREES),
    })
  }, [map, setBounds])

  // Create container ship icon with heading rotation
  // Ship silhouette viewed from above: pointed bow (top), wide stern (bottom), bridge at rear
  const shipIcon = useMemo(() => {
    if (!isLoaded || typeof window === 'undefined') return undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google
    if (!google) return undefined

    const heading = vessel?.lastHeading ?? 0

    // Container ship silhouette (top-down view, pointing up/north)
    // Elongated shape with slightly pointed bow - typical container ship proportions
    // Features: tapered bow (not too sharp), narrow hull, bridge at stern
    const containerShipPath = `
      M 12 2
      L 8 7
      L 8 30
      Q 8 32, 10 32
      L 10 34
      L 14 34
      L 14 32
      Q 16 32, 16 30
      L 16 7
      L 12 2
      Z
      M 10 32
      L 10 36
      L 14 36
      L 14 32
      Z
    `

    return {
      path: containerShipPath,
      fillColor: '#0f172a',      // Dark slate hull
      fillOpacity: 0.95,
      strokeColor: '#ffffff',
      strokeWeight: 1.5,
      scale: 1.0,
      rotation: heading,
      anchor: new google.maps.Point(12, 18),  // Center point for rotation
    }
  }, [isLoaded, vessel?.lastHeading])

  // Factory for the small clickable POI center dot. Markers live in a higher map pane than
  // circles, so these stay above the translucent circles and are the precise click target —
  // the circles themselves are non-clickable, so overlapping circles never steal a click.
  // Pixel-scaled (not meters), so the dot stays a consistent small size at any zoom.
  const poiDotIcon = useMemo(() => {
    if (!isLoaded || typeof window === 'undefined') return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google
    if (!google) return null
    return (color: string, selected: boolean) => ({
      path: google.maps.SymbolPath.CIRCLE,
      scale: selected ? 6 : 4,
      fillColor: color,
      fillOpacity: 0.95,
      strokeColor: '#ffffff',
      strokeWeight: 1.5,
    })
  }, [isLoaded])

  // Options for the POI info window: drop Google's default header row (the empty top bar +
  // default close button that crowds the content), nudge the bubble just above the center
  // dot, and cap its width. We render our own close button instead.
  const infoWindowOptions = useMemo(() => {
    if (!isLoaded || typeof window === 'undefined') return undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google
    if (!google) return undefined
    return {
      headerDisabled: true,
      pixelOffset: new google.maps.Size(0, -4),
      maxWidth: 260,
    }
  }, [isLoaded])

  // Center map on vessel position
  const center = useMemo(() => {
    if (vessel?.lastPosition) {
      return { lat: vessel.lastPosition.lat, lng: vessel.lastPosition.lng }
    }
    return defaultCenter
  }, [vessel?.lastPosition])

  // Filter trace points to only position updates for cleaner polyline
  const tracePath = useMemo(() => {
    if (!trace?.trace) return []
    return trace.trace
      .filter((p) => p.lat && p.lng && p.eventType === 'POSITION_UPDATE')
      .map((p) => ({ lat: p.lat, lng: p.lng }))
  }, [trace?.trace])

  // ─── Loading State ─────────────────────────────────────────

  if (loadError) {
    return (
      <div className="flex w-full" style={{ height }}>
        <div className="w-full flex items-center justify-center bg-muted rounded-lg border border-border">
          <div className="text-center">
            <Ship className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {t('shipment_tracking.map.loadError', 'Failed to load map')}
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!isLoaded || (isVesselLoading && !vessel)) {
    return (
      <div className="flex w-full" style={{ height }}>
        <div className="w-full flex items-center justify-center bg-muted rounded-lg border border-border">
          <div className="flex flex-col items-center gap-2">
            <Spinner className="h-6 w-6" />
            <span className="text-sm text-muted-foreground">
              {t('shipment_tracking.map.loading', 'Loading map...')}
            </span>
          </div>
        </div>
      </div>
    )
  }

  // ─── No Vessel Data ────────────────────────────────────────

  if (!vessel && !isVesselLoading) {
    return (
      <div className="flex w-full" style={{ height }}>
        <div className="w-full flex items-center justify-center bg-muted rounded-lg border border-border">
          <div className="text-center">
            <Ship className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {vesselError
                ? t('shipment_tracking.map.vesselError', 'Failed to load vessel data')
                : t('shipment_tracking.map.vesselNotFound', 'Vessel not found')}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ─── Map Render ────────────────────────────────────────────

  const displayName = vesselName || vessel?.name || 'Unknown Vessel'

  return (
    <div className="flex w-full" style={{ height }}>
      {/* Vessel Info Card - 1/3 width */}
      {showInfoOverlay && (
        <div className="w-1/3 flex-shrink-0">
          <VesselInfoCard
            vessel={vessel}
            displayName={displayName}
            isPlannedVessel={isPlannedVessel}
            containerStatus={containerStatus}
            currentPort={currentPort}
            currentLeg={currentLeg}
            t={t}
          />
        </div>
      )}

      {/* Map - 2/3 width (or full if no info overlay) */}
      <div className={`relative border border-border overflow-hidden ${showInfoOverlay ? 'w-2/3 rounded-r-lg' : 'w-full rounded-lg'}`}>
        <GoogleMap
          mapContainerStyle={containerStyle}
          center={center}
          zoom={8}
          onLoad={onMapLoad}
          onIdle={handleMapIdle}
          options={mapOptions}
        >
          {/* Vessel Marker */}
          {vessel?.lastPosition && (
            <MarkerF
              position={{ lat: vessel.lastPosition.lat, lng: vessel.lastPosition.lng }}
              icon={shipIcon}
              title={displayName}
              zIndex={2000}
            />
          )}

          {/* Trace Polyline */}
          {tracePath.length > 1 && (
            <PolylineF
              path={tracePath}
              options={{
                strokeColor: '#8b5cf6', // Purple
                strokeOpacity: 0.6,
                strokeWeight: 2,
                geodesic: true,
              }}
            />
          )}

          {/* POIs — faint, non-intrusive circles (visual only) plus a small clickable
              center dot. Making the circles non-clickable means a large translucent circle
              can never swallow clicks for a small port/terminal sitting inside it; the dot
              is always the precise, overlap-resistant click target. */}
          {enablePois && pois?.map((poi) => {
            const color = POI_COLORS[poi.type] ?? '#64748b'
            const isSelected = selectedPoi?.code === poi.code
            return (
              <React.Fragment key={poi.code}>
                <CircleF
                  center={poi.center}
                  radius={poi.radiusMeters}
                  options={{
                    fillColor: color,
                    fillOpacity: isSelected ? 0.2 : 0.08,
                    strokeColor: color,
                    strokeOpacity: isSelected ? 0.9 : 0.5,
                    strokeWeight: 1,
                    clickable: false,
                    // Smaller circles on top so they aren't buried under large translucent fills
                    zIndex: Math.round(1_000_000 / Math.max(poi.radiusMeters, 1)),
                  }}
                />
                <MarkerF
                  position={poi.center}
                  icon={poiDotIcon ? poiDotIcon(color, isSelected) : undefined}
                  title={getPoiPrimaryName(poi, locale)}
                  onClick={() => setSelectedPoi(poi)}
                  zIndex={isSelected ? 1000 : 500}
                />
              </React.Fragment>
            )
          })}

          {/* POI details popup. Position-anchored: rendering InfoWindowF inside MarkerF does
              NOT inject the marker anchor in this version of @react-google-maps/api, which
              throws "must provide either an anchor or a position" on open. The pixelOffset in
              infoWindowOptions lifts the bubble just above the center dot. */}
          {selectedPoi && (
            <InfoWindowF
              position={selectedPoi.center}
              onCloseClick={() => setSelectedPoi(null)}
              options={infoWindowOptions}
            >
              <div className="relative min-w-[150px] max-w-[240px] text-slate-800 pr-5">
                {/* Custom close button (Google's default header is disabled) */}
                <button
                  type="button"
                  onClick={() => setSelectedPoi(null)}
                  aria-label={t('shipment_tracking.map.close', 'Close')}
                  className="absolute top-0 right-0 flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 leading-none"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: POI_COLORS[selectedPoi.type] ?? '#64748b' }}
                  />
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    {getPoiTypeLabel(selectedPoi.type, t)}
                  </span>
                </div>
                <div className="text-sm font-semibold leading-tight text-slate-900">
                  {getPoiPrimaryName(selectedPoi, locale)}
                </div>
                {selectedPoi.terminalName && selectedPoi.portName && (
                  <div className="text-xs text-slate-500 mt-0.5">{selectedPoi.portName}</div>
                )}
                {(selectedPoi.city || selectedPoi.country) && (
                  <div className="text-xs text-slate-500 mt-0.5">
                    {[selectedPoi.city, selectedPoi.country].filter(Boolean).join(', ')}
                  </div>
                )}
                <div className="text-[11px] font-mono text-slate-400 mt-1">
                  {selectedPoi.locode || selectedPoi.code}
                </div>
              </div>
            </InfoWindowF>
          )}
        </GoogleMap>

        {/* Loading Indicator for Trace */}
        {(isTraceLoading || isDebouncing) && (
          <div className="absolute top-3 right-3 bg-card/95 backdrop-blur-sm rounded-lg shadow-sm px-2 py-1 border border-border">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-muted-foreground">
                {t('shipment_tracking.map.loadingTrace', 'Loading...')}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default VesselTrackingMap
