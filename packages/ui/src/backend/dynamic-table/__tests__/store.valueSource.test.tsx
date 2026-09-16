import React from 'react'
import { renderHook } from '@testing-library/react'
import { createCellStore, type CellStore } from '../store/index'
import { CellStoreContext, useCopyHandler } from '../hooks/index'
import { extractExportRows, extractExportRowsFromData } from '../utils/exportTable'
import type { ColumnDef } from '../types/index'

/**
 * REGRESSION — anchor Defect 4: "ONE value source".
 *
 * The store used to keep a second value map (`cellData`) keyed by the NUMERIC
 * `"row:colIndex"`, projected once in `initializeData`. `setColumns()` re-keyed
 * `columnWidths` by `col.data` but left that map alone, so after ANY perspective
 * reorder or column hide the screen (`rowData[col.data]`, via `Cell.tsx`) and
 * the clipboard / CSV / XLSX (`store.getCellValue`) showed DIFFERENT values —
 * and the two export paths disagreed with each other, because
 * `extractExportRowsFromData` already read the row object correctly.
 *
 * These tests pin the single read path. Every assertion compares against the
 * SEEN value — `rowData[col.data]` — computed the same way `Cell.tsx` does.
 * If a second value source is ever reintroduced, the reorder cases below fail.
 */

const ORIGINAL: ColumnDef[] = [
  { data: 'ref', title: 'Ref' },
  { data: 'origin', title: 'Origin' },
  { data: 'destination', title: 'Destination' },
  { data: 'status', title: 'Status' },
]

/** What the user SEES: exactly what `Cell.tsx` renders for (row, col). */
function seenValue(store: CellStore, cols: ColumnDef[], row: number, col: number): any {
  return store.getRowData(row)?.[cols[col].data]
}

function seenGrid(store: CellStore, cols: ColumnDef[]): any[][] {
  return Array.from({ length: store.getRowCount() }, (_, r) =>
    cols.map((_c, c) => seenValue(store, cols, r, c)),
  )
}

function makeRows() {
  return [
    { id: 'r1', ref: 'A1', origin: 'WAW', destination: 'GDN', status: 'new' },
    { id: 'r2', ref: 'A2', origin: 'KRK', destination: 'SZZ', status: 'done' },
    { id: 'r3', ref: 'A3', origin: 'WRO', destination: 'POZ', status: 'new' },
  ]
}

/** The exact TSV the copy handler builds, driven through the real hook. */
function copyTsv(store: CellStore): string | null {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(CellStoreContext.Provider, { value: store }, children)
  const { result } = renderHook(() => useCopyHandler(store), { wrapper })

  let written: string | null = null
  const evt = {
    target: null,
    preventDefault: () => {},
    clipboardData: {
      setData: (mime: string, value: string) => {
        if (mime === 'text/plain') written = value
      },
    },
  } as unknown as ClipboardEvent

  result.current(evt)
  return written
}

describe('CellStore — exactly one cell-value source', () => {
  it('projects rowData[col.data] rather than caching by column index', () => {
    const store = createCellStore(makeRows(), ORIGINAL)
    expect(store.getCellValue(0, 1)).toBe('WAW')

    // Mutating the row object in place is what the optimistic edit path does;
    // a cached second source would keep serving the old value.
    store.getRowData(0).origin = 'LCJ'
    expect(store.getCellValue(0, 1)).toBe('LCJ')
  })

  it('returns undefined for a column index that does not exist', () => {
    const store = createCellStore(makeRows(), ORIGINAL)
    expect(store.getCellValue(0, 99)).toBeUndefined()
    expect(store.getCellValue(99, 0)).toBeUndefined()
  })
})

describe('Defect 4 — reorder columns, then copy and export', () => {
  // Perspective reorder: Status first, then Destination, Ref, Origin.
  const REORDERED: ColumnDef[] = [ORIGINAL[3], ORIGINAL[2], ORIGINAL[0], ORIGINAL[1]]

  it('getCellValue follows the new view order immediately', () => {
    const store = createCellStore(makeRows(), ORIGINAL)
    store.setColumns(REORDERED)

    expect(store.getCellValue(0, 0)).toBe('new') // status
    expect(store.getCellValue(0, 1)).toBe('GDN') // destination
    expect(store.getCellValue(0, 2)).toBe('A1') // ref
    expect(store.getCellValue(0, 3)).toBe('WAW') // origin
  })

  it('COPY yields the SEEN values, not the pre-reorder ones', () => {
    const store = createCellStore(makeRows(), ORIGINAL)
    store.setColumns(REORDERED)
    store.setSelection({
      type: 'range',
      anchor: { row: 0, col: 0 },
      focus: { row: 2, col: 3 },
    })

    const expected = seenGrid(store, REORDERED)
      .map((row) => row.join('\t'))
      .join('\n')

    expect(copyTsv(store)).toBe(expected)
    // Spelled out so a regression reads as a value mismatch, not a diff of two
    // computed strings.
    expect(copyTsv(store)).toBe(
      ['new\tGDN\tA1\tWAW', 'done\tSZZ\tA2\tKRK', 'new\tPOZ\tA3\tWRO'].join('\n'),
    )
  })

  it('getCellsInSelection (the copy source) matches the seen grid', () => {
    const store = createCellStore(makeRows(), ORIGINAL)
    store.setColumns(REORDERED)
    store.setSelection({
      type: 'range',
      anchor: { row: 0, col: 0 },
      focus: { row: 2, col: 3 },
    })

    for (const cell of store.getCellsInSelection()) {
      expect(cell.value).toBe(seenValue(store, REORDERED, cell.row, cell.col))
    }
  })

  it('BOTH export paths agree with each other and with the seen grid', () => {
    const rows = makeRows()
    const store = createCellStore(rows, ORIGINAL)
    store.setColumns(REORDERED)

    const fromStore = extractExportRows(store, REORDERED, new Set(), 'id')
    const fromData = extractExportRowsFromData(rows, REORDERED)
    const seen = seenGrid(store, REORDERED).map((r) => r.map((v) => String(v ?? '')))

    expect(fromStore.headers).toEqual(['Status', 'Destination', 'Ref', 'Origin'])
    expect(fromStore.headers).toEqual(fromData.headers)
    expect(fromStore.rows).toEqual(seen)
    expect(fromStore.rows).toEqual(fromData.rows)
    expect(fromStore.rows[0]).toEqual(['new', 'GDN', 'A1', 'WAW'])
  })

  it('writes land on the field the user is looking at after a reorder', () => {
    const store = createCellStore(makeRows(), ORIGINAL)
    store.setColumns(REORDERED)

    // Column 1 is now Destination.
    store.setCellValue(0, 1, 'SZZ')

    expect(store.getRowData(0).destination).toBe('SZZ')
    expect(store.getRowData(0).origin).toBe('WAW') // untouched
    expect(store.getCellValue(0, 1)).toBe('SZZ')
  })
})

describe('Defect 4 — hide a column, then copy and export', () => {
  // Perspective hides Origin; the rest keep their relative order.
  const HIDDEN: ColumnDef[] = [ORIGINAL[0], ORIGINAL[2], ORIGINAL[3]]

  it('COPY and both export paths skip the hidden column and stay aligned', () => {
    const rows = makeRows()
    const store = createCellStore(rows, ORIGINAL)
    store.setColumns(HIDDEN)
    store.setSelection({
      type: 'range',
      anchor: { row: 0, col: 0 },
      focus: { row: 0, col: 2 },
    })

    expect(copyTsv(store)).toBe('A1\tGDN\tnew')

    const fromStore = extractExportRows(store, HIDDEN, new Set(), 'id')
    const fromData = extractExportRowsFromData(rows, HIDDEN)
    expect(fromStore.rows).toEqual(seenGrid(store, HIDDEN).map((r) => r.map(String)))
    expect(fromStore.rows).toEqual(fromData.rows)
    expect(fromStore.rows[0]).toEqual(['A1', 'GDN', 'new'])
  })
})

describe('Defect 4 — new rows have every column key present', () => {
  it('seeds columns the caller omitted so nothing reads as undefined', () => {
    const store = createCellStore(makeRows(), ORIGINAL)
    store.addRow({ id: 'draft', ref: 'NEW' }, 0)

    const rowData = store.getRowData(0)
    ORIGINAL.forEach((col, c) => {
      expect(rowData[col.data]).toBe(store.getCellValue(0, c))
    })
    expect(store.getCellValue(0, 0)).toBe('NEW')
    expect(store.getCellValue(0, 1)).toBe('')
    expect(store.getCellValue(0, 3)).toBe('')
  })
})
