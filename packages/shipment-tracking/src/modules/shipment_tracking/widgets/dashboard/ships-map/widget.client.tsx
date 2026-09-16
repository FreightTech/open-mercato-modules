"use client"

/**
 * Ships Map dashboard widget — fleet-level overview of every vessel currently carrying the
 * organization's tracked containers, plus ports where at-rest cargo waits. Read-only overlay
 * over the `shipment_tracking.dashboard.ships_map` aggregation route.
 */

import * as React from 'react'
import Link from 'next/link'
import { GoogleMap, useJsApiLoader, MarkerF, InfoWindowF } from '@react-google-maps/api'
import { Ship, Anchor, X } from 'lucide-react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@freighttech/ui/backend/utils/apiCall'
import { Spinner } from '@freighttech/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ShipsMapResponse, ShipsMapMarker } from '../../../data/validators'
import { DEFAULT_SETTINGS, hydrateShipsMapSettings, type ShipsMapSettings } from './config'

// ─── Types ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GoogleMapInstance = any

// ─── Map configuration (shared look with VesselTrackingMap) ──

const containerStyle: React.CSSProperties = { width: '100%', height: '100%' }

const mapOptions: Record<string, unknown> = {
  zoomControl: true,
  mapTypeControl: false,
  scaleControl: false,
  streetViewControl: false,
  rotateControl: false,
  fullscreenControl: false,
  disableDefaultUI: false,
  gestureHandling: 'cooperative',
  // Muted gray-pastel skin: soft slate water, near-white land, faint borders, hidden POIs/
  // transit and road labels for an uncluttered overview tile.
  styles: [
    { elementType: 'geometry', stylers: [{ color: '#f3f4f6' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#9aa0a6' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }, { weight: 2 }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dde3ea' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#aab2bd' }] },
    { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f1f2f4' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#e7e9ed' }] },
    { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#d6d9df' }] },
    { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#c6cad1' }] },
    { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  ],
}

// Top-down container-ship silhouette (pointing north), shared with VesselTrackingMap.
const CONTAINER_SHIP_PATH = `
  M 12 2 L 8 7 L 8 30 Q 8 32, 10 32 L 10 34 L 14 34 L 14 32 Q 16 32, 16 30 L 16 7 L 12 2 Z
  M 10 32 L 10 36 L 14 36 L 14 32 Z
`

// ─── Data loading ────────────────────────────────────────────

async function loadShipsMap(): Promise<ShipsMapResponse> {
  const call = await apiCall<ShipsMapResponse>('/api/shipment_tracking/dashboard/ships-map')
  if (!call.ok) {
    const message =
      typeof (call.result as Record<string, unknown> | null)?.error === 'string'
        ? ((call.result as Record<string, unknown>).error as string)
        : `Request failed with status ${call.status}`
    throw new Error(message)
  }
  return call.result ?? { markers: [], unresolvedCount: 0, generatedAt: new Date().toISOString() }
}

// ─── Helpers ─────────────────────────────────────────────────

function formatRelativeTime(dateString: string | null, t: ReturnType<typeof useT>): string {
  if (!dateString) return ''
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)
  if (diffMinutes < 1) return t('shipment_tracking.map.justNow', 'Just now')
  if (diffMinutes < 60) return t('shipment_tracking.map.minutesAgo', '{{count}} min ago', { count: diffMinutes })
  if (diffHours < 24) return t('shipment_tracking.map.hoursAgo', '{{count}}h ago', { count: diffHours })
  return t('shipment_tracking.map.daysAgo', '{{count}}d ago', { count: diffDays })
}

function markerKey(marker: ShipsMapMarker, index: number): string {
  return marker.kind === 'vessel' ? `vessel:${marker.imo}` : `port:${marker.unlocode ?? index}`
}

// ─── Settings panel ──────────────────────────────────────────

function SettingsPanel({
  settings,
  onSettingsChange,
}: {
  settings: ShipsMapSettings
  onSettingsChange: (next: ShipsMapSettings) => void
}) {
  const t = useT()
  const update = (patch: Partial<ShipsMapSettings>) => onSettingsChange({ ...settings, ...patch })
  const inputClass =
    'w-full rounded-md border border-border bg-background px-2 py-1 text-body-regular-sm text-foreground'
  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-body-medium-sm text-muted-foreground">
          {t('shipment_tracking.dashboard.ships_map.settings.zoom', 'Default zoom')}
        </span>
        <input
          type="number"
          min={1}
          max={20}
          value={settings.defaultZoom}
          onChange={(e) => update({ defaultZoom: Number(e.target.value) })}
          className={inputClass}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-body-medium-sm text-muted-foreground">
            {t('shipment_tracking.dashboard.ships_map.settings.centerLat', 'Center latitude')}
          </span>
          <input
            type="number"
            step="0.1"
            value={settings.centerLat}
            onChange={(e) => update({ centerLat: Number(e.target.value) })}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-body-medium-sm text-muted-foreground">
            {t('shipment_tracking.dashboard.ships_map.settings.centerLng', 'Center longitude')}
          </span>
          <input
            type="number"
            step="0.1"
            value={settings.centerLng}
            onChange={(e) => update({ centerLng: Number(e.target.value) })}
            className={inputClass}
          />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-body-medium-sm text-muted-foreground">
          {t('shipment_tracking.dashboard.ships_map.settings.autoRefresh', 'Auto-refresh (seconds, 0 = off)')}
        </span>
        <input
          type="number"
          min={0}
          value={settings.autoRefreshSeconds}
          onChange={(e) => update({ autoRefreshSeconds: Number(e.target.value) })}
          className={inputClass}
        />
      </label>
    </div>
  )
}

// ─── Widget ──────────────────────────────────────────────────

const ShipsMapWidget: React.FC<DashboardWidgetComponentProps<ShipsMapSettings>> = ({
  mode,
  settings,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateShipsMapSettings(settings ?? DEFAULT_SETTINGS), [settings])

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '',
  })

  const [data, setData] = React.useState<ShipsMapResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [map, setMap] = React.useState<GoogleMapInstance | null>(null)
  const [selected, setSelected] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      setData(await loadShipsMap())
    } catch (err) {
      console.error('Failed to load ships map widget data', err)
      setError(t('shipment_tracking.dashboard.ships_map.error', 'Failed to load ships map'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [onRefreshStateChange, t])

  // Initial load + manual refresh via the card's refresh button.
  React.useEffect(() => {
    if (mode === 'settings') return
    refresh().catch(() => {})
  }, [refresh, refreshToken, mode])

  // Auto-refresh.
  React.useEffect(() => {
    if (mode === 'settings') return
    if (!hydrated.autoRefreshSeconds || hydrated.autoRefreshSeconds <= 0) return
    const id = setInterval(() => {
      refresh().catch(() => {})
    }, hydrated.autoRefreshSeconds * 1000)
    return () => clearInterval(id)
  }, [hydrated.autoRefreshSeconds, refresh, mode])

  // Fit bounds to all markers once the map and data are ready.
  React.useEffect(() => {
    if (!map || !isLoaded || typeof window === 'undefined') return
    const markers = data?.markers ?? []
    if (markers.length === 0) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google
    if (!google) return
    if (markers.length === 1) {
      map.setCenter(markers[0].position)
      map.setZoom(Math.max(hydrated.defaultZoom, 5))
      return
    }
    const bounds = new google.maps.LatLngBounds()
    markers.forEach((m) => bounds.extend(m.position))
    map.fitBounds(bounds, 48)
  }, [map, isLoaded, data, hydrated.defaultZoom])

  const shipIconFactory = React.useCallback(
    (heading: number | null) => {
      if (!isLoaded || typeof window === 'undefined') return undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const google = (window as any).google
      if (!google) return undefined
      return {
        path: CONTAINER_SHIP_PATH,
        fillColor: '#0f172a',
        fillOpacity: 0.95,
        strokeColor: '#ffffff',
        strokeWeight: 1.5,
        scale: 1.0,
        rotation: heading ?? 0,
        anchor: new google.maps.Point(12, 18),
      }
    },
    [isLoaded],
  )

  const portIcon = React.useMemo(() => {
    if (!isLoaded || typeof window === 'undefined') return undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google
    if (!google) return undefined
    return {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 7,
      fillColor: '#059669',
      fillOpacity: 0.95,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    }
  }, [isLoaded])

  const infoWindowOptions = React.useMemo(() => {
    if (!isLoaded || typeof window === 'undefined') return undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google
    if (!google) return undefined
    return { headerDisabled: true, pixelOffset: new google.maps.Size(0, -6), maxWidth: 280 }
  }, [isLoaded])

  // ─── Settings mode ─────────────────────────────────────────
  if (mode === 'settings') {
    return <SettingsPanel settings={hydrated} onSettingsChange={onSettingsChange} />
  }

  // ─── Error / map-load states ───────────────────────────────
  if (loadError) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-muted">
        <p className="text-body-regular-sm text-muted-foreground">
          {t('shipment_tracking.map.loadError', 'Failed to load map')}
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-muted">
        <p className="text-body-regular-sm text-destructive">{error}</p>
      </div>
    )
  }

  const markers = data?.markers ?? []
  const vesselCount = markers.filter((m) => m.kind === 'vessel').length
  const showSpinner = !isLoaded || (loading && !data)
  const isEmpty = !showSpinner && markers.length === 0

  return (
    <div className="space-y-2">
      {/* Header: counts + unresolved hint */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-body-medium-sm text-foreground">
          <Ship className="h-4 w-4 text-blue-500" />
          <span>
            {t('shipment_tracking.dashboard.ships_map.vesselCount', '{{count}} ships', { count: vesselCount })}
          </span>
        </div>
        {data && data.unresolvedCount > 0 && (
          <span className="text-body-regular-xs text-muted-foreground">
            {t('shipment_tracking.dashboard.ships_map.unresolved', '{{count}} without position', {
              count: data.unresolvedCount,
            })}
          </span>
        )}
      </div>

      <div className="relative h-72 overflow-hidden rounded-lg border border-border">
        {showSpinner && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-muted">
            <Spinner className="h-6 w-6" />
            <span className="text-body-regular-sm text-muted-foreground">
              {t('shipment_tracking.dashboard.ships_map.loading', 'Loading map…')}
            </span>
          </div>
        )}

        {isEmpty && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-muted">
            <Ship className="h-8 w-8 text-muted-foreground" />
            <span className="text-body-regular-sm text-muted-foreground">
              {t('shipment_tracking.dashboard.ships_map.empty', 'No active vessels')}
            </span>
          </div>
        )}

        {isLoaded && (
          <GoogleMap
            mapContainerStyle={containerStyle}
            center={{ lat: hydrated.centerLat, lng: hydrated.centerLng }}
            zoom={hydrated.defaultZoom}
            onLoad={(m) => setMap(m)}
            onUnmount={() => setMap(null)}
            options={mapOptions}
          >
            {markers.map((marker, index) => {
              const key = markerKey(marker, index)
              return (
                <MarkerF
                  key={key}
                  position={marker.position}
                  icon={marker.kind === 'vessel' ? shipIconFactory(marker.heading) : portIcon}
                  title={marker.kind === 'vessel' ? marker.name ?? marker.imo : marker.portName ?? undefined}
                  zIndex={marker.kind === 'vessel' ? 2000 : 1000}
                  onClick={() => setSelected(key)}
                />
              )
            })}

            {markers.map((marker, index) => {
              const key = markerKey(marker, index)
              if (selected !== key) return null
              return (
                <InfoWindowF
                  key={`iw:${key}`}
                  position={marker.position}
                  onCloseClick={() => setSelected(null)}
                  options={infoWindowOptions}
                >
                  <div className="relative min-w-[180px] max-w-[260px] pr-5 text-slate-800">
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      aria-label={t('shipment_tracking.map.close', 'Close')}
                      className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>

                    {marker.kind === 'vessel' ? (
                      <div className="mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Ship className="h-3.5 w-3.5 text-blue-500" />
                          <span className="text-sm font-semibold leading-tight text-slate-900">
                            {marker.name ?? t('shipment_tracking.map.unknown', 'Unknown')}
                          </span>
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-slate-400">IMO {marker.imo}</div>
                        {marker.destination && (
                          <div className="mt-0.5 text-xs text-slate-500">→ {marker.destination}</div>
                        )}
                        {marker.updatedAt && (
                          <div className="text-[11px] text-slate-400">
                            {formatRelativeTime(marker.updatedAt, t)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Anchor className="h-3.5 w-3.5 text-emerald-600" />
                          <span className="text-sm font-semibold leading-tight text-slate-900">
                            {marker.portName ?? t('shipment_tracking.map.unknown', 'Unknown')}
                          </span>
                        </div>
                        {marker.unlocode && (
                          <div className="mt-0.5 font-mono text-[11px] text-slate-400">{marker.unlocode}</div>
                        )}
                      </div>
                    )}

                    <div className="space-y-0.5 border-t border-slate-100 pt-1.5">
                      {marker.shipments.map((s) => (
                        <Link
                          key={s.id}
                          href={`/backend/shipment-tracking?shipment=${s.id}`}
                          className="block truncate text-xs text-blue-600 hover:underline"
                          title={s.containerNumber ?? s.id}
                        >
                          {s.containerNumber ?? s.id}
                          {s.destinationLocation ? ` · ${s.destinationLocation}` : ''}
                        </Link>
                      ))}
                    </div>
                  </div>
                </InfoWindowF>
              )
            })}
          </GoogleMap>
        )}
      </div>
    </div>
  )
}

export default ShipsMapWidget
