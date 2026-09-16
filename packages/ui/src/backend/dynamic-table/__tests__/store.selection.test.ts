import { createCellStore, CellStore } from '../store/index'
import type { ColumnDef } from '../types/index'

// The cell store is the source of truth behind "grouped cell selection" — the
// dotted range outline, the Copy / Comment-colour context menu, and the bulk
// annotate payload all read getSelectionBounds() / getCellsInSelection(). These
// pure tests pin that behaviour without rendering the (virtualised) table.

const columns: ColumnDef[] = [
  { data: 'ref', title: 'Ref' },
  { data: 'origin', title: 'Origin' },
  { data: 'dest', title: 'Destination' },
]

const rows = [
  { ref: 'A1', origin: 'WAW', dest: 'GDN' },
  { ref: 'A2', origin: 'KRK', dest: 'POZ' },
  { ref: 'A3', origin: 'WRO', dest: 'LDZ' },
]

function makeStore(): CellStore {
  return createCellStore(rows, columns)
}

describe('cell store — selection bounds', () => {
  it('returns null bounds when nothing is selected', () => {
    const store = makeStore()
    expect(store.getSelectionBounds()).toBeNull()
    expect(store.getCellsInSelection()).toEqual([])
  })

  it('computes bounds for a single cell selection', () => {
    const store = makeStore()
    store.setSelection({ type: 'cell', anchor: { row: 1, col: 1 }, focus: { row: 1, col: 1 } })
    expect(store.getSelectionBounds()).toEqual({ startRow: 1, endRow: 1, startCol: 1, endCol: 1 })
  })

  it('normalises a range dragged bottom-right → top-left into ordered bounds', () => {
    const store = makeStore()
    // anchor below/right of focus — bounds must still come out min→max.
    store.setSelection({ type: 'range', anchor: { row: 2, col: 2 }, focus: { row: 0, col: 0 } })
    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 2, startCol: 0, endCol: 2 })
  })

  it('expands a rowRange selection across every column', () => {
    const store = makeStore()
    store.setSelection({ type: 'rowRange', anchor: { row: 0, col: 99 }, focus: { row: 1, col: 0 } })
    expect(store.getSelectionBounds()).toEqual({
      startRow: 0,
      endRow: 1,
      startCol: 0,
      endCol: columns.length - 1,
    })
  })

  it('expands a colRange selection across every row', () => {
    const store = makeStore()
    store.setSelection({ type: 'colRange', anchor: { row: 5, col: 1 }, focus: { row: 0, col: 2 } })
    expect(store.getSelectionBounds()).toEqual({
      startRow: 0,
      endRow: rows.length - 1,
      startCol: 1,
      endCol: 2,
    })
  })

  it('invalidates the bounds cache when the selection changes', () => {
    const store = makeStore()
    store.setSelection({ type: 'cell', anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } })
    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 })
    store.setSelection({ type: 'range', anchor: { row: 0, col: 0 }, focus: { row: 1, col: 1 } })
    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 1, startCol: 0, endCol: 1 })
  })

  it('clears bounds when the selection is reset to null', () => {
    const store = makeStore()
    store.setSelection({ type: 'range', anchor: { row: 0, col: 0 }, focus: { row: 1, col: 1 } })
    store.setSelection({ type: null, anchor: null, focus: null })
    expect(store.getSelectionBounds()).toBeNull()
  })
})

describe('cell store — getCellsInSelection (drives copy + bulk annotate)', () => {
  it('returns every cell in a 2x2 range with its value, row-major', () => {
    const store = makeStore()
    store.setSelection({ type: 'range', anchor: { row: 0, col: 0 }, focus: { row: 1, col: 1 } })
    expect(store.getCellsInSelection()).toEqual([
      { row: 0, col: 0, value: 'A1' },
      { row: 0, col: 1, value: 'WAW' },
      { row: 1, col: 0, value: 'A2' },
      { row: 1, col: 1, value: 'KRK' },
    ])
  })

  it('produces a tab/newline grid matching the copy-to-clipboard serialisation', () => {
    const store = makeStore()
    store.setSelection({ type: 'range', anchor: { row: 0, col: 0 }, focus: { row: 1, col: 1 } })
    const cells = store.getCellsInSelection()
    const bounds = store.getSelectionBounds()!
    const h = bounds.endRow - bounds.startRow + 1
    const w = bounds.endCol - bounds.startCol + 1
    const grid: string[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => ''))
    cells.forEach((c) => {
      grid[c.row - bounds.startRow][c.col - bounds.startCol] = String(c.value ?? '')
    })
    const text = grid.map((r) => r.join('\t')).join('\n')
    expect(text).toBe('A1\tWAW\nA2\tKRK')
  })

  it('reflects edited values in the copied selection', () => {
    const store = makeStore()
    store.setCellValue(0, 0, 'EDITED')
    store.setSelection({ type: 'cell', anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } })
    expect(store.getCellsInSelection()).toEqual([{ row: 0, col: 0, value: 'EDITED' }])
  })
})

describe('cell store — cell state used to paint the range outline', () => {
  it('marks the anchor cell as selected and flags range membership + edges', () => {
    const store = makeStore()
    store.setSelection({ type: 'range', anchor: { row: 0, col: 0 }, focus: { row: 1, col: 1 } })

    const topLeft = store.getCellState(0, 0)
    expect(topLeft.isInRange).toBe(true)
    expect(topLeft.rangeEdges).toEqual({ top: true, bottom: false, left: true, right: false })

    const bottomRight = store.getCellState(1, 1)
    expect(bottomRight.isInRange).toBe(true)
    expect(bottomRight.rangeEdges).toEqual({ top: false, bottom: true, left: false, right: true })

    const outside = store.getCellState(2, 2)
    expect(outside.isInRange).toBe(false)
    expect(outside.rangeEdges).toEqual({})
  })

  it('treats a single-cell selection as isSelected (not a multi-cell range)', () => {
    const store = makeStore()
    store.setSelection({ type: 'cell', anchor: { row: 1, col: 2 }, focus: { row: 1, col: 2 } })
    expect(store.getCellState(1, 2).isSelected).toBe(true)
    expect(store.getCellState(0, 0).isSelected).toBe(false)
  })
})

describe('cell store — selection notifications', () => {
  it('bumps the selection revision and notifies selection subscribers on change', () => {
    const store = makeStore()
    const before = store.getSelectionRevision()
    const sub = jest.fn()
    const unsubscribe = store.subscribeToSelection(sub)

    store.setSelection({ type: 'cell', anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } })

    expect(store.getSelectionRevision()).toBe(before + 1)
    expect(sub).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
