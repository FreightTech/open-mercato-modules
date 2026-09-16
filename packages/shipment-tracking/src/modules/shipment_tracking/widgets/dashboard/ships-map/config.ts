export interface ShipsMapSettings {
  /** Initial map zoom (fleet view). */
  defaultZoom: number
  /** Initial map center latitude. */
  centerLat: number
  /** Initial map center longitude. */
  centerLng: number
  /** Auto-refresh interval in seconds; 0 disables auto-refresh. */
  autoRefreshSeconds: number
}

export const DEFAULT_SETTINGS: ShipsMapSettings = {
  defaultZoom: 3,
  centerLat: 54.5, // Baltic, matches VesselTrackingMap default
  centerLng: 18.5,
  autoRefreshSeconds: 60,
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function hydrateShipsMapSettings(raw: unknown): ShipsMapSettings {
  const r = (raw ?? {}) as Partial<Record<keyof ShipsMapSettings, unknown>>
  return {
    defaultZoom: Math.min(20, Math.max(1, Math.round(toFiniteNumber(r.defaultZoom, DEFAULT_SETTINGS.defaultZoom)))),
    centerLat: Math.min(90, Math.max(-90, toFiniteNumber(r.centerLat, DEFAULT_SETTINGS.centerLat))),
    centerLng: Math.min(180, Math.max(-180, toFiniteNumber(r.centerLng, DEFAULT_SETTINGS.centerLng))),
    autoRefreshSeconds: Math.max(0, Math.round(toFiniteNumber(r.autoRefreshSeconds, DEFAULT_SETTINGS.autoRefreshSeconds))),
  }
}
