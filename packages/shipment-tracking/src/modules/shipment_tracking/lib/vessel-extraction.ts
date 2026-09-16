/**
 * Vessel info extraction utilities for shipment tracking.
 */

export type VesselInfo = {
  vesselName: string | null
  vesselImo: string | null
  voyageNumber: string | null
}

type EventWithVesselFields = {
  vesselName?: string | null
  vesselImo?: string | null
  voyageNumber?: string | null
}

/**
 * Finds the latest vessel info from a list of tracking events.
 *
 * For completed voyages, the last event may be a gate operation (GTOT/GTIN)
 * that doesn't have vessel data. This function finds the latest event
 * that has any vessel info (vesselName, vesselImo, or voyageNumber).
 *
 * @param events - Array of tracking events sorted by eventDateTime
 * @returns VesselInfo from the latest event with vessel data, or null if none found
 */
export function findLatestVesselInfo(events: EventWithVesselFields[]): VesselInfo | null {
  const eventWithVessel = [...events]
    .reverse()
    .find((e) => e.vesselName || e.vesselImo || e.voyageNumber)

  if (!eventWithVessel) return null

  return {
    vesselName: eventWithVessel.vesselName ?? null,
    vesselImo: eventWithVessel.vesselImo ?? null,
    voyageNumber: eventWithVessel.voyageNumber ?? null,
  }
}
