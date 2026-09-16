'use client'

import * as React from 'react'
import { useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import Image from 'next/image'
import {
  Ship,
  MapPin,
  Anchor,
  Calendar,
  Package,
  ChevronDown,
  ChevronUp,
  Clock,
  ArrowRight,
  ExternalLink,
  Navigation,
  Radio,
  Truck,
  Warehouse,
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
} from '@freighttech/ui/primitives/sheet'
import { Button } from '@freighttech/ui/primitives/button'
import { Badge } from '@freighttech/ui/primitives/badge'
import { Spinner } from '@freighttech/ui/primitives/spinner'
import { apiCall } from '@freighttech/ui/backend/utils/apiCall'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import type { TimestampEntry } from './CombinedTimestampCell'
import { getCarrierLogo } from '../assets'
import { VesselTrackingMap } from './VesselTrackingMap'
import { getCurrentVessel, type CurrentVesselInfo } from '../lib/current-vessel'
import type { RouteStopEntry, CargoEventEntry } from '../lib/route-extraction'

// ─── Types ───────────────────────────────────────────────────

interface Coords {
  latitude: number
  longitude: number
}

interface FacilityLocation {
  name: string
  unlocode: string | null
  countryCode: string | null
  facilityCode: string | null
  facilityCodeListProvider: 'BIC' | 'SMDG' | null
  facilityTypeCode: string | null
  address: string | null
  coords: Coords | null
  operatorName: string | null
  source: 'dcsa' | 'bic' | 'manual'
}

interface TrackingEventData {
  id: string
  eventType: string
  eventCode: string
  eventClassifierCode: 'ACT' | 'PLN' | 'EST' | null
  eventDateTime: string
  description?: string | null
  locationName?: string | null
  locationUnlocode?: string | null
  // Localized region names for AIS POI events (e.g. open-water waypoints without a UN/LOCODE)
  regionNamePl?: string | null
  regionNameEn?: string | null
  vesselName?: string | null
  vesselImo?: string | null
  voyageNumber?: string | null
  equipmentReference?: string | null
  isTransshipmentMove?: boolean | null
  // Facility/terminal details
  facilityCode?: string | null
  facilityCodeListProvider?: 'BIC' | 'SMDG' | null
  facilityTypeCode?: string | null
  facilityAddress?: string | null
  latitude?: number | null
  longitude?: number | null
}

interface SealInfo {
  number: string
  source?: string | null
  type?: string | null
}

interface ShipmentDetailsData {
  id: string
  status: string
  carrierCode?: string | null
  containerNumber?: string | null
  bookingNumber?: string | null
  isoEquipmentCode?: string | null
  bolNumber?: string | null
  etdTimestamps?: TimestampEntry[] | null
  etaTimestamps?: TimestampEntry[] | null
  atdTimestamps?: TimestampEntry[] | null
  ataTimestamps?: TimestampEntry[] | null
  // Location data (JSONB)
  originLocation?: FacilityLocation | null
  destinationLocation?: FacilityLocation | null
  vesselName?: string | null
  vesselImo?: string | null
  voyageNumber?: string | null
  // Denormalized route and events (no longer need separate API call)
  routeStops?: RouteStop[] | null
  cargoEvents?: TrackingEventData[] | null
  // Aggregated seals from tracking events
  seals?: SealInfo[] | null
  // Kept for backward compatibility
  trackingJob?: { id: string } | null
}

interface RouteStop {
  location: string
  unlocode?: string
  type: 'origin' | 'transshipment' | 'port_call' | 'destination'
  vesselName?: string
  vesselImo?: string | null
  ata?: string | null
  atd?: string | null
  eta?: string | null
  etd?: string | null
  // Facility/terminal details
  facilityCode?: string | null
  facilityCodeListProvider?: 'BIC' | 'SMDG' | null
  facilityTypeCode?: string | null
  facilityAddress?: string | null
  coords?: Coords | null
}

// ─── Helpers ─────────────────────────────────────────────────

function getPrimaryTimestamp(timestamps: TimestampEntry[] | null | undefined): string | null {
  if (!timestamps || timestamps.length === 0) return null
  const latest = timestamps.reduce((best, entry) =>
    entry.updatedAt > best.updatedAt ? entry : best
  )
  return latest.value
}

function formatShortDate(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatDateOnly(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })
}

/**
 * Pick the human-friendly POI region name for the active locale, falling back across
 * locales (the producer only emits pl + en). Returns null when no region name is set,
 * so callers can fall back to locationName / POI code.
 */
function pickRegionName(
  event: Pick<TrackingEventData, 'regionNamePl' | 'regionNameEn'>,
  locale: string
): string | null {
  if (locale === 'pl') return event.regionNamePl || event.regionNameEn || null
  return event.regionNameEn || event.regionNamePl || null
}

/**
 * Calculate transit time in days between departure and arrival.
 * Uses ATD as start, and ATA (if arrived) or ETA (if in transit) as end.
 */
function calculateTransitDays(
  atd: string | null | undefined,
  ata: string | null | undefined,
  eta: string | null | undefined
): number | null {
  const startDate = atd ? new Date(atd) : null
  const endDate = ata ? new Date(ata) : (eta ? new Date(eta) : null)
  if (!startDate || !endDate) return null
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null
  const diffMs = endDate.getTime() - startDate.getTime()
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

/**
 * Calculate delay in days by comparing the oldest timestamp to the newest.
 * This shows drift over time as estimates get updated.
 * Returns positive for delays (late), negative for ahead of schedule.
 */
function calculateDelayFromHistory(timestamps: TimestampEntry[] | null | undefined): number | null {
  if (!timestamps || timestamps.length < 2) return null
  // Sort by updatedAt to get oldest (original estimate) and newest (latest update)
  const sorted = [...timestamps].sort((a, b) =>
    new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
  )
  const oldest = new Date(sorted[0].value)
  const newest = new Date(sorted[sorted.length - 1].value)
  if (Number.isNaN(oldest.getTime()) || Number.isNaN(newest.getTime())) return null
  const diffMs = newest.getTime() - oldest.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  return diffDays !== 0 ? diffDays : null
}

/**
 * Calculate delay by comparing planned (ETD/ETA) to actual (ATD/ATA).
 * Returns positive for delays (late), negative for ahead of schedule.
 */
function calculateDelayFromPlanned(
  planned: string | null | undefined,
  actual: string | null | undefined
): number | null {
  if (!planned || !actual) return null
  const plannedDate = new Date(planned)
  const actualDate = new Date(actual)
  if (Number.isNaN(plannedDate.getTime()) || Number.isNaN(actualDate.getTime())) return null
  const diffMs = actualDate.getTime() - plannedDate.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  return diffDays !== 0 ? diffDays : null
}

// NOTE: getCarrierLogo() is now imported from '../assets' and returns StaticImageData
// for use with next/image component

/**
 * Build carrier tracking URL with optional reference number.
 * Some carriers support direct deep-linking to a specific shipment.
 */
function getCarrierTrackingUrl(
  carrierCode: string | null | undefined,
  reference?: string | null
): string | null {
  if (!carrierCode) return null
  const code = carrierCode.toLowerCase()
  const ref = reference?.trim()

  // Carriers that support direct deep-linking with reference in URL path
  if ((code === 'maeu' || code === 'maersk') && ref) {
    return `https://www.maersk.com/tracking/${encodeURIComponent(ref)}`
  }

  // Fallback to generic tracking pages
  const urls: Record<string, string> = {
    maeu: 'https://www.maersk.com/tracking',
    maersk: 'https://www.maersk.com/tracking',
    mscu: 'https://www.msc.com/track-a-shipment',
    msc: 'https://www.msc.com/track-a-shipment',
    cmdu: 'https://www.cma-cgm.com/ebusiness/tracking',
    'cma-cgm': 'https://www.cma-cgm.com/ebusiness/tracking',
    hlcu: 'https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html',
    'hapag-lloyd': 'https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html',
    cosu: 'https://elines.coscoshipping.com/ebusiness/cargoTracking',
    cosco: 'https://elines.coscoshipping.com/ebusiness/cargoTracking',
    eglv: 'https://www.evergreen-line.com/trkc/',
    evergreen: 'https://www.evergreen-line.com/trkc/',
    oolu: 'https://www.oocl.com/eng/ourservices/eservices/cargotracking',
    oocl: 'https://www.oocl.com/eng/ourservices/eservices/cargotracking',
    one: 'https://ecomm.one-line.com/ecom/CUP_HOM_3301.do',
    oney: 'https://ecomm.one-line.com/ecom/CUP_HOM_3301.do',
    ymlu: 'https://www.yangming.com/e-service/Track_Trace/track_trace_cargo_tracking.aspx',
    'yang-ming': 'https://www.yangming.com/e-service/Track_Trace/track_trace_cargo_tracking.aspx',
    zimu: 'https://www.zim.com/tools/track-a-shipment',
    zim: 'https://www.zim.com/tools/track-a-shipment',
  }
  return urls[code] || null
}

function getStatusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'ARRIVED':
    case 'DELIVERED':
      return 'default'
    case 'IN_TRANSIT':
    case 'DEPARTED':
      return 'secondary'
    case 'PENDING':
    case 'BOOKED':
      return 'outline'
    default:
      return 'outline'
  }
}

// NOTE: extractRouteFromEvents logic has been moved to lib/route-extraction.ts
// and is now executed server-side in TrackingService.deriveShipmentStateFromEvents()
// The computed route is stored as `routeStops` JSONB on the shipment entity.

/**
 * Determines facility location type based on facility code and vessel presence.
 *
 * Facility types (DCSA standard):
 * - POTE = Port Terminal (always port)
 * - INTE = Intermodal Terminal (port if vessel, inland if no vessel)
 * - DEPO = Depot (always inland)
 * - CLOC = Client Location (always inland)
 * - null/undefined = Unknown (use MapPin icon)
 *
 * Returns: 'port' | 'inland' | 'unknown'
 */
function getFacilityLocationType(
  facilityTypeCode: string | null | undefined,
  vesselName?: string | null
): 'port' | 'inland' | 'unknown' {
  // Port terminals are always at ports
  if (facilityTypeCode === 'POTE') {
    return 'port'
  }

  // Depots and client locations are always inland
  if (facilityTypeCode === 'DEPO' || facilityTypeCode === 'CLOC') {
    return 'inland'
  }

  // Intermodal terminals: port if vessel involved, inland otherwise
  if (facilityTypeCode === 'INTE') {
    return vesselName ? 'port' : 'inland'
  }

  // Unknown facility type - use MapPin
  return 'unknown'
}

/**
 * Get the appropriate icon for a tracking event based on event code, facility type, and vessel.
 *
 * Icon selection logic:
 * - Port arrivals: Anchor (vessel arriving at port)
 * - Port departures: Ship (vessel departing from port)
 * - Inland arrivals (depot/client/inland intermodal): Warehouse
 * - Inland departures (depot/client/inland intermodal): Truck
 * - Unknown facility arrivals/departures: MapPin (generic location)
 * - Load/Discharge: Package (cargo handling)
 * - Proximity events: Navigation (approaching)
 * - Waypoints: Radio (tracking point)
 */
function getEventIcon(
  eventCode: string,
  facilityTypeCode?: string | null,
  vesselName?: string | null
) {
  const locationType = getFacilityLocationType(facilityTypeCode, vesselName)

  // Gate events
  if (eventCode === 'GTIN') {
    if (locationType === 'port') return Anchor
    if (locationType === 'inland') return Warehouse
    return MapPin
  }
  if (eventCode === 'GTOT') {
    if (locationType === 'port') return Ship
    if (locationType === 'inland') return Truck
    return MapPin
  }

  switch (eventCode) {
    // Standard DCSA events - check facility type for arrivals/departures
    case 'ARRI':
      if (locationType === 'port') return Anchor
      if (locationType === 'inland') return Warehouse
      return MapPin
    case 'DEPA':
      if (locationType === 'port') return Ship
      if (locationType === 'inland') return Truck
      return MapPin
    case 'LOAD':
    case 'DISC':
      return Package
    // POI/AIS events (always at ports/terminals)
    case 'PARR': // Port Arrival
    case 'TARR': // Terminal Arrival
      return Anchor
    case 'PPRD': // Port Departure
    case 'TPRD': // Terminal Departure
      return Ship
    case 'PPRA': // Port Proximity Arrival
    case 'TPRA': // Terminal Proximity Arrival
      return Navigation
    case 'WAYR': // Waypoint Reached
      return Radio
    default:
      return Package
  }
}

/**
 * Hook to get translated event label.
 * Uses i18n translations from shipment_tracking.event_codes
 */
function useEventLabel() {
  const t = useT()
  
  return useCallback((eventCode: string): string => {
    const key = `shipment_tracking.event_codes.${eventCode}`
    const translated = t(key, eventCode.toLowerCase())
    // If translation returns the key itself, fall back to lowercase code
    return translated === key ? eventCode.toLowerCase() : translated
  }, [t])
}

// ─── Sub-components ──────────────────────────────────────────

type LucideIcon = typeof Ship

interface CollapsibleSectionProps {
  title: string
  icon: LucideIcon
  count?: number
  defaultOpen?: boolean
  children: React.ReactNode
}

function CollapsibleSection({
  title,
  icon: Icon,
  count,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <button
        type="button"
        className="w-full p-3 flex items-center justify-between text-left hover:bg-muted transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center space-x-2">
          <Icon className="w-4 h-4" />
          <span className="font-medium text-foreground">{title}</span>
          {count !== undefined && (
            <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full text-xs font-medium">
              {count}
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      {isOpen && (
        <div className="border-t border-border">
          {children}
        </div>
      )}
    </div>
  )
}

interface ShipmentCardProps {
  shipment: ShipmentDetailsData
}

function ShipmentCard({ shipment }: ShipmentCardProps) {
  const t = useT()
  const carrierLogo = getCarrierLogo(shipment.carrierCode)
  // For deep-linking, prefer BOL > booking > container as reference
  const trackingReference = shipment.bolNumber || shipment.bookingNumber || shipment.containerNumber
  const trackingUrl = getCarrierTrackingUrl(shipment.carrierCode, trackingReference)
  const atdActual = getPrimaryTimestamp(shipment.atdTimestamps)
  const ataActual = getPrimaryTimestamp(shipment.ataTimestamps)
  const etd = getPrimaryTimestamp(shipment.etdTimestamps)
  const eta = getPrimaryTimestamp(shipment.etaTimestamps)
  const atd = atdActual || etd
  const ata = ataActual || eta

  // Calculate transit time
  const transitDays = calculateTransitDays(atdActual || etd, ataActual, eta)

  // Extract location names from JSONB fields
  const originName = shipment.originLocation?.name || shipment.originLocation?.unlocode || '-'
  const destinationName = shipment.destinationLocation?.name || shipment.destinationLocation?.unlocode || '-'
  const originFacilityCode = formatFacilityCode(
    shipment.originLocation?.facilityCode,
    shipment.originLocation?.facilityCodeListProvider
  )
  const destinationFacilityCode = formatFacilityCode(
    shipment.destinationLocation?.facilityCode,
    shipment.destinationLocation?.facilityCodeListProvider
  )

  return (
    <div className="bg-card border border-border rounded-lg p-4 relative">
      <div className="space-y-3">
        {/* Header with reference and carrier logo */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {shipment.bolNumber || shipment.bookingNumber || shipment.containerNumber || shipment.id.slice(0, 8)}
            </h2>
            {shipment.containerNumber && (
              <p className="text-sm text-muted-foreground font-mono mt-1">{shipment.containerNumber}</p>
            )}
          </div>
        </div>

        {/* Carrier logo */}
        {carrierLogo && (
          <div className="w-12 h-12 flex items-center justify-center absolute top-4 right-4">
            <Image
              src={carrierLogo}
              alt={shipment.carrierCode || 'Carrier'}
              width={40}
              height={40}
              className="object-contain"
            />
          </div>
        )}

        {/* Route: Origin -> Destination */}
        <div className="flex items-center gap-2 text-sm">
          <div className="font-medium text-foreground">
            <b>{originName}</b>
            {originFacilityCode && (
              <span className="text-xs text-blue-600 dark:text-blue-400 ml-1 font-mono">[{originFacilityCode}]</span>
            )}
            {atd && <span className="text-muted-foreground"> ({formatDateOnly(atd)})</span>}
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
          <div className="font-medium text-foreground">
            <b>{destinationName}</b>
            {destinationFacilityCode && (
              <span className="text-xs text-blue-600 dark:text-blue-400 ml-1 font-mono">[{destinationFacilityCode}]</span>
            )}
            {ata && <span className="text-muted-foreground"> ({formatDateOnly(ata)})</span>}
          </div>
        </div>

        {/* Vessel info */}
        {shipment.vesselName && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Ship className="w-4 h-4" />
            <span className="font-medium">{shipment.vesselName}</span>
            {shipment.vesselImo && (
              <>
                <span className="text-muted-foreground/70">•</span>
                <span className="font-mono text-xs">IMO: {shipment.vesselImo}</span>
              </>
            )}
          </div>
        )}

        {/* Transit time */}
        {transitDays !== null && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>
              {t('shipment_tracking.details.transitTime', 'Transit time')}: {transitDays} {t('shipment_tracking.details.days', 'days')}
            </span>
          </div>
        )}

        {/* Verify on carrier website */}
        {trackingUrl && (
          <a
            href={trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <span>{t('shipment_tracking.details.verifyOnCarrier', 'Verify on carrier website')}</span>
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
    </div>
  )
}

interface DestinationStatusCardProps {
  shipment: ShipmentDetailsData
}

function DestinationStatusCard({ shipment }: DestinationStatusCardProps) {
  const t = useT()
  const ata = getPrimaryTimestamp(shipment.ataTimestamps)
  const eta = getPrimaryTimestamp(shipment.etaTimestamps)
  const hasArrived = ata !== null

  // Determine status
  let statusLabel = t('shipment_tracking.details.status.enRoute', 'En Route')
  let statusColor = 'bg-yellow-600'
  if (shipment.status === 'ARRIVED' || hasArrived) {
    statusLabel = t('shipment_tracking.details.status.inPort', 'In Port')
    statusColor = 'bg-blue-600'
  } else if (shipment.status === 'DELIVERED') {
    statusLabel = t('shipment_tracking.details.status.delivered', 'Delivered')
    statusColor = 'bg-green-600'
  }

  // Extract location name from JSONB field
  const destLoc = shipment.destinationLocation
  const destinationName = destLoc?.name || destLoc?.unlocode || '-'
  const facilityCode = formatFacilityCode(destLoc?.facilityCode, destLoc?.facilityCodeListProvider)

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <MapPin className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          {t('shipment_tracking.details.destinationStatus', 'Destination Status')}
        </h3>
        <span className={`${statusColor} text-white px-3 py-1 rounded-full text-xs font-medium`}>
          {statusLabel}
        </span>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <Anchor className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-foreground">{destinationName}</span>
          {facilityCode && (
            <span className="text-xs text-blue-600 dark:text-blue-400 font-mono">[{facilityCode}]</span>
          )}
        </div>
        {/* Terminal address */}
        {destLoc?.address && (
          <div className="text-xs text-muted-foreground ml-6 truncate" title={destLoc.address}>
            {destLoc.address}
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>
            {hasArrived
              ? `ATA: ${formatShortDate(ata)}`
              : eta
              ? `ETA: ${formatShortDate(eta)}`
              : '-'}
          </span>
        </div>
      </div>
    </div>
  )
}

interface RouteDetailsProps {
  stops: RouteStop[]
}

/**
 * Get colors based on stop type.
 * Origin = green, Destination = blue, Transshipment = yellow
 */
function getStopColors(type: 'origin' | 'transshipment' | 'port_call' | 'destination') {
  switch (type) {
    case 'origin':
      return {
        bg: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700',
        badge: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
      }
    case 'destination':
      return {
        bg: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700',
        badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
      }
    case 'port_call':
      return {
        bg: 'bg-slate-100 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600',
        badge: 'bg-slate-100 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300',
      }
    case 'transshipment':
    default:
      return {
        bg: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700',
        badge: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
      }
  }
}

/**
 * Formats facility code with provider badge (e.g., "DCT (SMDG)")
 */
function formatFacilityCode(code: string | null | undefined, provider: string | null | undefined): string | null {
  if (!code) return null
  if (provider) return `${code} (${provider})`
  return code
}

/**
 * Get the appropriate icon for a route stop based on facility type, vessel, and stop type.
 *
 * Priority order:
 * 1. Explicit facility types (DEPO, CLOC, POTE, INTE) - respect the data
 * 2. Unknown facility type + origin/destination - assume port for sea container tracking
 * 3. Unknown facility type + transshipment - use MapPin
 *
 * This ensures:
 * - Depots/client locations show Warehouse even if they're origin/destination
 * - Ports with missing facilityTypeCode (like NHAVA SHEVA) show Anchor
 * - Intermodal terminals use vessel presence as the deciding factor
 */
function getRouteStopIcon(
  facilityTypeCode: string | null | undefined,
  vesselName?: string | null,
  stopType?: 'origin' | 'transshipment' | 'port_call' | 'destination'
) {
  // Explicit depot/client locations are always inland (warehouse icon)
  // Respect the data when we know it's a depot or client location
  if (facilityTypeCode === 'DEPO' || facilityTypeCode === 'CLOC') {
    return Warehouse
  }

  // Port terminals are always ports
  if (facilityTypeCode === 'POTE') {
    return Anchor
  }

  // Intermodal terminals: use vessel presence as signal
  if (facilityTypeCode === 'INTE') {
    return vesselName ? Anchor : Warehouse
  }

  // Unknown facility type (null/undefined):
  // For sea container origin/destination, assume port when we have no other info
  // (this handles cases like NHAVA SHEVA where facilityTypeCode is missing)
  if (stopType === 'origin' || stopType === 'destination') {
    return Anchor
  }

  return MapPin // truly unknown transshipment or no stop type
}

function RouteDetails({ stops }: RouteDetailsProps) {
  const t = useT()

  if (stops.length === 0) {
    return null
  }

  // Segment status helpers:
  // - Completed (green): departed from current AND arrived at next
  // - In progress (blue): departed from current but NOT arrived at next
  // - Pending (gray): not departed yet
  const getSegmentStatus = (currentStop: RouteStop, nextStop: RouteStop | undefined): 'completed' | 'in-progress' | 'pending' => {
    if (!currentStop.atd) return 'pending'
    if (nextStop?.ata) return 'completed'
    return 'in-progress'
  }

  const getSegmentLineColor = (status: 'completed' | 'in-progress' | 'pending') => {
    switch (status) {
      case 'completed':
        return 'bg-green-500 dark:bg-green-400'
      case 'in-progress':
        return 'bg-blue-500 dark:bg-blue-400'
      default:
        return 'bg-border'
    }
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
        <MapPin className="w-4 h-4" />
        {t('shipment_tracking.details.routeDetails', 'Route Details')}
      </h3>
      <div className="relative">
        <div className="space-y-0">
          {stops.map((stop, index) => {
            const colors = getStopColors(stop.type)
            const badgeText = stop.type === 'destination'
              ? t('shipment_tracking.details.destination', 'Destination')
              : stop.type === 'transshipment'
              ? t('shipment_tracking.details.transshipment', 'Transshipment')
              : stop.type === 'port_call'
              ? t('shipment_tracking.details.portCall', 'Port call')
              : t('shipment_tracking.details.origin', 'Origin')

            // Calculate delays by comparing planned vs actual
            const departureDelay = calculateDelayFromPlanned(stop.etd, stop.atd)
            const arrivalDelay = calculateDelayFromPlanned(stop.eta, stop.ata)

            // Format facility code with provider
            const facilityDisplay = formatFacilityCode(stop.facilityCode, stop.facilityCodeListProvider)

            // Determine segment status (line to next stop)
            const isLastStop = index === stops.length - 1
            const nextStop = !isLastStop ? stops[index + 1] : undefined
            const segmentStatus = getSegmentStatus(stop, nextStop)

            // Get contextual icon based on facility type and stop type
            const StopIcon = getRouteStopIcon(stop.facilityTypeCode, stop.vesselName, stop.type)

              return (
                <div key={`${stop.unlocode || stop.location}-${index}`} className="relative flex items-start gap-3 py-2">
                  {/* Connecting line to next stop - starts below current icon, extends to next icon center */}
                  {/* Icon: mt-1(4px) + p-2(8px) + icon(16px) + p-2(8px) = 36px total, center at 20px from item top */}
                  {/* Line starts at 36px (below icon), extends to bottom + 20px into next item */}
                  {!isLastStop && (
                    <div
                      className={`absolute left-[15px] top-[36px] bottom-[-20px] w-0.5 ${getSegmentLineColor(segmentStatus)}`}
                    />
                  )}
                  <div className={`relative z-10 mt-1 p-2 rounded-full ${colors.bg}`}>
                    <StopIcon className="w-4 h-4" />
                  </div>
                <div className="flex-1 min-w-0 flex items-start justify-between gap-4">
                  <div className="flex-shrink-0">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="font-semibold text-foreground">{stop.location}</div>
                      <div className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${colors.badge}`}>
                        {badgeText}
                      </div>
                    </div>
                    {/* UN/LOCODE and facility code */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      {stop.unlocode && <span className="font-mono">{stop.unlocode}</span>}
                      {facilityDisplay && (
                        <>
                          {stop.unlocode && <span>•</span>}
                          <span className="font-mono text-blue-600 dark:text-blue-400" title={t('shipment_tracking.details.terminalCode', 'Terminal Code')}>
                            {facilityDisplay}
                          </span>
                        </>
                      )}
                    </div>
                    {/* Facility address */}
                    {stop.facilityAddress && (
                      <div className="text-xs text-muted-foreground mb-1 max-w-[200px] truncate" title={stop.facilityAddress}>
                        {stop.facilityAddress}
                      </div>
                    )}
                    {/* Coordinates */}
                    {stop.coords && (
                      <div className="text-xs text-muted-foreground/70 mb-1 font-mono">
                        {stop.coords.latitude.toFixed(4)}, {stop.coords.longitude.toFixed(4)}
                      </div>
                    )}
                    {stop.vesselName && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Ship className="w-3 h-3" />
                        <span>{stop.vesselName}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right text-sm space-y-2 flex-shrink-0">
                    {/* Departure timestamps */}
                    {(stop.atd || stop.etd) && (
                      <div>
                        <div className="text-muted-foreground text-xs">{stop.atd ? 'ATD:' : 'ETD:'}</div>
                        <div className="font-medium text-foreground">{formatShortDate(stop.atd || stop.etd)}</div>
                        {departureDelay !== null && (
                          <div className={`text-xs ${departureDelay > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                            {departureDelay > 0 ? '+' : ''}{departureDelay} {t('shipment_tracking.details.days', 'days')}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Arrival timestamps */}
                    {(stop.ata || stop.eta) && (
                      <div>
                        <div className="text-muted-foreground text-xs">{stop.ata ? 'ATA:' : 'ETA:'}</div>
                        <div className="font-medium text-foreground">{formatShortDate(stop.ata || stop.eta)}</div>
                        {arrivalDelay !== null && (
                          <div className={`text-xs ${arrivalDelay > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                            {arrivalDelay > 0 ? '+' : ''}{arrivalDelay} {t('shipment_tracking.details.days', 'days')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface JourneyTimelineProps {
  events: TrackingEventData[]
}

function JourneyTimeline({ events }: JourneyTimelineProps) {
  const t = useT()
  const locale = useLocale()
  const getEventLabel = useEventLabel()

  // Sort events by datetime ascending (chronological order - oldest first at top)
  // Use id as secondary sort key for stability when timestamps are equal
  // Hide timeline noise: AIS waypoints (WAYR) and "approaching" proximity events
  // (PPRA/TPRA). Actual arrivals/departures (PARR/TARR/PPRD/TPRD) and DCSA events stay.
  const sortedEvents = useMemo(
    () => events
      .filter((e) => !['WAYR', 'PPRA', 'TPRA'].includes(e.eventCode))
      .sort((a, b) => {
        const timeA = new Date(a.eventDateTime).getTime()
        const timeB = new Date(b.eventDateTime).getTime()
        if (timeA !== timeB) return timeA - timeB
        return a.id.localeCompare(b.id)
      }),
    [events]
  )

  // An event has "already happened" if the journey has progressed past it — i.e. there is an
  // ACT (actual) event at or after its position. We anchor on the LAST actual event in
  // chronological order: everything up to and including it is done (green), even planned
  // (PLN/EST) milestones that were superseded by a later actual event (e.g. a planned
  // departure followed by an actual arrival). Everything after it is still upcoming. See CHAME-185.
  const lastActualIndex = useMemo(() => {
    let last = -1
    sortedEvents.forEach((e, i) => {
      if (e.eventClassifierCode === 'ACT') last = i
    })
    return last
  }, [sortedEvents])

  // Segment (connector) status between event[index] and event[index + 1]:
  // - Completed (green): both ends have already happened
  // - In progress (blue): we've reached this event but not the next (the current leg)
  // - Pending (gray): this event hasn't happened yet
  const getSegmentStatus = (index: number): 'completed' | 'in-progress' | 'pending' => {
    if (index + 1 <= lastActualIndex) return 'completed'
    if (index <= lastActualIndex) return 'in-progress'
    return 'pending'
  }

  const getSegmentLineColor = (status: 'completed' | 'in-progress' | 'pending') => {
    switch (status) {
      case 'completed':
        return 'bg-green-500 dark:bg-green-400'
      case 'in-progress':
        return 'bg-blue-500 dark:bg-blue-400'
      default:
        return 'bg-border'
    }
  }

  return (
    <CollapsibleSection
      title={t('shipment_tracking.details.journeyTimeline', 'Journey Timeline')}
      icon={Calendar}
      count={sortedEvents.length}
      defaultOpen={false}
    >
      <div className="p-3">
        <div className="relative">
          <div className="space-y-4">
            {sortedEvents.map((event, index) => {
              const Icon = getEventIcon(event.eventCode, event.facilityTypeCode, event.vesselName)
              const hasHappened = index <= lastActualIndex
              const borderColor = hasHappened ? 'border-green-300 dark:border-green-700' : 'border-blue-300 dark:border-blue-700'
              const bgColor = hasHappened
                ? 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-800 dark:text-green-300'
                : 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-300'
              const badgeColor = hasHappened
                ? 'bg-green-200 dark:bg-green-800/50 text-green-800 dark:text-green-300'
                : 'bg-blue-200 dark:bg-blue-800/50 text-blue-800 dark:text-blue-300'

              const isLastEvent = index === sortedEvents.length - 1
              const segmentStatus = getSegmentStatus(index)

              return (
                <div key={event.id} className="relative flex items-start gap-4">
                  {/* Connecting line to next event - connects icon centers symmetrically */}
                  {/* Icon: border-2(2px) + p-2(8px) + icon(20px) + p-2(8px) + border-2(2px) = 40px, center at 20px */}
                  {/* space-y-4 = 16px gap between items. Line: from 20px below center to 20px above next center */}
                  {/* Start: 20px (center) + 20px (half icon) = 40px. End: 16px gap + 20px into next = -36px */}
                  {!isLastEvent && (
                    <div
                      className={`absolute left-[19px] top-[40px] bottom-[-36px] w-0.5 ${getSegmentLineColor(segmentStatus)}`}
                    />
                  )}
                  <div className={`relative z-10 p-2 rounded-full border-2 bg-card ${borderColor}`}>
                    <Icon className={`w-5 h-5 ${hasHappened ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'}`} />
                  </div>
                  <div className={`flex-1 border rounded-lg p-3 ${bgColor}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">{getEventLabel(event.eventCode)}</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${badgeColor}`}>
                            {event.eventClassifierCode || 'N/A'}
                          </span>
                        </div>
                        <div className="text-sm font-medium mb-2">
                          {(() => {
                            // Precise place name wins: carrier events and AIS port/terminal
                            // events both populate locationName (e.g. "Gdańsk", "Qingdao QQCTN").
                            if (event.locationName) return event.locationName
                            // Open-water AIS waypoints have no place name — show the localized
                            // region plus the raw POI grid code muted beside it
                            // (e.g. "Morze Północne" · "N053W001-03738").
                            const regionName = pickRegionName(event, locale)
                            if (regionName) {
                              return (
                                <>
                                  {regionName}
                                  {event.locationUnlocode && (
                                    <span className="ml-1.5 font-normal opacity-60">{event.locationUnlocode}</span>
                                  )}
                                </>
                              )
                            }
                            return event.locationUnlocode || '-'
                          })()}
                        </div>
                        <div className="flex items-center gap-4 text-xs">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatShortDate(event.eventDateTime)}
                          </div>
                          {event.vesselName && (
                            <div className="flex items-center gap-1">
                              <Ship className="w-3 h-3" />
                              {event.vesselName}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </CollapsibleSection>
  )
}

interface BookingDetailsProps {
  shipment: ShipmentDetailsData
}

function BookingDetails({ shipment }: BookingDetailsProps) {
  const t = useT()

  return (
    <CollapsibleSection
      title={t('shipment_tracking.details.bookingDetails', 'Booking Details')}
      icon={Package}
      defaultOpen={false}
    >
      <div className="p-3">
        <div className="bg-muted rounded-lg p-4 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {t('shipment_tracking.shipments.fields.containerNumber', 'Container Number')}
            </span>
            <span className="font-mono text-sm font-semibold text-foreground">
              {shipment.containerNumber || 'N/A'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {t('shipment_tracking.shipments.fields.size', 'Size')}
            </span>
            <span className="font-mono text-sm font-semibold text-foreground">
              {shipment.isoEquipmentCode || 'N/A'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {t('shipment_tracking.shipments.fields.bookingNumber', 'Booking Number')}
            </span>
            <span className="font-mono text-sm font-semibold text-foreground">
              {shipment.bookingNumber || 'N/A'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {t('shipment_tracking.shipments.fields.bolNumber', 'BOL Number')}
            </span>
            <span className="font-mono text-sm font-semibold text-foreground">
              {shipment.bolNumber || 'N/A'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {t('shipment_tracking.shipments.fields.carrierCode', 'Carrier Code')}
            </span>
            <span className="font-mono text-sm font-semibold text-foreground">
              {shipment.carrierCode || 'N/A'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {t('shipment_tracking.shipments.fields.seals', 'Seals')}
            </span>
            <span className="font-mono text-sm font-semibold text-foreground">
              {shipment.seals?.length
                ? shipment.seals.map(s => s.number).join(', ')
                : 'N/A'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {t('shipment_tracking.shipments.fields.status', 'Status')}
            </span>
            <Badge variant={getStatusBadgeVariant(shipment.status)}>
              {shipment.status}
            </Badge>
          </div>
        </div>
      </div>
    </CollapsibleSection>
  )
}

// ─── Main Component ──────────────────────────────────────────

export interface ShipmentDetailsDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  shipmentId: string | null
}

export function ShipmentDetailsDrawer({
  open,
  onOpenChange,
  shipmentId,
}: ShipmentDetailsDrawerProps) {
  const t = useT()

  // Fetch shipment data
  const { data: shipment, isLoading: isLoadingShipment } = useQuery({
    queryKey: ['shipment_tracking_shipment_details', shipmentId],
    queryFn: async () => {
      if (!shipmentId) return null
      const response = await apiCall<{ items: Record<string, unknown>[] }>(
        `/api/shipment_tracking/shipments?id=${shipmentId}`
      )
      if (!response.ok) throw new Error('Failed to load shipment')
      const items = response.result?.items ?? []
      const item = items.find((i) => i.id === shipmentId) ?? items[0]
      if (!item) return null

      // Normalize API response
      // Handle trackingJob which can be: { id: string }, string (just the ID), or null
      const trackingJobRaw = item.trackingJob ?? item.tracking_job ?? item.trackingJobId ?? item.tracking_job_id
      let trackingJobId: string | null = null
      if (trackingJobRaw) {
        if (typeof trackingJobRaw === 'string') {
          trackingJobId = trackingJobRaw
        } else if (typeof trackingJobRaw === 'object' && 'id' in trackingJobRaw) {
          trackingJobId = (trackingJobRaw as { id: string }).id
        }
      }

      // Parse denormalized route stops
      const routeStopsRaw = item.routeStops ?? item.route_stops
      const routeStops = Array.isArray(routeStopsRaw) ? routeStopsRaw.map((stop: Record<string, unknown>) => ({
        location: stop.location as string,
        unlocode: (stop.unlocode) as string | undefined,
        type: (stop.type ?? 'transshipment') as 'origin' | 'transshipment' | 'port_call' | 'destination',
        vesselName: (stop.vesselName ?? stop.vessel_name) as string | undefined,
        vesselImo: (stop.vesselImo ?? stop.vessel_imo) as string | null,
        ata: (stop.ata) as string | null,
        atd: (stop.atd) as string | null,
        eta: (stop.eta) as string | null,
        etd: (stop.etd) as string | null,
        // Facility/terminal details
        facilityCode: (stop.facilityCode ?? stop.facility_code) as string | null,
        facilityCodeListProvider: (stop.facilityCodeListProvider ?? stop.facility_code_list_provider) as 'BIC' | 'SMDG' | null,
        facilityTypeCode: (stop.facilityTypeCode ?? stop.facility_type_code) as string | null,
        facilityAddress: (stop.facilityAddress ?? stop.facility_address) as string | null,
        coords: stop.coords ? stop.coords as Coords : null,
      })) : null

      // Parse denormalized cargo events
      const cargoEventsRaw = item.cargoEvents ?? item.cargo_events
      const cargoEvents = Array.isArray(cargoEventsRaw) ? cargoEventsRaw.map((evt: Record<string, unknown>) => ({
        id: evt.id as string,
        eventType: (evt.eventType ?? evt.event_type ?? '') as string,
        eventCode: (evt.eventCode ?? evt.event_code ?? '') as string,
        eventClassifierCode: (evt.eventClassifierCode ?? evt.event_classifier_code) as 'ACT' | 'PLN' | 'EST' | null,
        eventDateTime: (evt.eventDateTime ?? evt.event_date_time) as string,
        description: (evt.description) as string | null,
        locationName: (evt.locationName ?? evt.location_name) as string | null,
        locationUnlocode: (evt.locationUnlocode ?? evt.location_unlocode) as string | null,
        regionNamePl: (evt.regionNamePl ?? evt.region_name_pl) as string | null,
        regionNameEn: (evt.regionNameEn ?? evt.region_name_en) as string | null,
        vesselName: (evt.vesselName ?? evt.vessel_name) as string | null,
        vesselImo: (evt.vesselImo ?? evt.vessel_imo) as string | null,
        voyageNumber: (evt.voyageNumber ?? evt.voyage_number) as string | null,
        isTransshipmentMove: (evt.isTransshipmentMove ?? evt.is_transshipment_move) as boolean | null,
        // Facility/terminal details
        facilityCode: (evt.facilityCode ?? evt.facility_code) as string | null,
        facilityCodeListProvider: (evt.facilityCodeListProvider ?? evt.facility_code_list_provider) as 'BIC' | 'SMDG' | null,
        facilityTypeCode: (evt.facilityTypeCode ?? evt.facility_type_code) as string | null,
        facilityAddress: (evt.facilityAddress ?? evt.facility_address) as string | null,
        latitude: (evt.latitude) as number | null,
        longitude: (evt.longitude) as number | null,
      })) : null

      // Parse rich location data
      const originLocationRaw = item.originLocation ?? item.origin_location
      const destinationLocationRaw = item.destinationLocation ?? item.destination_location

      return {
        id: item.id as string,
        status: (item.status ?? 'PENDING') as string,
        carrierCode: (item.carrierCode ?? item.carrier_code) as string | null,
        containerNumber: (item.containerNumber ?? item.container_number) as string | null,
        bookingNumber: (item.bookingNumber ?? item.booking_number) as string | null,
        isoEquipmentCode: (item.isoEquipmentCode ?? item.iso_equipment_code) as string | null,
        bolNumber: (item.bolNumber ?? item.bol_number) as string | null,
        etdTimestamps: (item.etdTimestamps ?? item.etd_timestamps) as TimestampEntry[] | null,
        etaTimestamps: (item.etaTimestamps ?? item.eta_timestamps) as TimestampEntry[] | null,
        atdTimestamps: (item.atdTimestamps ?? item.atd_timestamps) as TimestampEntry[] | null,
        ataTimestamps: (item.ataTimestamps ?? item.ata_timestamps) as TimestampEntry[] | null,
        originLocation: originLocationRaw as FacilityLocation | null,
        destinationLocation: destinationLocationRaw as FacilityLocation | null,
        vesselName: (item.vesselName ?? item.vessel_name) as string | null,
        vesselImo: (item.vesselImo ?? item.vessel_imo) as string | null,
        voyageNumber: (item.voyageNumber ?? item.voyage_number) as string | null,
        routeStops,
        cargoEvents,
        trackingJob: trackingJobId ? { id: trackingJobId } : null,
      } as ShipmentDetailsData
    },
    enabled: open && !!shipmentId,
  })

  // Use denormalized data directly from shipment - no separate events query needed!
  const routeStops = shipment?.routeStops ?? []
  const events = shipment?.cargoEvents ?? []

  // Derive current vessel from shipment progress
  const currentVessel = useMemo<CurrentVesselInfo>(() => {
    return getCurrentVessel(
      shipment?.routeStops as RouteStopEntry[] | null | undefined,
      shipment?.cargoEvents as CargoEventEntry[] | null | undefined,
      { vesselName: shipment?.vesselName, vesselImo: shipment?.vesselImo }
    )
  }, [shipment?.routeStops, shipment?.cargoEvents, shipment?.vesselName, shipment?.vesselImo])

  const isLoading = isLoadingShipment

  // Handle keyboard shortcuts
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false)
      }
    },
    [onOpenChange]
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex flex-col p-0 w-full sm:max-w-xl md:max-w-2xl"
        overlayClassName="backdrop-blur-none"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex justify-between px-4 py-6 border-b border-border">
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold text-foreground">
              {t('shipment_tracking.details.title', 'Shipment Details')}
            </h1>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <Spinner className="h-6 w-6" />
              <span className="text-sm text-muted-foreground">
                {t('shipment_tracking.details.loading', 'Loading shipment details...')}
              </span>
            </div>
          ) : !shipment ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <span className="text-sm text-muted-foreground">
                {t('shipment_tracking.details.notFound', 'Shipment not found')}
              </span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Shipment Card */}
              <ShipmentCard shipment={shipment} />

              {/* Destination Status */}
              <DestinationStatusCard shipment={shipment} />

              {/* Route Details */}
              {routeStops.length > 0 && <RouteDetails stops={routeStops} />}

              {/* Vessel Tracking Map */}
              {currentVessel.status === 'delivered' ? (
                // Container delivered - show delivered message instead of map
                <div className="relative w-full h-32 border border-green-200 dark:border-green-800 rounded-lg overflow-hidden bg-green-50 dark:bg-green-950/30">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <Package className="w-8 h-8 text-green-500 dark:text-green-400 mx-auto mb-2" />
                      <p className="text-sm font-medium text-green-700 dark:text-green-300">
                        {t('shipment_tracking.map.delivered', 'Container delivered')}
                      </p>
                      {currentVessel.currentPort && (
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                          {currentVessel.currentPort}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : currentVessel.vesselImo ? (
                // Show map with current or planned vessel
                <VesselTrackingMap
                  vesselImo={currentVessel.vesselImo}
                  vesselName={currentVessel.vesselName}
                  height="250px"
                  autoRefresh={true}
                  showInfoOverlay={true}
                  containerStatus={currentVessel.status}
                  currentPort={currentVessel.currentPort}
                  isPlannedVessel={currentVessel.isPlannedVessel}
                  currentLeg={currentVessel.currentLeg}
                  traceFrom={currentVessel.traceFrom}
                />
              ) : (
                // No vessel IMO available
                <div className="relative w-full h-48 border border-border rounded-lg overflow-hidden bg-muted">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <Ship className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">
                        {t('shipment_tracking.details.noVesselData', 'No vessel data available')}
                      </p>
                    </div>
                  </div>
                  {/* Vessel name overlay when no IMO */}
                  {currentVessel.vesselName && (
                    <div className="absolute top-3 left-3 bg-card/95 backdrop-blur-sm rounded-lg shadow-md px-3 py-2 border border-border">
                      <div className="flex items-center gap-2">
                        <Ship className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                        <div>
                          <h2 className="font-semibold text-sm text-foreground">{currentVessel.vesselName}</h2>
                          <p className="text-xs text-muted-foreground">
                            {t('shipment_tracking.details.noImoNumber', 'IMO number not available')}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Journey Timeline */}
              {events.length > 0 && <JourneyTimeline events={events} />}

              {/* Booking Details */}
              <BookingDetails shipment={shipment} />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default ShipmentDetailsDrawer
