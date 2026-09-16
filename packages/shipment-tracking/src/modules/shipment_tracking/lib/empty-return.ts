/**
 * Container-journey completion detection (to stop polling a finished job).
 *
 * A container is done when the carrier reports either:
 *
 * - **Empty return** (DCSA carriers) — an actual (`ACT`) empty gate-in
 *   (`GTIN` + `emptyIndicatorCode === 'EMPTY'`). Keying on the empty flag is
 *   unambiguous: a *laden* `GTIN` is the export-origin gate-in (see
 *   `route-inference.ts`), so this can never fire at origin.
 * - **Delivered to consignee** (COSCO) — an actual `DLVR` event. COSCO never
 *   emits `GTIN`/`emptyIndicatorCode`, so it needs its own terminal signal.
 *   `DLVR` is COSCO-exclusive (no other adapter or fixture emits it), so this
 *   branch cannot prematurely stop a DCSA carrier. Note: we deliberately key on
 *   the `DLVR` *event code*, not the `DELIVERED` *status* — DCSA carriers reach
 *   `DELIVERED` via `GTOT`-at-destination (laden pickup) *before* the empty is
 *   returned, so a status-based stop would defeat the empty-return intent.
 *
 * A `TrackingJob` may cover many containers (Bill of Lading / Booking Number),
 * so a job is only complete when **every** discovered container is complete —
 * never on the first. Pure helpers: no DI, no persistence.
 *
 * Backup for missing events: empty gate-in (and COSCO `DLVR`) are sometimes
 * absent from carrier feeds, so `destinationArrivedBefore` stops a job once it
 * has arrived at its destination port and `STALE_AFTER_ARRIVAL_DAYS` have passed.
 */

/** Minimal event shape both a fetched and a persisted `TrackingEvent` satisfy. */
export type EmptyReturnEvent = {
  eventType: string
  eventCode: string
  eventClassifierCode?: string | null
  emptyIndicatorCode?: string | null
  equipmentReference?: string | null
  locationUnlocode?: string | null
  eventDateTime?: Date | string | null
}

/** Buffer after destination arrival before we stop a job whose empty-return event never arrived. */
export const STALE_AFTER_ARRIVAL_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

/** The `cutoff` for `destinationArrivedBefore`: arrivals at/before this are stale. */
export function staleArrivalCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - STALE_AFTER_ARRIVAL_DAYS * DAY_MS)
}

/** An actual empty gate-in — the empty container returned to a depot (DCSA). */
export function isEmptyGateIn(e: EmptyReturnEvent): boolean {
  return (
    e.eventType === 'EQUIPMENT' &&
    e.eventCode === 'GTIN' &&
    e.emptyIndicatorCode === 'EMPTY' &&
    e.eventClassifierCode === 'ACT'
  )
}

/** An actual delivery to consignee — COSCO's terminal signal (CS210 → DLVR). */
export function isFinalDelivery(e: EmptyReturnEvent): boolean {
  return e.eventType === 'EQUIPMENT' && e.eventCode === 'DLVR' && e.eventClassifierCode === 'ACT'
}

/** A container is done when it is returned empty (DCSA) or delivered (COSCO). */
export function isContainerComplete(e: EmptyReturnEvent): boolean {
  return isEmptyGateIn(e) || isFinalDelivery(e)
}

/**
 * True when the job has ≥1 discovered container and every one has completed its
 * journey (empty return or delivery), i.e. polling can stop.
 */
export function allContainersComplete(
  events: readonly EmptyReturnEvent[],
  containerNumbers: ReadonlySet<string>,
): boolean {
  if (containerNumbers.size === 0) return false
  const complete = new Set<string>()
  for (const e of events) {
    if (e.equipmentReference && isContainerComplete(e)) complete.add(e.equipmentReference)
  }
  for (const c of containerNumbers) {
    if (!complete.has(c)) return false
  }
  return true
}

/**
 * An actual arrival at the job's destination port — `ARRI` (transport) or `DISC`
 * (equipment), `ACT`, at the destination UNLOCODE. Destination-scoped by
 * construction: a null/unknown destination matches nothing, so the backup can
 * never fire for an in-transit shipment. Transshipment arrivals (different
 * UNLOCODE) are excluded.
 */
export function isDestinationArrival(
  e: EmptyReturnEvent,
  destinationUnlocode: string | null | undefined,
): boolean {
  if (!destinationUnlocode) return false
  return (
    (e.eventCode === 'ARRI' || e.eventCode === 'DISC') &&
    e.eventClassifierCode === 'ACT' &&
    !!e.locationUnlocode &&
    e.locationUnlocode.toUpperCase() === destinationUnlocode.toUpperCase()
  )
}

/**
 * Time-based backup: true when the shipment arrived at its destination port
 * at/before `cutoff` (i.e. long enough ago to stop even though the empty-return
 * event never arrived). Job-level — `ARRI` carries no container reference.
 */
export function destinationArrivedBefore(
  events: readonly EmptyReturnEvent[],
  destinationUnlocode: string | null | undefined,
  cutoff: Date,
): boolean {
  for (const e of events) {
    if (!isDestinationArrival(e, destinationUnlocode)) continue
    const t = e.eventDateTime ? new Date(e.eventDateTime).getTime() : NaN
    if (!Number.isNaN(t) && t <= cutoff.getTime()) return true
  }
  return false
}
