import type { TerminalStops } from '../../stops'

/**
 * Normalized representation of one N4 "Unit Facility Visit" row returned by
 * the terminal `/unit` endpoint (the `query-response.data-table` envelope).
 * Field names mirror the N4 column headers (mapped by name, not position).
 */
export type N4UnitRow = {
  ufvGkey: string
  unitNbr: string
  tState?: string | null
  vState?: string | null
  category?: string | null
  lineOp?: string | null
  typeIso?: string | null
  frghtKind?: string | null
  ibActualVisit?: string | null
  obActualVisit?: string | null
  timeIn?: string | null
  timeOut?: string | null
  impediments?: string[] | null
  cenNumber?: string | null
  vgmWeight?: number | null
  cargoWtKg?: number | null
  tareWt?: number | null
  weightKg?: number | null
  seals?: string[] | null
  dskNumber?: string | null
  loaded?: string | null
  /** Per-mode load/pickup STOP flags (Stop-Vsl / Stop-Road / Stop-Rail). */
  stops: TerminalStops
  /** The full header->value map for rawData persistence. */
  raw: Record<string, string | null>
}

/**
 * Normalized representation of one N4 vessel visit row returned by the `/VESSEL`
 * endpoint. Date fields are raw strings ("yyyy-mm-dd hh:mm"); the adapter parses
 * them via parseN4DateTime. There are two voyages — inbound and outbound.
 */
export type N4VesselRow = {
  visitRef: string
  vesselName: string | null
  ibVoyage: string | null
  obVoyage: string | null
  line: string | null
  phase: string | null
  eta: string | null
  etd: string | null
  ata: string | null
  atd: string | null
  beginReceive: string | null
  dryCutoff: string | null
  /** The full header->value map for rawData persistence. */
  raw: Record<string, string | null>
}
