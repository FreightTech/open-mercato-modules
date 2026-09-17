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
const DEPARTED: MilestoneSpec = { eventType: 'TRANSPORT', eventCode: 'DEPA', classifier: 'ACT' }

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
 * Everything else defaults to VESSEL: GCT is a maritime container terminal and,
 * absent a vessel/export sample confirming the finer direction×milestone mode
 * matrix (import-discharge vs export-load), VESSEL is the correct default for a
 * real, named vessel visit.
 */
const LAND_TRANSPORT_RE = /\bTLO\b|transport\s+l[aą]dowy/i

export function isLandTransport(container: GctContainer): boolean {
  return (
    LAND_TRANSPORT_RE.test(container.VesselName ?? '') ||
    LAND_TRANSPORT_RE.test(container.GCTVoyage ?? '')
  )
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
): TerminalFetchedEvent {
  const seals = (container.SealList ?? [])
    .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
    .map((number) => ({ number, source: config.terminalCode }))
  const holds = (container.HoldCodesList ?? []).filter(
    (c): c is string => typeof c === 'string' && c.trim() !== '',
  )
  const direction = directionFromStatus(container.CntrStatus)
  // GCT signals a land (truck) movement via a TLO sentinel in the vessel/voyage
  // fields rather than a per-movement mode field; when present, the movement is
  // by truck and the "vessel"/"voyage" are placeholders, not real identifiers.
  const land = isLandTransport(container)
  const modeOfTransport: TerminalModeOfTransport = land ? 'TRUCK' : 'VESSEL'
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
 * Turn one GCT container snapshot into zero, one, or two normalized events:
 * a gate-in when `GroundingDateTime` is set, and a departed when
 * `PickupDateTime` is set. A snapshot with neither timestamp yields no events
 * (nothing has provably happened yet).
 */
export function mapContainerToEvents(
  container: GctContainer,
  config: ResolvedTerminalConfig,
): TerminalFetchedEvent[] {
  if (!container.CntrID) return []
  const ufvGkey = (container.VisitNo && container.VisitNo.trim()) || container.CntrID

  const events: TerminalFetchedEvent[] = []
  const grounded = parseGctDateTime(container.GroundingDateTime)
  if (grounded) events.push(baseEvent(container, config, ufvGkey, GATE_IN, grounded))
  const pickedUp = parseGctDateTime(container.PickupDateTime)
  if (pickedUp) events.push(baseEvent(container, config, ufvGkey, DEPARTED, pickedUp))

  return events
}
