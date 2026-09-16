/**
 * Availability detection for terminal containers.
 *
 * Derives two business signals from the latest N4 `/unit` snapshot of a
 * container, reusing the hold catalogue in `./holds` to decide what actually
 * blocks a physical pickup:
 *
 * - **Empty-ready** — an empty container sitting in the yard with no
 *   movement-blocking holds is releasable for collection. Per Baltic Hub's
 *   Navis docs, `EMPTY PERMISSION` is applied to *every* empty regardless of
 *   direction and is cleared once the carrier's EDO/booking is provided; empties
 *   are handled under N4 category `Storage`, not `Export` — so this does not
 *   gate on category.
 * - **Import holds-cleared** — an import container in the yard whose blocking
 *   holds have just been lifted (transition blocked → clear) has become
 *   collectable.
 *
 * Pure helpers — no DI, no persistence. The service owns the one-shot guard
 * (job-level `emptyReadyAt` / `holdsClearedAt`).
 */
import { resolveHolds } from './holds'
import { parseTerminalStops } from './stops'

/** N4 in-yard transit state (discharged, available on the terminal). */
const YARD_STATE = 'S40_YARD'

/** Minimal shape both a fetched event and a persisted `TerminalEvent` satisfy. */
export type AvailabilityInput = {
  transitState?: string | null
  impediments?: string[] | null
  rawData?: Record<string, unknown> | null
}

/** Count holds that block physical movement / loading / pickup. */
export function blockingHoldCount(impediments: readonly string[] | null | undefined): number {
  return resolveHolds(impediments ?? null).filter((h) => h.blocksMovement).length
}

/**
 * Whether two raw impediment lists differ as sets (order- and duplicate-
 * insensitive, whitespace-trimmed). An absent/null prior is treated as empty,
 * so a first-seen container carrying holds counts as a change. Drives the
 * `equipment.holds_updated` event (fires on every poll the hold set changes).
 */
export function impedimentsChanged(
  prior: readonly string[] | null | undefined,
  current: readonly string[] | null | undefined,
): boolean {
  const norm = (l: readonly string[] | null | undefined): string[] =>
    Array.from(new Set((l ?? []).map((c) => c.trim()).filter((c) => c !== ''))).sort()
  const a = norm(prior)
  const b = norm(current)
  if (a.length !== b.length) return true
  return a.some((code, i) => code !== b[i])
}

/** N4 `Category` column, normalized to import/export (null if absent/unknown). */
function category(e: AvailabilityInput): 'import' | 'export' | null {
  const c = String(e.rawData?.['Category'] ?? '').trim().toLowerCase()
  return c === 'import' || c === 'export' ? c : null
}

/**
 * Whether the container is empty, per the N4 `Frght Kind` column. Baltic Hub
 * reports empties as `Empty` (confirmed against a real /unit payload, 2026-07);
 * `MTY` is kept as a defensive alias for other N4 terminals. Full containers
 * report `FCL`/`LCL`.
 */
function isEmpty(e: AvailabilityInput): boolean {
  const kind = String(e.rawData?.['Frght Kind'] ?? '').trim().toUpperCase()
  return kind === 'EMPTY' || kind === 'MTY'
}

function isInYard(e: AvailabilityInput): boolean {
  return e.transitState === YARD_STATE
}

/**
 * Whether the terminal has explicitly stopped road pickup for this container
 * (Stop-Road). Only an *explicit* stop counts — an absent column (`null`, the
 * pre-update world) or a `false` never blocks, keeping this purely additive.
 *
 * This gates only the **state-based** `isEmptyReady` below, where a road stop
 * simply *delays* the one-shot until it lifts (the signal is re-evaluated every
 * poll). The **transition-based** `isImportHoldsCleared` is deliberately NOT
 * gated: it fires on the holds blocked→clear edge, so suppressing it during a
 * road stop would lose the event entirely once the edge has passed, rather than
 * defer it — the container's holds still genuinely cleared.
 */
function isRoadPickupStopped(e: AvailabilityInput): boolean {
  return parseTerminalStops(e.rawData).road === true
}

/**
 * Empty ready for pickup: an empty container in the yard with no movement-
 * blocking holds (its `EMPTY PERMISSION` and any others have cleared). State-
 * based — evaluate on the latest snapshot. Direction-agnostic, since empties
 * sit under N4 category `Storage` rather than `Export`.
 */
export function isEmptyReady(e: AvailabilityInput): boolean {
  return isEmpty(e) && isInYard(e) && blockingHoldCount(e.impediments) === 0 && !isRoadPickupStopped(e)
}

/**
 * Import holds cleared: an import container in the yard whose blocking holds
 * went from present → none this poll. Transition-based, so it never fires for a
 * container that was never blocked.
 */
export function isImportHoldsCleared(
  e: AvailabilityInput,
  priorImpediments: readonly string[] | null | undefined,
): boolean {
  return (
    category(e) === 'import' &&
    isInYard(e) &&
    blockingHoldCount(priorImpediments) > 0 &&
    blockingHoldCount(e.impediments) === 0
  )
}
