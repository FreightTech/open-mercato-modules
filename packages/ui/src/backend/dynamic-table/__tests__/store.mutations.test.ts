import { createCellStore, CellStore } from '../store/index'
import type { ColumnDef } from '../types/index'

/**
 * Spec 0 / Phase 2 — `CellStore.addRow` / `removeRow` re-key FIVE parallel maps
 * (rowData, cellData, revisions, saveStates, newRowFlags) by rebuilding each one
 * with shifted integer keys. Every inline-edit defect in the grid lands here:
 * a map that is not shifted in lockstep with the others puts a save spinner, a
 * "new row" outline or a stale value on the WRONG row.
 *
 * These tests are pure — no DOM, no React.
 */

const columns: ColumnDef[] = [
  { data: 'id', title: 'ID' },
  { data: 'ref', title: 'Ref' },
  { data: 'city', title: 'City' },
]

const rows = [
  { id: 'r1', ref: 'A1', city: 'WAW' },
  { id: 'r2', ref: 'A2', city: 'KRK' },
  { id: 'r3', ref: 'A3', city: 'WRO' },
]

function makeStore(): CellStore {
  // Clone so a mutation in one test cannot leak into the next via rowDataMap.
  return createCellStore(rows.map((r) => ({ ...r })), columns)
}

function snapshotColumn(store: CellStore, col: number): any[] {
  return Array.from({ length: store.getRowCount() }, (_, r) => store.getCellValue(r, col))
}

describe('CellStore — addRow re-keying', () => {
  it('inserts at the head by default and shifts every existing row down', () => {
    const store = makeStore()
    store.addRow({ id: 'new', ref: 'NEW', city: 'GDN' })

    expect(store.getRowCount()).toBe(4)
    expect(snapshotColumn(store, 1)).toEqual(['NEW', 'A1', 'A2', 'A3'])
    expect(store.getRowData(0).id).toBe('new')
    expect(store.getRowData(3).id).toBe('r3')
  })

  it('inserts in the middle, leaving rows above untouched', () => {
    const store = makeStore()
    store.addRow({ id: 'new', ref: 'MID', city: 'POZ' }, 2)

    expect(store.getRowCount()).toBe(4)
    expect(snapshotColumn(store, 1)).toEqual(['A1', 'A2', 'MID', 'A3'])
  })

  it('marks only the inserted row as new, shifting pre-existing new-row flags', () => {
    const store = makeStore()
    store.markRowAsNew(1, true)
    store.addRow({ id: 'new', ref: 'NEW', city: 'GDN' }, 0)

    // The row previously flagged at index 1 is now at index 2.
    expect(store.isNewRow(0)).toBe(true)
    expect(store.isNewRow(1)).toBe(false)
    expect(store.isNewRow(2)).toBe(true)
    expect(store.isNewRow(3)).toBe(false)
    expect(store.hasNewRows()).toBe(true)
  })

  it('shifts save states with their row so a spinner never lands on a neighbour', () => {
    const store = makeStore()
    store.setSaveState(0, 1, 'saving')
    store.setSaveState(2, 2, 'error')

    store.addRow({ id: 'new', ref: 'NEW', city: 'GDN' }, 0)

    expect(store.getSaveState(0, 1)).toBeNull()
    expect(store.getSaveState(1, 1)).toBe('saving')
    expect(store.getSaveState(3, 2)).toBe('error')
  })

  it('fills missing keys on the inserted row with empty string, not undefined', () => {
    const store = makeStore()
    store.addRow({ id: 'new' }, 0)

    expect(store.getCellValue(0, 0)).toBe('new')
    expect(store.getCellValue(0, 1)).toBe('')
    expect(store.getCellValue(0, 2)).toBe('')
  })

  it('bumps the store revision so row-count subscribers re-render', () => {
    const store = makeStore()
    const before = store.getStoreRevision()
    const onStore = jest.fn()
    store.subscribeToStore(onStore)

    store.addRow({ id: 'new' }, 0)

    expect(store.getStoreRevision()).toBeGreaterThan(before)
    expect(onStore).toHaveBeenCalled()
  })

  it('notifies every subscribed cell so the shifted rows repaint', () => {
    const store = makeStore()
    const onA = jest.fn()
    const onB = jest.fn()
    store.subscribe(0, 1, onA)
    store.subscribe(2, 1, onB)

    store.addRow({ id: 'new' }, 0)

    expect(onA).toHaveBeenCalled()
    expect(onB).toHaveBeenCalled()
  })

  it('carries a cell revision along with the row it belongs to', () => {
    const store = makeStore()
    store.setCellValue(0, 1, 'A1-edited') // revision(0,1) -> 1
    const revBefore = store.getRevision(0, 1)
    expect(revBefore).toBe(1)

    store.addRow({ id: 'new' }, 0)

    // The edited cell moved to row 1 and kept its revision history.
    expect(store.getRevision(1, 1)).toBe(revBefore)
  })
})

describe('CellStore — removeRow re-keying', () => {
  it('shifts rows below the removed index up by one', () => {
    const store = makeStore()
    store.removeRow(1)

    expect(store.getRowCount()).toBe(2)
    expect(snapshotColumn(store, 1)).toEqual(['A1', 'A3'])
    expect(store.getRowData(1).id).toBe('r3')
  })

  it('drops the removed row entirely — no stale cell value at the tail', () => {
    const store = makeStore()
    store.removeRow(2)

    expect(store.getRowCount()).toBe(2)
    expect(store.getCellValue(2, 1)).toBeUndefined()
    expect(store.getRowData(2)).toBeUndefined()
  })

  it('shifts save states up and drops the removed row’s own state', () => {
    const store = makeStore()
    store.setSaveState(0, 0, 'success')
    store.setSaveState(1, 0, 'saving')
    store.setSaveState(2, 0, 'error')

    store.removeRow(1)

    expect(store.getSaveState(0, 0)).toBe('success')
    expect(store.getSaveState(1, 0)).toBe('error')
    expect(store.getSaveState(2, 0)).toBeNull()
  })

  it('shifts new-row flags up and clears the removed one', () => {
    const store = makeStore()
    store.markRowAsNew(1, true)
    store.markRowAsNew(2, true)

    store.removeRow(1)

    expect(store.isNewRow(0)).toBe(false)
    expect(store.isNewRow(1)).toBe(true)
    expect(store.hasNewRows()).toBe(true)
  })

  it('clears hasNewRows once the only new row is removed', () => {
    const store = makeStore()
    store.addRow({ id: 'new' }, 0)
    expect(store.hasNewRows()).toBe(true)

    store.removeRow(0)

    expect(store.hasNewRows()).toBe(false)
    expect(store.getRowCount()).toBe(3)
    expect(snapshotColumn(store, 1)).toEqual(['A1', 'A2', 'A3'])
  })

  it('bumps the store revision and notifies subscribed cells', () => {
    const store = makeStore()
    const before = store.getStoreRevision()
    const onStore = jest.fn()
    const onCell = jest.fn()
    store.subscribeToStore(onStore)
    store.subscribe(1, 1, onCell)

    store.removeRow(0)

    expect(store.getStoreRevision()).toBeGreaterThan(before)
    expect(onStore).toHaveBeenCalled()
    expect(onCell).toHaveBeenCalled()
  })

  it('survives an add/remove round trip with the original data intact', () => {
    const store = makeStore()
    store.addRow({ id: 'x', ref: 'X', city: 'X' }, 1)
    store.removeRow(1)

    expect(store.getRowCount()).toBe(3)
    expect(snapshotColumn(store, 0)).toEqual(['r1', 'r2', 'r3'])
    expect(snapshotColumn(store, 1)).toEqual(['A1', 'A2', 'A3'])
  })
})

describe('CellStore — findRowIndexById', () => {
  it('resolves a stable id to its current row index', () => {
    const store = makeStore()
    expect(store.findRowIndexById('id', 'r2')).toBe(1)
  })

  it('tracks the row across an insert above it', () => {
    const store = makeStore()
    store.addRow({ id: 'new' }, 0)
    expect(store.findRowIndexById('id', 'r2')).toBe(2)
  })

  it('tracks the row across a removal above it', () => {
    const store = makeStore()
    store.removeRow(0)
    expect(store.findRowIndexById('id', 'r2')).toBe(0)
  })

  it('returns -1 for an unknown id', () => {
    const store = makeStore()
    expect(store.findRowIndexById('id', 'nope')).toBe(-1)
  })

  it('returns -1 for a null/undefined id rather than matching a blank row', () => {
    const store = makeStore()
    store.addRow({ ref: 'blank' }, 0) // no `id` key -> cell filled with ''
    expect(store.findRowIndexById('id', null)).toBe(-1)
    expect(store.findRowIndexById('id', undefined)).toBe(-1)
  })

  it('resolves after the row was replaced by markRowAsSaved', () => {
    const store = makeStore()
    store.addRow({ id: '', ref: 'NEW' }, 0)
    expect(store.findRowIndexById('id', 'server-id')).toBe(-1)

    store.markRowAsSaved(0, { id: 'server-id', ref: 'NEW', city: 'GDN' })

    expect(store.findRowIndexById('id', 'server-id')).toBe(0)
    expect(store.isNewRow(0)).toBe(false)
  })
})

describe('CellStore — revision bookkeeping', () => {
  it('increments a cell revision on every setCellValue', () => {
    const store = makeStore()
    expect(store.getRevision(0, 1)).toBe(0)
    store.setCellValue(0, 1, 'x')
    store.setCellValue(0, 1, 'y')
    expect(store.getRevision(0, 1)).toBe(2)
  })

  it('writes through to rowData so the row object and the cell map agree', () => {
    const store = makeStore()
    store.setCellValue(0, 2, 'GDN')
    expect(store.getCellValue(0, 2)).toBe('GDN')
    expect(store.getRowData(0).city).toBe('GDN')
  })

  it('notifies only the subscribers of the mutated cell', () => {
    const store = makeStore()
    const onTarget = jest.fn()
    const onOther = jest.fn()
    store.subscribe(0, 1, onTarget)
    store.subscribe(1, 1, onOther)

    store.setCellValue(0, 1, 'x')

    expect(onTarget).toHaveBeenCalledTimes(1)
    expect(onOther).not.toHaveBeenCalled()
  })

  it('bumps a whole row when setRowData replaces it', () => {
    const store = makeStore()
    const before = [0, 1, 2].map((c) => store.getRevision(0, c))
    store.setRowData(0, { id: 'r1', ref: 'A1*', city: 'GDN' })
    const after = [0, 1, 2].map((c) => store.getRevision(0, c))

    expect(after).toEqual(before.map((n) => n + 1))
    expect(store.getCellValue(0, 1)).toBe('A1*')
  })

  it('separates the selection revision from the store revision', () => {
    const store = makeStore()
    const storeRev = store.getStoreRevision()
    const selRev = store.getSelectionRevision()

    store.setSelection({ type: 'cell', anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } })

    expect(store.getSelectionRevision()).toBe(selRev + 1)
    expect(store.getStoreRevision()).toBe(storeRev)
  })

  it('bumps the store revision (not cell revisions) when a column is resized', () => {
    const store = makeStore()
    const storeRev = store.getStoreRevision()
    const cellRev = store.getRevision(0, 0)

    store.setColumnWidth(0, 240)

    expect(store.getColumnWidth(0)).toBe(240)
    expect(store.getStoreRevision()).toBe(storeRev + 1)
    expect(store.getRevision(0, 0)).toBe(cellRev)
  })

  it('carries manual widths across a column reorder by data key', () => {
    const store = makeStore()
    store.setColumnWidth(1, 300) // `ref`

    store.setColumns([columns[1], columns[0], columns[2]])

    expect(store.getColumnWidth(0)).toBe(300) // `ref` is now index 0
  })

  it('drops width overrides on reinitColumnWidths', () => {
    const store = createCellStore(rows.map((r) => ({ ...r })), [
      { data: 'id', width: 120 },
      { data: 'ref' },
      { data: 'city' },
    ])
    store.setColumnWidth(0, 400)
    expect(store.getColumnWidth(0)).toBe(400)

    store.reinitColumnWidths()

    expect(store.getColumnWidth(0)).toBe(120)
  })

  it('clears new-row flags and reseeds every cell on setData', () => {
    const store = makeStore()
    store.markRowAsNew(0, true)

    store.setData([{ id: 'z1', ref: 'Z1', city: 'ZZZ' }])

    expect(store.getRowCount()).toBe(1)
    expect(store.hasNewRows()).toBe(false)
    expect(store.getCellValue(0, 1)).toBe('Z1')
  })
})
