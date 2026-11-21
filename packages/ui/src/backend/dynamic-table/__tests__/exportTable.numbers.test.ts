import * as XLSX from 'xlsx'
import { createCellStore } from '../store/index'
import type { ColumnDef } from '../types/index'
import { extractExportRows, extractExportRowsFromData, toCsv, toXlsxBlob, xlsxNumberFormat } from '../utils/exportTable'

// GEPARD-343 (GT Księgowość, 19.11): "Pobieranie excela z poziomu Księgowość/Wyciągi/Rozliczone — kwoty mają kropki
// zamiast przecinków … formuła Suma nie działa poprawnie i trzeba najpierw poprawić kropki na przecinki". The .xlsx
// export wrote every cell as text, so 4556.52 arrived as the text "4556.52" — not a number to a Polish Excel, left
// aligned, skipped by SUMA. A number is now a number cell (Excel prints it with the reader's own decimal comma), shown
// with the column's decimals; text stays text, and the CSV is as it was.

// The Księgowość desk's amount columns: pl-PL, two decimals, grouped ("347 738,50").
const DESK = { locale: 'pl-PL', minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as unknown as ColumnDef['numericFormat']

const columns: ColumnDef[] = [
  { data: 'invoiceNumber', title: 'Faktura' },
  { data: 'amount', title: 'Kwota', type: 'numeric', numericFormat: DESK },
  { data: 'currency', title: 'Waluta' },
  { data: 'settledOn', title: 'Data', type: 'date' },
  { data: 'left', title: 'pozostało', type: 'numeric', numericFormat: DESK },
]

// What the desk's "Rozliczone" table holds: amounts as numbers, an invoice number that looks like a number as text.
const rows = [
  { id: 's1', invoiceNumber: 'GTAED26090384', amount: 4556.52, currency: 'USD', settledOn: '2026-10-19', left: 73.37 },
  { id: 's2', invoiceNumber: '2104727692', amount: 1103.6, currency: 'USD', settledOn: '2026-10-19', left: null },
]

async function readBack(blob: Blob) {
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
  const wb = XLSX.read(buf, { type: 'array', cellNF: true })
  return wb.Sheets[wb.SheetNames[0]]
}

describe('GEPARD-343 — the .xlsx export writes numbers as numbers', () => {
  it('an amount is a number cell with the column\'s decimals; text — a number-like invoice number too — stays text', async () => {
    const store = createCellStore(rows, columns)
    const sheet = await readBack(toXlsxBlob(extractExportRows(store, columns, new Set(), 'id'), XLSX))
    expect(sheet.B2).toMatchObject({ t: 'n', v: 4556.52, z: '#,##0.00' })
    expect(sheet.B3).toMatchObject({ t: 'n', v: 1103.6, z: '#,##0.00' })
    expect(sheet.E2).toMatchObject({ t: 'n', v: 73.37, z: '#,##0.00' })
    expect(sheet.A3).toMatchObject({ t: 's', v: '2104727692' })
    expect(sheet.C2).toMatchObject({ t: 's', v: 'USD' })
    expect(sheet.D2).toMatchObject({ t: 's', v: '2026-10-19' })
    // Nothing to pay: an empty cell, as before.
    expect(sheet.E3?.v ?? '').toBe('')
    expect(sheet.B1).toMatchObject({ t: 's', v: 'Kwota' })
  })

  it('the whole view (rows read page by page) writes the same cells', async () => {
    const sheet = await readBack(toXlsxBlob(extractExportRowsFromData(rows, columns), XLSX))
    expect(sheet.B2).toMatchObject({ t: 'n', v: 4556.52, z: '#,##0.00' })
    expect(sheet.A3).toMatchObject({ t: 's', v: '2104727692' })
  })

  it('a numeric column\'s amount kept as text by an API ("-588.80") is its number; a formatted one is left as text', async () => {
    const cols: ColumnDef[] = [{ data: 'amount', title: 'Kwota', type: 'numeric', numericFormat: DESK }]
    const out = extractExportRowsFromData([{ amount: '-588.80' }, { amount: '1 234,56 PLN' }, { amount: '' }, { amount: '0x1A' }], cols)
    expect(out.values).toEqual([[-588.8], ['1 234,56 PLN'], [''], ['0x1A']])
    // A number-like string in a text column is never made a number.
    expect(extractExportRowsFromData([{ ref: '00211' }], [{ data: 'ref', title: 'Wyciąg' }]).values).toEqual([['00211']])
  })

  it('a numeric column\'s exportValue that gives a number (rollups, formulas) is a number cell', async () => {
    const cols: ColumnDef[] = [{ data: 'total', title: 'Razem', type: 'numeric', exportValue: (_v, row) => (row as { a: number; b: number }).a + (row as { a: number; b: number }).b }]
    const sheet = await readBack(toXlsxBlob(extractExportRowsFromData([{ a: 0.1, b: 0.2 }], cols), XLSX))
    expect(sheet.A2).toMatchObject({ t: 'n' })
    expect(sheet.A2.v).toBeCloseTo(0.3)
    // No numericFormat: Excel's own General format.
    expect(sheet.A2.z === undefined || sheet.A2.z === 'General').toBe(true)
  })

  it('a text column\'s value stays text, a number too: an identifier is not shown as "7,56E+09" (CHECK omm #55, N1)', async () => {
    const cols: ColumnDef[] = [{ data: 'ref', title: 'Nr referencyjny' }, { data: 'n', title: 'Liczba', exportValue: (v) => v as number }]
    const out = extractExportRowsFromData([{ ref: 7564321098, n: 12 }], cols)
    expect(out.values).toEqual([['7564321098', '12']])
    const sheet = await readBack(toXlsxBlob(out, XLSX))
    expect(sheet.A2).toMatchObject({ t: 's', v: '7564321098' })
  })

  it('the CSV is as it was: the same text cells, a dot as the decimal point', () => {
    const store = createCellStore(rows, columns)
    const out = extractExportRows(store, columns, new Set(), 'id')
    expect(out.rows).toEqual([
      ['GTAED26090384', '4556.52', 'USD', '2026-10-19', '73.37'],
      ['2104727692', '1103.6', 'USD', '2026-10-19', ''],
    ])
    expect(toCsv(out)).toContain('GTAED26090384,4556.52,USD,2026-10-19,73.37')
  })

  it('a table built by hand (headers + rows, no values) is written as it is', async () => {
    const sheet = await readBack(toXlsxBlob({ headers: ['Kwota'], rows: [['4556.52']] }, XLSX))
    expect(sheet.A2).toMatchObject({ t: 's', v: '4556.52' })
  })
})

describe('GEPARD-343 — the Excel number format of a numeric column', () => {
  const numeric = (numericFormat?: ColumnDef['numericFormat']): ColumnDef => ({ data: 'x', type: 'numeric', numericFormat })

  it('fixed decimals, grouped unless grouping is off', () => {
    expect(xlsxNumberFormat(numeric(DESK))).toBe('#,##0.00')
    expect(xlsxNumberFormat(numeric({ minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }))).toBe('0.00')
    expect(xlsxNumberFormat(numeric({ minimumFractionDigits: 2, maximumFractionDigits: 4 }))).toBe('#,##0.00##')
    expect(xlsxNumberFormat(numeric({ minimumFractionDigits: 3 }))).toBe('#,##0.000')
  })

  it('none (Excel\'s General) without fixed decimals, for a percent or currency style, or a column that is not numeric', () => {
    expect(xlsxNumberFormat(numeric())).toBeUndefined()
    expect(xlsxNumberFormat(numeric({ maximumFractionDigits: 2 }))).toBeUndefined()
    expect(xlsxNumberFormat(numeric({ style: 'percent', minimumFractionDigits: 1 }))).toBeUndefined()
    expect(xlsxNumberFormat(numeric({ style: 'currency', currency: 'PLN', minimumFractionDigits: 2 }))).toBeUndefined()
    expect(xlsxNumberFormat({ data: 'x', numericFormat: DESK })).toBeUndefined()
  })
})
