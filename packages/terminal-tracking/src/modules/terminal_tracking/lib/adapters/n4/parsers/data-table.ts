import type { N4UnitRow } from '../types'
import { parseTerminalStops } from '../../../stops'

/** Coerce a value that may be a single item or an array into an array. */
function asArray<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

function toNum(v: string | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function splitList(v: string | null | undefined): string[] | null {
  if (v == null || v === '') return null
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export type N4DataTableResponse = {
  'query-response'?: {
    'data-table'?: {
      '@count'?: string
      columns?: { column?: string | string[] }
      rows?: { row?: N4RawRow | N4RawRow[] } | null
    }
  }
}

type N4RawRow = {
  '@primary-key'?: string
  field?: (string | null) | (string | null)[]
}

/**
 * Parse the N4 `/unit` `query-response.data-table` JSON envelope into typed
 * rows. Maps `field[]` onto `columns.column[]` by index, reads `@primary-key`
 * as the Ufv_Gkey, and tolerates single-vs-array collapsing from XML→JSON.
 */
export function parseUnitDataTable(body: N4DataTableResponse): N4UnitRow[] {
  const table = body?.['query-response']?.['data-table']
  if (!table) return []

  const columns = asArray(table.columns?.column).map((c) => String(c))
  const rows = asArray(table.rows?.row ?? undefined)

  const idx = (header: string): number => columns.indexOf(header)
  const out: N4UnitRow[] = []

  for (const row of rows) {
    const fields = asArray(row.field)
    const get = (header: string): string | null => {
      const i = idx(header)
      if (i < 0 || i >= fields.length) return null
      const v = fields[i]
      return v == null || v === '' ? null : String(v)
    }

    const raw: Record<string, string | null> = {}
    columns.forEach((col, i) => {
      raw[col] = fields[i] == null || fields[i] === '' ? null : String(fields[i])
    })

    const ufvGkey = row['@primary-key'] ? String(row['@primary-key']) : ''
    const unitNbr = get('Unit Nbr') ?? ''
    if (!ufvGkey || !unitNbr) continue

    out.push({
      ufvGkey,
      unitNbr,
      tState: get('T-State'),
      vState: get('V-State'),
      category: get('Category'),
      lineOp: get('Line Op'),
      typeIso: get('Type ISO'),
      frghtKind: get('Frght Kind'),
      ibActualVisit: get('I/B Actual Visit'),
      obActualVisit: get('O/B Actual Visit'),
      timeIn: get('Time In'),
      timeOut: get('Time Out'),
      impediments: splitList(get('Unit Impediments')),
      cenNumber: get('CEN Number'),
      vgmWeight: toNum(get('VGM Weight')),
      cargoWtKg: toNum(get('Cargo Wt (kg)')),
      tareWt: toNum(get('Tare Wt')),
      weightKg: toNum(get('Weight (kg)')),
      seals: [get('Seal Nbr1'), get('Seal Nbr2'), get('Seal Nbr3'), get('Seal Nbr4')].filter(
        (s): s is string => !!s,
      ),
      dskNumber: get('DSK Number'),
      loaded: get('Loaded'),
      stops: parseTerminalStops(raw),
      raw,
    })
  }

  return out
}
