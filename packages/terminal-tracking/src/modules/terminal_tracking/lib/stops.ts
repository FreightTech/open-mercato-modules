/**
 * Load/pickup "STOP" flags for Navis N4 terminals (Baltic Hub / BCT).
 *
 * The N4 `/unit` endpoint gained three columns (Baltic Hub API update, Aug 2026)
 * that state, per transport mode, whether the container currently CANNOT be
 * loaded / picked up:
 *
 * - **Stop-Vsl**  — no loading onto a **vessel** (export blocked).
 * - **Stop-Road** — no pickup by **road / truck**.
 * - **Stop-Rail** — no pickup by **rail**.
 *
 * Unlike the `Unit Impediments` hold list (from which blocking is *inferred* via
 * the catalogue in `./holds`), these are the terminal stating the restriction
 * directly, so they are a cleaner mode-specific signal.
 *
 * Pure helper — no DI, no i18n, no React. Reads from the N4 row's `rawData` map
 * (header → value) so the SAME parse serves the `/unit` parser, the availability
 * logic (which runs on the persisted event's `rawData`), and the details drawer.
 *
 * ── Header + value format ───────────────────────────────────────────────────
 * Confirmed against a real Baltic Hub `/unit` payload (2026-07): headers are
 * `Stop-Vsl` / `Stop-Rail` / `Stop-Road`, values are the strings `"true"` /
 * `"false"`. Header matching is still done **tolerantly** (case- and
 * punctuation-insensitive) and value parsing treats any non-empty, non-falsy
 * token as an active stop, so a minor terminal-side format change (or another
 * N4 terminal spelling the columns differently) keeps working — everything
 * keys off this one file.
 */

/** Transport mode a STOP flag applies to. */
export type TerminalStopMode = 'vsl' | 'road' | 'rail'

/**
 * The three STOP flags for a container. `null` means the terminal did not report
 * that column at all (older terminals / pre-update payloads) — distinct from
 * `false`, which means the column was present and no restriction is active.
 */
export type TerminalStops = {
  /** No loading onto a vessel (export). */
  vsl: boolean | null
  /** No pickup by road / truck. */
  road: boolean | null
  /** No pickup by rail. */
  rail: boolean | null
}

/** All-unknown stops (nothing reported). */
export const NO_STOPS: TerminalStops = { vsl: null, road: null, rail: null }

/**
 * Candidate column headers per mode, in normalized form (lower-case,
 * non-alphanumerics stripped). First match wins. `stopvessel` is kept alongside
 * `stopvsl` in case the header spells the word out.
 */
const STOP_HEADERS: Record<TerminalStopMode, readonly string[]> = {
  vsl: ['stopvsl', 'stopvessel'],
  road: ['stoproad'],
  rail: ['stoprail'],
}

/** Values that mean "no stop" when the column is present. */
const FALSY_TOKENS = new Set(['', '0', 'n', 'no', 'false', 'f', '-'])

/** Normalize a header for tolerant matching: lower-case, drop non-alphanumerics. */
function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Interpret a present column value as an active stop (true) or not (false). */
function isActiveStop(value: unknown): boolean {
  if (value == null) return false
  return !FALSY_TOKENS.has(String(value).trim().toLowerCase())
}

/**
 * Parse the STOP flags out of an N4 row's `rawData` (header → value). Returns
 * `null` for a mode whose column is absent, `false`/`true` when present.
 */
export function parseTerminalStops(rawData: Record<string, unknown> | null | undefined): TerminalStops {
  if (!rawData) return { ...NO_STOPS }

  const byNorm = new Map<string, unknown>()
  for (const [key, value] of Object.entries(rawData)) byNorm.set(normalizeHeader(key), value)

  const read = (mode: TerminalStopMode): boolean | null => {
    for (const candidate of STOP_HEADERS[mode]) {
      if (byNorm.has(candidate)) return isActiveStop(byNorm.get(candidate))
    }
    return null
  }

  return { vsl: read('vsl'), road: read('road'), rail: read('rail') }
}

/** True only when road pickup is explicitly stopped (not on null/false). */
export function isRoadStopped(stops: TerminalStops): boolean {
  return stops.road === true
}

/**
 * Whether the set of *actively-stopped* modes differs between two snapshots.
 * Drives the `equipment.stops_updated` event. Compares on truthiness, so
 * `null` (unreported) and `false` (reported, not stopped) are equivalent —
 * both mean "not stopped" — mirroring how `impedimentsChanged` treats a null
 * and an empty hold list as equal. This keeps a first poll of containers that
 * merely carry all-`false` STOP columns from emitting spurious change events.
 */
export function stopsChanged(prior: TerminalStops, next: TerminalStops): boolean {
  const active = (v: boolean | null) => v === true
  return (
    active(prior.vsl) !== active(next.vsl) ||
    active(prior.road) !== active(next.road) ||
    active(prior.rail) !== active(next.rail)
  )
}

/** The modes with an active stop, in vsl → road → rail order. */
export function activeStopModes(stops: TerminalStops): TerminalStopMode[] {
  const modes: TerminalStopMode[] = []
  if (stops.vsl === true) modes.push('vsl')
  if (stops.road === true) modes.push('road')
  if (stops.rail === true) modes.push('rail')
  return modes
}
