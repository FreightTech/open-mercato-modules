import type { IncosContainer, IncosVesselVisit } from './types'
import { DEFAULT_TERMINAL_TIMEZONE, zonedNaiveToUtc } from '../zoned-time'
import type {
  TerminalFetchedEvent,
  ResolvedTerminalConfig,
  NormalizedVesselVisit,
} from '../../terminal-adapter'
import type {
  TerminalEventType,
  TerminalEventClassifierCode,
  TerminalModeOfTransport,
} from '../../../data/entities'

/**
 * INCOS returns a container *state snapshot*, not a timestamped milestone stream
 * (much like GCT). We emit only the container's CURRENT milestone — its arrival
 * (`in_yard_date`) while it is on the terminal, or its departure
 * (`out_yard_date`) once it has left — mirroring N4's `/unit` current-state row,
 * rather than synthesizing extra states we cannot timestamp. INCOS has no
 * separate loaded-onto-transport timestamp (N4's "Loaded" column), so no `LOAD`
 * event.
 *
 * The arrival is refined by `in_yard_type` to match N4's vocabulary: a vessel
 * arrival is a discharge (`DISC` → `equipment.discharged`), a truck/rail arrival
 * is a gate-in (`GTIN` → `equipment.gate_in`). The departure is `DEPA`
 * (`transport.departed`). All three `eventCode`s are the ones the service maps
 * via n4-semantics `semanticEventIdFor`, so no adapter-specific downstream
 * wiring is needed.
 */

type MilestoneSpec = {
  eventType: TerminalEventType
  eventCode: string
  classifier: TerminalEventClassifierCode
}

const GATE_IN: MilestoneSpec = { eventType: 'EQUIPMENT', eventCode: 'GTIN', classifier: 'ACT' }
const DISCHARGED: MilestoneSpec = { eventType: 'EQUIPMENT', eventCode: 'DISC', classifier: 'ACT' }
const DEPARTED: MilestoneSpec = { eventType: 'TRANSPORT', eventCode: 'DEPA', classifier: 'ACT' }

/** The container's direction of travel. */
export type IncosCargoDirection = 'import' | 'export'

/**
 * Map INCOS `category` to a direction. Unlike GCT (which infers from a status
 * prefix), INCOS states it explicitly: `E` = export, `I`/`X` = import. Blank or
 * unknown yields null.
 */
export function directionFromCategory(category: string | null | undefined): IncosCargoDirection | null {
  const c = (category ?? '').trim().toUpperCase()
  if (!c) return null
  if (c === 'E') return 'export'
  if (c === 'I' || c === 'X') return 'import'
  return null
}

/**
 * Map an INCOS yard-move type (`in_yard_type` / `out_yard_type`) to a mode of
 * transport: `T` truck, `V` vessel, `R` rail. Blank/unknown yields null.
 */
export function modeFromYardType(type: string | null | undefined): TerminalModeOfTransport | null {
  const t = (type ?? '').trim().toUpperCase()
  if (t === 'T') return 'TRUCK'
  if (t === 'V') return 'VESSEL'
  if (t === 'R') return 'RAIL'
  return null
}

/**
 * Parse an INCOS datetime — `DD-MM-YYYY HH:MI` (optionally with seconds), e.g.
 * `03-05-2020 03:28`. INCOS returns terminal-local time without an offset, so we
 * interpret it in the terminal's timezone (Europe/Warsaw by default) and return
 * the corresponding UTC instant. Returns null when empty or the shape does not
 * match (a strict match avoids `Date.parse` misreading the day-first order as
 * month-first).
 */
export function parseIncosDateTime(
  value: string | null | undefined,
  timeZone: string = DEFAULT_TERMINAL_TIMEZONE,
): Date | null {
  if (!value) return null
  const m = /^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  const [, dd, mm, yyyy, hh, mi, ss] = m
  return zonedNaiveToUtc(+yyyy, +mm, +dd, +hh, +mi, ss ? +ss : 0, timeZone)
}

/**
 * Parse an INCOS **vessel-visit** datetime — `YYYY-MM-DD HH:MM[:SS]`, e.g.
 * `2026-08-13 18:00:00`. This is a DIFFERENT format from the container endpoint's
 * day-first `DD-MM-YYYY HH:MI` (confirmed against the live API). Terminal-local,
 * no offset → interpreted in the terminal's timezone, consistent with
 * `parseIncosDateTime`.
 */
export function parseIncosVesselDateTime(
  value: string | null | undefined,
  timeZone: string = DEFAULT_TERMINAL_TIMEZONE,
): Date | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  const [, yyyy, mm, dd, hh, mi, ss] = m
  return zonedNaiveToUtc(+yyyy, +mm, +dd, +hh, +mi, ss ? +ss : 0, timeZone)
}

/**
 * Encode an INCOS vessel visit key. INCOS looks a visit up by (vesselCode,
 * voyage), so both are packed into one visit ref as `CODE/VOY` (vessel codes and
 * voyages contain no `/`). Returns null unless both parts are present.
 */
export function combinedVisitRef(
  code: string | null | undefined,
  voyage: string | null | undefined,
): string | null {
  const c = (code ?? '').trim()
  const v = (voyage ?? '').trim()
  return c && v ? `${c}/${v}` : null
}

/** Split a `CODE/VOY` visit ref back into its parts (on the first `/`). */
export function splitVisitRef(visitRef: string): { vesselCode: string; voyage: string } | null {
  const i = visitRef.indexOf('/')
  if (i <= 0 || i >= visitRef.length - 1) return null
  return { vesselCode: visitRef.slice(0, i), voyage: visitRef.slice(i + 1) }
}

/**
 * Normalize an INCOS vessel-visit payload into the shared `NormalizedVesselVisit`.
 * INCOS has no `phase`, `beginReceive`, or `dryCutoff`, so those are null.
 */
export function normalizeIncosVesselVisit(
  data: IncosVesselVisit,
  visitRef: string,
): NormalizedVesselVisit {
  return {
    visitRef,
    vesselName: data.vessel_name ?? null,
    ibVoyage: data.in_voy ?? null,
    obVoyage: data.out_voy ?? null,
    line: data.line_code ?? null,
    phase: null,
    eta: parseIncosVesselDateTime(data.eta),
    etd: parseIncosVesselDateTime(data.etd),
    ata: parseIncosVesselDateTime(data.ata),
    atd: parseIncosVesselDateTime(data.atd),
    beginReceive: null,
    dryCutoff: null,
    rawData: { ...data },
  }
}

/** Split a `;`-separated INCOS list, dropping blanks. */
function splitList(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

function buildSourceEventId(terminalCode: string, ufvGkey: string, eventCode: string): string {
  return `${terminalCode}:${ufvGkey}:${eventCode}`
}

/** Per-milestone view of the snapshot: which yard-type + vessel fields apply. */
type MilestoneContext = {
  yardType: string | null | undefined
  vesselName: string | null | undefined
  voyage: string | null | undefined
}

function baseEvent(
  container: IncosContainer,
  config: ResolvedTerminalConfig,
  ufvGkey: string,
  spec: MilestoneSpec,
  eventDateTime: Date,
  ctx: MilestoneContext,
): TerminalFetchedEvent {
  const seals = [container.seal1, container.seal2, container.seal3, container.seal4]
    .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
    .map((number) => ({ number, source: config.terminalCode }))

  const direction = directionFromCategory(container.category)

  // Impediments ("stopki"). A customs HOLD is mapped to the direction-specific
  // catalogue code (`CUSTOMS IMPORT/EXPORT HOLD`) so `lib/holds.ts` classifies it
  // as a critical customs hold instead of the "unknown" fallback. Per the INCOS
  // docs `customs_status` is binary — empty, or `HOLD` when a customs hold is
  // placed ("założony") — so this is the full fidelity INCOS offers: it is a real
  // placed hold (not N4's routine auto-clearing "permission"), hence `critical`.
  // Direction unknown → the import code (the dominant BCT flow). Raw `constraint`
  // codes pass through and stay unclassified until INCOS documents them.
  const customsHold =
    String(container.customs_status ?? '').trim().toUpperCase() === 'HOLD'
      ? [direction === 'export' ? 'CUSTOMS EXPORT HOLD' : 'CUSTOMS IMPORT HOLD']
      : []
  const impediments = [...customsHold, ...splitList(container.constraint)]

  const vgm = typeof container.vgm_weight === 'number' ? container.vgm_weight : null

  return {
    source: 'terminal',
    sourceEventId: buildSourceEventId(config.terminalCode, ufvGkey, spec.eventCode),
    eventType: spec.eventType,
    eventCode: spec.eventCode,
    eventClassifierCode: spec.classifier,
    eventDateTime,
    // `ufvGkey` is the trimmed container number — reuse it so `containerNumber`
    // and the dedup key can never disagree (and to avoid a raw-field cast).
    containerNumber: ufvGkey,
    ufvGkey,
    // No S-code state on INCOS; the location is the closest transit signal.
    transitState: container.actual_location ?? null,
    visitState: null,
    facilityCode: config.facilityCode ?? null,
    facilityCodeListProvider: config.facilityCodeListProvider ?? null,
    unlocode: config.unlocode ?? null,
    // INCOS keys a vessel visit by (vesselCode, voyage), so encode both into the
    // visit ref (`CODE/VOY`); the adapter's fetchVesselVisit splits it back apart.
    visitRefIn: combinedVisitRef(container.vessel_code_in, container.vessel_visit_invoy),
    visitRefOut: combinedVisitRef(container.vessel_code_out, container.vessel_visit_outvoy),
    // Vessel name/voyage here are the container-snapshot values; when the config
    // enables the vessel endpoint the service overwrites them (and adds ETA/ATA)
    // from the resolved vessel visit.
    vesselName: ctx.vesselName ?? null,
    voyageNumber: ctx.voyage ?? null,
    modeOfTransport: modeFromYardType(ctx.yardType),
    seals: seals.length ? seals : null,
    vgmWeightKg: vgm,
    impediments: impediments.length ? impediments : null,
    loadedAt: null,
    // Preserve the full snapshot. `Category` (import/export) is the field
    // `parseCargoCategory` reads to pick the vessel-visit side for enrichment.
    rawData: { ...container, Category: direction ?? null },
  }
}

/**
 * Turn one INCOS container snapshot into zero, one, or two normalized events:
 * a gate-in when `in_yard_date` is set, and a departed when `out_yard_date` is
 * set. A snapshot with neither timestamp yields no events (nothing has provably
 * happened yet). The dedup key is the container number — the container lookup
 * carries no per-visit gkey, so (unlike GCT's `VisitNo`) a container that
 * returns for a later visit reuses the same key.
 */
export function mapContainerToEvents(
  container: IncosContainer,
  config: ResolvedTerminalConfig,
): TerminalFetchedEvent[] {
  const containerNbr = (container.container_nbr ?? '').trim()
  if (!containerNbr) return []
  const ufvGkey = containerNbr

  // Emit only the container's CURRENT milestone, mirroring N4's `/unit` (which
  // returns a single row for the current transit state):
  //  - departed (out_yard_date set) → just DEPA;
  //  - still on terminal (in_yard_date set, no out) → its arrival (DISC/GTIN).
  // Emitting BOTH the historical arrival and the departure on every poll would
  // keep the job from ever completing — the service's `isFullyDeparted` requires
  // *every* event in a poll to be DEPA — so a departed container would be polled
  // forever, wasting requests against BCT's 10k/day cap. The arrival was already
  // persisted (deduped by sourceEventId) while the box sat in the yard, so it
  // stays on the timeline; only its redundant re-emission is dropped here.
  const departed = parseIncosDateTime(container.out_yard_date)
  if (departed) {
    return [
      baseEvent(container, config, ufvGkey, DEPARTED, departed, {
        yardType: container.out_yard_type,
        vesselName: container.vessel_name_out,
        voyage: container.vessel_visit_outvoy,
      }),
    ]
  }

  const grounded = parseIncosDateTime(container.in_yard_date)
  if (grounded) {
    // A vessel arrival is a discharge; a truck/rail (or unspecified) arrival is a
    // gate-in — matching how N4 splits DISC vs GTIN.
    const arrivalSpec = modeFromYardType(container.in_yard_type) === 'VESSEL' ? DISCHARGED : GATE_IN
    return [
      baseEvent(container, config, ufvGkey, arrivalSpec, grounded, {
        yardType: container.in_yard_type,
        vesselName: container.vessel_name_in,
        voyage: container.vessel_visit_invoy,
      }),
    ]
  }

  return []
}
