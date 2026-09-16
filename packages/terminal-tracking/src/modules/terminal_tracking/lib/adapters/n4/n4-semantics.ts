import type { N4UnitRow } from './types'
import { DEFAULT_TERMINAL_TIMEZONE, zonedNaiveToUtc } from '../zoned-time'
import type { TerminalFetchedEvent, ResolvedTerminalConfig } from '../../terminal-adapter'
import type {
  TerminalEventType,
  TerminalEventClassifierCode,
  TerminalModeOfTransport,
} from '../../../data/entities'

type StateMapping = {
  code: string // canonical N4 transit-state code
  eventType: TerminalEventType
  eventCode: string
  classifier: TerminalEventClassifierCode
  timestampField: 'timeIn' | 'timeOut' | 'loaded'
}

/**
 * Maps an N4 friendly T-State (as returned by `/unit`) to a normalized event.
 * The `/unit` response uses friendly names ("Inbound", "Yard", "Loaded",
 * "Departed"); the `S*` codes are the request-side filter values.
 */
const STATE_MAP: Record<string, StateMapping> = {
  inbound: { code: 'S20_INBOUND', eventType: 'EQUIPMENT', eventCode: 'GTIN', classifier: 'ACT', timestampField: 'timeIn' },
  ecin: { code: 'S30_ECIN', eventType: 'EQUIPMENT', eventCode: 'GTIN', classifier: 'ACT', timestampField: 'timeIn' },
  yard: { code: 'S40_YARD', eventType: 'EQUIPMENT', eventCode: 'DISC', classifier: 'ACT', timestampField: 'timeIn' },
  loaded: { code: 'S60_LOADED', eventType: 'EQUIPMENT', eventCode: 'LOAD', classifier: 'ACT', timestampField: 'loaded' },
  departed: { code: 'S70_DEPARTED', eventType: 'TRANSPORT', eventCode: 'DEPA', classifier: 'ACT', timestampField: 'timeOut' },
}

/** Map an eventCode to the semantic module event id (or null if none). */
export function semanticEventIdFor(eventCode: string): string | null {
  switch (eventCode) {
    case 'GTIN':
      return 'terminal_tracking.equipment.gate_in'
    case 'DISC':
      return 'terminal_tracking.equipment.discharged'
    case 'LOAD':
      return 'terminal_tracking.equipment.loaded'
    case 'DEPA':
      return 'terminal_tracking.transport.departed'
    default:
      return null
  }
}

export function buildSourceEventId(terminalCode: string, ufvGkey: string, eventCode: string): string {
  return `${terminalCode}:${ufvGkey}:${eventCode}`
}

/**
 * Parse an N4 timestamp ("yyyy-mm-dd hh:mm[:ss]"). N4 returns terminal-local
 * time without an offset, so we interpret it in the terminal's timezone
 * (Europe/Warsaw by default) and return the corresponding UTC instant.
 */
export function parseN4DateTime(
  value: string | null | undefined,
  timeZone: string = DEFAULT_TERMINAL_TIMEZONE,
): Date | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  const [, yyyy, mm, dd, hh, mi, ss] = m
  return zonedNaiveToUtc(+yyyy, +mm, +dd, +hh, +mi, ss ? +ss : 0, timeZone)
}

export function inferMode(visitRef: string | null | undefined): TerminalModeOfTransport | null {
  if (!visitRef) return null
  const v = visitRef.toUpperCase()
  if (v.includes('TRUCK')) return 'TRUCK'
  // Rail visit ids look like 'TUX3W31-25_IMP' / '..._EXP'
  if (/_IMP|_EXP|\bW\d/.test(v)) return 'RAIL'
  return 'VESSEL'
}

/**
 * The container's direction of travel through the terminal, from the N4
 * `Category` column. Anything else N4 reports (notably "Storage" for empties)
 * is not a direction and normalizes to null.
 */
export type TerminalCargoCategory = 'import' | 'export'

/** Normalize an N4 `Category` value to a direction (null when not directional). */
export function parseCargoCategory(rawData: Record<string, unknown> | null | undefined): TerminalCargoCategory | null {
  const category = String(rawData?.['Category'] ?? '').trim().toLowerCase()
  if (category === 'import') return 'import'
  if (category === 'export') return 'export'
  return null
}

/**
 * Pick the vessel-side visit ref for a leg, by its N4 `Category`:
 * an **Import** leg's vessel is the inbound visit ("I/B Actual Visit"); an
 * **Export** leg's vessel is the outbound visit ("O/B Actual Visit"). The `dir`
 * tells the caller which voyage (inbound vs outbound) to attach. Returns null
 * when the category is unknown or the relevant side is missing.
 */
export function pickVesselVisit(
  event: Pick<TerminalFetchedEvent, 'visitRefIn' | 'visitRefOut' | 'rawData'>,
): { ref: string; dir: 'in' | 'out' } | null {
  const category = parseCargoCategory(event.rawData)
  if (category === 'import') return event.visitRefIn ? { ref: event.visitRefIn, dir: 'in' } : null
  if (category === 'export') return event.visitRefOut ? { ref: event.visitRefOut, dir: 'out' } : null
  return null
}

/**
 * Map a single N4 unit-facility-visit row to a normalized terminal event,
 * keyed by the row's current transit state. Returns null when the state is not
 * mappable (e.g. advised-only, retired).
 */
export function mapRowToEvent(
  row: N4UnitRow,
  config: ResolvedTerminalConfig,
): TerminalFetchedEvent | null {
  const stateKey = (row.tState ?? '').trim().toLowerCase()
  const mapping = STATE_MAP[stateKey]
  if (!mapping) return null

  const eventDateTime =
    parseN4DateTime(row[mapping.timestampField]) ??
    parseN4DateTime(row.timeOut) ??
    parseN4DateTime(row.loaded) ??
    parseN4DateTime(row.timeIn) ??
    new Date()

  const seals = (row.seals ?? []).map((number) => ({ number, source: config.terminalCode }))

  return {
    source: 'terminal',
    sourceEventId: buildSourceEventId(config.terminalCode, row.ufvGkey, mapping.eventCode),
    eventType: mapping.eventType,
    eventCode: mapping.eventCode,
    eventClassifierCode: mapping.classifier,
    eventDateTime,
    containerNumber: row.unitNbr,
    ufvGkey: row.ufvGkey,
    transitState: mapping.code,
    visitState: row.vState ?? null,
    facilityCode: config.facilityCode ?? null,
    facilityCodeListProvider: config.facilityCodeListProvider ?? null,
    unlocode: config.unlocode ?? null,
    visitRefIn: row.ibActualVisit ?? null,
    visitRefOut: row.obActualVisit ?? null,
    vesselName: null,
    voyageNumber: null,
    modeOfTransport: inferMode(row.obActualVisit) ?? inferMode(row.ibActualVisit),
    seals: seals.length ? seals : null,
    vgmWeightKg: row.vgmWeight ?? null,
    impediments: row.impediments ?? null,
    // The N4 `Loaded` timestamp, parsed independently of the current state so a
    // container that has since departed still carries when it was loaded.
    loadedAt: parseN4DateTime(row.loaded),
    rawData: row.raw,
  }
}
