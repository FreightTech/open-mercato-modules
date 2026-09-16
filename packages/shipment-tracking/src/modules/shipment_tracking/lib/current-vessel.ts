/**
 * Current vessel derivation utilities for shipment tracking.
 *
 * Determines which vessel the container is currently on (or waiting for)
 * based on shipment progress through route stops.
 */

import type { RouteStopEntry, CargoEventEntry } from './route-extraction'

// ─── Types ───────────────────────────────────────────────────

/**
 * Container's current tracking status.
 */
export type VesselTrackingStatus =
  | 'in_transit'    // Container is on a vessel moving between ports
  | 'at_port'       // Container is at a port (waiting for next vessel or just arrived)
  | 'not_departed'  // Container hasn't started journey yet (at origin)
  | 'delivered'     // Container has arrived at final destination

/**
 * Information about the current or planned vessel for tracking.
 */
export interface CurrentVesselInfo {
  /** Current or planned vessel name */
  vesselName: string | null
  /** Current or planned vessel IMO for tracking */
  vesselImo: string | null
  /** Container's current status */
  status: VesselTrackingStatus
  /** Current leg info (if in transit) */
  currentLeg?: {
    fromPort: string
    toPort: string
  }
  /** Port name where container currently is (if at_port or not_departed) */
  currentPort?: string
  /** Whether the vessel shown is planned (not yet departed) vs currently carrying container */
  isPlannedVessel: boolean
  /** Start date for trace - ATD from departure port (in_transit) or 7 days ago (planned) */
  traceFrom?: string
}

// ─── Helper Functions ────────────────────────────────────────

/**
 * Returns ISO 8601 date string for 7 days ago.
 * Used as default trace start time for planned vessels.
 */
function getSevenDaysAgo(): string {
  const date = new Date()
  date.setDate(date.getDate() - 7)
  return date.toISOString()
}

// ─── Helper Functions ────────────────────────────────────────

/**
 * Finds the last vessel that carried the container by searching route stops backwards.
 * Used for delivered shipments to show which vessel completed the journey.
 */
function findLastVesselFromStops(
  routeStops: RouteStopEntry[],
  cargoEvents: CargoEventEntry[] | null | undefined
): { vesselName: string | null; vesselImo: string | null } {
  // Work backwards from the last stop to find a stop with vessel info
  for (let i = routeStops.length - 1; i >= 0; i--) {
    const stop = routeStops[i]
    if (stop.vesselName) {
      const vesselImo = stop.vesselImo || findVesselImoFromEvents(stop.vesselName, cargoEvents)
      return { vesselName: stop.vesselName, vesselImo }
    }
  }
  return { vesselName: null, vesselImo: null }
}

// ─── Main Function ───────────────────────────────────────────

/**
 * Determines the current vessel based on shipment progress through route stops.
 *
 * Algorithm:
 * 1. If final destination has ATA → Container delivered, no vessel to track
 * 2. Find the latest stop with ATD where next stop doesn't have ATA
 *    → Container is in transit on this leg's vessel
 * 3. Find stop with ATA but no ATD (container at port waiting)
 *    → Return next leg's planned vessel if available
 * 4. No stops have ATD → Container not departed yet
 *    → Return first leg's planned vessel
 *
 * @param routeStops - Array of route stops from shipment
 * @param cargoEvents - Array of cargo events (used to find vessel IMO if not in stops)
 * @param fallbackVessel - Fallback vessel info from shipment entity
 * @returns CurrentVesselInfo with vessel details and status
 */
export function getCurrentVessel(
  routeStops: RouteStopEntry[] | null | undefined,
  cargoEvents: CargoEventEntry[] | null | undefined,
  fallbackVessel?: { vesselName?: string | null; vesselImo?: string | null }
): CurrentVesselInfo {
  // Default result when no data available
  const defaultResult: CurrentVesselInfo = {
    vesselName: fallbackVessel?.vesselName ?? null,
    vesselImo: fallbackVessel?.vesselImo ?? null,
    status: 'not_departed',
    isPlannedVessel: true,
    traceFrom: getSevenDaysAgo(),
  }

  if (!routeStops || routeStops.length === 0) {
    return defaultResult
  }

  // Check if container is delivered (final destination has ATA)
  const destination = routeStops.find((s) => s.type === 'destination')
  if (destination?.ata) {
    // Find the last vessel that carried the container (for display purposes)
    // Work backwards from destination to find a stop with vessel info
    const lastVesselInfo = findLastVesselFromStops(routeStops, cargoEvents)
    return {
      vesselName: lastVesselInfo.vesselName,
      vesselImo: lastVesselInfo.vesselImo,
      status: 'delivered',
      currentPort: destination.location,
      isPlannedVessel: false,
      // No traceFrom needed for delivered containers (map not shown)
    }
  }

  // Find where the container currently is
  // Look for the latest stop with ATD where the next stop doesn't have ATA yet
  for (let i = routeStops.length - 1; i >= 0; i--) {
    const stop = routeStops[i]
    const nextStop = routeStops[i + 1]

    // Case 1: Stop has ATD and next stop exists but doesn't have ATA
    // → Container is in transit between these stops
    if (stop.atd && nextStop && !nextStop.ata) {
      const vesselImo = stop.vesselImo || findVesselImoFromEvents(stop.vesselName, cargoEvents) || fallbackVessel?.vesselImo || null
      return {
        vesselName: stop.vesselName ?? null,
        vesselImo,
        status: 'in_transit',
        currentLeg: {
          fromPort: stop.location,
          toPort: nextStop.location,
        },
        isPlannedVessel: false,
        traceFrom: stop.atd,  // Use ATD from departure port
      }
    }

    // Case 2: Stop has ATA but no ATD (container is at this port)
    // → Return the next leg's vessel as planned vessel
    if (stop.ata && !stop.atd) {
      // Look for next stop's vessel
      if (nextStop) {
        const vesselImo =
          nextStop.vesselImo || findVesselImoFromEvents(nextStop.vesselName, cargoEvents) || fallbackVessel?.vesselImo || null
        return {
          vesselName: nextStop.vesselName ?? null,
          vesselImo,
          status: 'at_port',
          currentPort: stop.location,
          isPlannedVessel: true,
          traceFrom: getSevenDaysAgo(),  // Last 7 days for planned vessel
        }
      }
      // At final stop but no ATA on destination (shouldn't happen normally)
      return {
        vesselName: null,
        vesselImo: null,
        status: 'at_port',
        currentPort: stop.location,
        isPlannedVessel: false,
        traceFrom: getSevenDaysAgo(),
      }
    }
  }

  // Case 3: No stops have ATD → Container hasn't departed yet
  // Return first leg's vessel as planned
  const origin = routeStops[0]
  const vesselImo = origin?.vesselImo || findVesselImoFromEvents(origin?.vesselName, cargoEvents)

  return {
    vesselName: origin?.vesselName ?? fallbackVessel?.vesselName ?? null,
    vesselImo: vesselImo ?? fallbackVessel?.vesselImo ?? null,
    status: 'not_departed',
    currentPort: origin?.location,
    isPlannedVessel: true,
    traceFrom: getSevenDaysAgo(),  // Last 7 days for planned vessel
  }
}

// ─── More Helper Functions ───────────────────────────────────

/**
 * Find vessel IMO from cargo events by vessel name.
 * Used when RouteStopEntry only has vesselName but needs IMO.
 *
 * @param vesselName - Vessel name to search for
 * @param events - Array of cargo events
 * @returns Vessel IMO if found, null otherwise
 */
export function findVesselImoFromEvents(
  vesselName: string | null | undefined,
  events: CargoEventEntry[] | null | undefined
): string | null {
  if (!vesselName || !events || events.length === 0) {
    return null
  }

  // Find any event with matching vessel name that has an IMO
  const eventWithImo = events.find(
    (e) => e.vesselName === vesselName && e.vesselImo
  )

  return eventWithImo?.vesselImo ?? null
}

/**
 * Get a human-readable description of the current vessel status.
 * Useful for UI display.
 *
 * @param info - Current vessel info
 * @returns Status description object with keys for i18n
 */
export function getVesselStatusDescription(info: CurrentVesselInfo): {
  key: string
  params?: Record<string, string>
} {
  switch (info.status) {
    case 'in_transit':
      return {
        key: 'shipment_tracking.map.inTransit',
        params: {
          destination: info.currentLeg?.toPort ?? '',
        },
      }
    case 'at_port':
      if (info.vesselName) {
        return {
          key: 'shipment_tracking.map.atPortAwaitingVessel',
          params: {
            port: info.currentPort ?? '',
            vessel: info.vesselName,
          },
        }
      }
      return {
        key: 'shipment_tracking.map.atPort',
        params: {
          port: info.currentPort ?? '',
        },
      }
    case 'not_departed':
      if (info.vesselName) {
        return {
          key: 'shipment_tracking.map.awaitingDeparture',
          params: {
            vessel: info.vesselName,
          },
        }
      }
      return {
        key: 'shipment_tracking.map.notDeparted',
      }
    case 'delivered':
      return {
        key: 'shipment_tracking.map.delivered',
      }
  }
}
