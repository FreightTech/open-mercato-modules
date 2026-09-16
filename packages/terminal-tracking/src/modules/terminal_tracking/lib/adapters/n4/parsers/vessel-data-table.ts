import type { N4DataTableResponse } from './data-table'
import type { N4VesselRow } from '../types'

/** Coerce a value that may be a single item or an array into an array. */
function asArray<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

/**
 * Parse the N4 `/VESSEL` `query-response.data-table` envelope into a single
 * vessel-visit row. A `/VESSEL?VISIT_REF=` query targets exactly one visit, so
 * we return the first row (or null when there are none). Columns are mapped by
 * header name, mirroring parseUnitDataTable.
 *
 * Real columns: Visit, Vessel Name, I/B Vyg, O/B Vyg, Line, Phase, ETA, ETD,
 * ATA, ATD, Begin Receive, DryCutoff. The `Visit` column equals the unit's
 * `visitRefIn`/`visitRefOut` (the join key).
 */
export function parseVesselDataTable(body: N4DataTableResponse): N4VesselRow | null {
  const table = body?.['query-response']?.['data-table']
  if (!table) return null

  const columns = asArray(table.columns?.column).map((c) => String(c))
  const rows = asArray(table.rows?.row ?? undefined)
  if (rows.length === 0) return null

  const row = rows[0]
  const fields = asArray(row.field)
  const get = (header: string): string | null => {
    const i = columns.indexOf(header)
    if (i < 0 || i >= fields.length) return null
    const v = fields[i]
    return v == null || v === '' ? null : String(v)
  }

  const raw: Record<string, string | null> = {}
  columns.forEach((col, i) => {
    raw[col] = fields[i] == null || fields[i] === '' ? null : String(fields[i])
  })

  const visitRef = get('Visit')
  if (!visitRef) return null

  return {
    visitRef,
    vesselName: get('Vessel Name'),
    ibVoyage: get('I/B Vyg'),
    obVoyage: get('O/B Vyg'),
    line: get('Line'),
    phase: get('Phase'),
    eta: get('ETA'),
    etd: get('ETD'),
    ata: get('ATA'),
    atd: get('ATD'),
    beginReceive: get('Begin Receive'),
    dryCutoff: get('DryCutoff'),
    raw,
  }
}
