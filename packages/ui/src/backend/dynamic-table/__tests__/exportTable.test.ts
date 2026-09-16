import * as XLSX from 'xlsx'
import { createCellStore } from '../store/index'
import type { ColumnDef } from '../types/index'
import {
  extractExportRows,
  extractExportRowsFromData,
  toCsv,
  toXlsxBlob,
  slugifyFileName,
} from '../utils/exportTable'

// The export utilities back the toolbar CSV/Excel buttons. extractExportRows
// mirrors the Copy extraction (visible columns, in view order, from the cell
// store); toCsv pins the RFC-4180 escaping + UTF-8 BOM that lets Excel open the
// file with Polish characters intact.

const columns: ColumnDef[] = [
  { data: 'ref', title: 'Ref' },
  { data: 'origin', title: 'Origin' },
  { data: 'client', title: 'Client', exportValue: (v) => {
    try { return JSON.parse(String(v)).name } catch { return String(v ?? '') }
  } },
]

const rows = [
  { id: 'r1', ref: 'A1', origin: 'WAW', client: JSON.stringify({ id: 'c1', name: 'Łódź Sp. z o.o.' }) },
  { id: 'r2', ref: 'A2', origin: 'KRK, PL', client: JSON.stringify({ id: 'c2', name: 'Acme "Co"' }) },
  { id: 'r3', ref: 'A3', origin: 'WRO', client: JSON.stringify({ id: 'c3', name: 'Multi\nLine' }) },
]

describe('extractExportRows', () => {
  it('exports all loaded rows when nothing is selected', () => {
    const store = createCellStore(rows, columns)
    const out = extractExportRows(store, columns, new Set(), 'id')
    expect(out.headers).toEqual(['Ref', 'Origin', 'Client'])
    expect(out.rows).toHaveLength(3)
    // exportValue formats the JSON-in-cell relation column to its display name
    expect(out.rows[0]).toEqual(['A1', 'WAW', 'Łódź Sp. z o.o.'])
  })

  it('exports only the selected rows when a selection exists', () => {
    const store = createCellStore(rows, columns)
    const out = extractExportRows(store, columns, new Set(['r2']), 'id')
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0][0]).toBe('A2')
  })

  it('ignores selected ids that are not on the loaded page', () => {
    const store = createCellStore(rows, columns)
    const out = extractExportRows(store, columns, new Set(['does-not-exist']), 'id')
    expect(out.rows).toHaveLength(0)
  })

  it('emits headers in the supplied column order (view order)', () => {
    const reordered: ColumnDef[] = [columns[2], columns[0]] // Client, Ref
    // The store is keyed by the column order it was built with — in production
    // that's the same view-ordered `cols` passed to extractExportRows.
    const store = createCellStore(rows, reordered)
    const out = extractExportRows(store, reordered, new Set(), 'id')
    expect(out.headers).toEqual(['Client', 'Ref'])
    expect(out.rows[0]).toEqual(['Łódź Sp. z o.o.', 'A1'])
  })

  it('falls back to the column data key when no title is set', () => {
    const noTitle: ColumnDef[] = [{ data: 'ref' }]
    const store = createCellStore(rows, columns)
    const out = extractExportRows(store, noTitle, new Set(), 'id')
    expect(out.headers).toEqual(['ref'])
  })
})

describe('extractExportRowsFromData (whole-table export)', () => {
  it('reads every column straight off the row objects, applying exportValue', () => {
    const out = extractExportRowsFromData(rows, columns)
    expect(out.headers).toEqual(['Ref', 'Origin', 'Client'])
    expect(out.rows).toHaveLength(3)
    expect(out.rows[0]).toEqual(['A1', 'WAW', 'Łódź Sp. z o.o.'])
  })

  it('blanks object/array values that have no exportValue (no "[object Object]")', () => {
    const cols: ColumnDef[] = [
      { data: 'ref', title: 'Ref' },
      { data: 'assignees', title: 'Assignees' },
    ]
    const out = extractExportRowsFromData(
      [{ ref: 'A1', assignees: [{ name: 'x' }] }],
      cols,
    )
    expect(out.rows[0]).toEqual(['A1', ''])
  })
})

describe('toCsv', () => {
  it('prepends a UTF-8 BOM', () => {
    const csv = toCsv({ headers: ['A'], rows: [['x']] })
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('quotes fields containing commas, quotes and newlines (RFC 4180)', () => {
    const store = createCellStore(rows, columns)
    const out = extractExportRows(store, columns, new Set(), 'id')
    const csv = toCsv(out)
    expect(csv).toContain('"KRK, PL"')
    expect(csv).toContain('"Acme ""Co"""')
    expect(csv).toContain('"Multi\nLine"')
  })

  it('uses CRLF row separators', () => {
    const csv = toCsv({ headers: ['A', 'B'], rows: [['1', '2']] })
    expect(csv).toContain('A,B\r\n1,2')
  })
})

describe('toXlsxBlob', () => {
  it('produces a workbook that round-trips back to the same cells', async () => {
    const table = { headers: ['Ref', 'Client'], rows: [['A1', 'Łódź'], ['A2', 'Acme']] }
    const blob = toXlsxBlob(table, XLSX)
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(blob.size).toBeGreaterThan(0)

    // jsdom's Blob has no .arrayBuffer(); read the bytes via FileReader instead.
    const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(blob)
    })
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 })
    expect(aoa[0]).toEqual(['Ref', 'Client'])
    expect(aoa[1]).toEqual(['A1', 'Łódź'])
    expect(aoa[2]).toEqual(['A2', 'Acme'])
  })
})

describe('slugifyFileName', () => {
  it('slugifies a table name', () => {
    expect(slugifyFileName('Faktury VAT 2026')).toBe('faktury-vat-2026')
  })
  it('falls back to "export" for empty input', () => {
    expect(slugifyFileName('   ')).toBe('export')
  })
})
