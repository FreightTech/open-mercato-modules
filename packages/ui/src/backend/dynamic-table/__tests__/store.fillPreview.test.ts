import { createCellStore, CellStore } from '../store/index'
import type { ColumnDef, FillPreview, SelectionBounds } from '../types/index'
import { computeFillPreview } from '../utils/fillGeometry'

// The fill preview is a RECTANGLE, not a one-column strip. These tests pin the
// three things the strip model could not express: four-sided edges, the
// source/extension split, and a nub that survives a read-only column being
// inside the selection.

const columns: ColumnDef[] = [
  { data: 'ref', title: 'Ref' },
  { data: 'qty', title: 'Qty', type: 'numeric' },
  { data: 'eta', title: 'ETA', type: 'date' },
  { data: 'status', title: 'Status', readOnly: true },
  { data: 'invoiceNo', title: 'Invoice no', disableFill: true },
]

const rows = Array.from({ length: 6 }, (_, i) => ({
  ref: `REF-00${i + 1}`,
  qty: i + 1,
  eta: '2026-08-03',
  status: 'draft',
  invoiceNo: `FV/${i}`,
}))

function makeStore(): CellStore {
  return createCellStore(rows.map((r) => ({ ...r })), columns)
}

const rect = (startRow: number, endRow: number, startCol: number, endCol: number): SelectionBounds =>
  ({ startRow, endRow, startCol, endCol })

const preview = (source: SelectionBounds, bounds: SelectionBounds): FillPreview => ({
  source,
  bounds,
  axis: 'vertical',
  backwards: false,
  clearing: false,
  cleared: null,
  mode: 'series',
})

describe('cell store — rectangle fill preview', () => {
  it('contains every cell of the rectangle, not just one column', () => {
    const store = makeStore()
    store.setFillPreview(preview(rect(0, 0, 0, 1), rect(0, 2, 0, 1)))
    expect(store.getCellState(0, 0).isFillPreview).toBe(true)
    expect(store.getCellState(2, 1).isFillPreview).toBe(true)
    expect(store.getCellState(1, 1).isFillPreview).toBe(true)
    // Outside the rectangle in either axis.
    expect(store.getCellState(3, 0).isFillPreview).toBe(false)
    expect(store.getCellState(1, 2).isFillPreview).toBe(false)
  })

  it('reports all four edges of a 3x3 rectangle, and only the outer ones', () => {
    const store = makeStore()
    store.setFillPreview(preview(rect(1, 1, 0, 2), rect(1, 3, 0, 2)))
    expect(store.getCellState(1, 0).fillEdges).toEqual({ top: true, bottom: false, left: true, right: false })
    expect(store.getCellState(3, 2).fillEdges).toEqual({ top: false, bottom: true, left: false, right: true })
    // The middle cell has no edge at all — this is the whole reason the single
    // full-box CSS rule had to go: it drew a border here too.
    expect(store.getCellState(2, 1).fillEdges).toEqual({ top: false, bottom: false, left: false, right: false })
  })

  it('isFillTarget covers the extension only — never the source', () => {
    const store = makeStore()
    store.setFillPreview(preview(rect(0, 1, 0, 0), rect(0, 4, 0, 0)))
    expect(store.getCellState(0, 0).isFillTarget).toBe(false)
    expect(store.getCellState(1, 0).isFillTarget).toBe(false)
    expect(store.getCellState(2, 0).isFillTarget).toBe(true)
    expect(store.getCellState(4, 0).isFillTarget).toBe(true)
  })

  it('isFillClearing matches the cleared sub-rect of a back-drag', () => {
    const store = makeStore()
    const p = computeFillPreview(rect(0, 4, 0, 0), { row: 2, col: 0 }, { modifier: false, defaultMode: 'series' })
    store.setFillPreview(p)
    expect(store.getCellState(2, 0).isFillClearing).toBe(false)
    expect(store.getCellState(3, 0).isFillClearing).toBe(true)
    expect(store.getCellState(4, 0).isFillClearing).toBe(true)
    // A clearing preview still outlines the WHOLE source.
    expect(store.getCellState(0, 0).isFillPreview).toBe(true)
  })

  it('repaints the union of the old and new rectangles, and nothing outside it', () => {
    const store = makeStore()
    store.setFillPreview(preview(rect(0, 0, 0, 0), rect(0, 1, 0, 0)))
    const before = (row: number, col: number) => store.getRevision(row, col)
    const snapshot = new Map<string, number>()
    for (let r = 0; r < 6; r++) for (let c = 0; c < 5; c++) snapshot.set(`${r}:${c}`, before(r, c))

    store.setFillPreview(preview(rect(0, 0, 0, 0), rect(0, 3, 0, 0)))

    // Old rect (rows 0-1) and new rect (rows 0-3) in column 0 were notified.
    for (const row of [0, 1, 2, 3]) {
      expect(store.getRevision(row, 0)).toBeGreaterThan(snapshot.get(`${row}:0`)!)
    }
    // Row 4 in the same column, and every other column, were NOT.
    expect(store.getRevision(4, 0)).toBe(snapshot.get('4:0'))
    expect(store.getRevision(0, 1)).toBe(snapshot.get('0:1'))
    expect(store.getRevision(2, 3)).toBe(snapshot.get('2:3'))
  })

  it('clears every previewed cell when the preview is dropped', () => {
    const store = makeStore()
    store.setFillPreview(preview(rect(0, 0, 0, 1), rect(0, 2, 0, 1)))
    store.setFillPreview(null)
    expect(store.getCellState(1, 1).isFillPreview).toBe(false)
    expect(store.getCellState(1, 1).fillEdges).toEqual({})
  })
})

describe('cell store — isFillOrigin (the nub)', () => {
  it('sits on the bottom-right corner of the selection, and nowhere else', () => {
    const store = makeStore()
    store.setSelection({ type: 'range', anchor: { row: 0, col: 0 }, focus: { row: 2, col: 1 } })
    expect(store.getCellState(2, 1).isFillOrigin).toBe(true)
    expect(store.getCellState(0, 0).isFillOrigin).toBe(false)
    expect(store.getCellState(2, 0).isFillOrigin).toBe(false)
    expect(store.getCellState(0, 1).isFillOrigin).toBe(false)
  })

  it('appears on a 1x1 selection, exactly as before the rectangle rework', () => {
    const store = makeStore()
    store.setSelection({ type: 'cell', anchor: { row: 1, col: 1 }, focus: { row: 1, col: 1 } })
    expect(store.getCellState(1, 1).isFillOrigin).toBe(true)
  })

  it('still appears when the selection CONTAINS a read-only column', () => {
    // cols 2..3 = eta (fillable) + status (readOnly). One fillable column is
    // enough: the read-only column's writes get rejected and reported.
    const store = makeStore()
    store.setSelection({ type: 'range', anchor: { row: 0, col: 2 }, focus: { row: 1, col: 3 } })
    expect(store.getCellState(1, 3).isFillOrigin).toBe(true)
  })

  it('disappears when EVERY column in the selection refuses fills', () => {
    // cols 3..4 = status (readOnly) + invoiceNo (disableFill).
    const store = makeStore()
    store.setSelection({ type: 'range', anchor: { row: 0, col: 3 }, focus: { row: 2, col: 4 } })
    expect(store.getCellState(2, 4).isFillOrigin).toBe(false)
  })

  it('disappears while a cell is being edited', () => {
    const store = makeStore()
    store.setSelection({ type: 'cell', anchor: { row: 1, col: 1 }, focus: { row: 1, col: 1 } })
    store.setEditingCell(1, 1)
    expect(store.getCellState(1, 1).isFillOrigin).toBe(false)
  })
})

describe('cell store — getCellsInRect', () => {
  it('walks an arbitrary rectangle row-major with values', () => {
    const store = makeStore()
    expect(store.getCellsInRect(rect(0, 1, 0, 1))).toEqual([
      { row: 0, col: 0, value: 'REF-001' },
      { row: 0, col: 1, value: 1 },
      { row: 1, col: 0, value: 'REF-002' },
      { row: 1, col: 1, value: 2 },
    ])
  })

  it('getCellsInSelection delegates to it', () => {
    const store = makeStore()
    store.setSelection({ type: 'range', anchor: { row: 1, col: 0 }, focus: { row: 2, col: 1 } })
    expect(store.getCellsInSelection()).toEqual(store.getCellsInRect(rect(1, 2, 0, 1)))
  })
})
