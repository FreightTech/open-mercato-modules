import type { GctContainer } from './types'
import { DEFAULT_TERMINAL_TIMEZONE, zonedNaiveToUtc } from '../zoned-time'
import type { TerminalFetchedEvent, ResolvedTerminalConfig } from '../../terminal-adapter'
import type {
  TerminalEventType,
  TerminalEventClassifierCode,
  TerminalModeOfTransport,
} from '../../../data/entities'

/**
 * GCT returns a container *state snapshot*, not a timestamped milestone stream.
 * We emit only the two milestones GCT actually timestamps — grounding (gate-in)
 * and pickup (gate-out/departed) — rather than synthesizing discharge/load from
 * a status code we cannot timestamp. The `eventCode`s (`GTIN`/`DEPA`) are the
 * same the service maps to `equipment.gate_in` / `transport.departed`, so no
 * adapter-specific wiring is needed downstream.
 */

type MilestoneSpec = {
  eventType: TerminalEventType
  eventCode: string
  classifier: TerminalEventClassifierCode
}

const GATE_IN: MilestoneSpec = { eventType: 'EQUIPMENT', eventCode: 'GTIN', classifier: 'ACT' }
const DISCHARGED: MilestoneSpec = { eventType: 'EQUIPMENT', eventCode: 'DISC', classifier: 'ACT' }
const DEPARTED: MilestoneSpec = { eventType: 'TRANSPORT', eventCode: 'DEPA', classifier: 'ACT' }

/** A resolved movement: which milestone to emit and by what mode of transport. */
type Movement = { spec: MilestoneSpec; mode: TerminalModeOfTransport | null }

/** The container's direction of travel, inferred from the GCT status prefix. */
export type GctCargoDirection = 'import' | 'export'

/**
 * Map `CntrStatus` (XF/EM/XM/IF/XI) to a direction: `X*` = export, `I*` = import.
 * `EM` (empty, no purpose) and any unknown value yield null. Kept deliberately
 * lenient — the vendor docs contradict on `IF` (full vs empty) and list an
 * undocumented `XI`, but Phase 1 does not branch on the full/empty nuance.
 */
export function directionFromStatus(status: string | null | undefined): GctCargoDirection | null {
  const s = (status ?? '').trim().toUpperCase()
  if (!s) return null
  if (s.startsWith('X')) return 'export'
  if (s.startsWith('I')) return 'import'
  return null
}

/**
 * GCT has no per-movement mode/yard-type field (unlike INCOS/BCT). Its one mode
 * signal is a sentinel it stuffs into the vessel/voyage fields for a purely
 * *land* movement — a box trucked in that never touched a vessel, labelled
 * "Transport lądowy wym. odprawy" and abbreviated **TLO** (e.g. VesselName
 * "Transport lądowy wym. odprawy (TLO)", GCTVoyage "GCT-TLO-2023"). Those are
 * not real vessel identifiers, so when the sentinel is present we treat the
 * movement as TRUCK and suppress the placeholder vessel/voyage downstream.
 *
 * The finer per-movement mode is then inferred from the maritime flow — see
 * {@link arrivalMovement} / {@link departureMovement}.
 */
const LAND_TRANSPORT_RE = /\bTLO\b|transport\s+l[aą]dowy/i

export function isLandTransport(container: GctContainer): boolean {
  return (
    LAND_TRANSPORT_RE.test(container.VesselName ?? '') ||
    LAND_TRANSPORT_RE.test(container.GCTVoyage ?? '')
  )
}

/**
 * Resolve the **arrival** (grounding) movement — milestone + mode — from the
 * container's direction and whether it is a land (TLO) move. GCT gives no
 * per-movement mode field, so we infer it from how a maritime terminal actually
 * handles the box, mirroring the INCOS/BCT adapter (which picks discharge vs
 * gate-in from the yard type):
 *  - land (TLO):        trucked in, never touched a vessel → GATE_IN  / TRUCK
 *  - import (non-land):  discharged off the arriving vessel → DISCHARGED / VESSEL
 *  - export (non-land):  delivered by road/rail for loading → GATE_IN  / TRUCK
 *  - unknown direction:  keep GATE_IN with an unknown (null) mode — we cannot
 *                        assert discharge without knowing the direction.
 *
 * NOTE: a confirmed import arrival is therefore keyed `DISC`, not `GTIN`; because
 * `sourceEventId` embeds the eventCode, this re-keys import gate-in events — safe
 * while GCT is new (little/no emitted history) and correct going forward.
 */
export function arrivalMovement(
  direction: GctCargoDirection | null,
  land: boolean,
): Movement {
  if (land) return { spec: GATE_IN, mode: 'TRUCK' }
  if (direction === 'import') return { spec: DISCHARGED, mode: 'VESSEL' }
  if (direction === 'export') return { spec: GATE_IN, mode: 'TRUCK' }
  return { spec: GATE_IN, mode: null }
}

/**
 * Resolve the **departure** (pickup) movement. The milestone stays DEPARTED (the
 * service maps it to `transport.departed`); only the mode varies:
 *  - export (non-land): loaded onto the departing vessel → VESSEL
 *  - import / land:     gated out by road/rail            → TRUCK
 *  - unknown direction: null
 */
export function departureMovement(
  direction: GctCargoDirection | null,
  land: boolean,
): Movement {
  if (land) return { spec: DEPARTED, mode: 'TRUCK' }
  if (direction === 'import') return { spec: DEPARTED, mode: 'TRUCK' }
  if (direction === 'export') return { spec: DEPARTED, mode: 'VESSEL' }
  return { spec: DEPARTED, mode: null }
}

/**
 * Parse a GCT datetime string. GCT is inconsistent — some fields are ISO-8601
 * with an explicit offset, others look like N4's "yyyy-mm-dd hh:mm"
 * (terminal-local, no offset). A field that carries its own timezone is parsed
 * as-is; a naive one is interpreted in the terminal's timezone (Europe/Warsaw
 * by default). Returns null when unparseable or empty.
 */
export function parseGctDateTime(
  value: string | null | undefined,
  timeZone: string = DEFAULT_TERMINAL_TIMEZONE,
): Date | null {
  if (!value) return null
  const raw = value.trim()
  if (!raw) return null
  // An explicit timezone (`Z` or `±hh:mm`) is authoritative — parse directly.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const ms = Date.parse(raw.replace(' ', 'T'))
    return Number.isNaN(ms) ? null : new Date(ms)
  }
  // Otherwise it is terminal-local-without-offset: interpret it in `timeZone`.
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw)
  if (!m) return null
  const [, yyyy, mm, dd, hh, mi, ss] = m
  return zonedNaiveToUtc(+yyyy, +mm, +dd, +hh, +mi, ss ? +ss : 0, timeZone)
}

function buildSourceEventId(terminalCode: string, ufvGkey: string, eventCode: string): string {
  return `${terminalCode}:${ufvGkey}:${eventCode}`
}

function baseEvent(
  container: GctContainer,
  config: ResolvedTerminalConfig,
  ufvGkey: string,
  spec: MilestoneSpec,
  eventDateTime: Date,
  modeOfTransport: TerminalModeOfTransport | null,
): TerminalFetchedEvent {
  const seals = (container.SealList ?? [])
    .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
    .map((number) => ({ number, source: config.terminalCode }))
  const holds = (container.HoldCodesList ?? []).filter(
    (c): c is string => typeof c === 'string' && c.trim() !== '',
  )
  const direction = directionFromStatus(container.CntrStatus)
  // GCT stuffs a TLO sentinel into the vessel/voyage fields for a purely land
  // move; those are placeholders, not real identifiers, so suppress them. A real
  // vessel visit (import discharge or export load) keeps its name/voyage even
  // when the arrival leg itself is by truck.
  const land = isLandTransport(container)
  const vesselName = land ? null : container.VesselName ?? null
  const voyageNumber = land ? null : container.GCTVoyage ?? container.OwnerVoyage ?? null

  return {
    source: 'terminal',
    sourceEventId: buildSourceEventId(config.terminalCode, ufvGkey, spec.eventCode),
    eventType: spec.eventType,
    eventCode: spec.eventCode,
    eventClassifierCode: spec.classifier,
    eventDateTime,
    containerNumber: container.CntrID,
    ufvGkey,
    transitState: container.CntrStatus ?? null,
    visitState: null,
    facilityCode: config.facilityCode ?? null,
    facilityCodeListProvider: config.facilityCodeListProvider ?? null,
    unlocode: config.unlocode ?? null,
    visitRefIn: null,
    visitRefOut: null,
    // Vessel name/voyage are metadata only — GCT has no vessel-visit endpoint, so
    // no schedule (ETA/ATA) enrichment is possible. Nulled for land (TLO) moves
    // so the placeholder does not surface as a real vessel/voyage downstream.
    vesselName,
    voyageNumber,
    modeOfTransport,
    seals: seals.length ? seals : null,
    vgmWeightKg: typeof container.VGMWeight === 'number' ? container.VGMWeight : null,
    impediments: holds.length ? holds : null,
    loadedAt: null,
    // Preserve the full snapshot plus a normalized direction for downstream use.
    rawData: { ...container, Category: direction ?? null },
  }
}

/**
 * Turn one GCT container snapshot into zero, one, or two normalized events: an
 * arrival when `GroundingDateTime` is set and a departure when `PickupDateTime`
 * is set. The milestone and mode of each leg are resolved from the container's
 * direction and land/vessel nature (see {@link arrivalMovement} /
 * {@link departureMovement}). A snapshot with neither timestamp yields no events
 * (nothing has provably happened yet).
 */
export function mapContainerToEvents(
  container: GctContainer,
  config: ResolvedTerminalConfig,
): TerminalFetchedEvent[] {
  if (!container.CntrID) return []
  const ufvGkey = (container.VisitNo && container.VisitNo.trim()) || container.CntrID
  const direction = directionFromStatus(container.CntrStatus)
  const land = isLandTransport(container)

  const events: TerminalFetchedEvent[] = []
  const grounded = parseGctDateTime(container.GroundingDateTime)
  if (grounded) {
    const { spec, mode } = arrivalMovement(direction, land)
    events.push(baseEvent(container, config, ufvGkey, spec, grounded, mode))
  }
  const pickedUp = parseGctDateTime(container.PickupDateTime)
  if (pickedUp) {
    const { spec, mode } = departureMovement(direction, land)
    events.push(baseEvent(container, config, ufvGkey, spec, pickedUp, mode))
  }

  return events
}
