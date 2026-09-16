import { createCellStore, CellStore } from '../store/index'
import type { ColumnDef } from '../types/index'

// Ledger row 1.8 — MARCHING ANTS.
//
// The marker is a SECOND rectangle, independent of the selection, because the
// whole point of Excel's marquee is that it survives the cursor moving away:
// that is exactly when a user needs to be told what Ctrl+V is about to paste.
//
// These assertions pin the three properties the CSS depends on and cannot
// express itself: outer edges only, repaint scoped to the union of old and new,
// and the two index-invalidating events that must drop it.

const columns: ColumnDef[] = [
  { data: 'ref', title: 'Ref' },
  { data: 'qty', title: 'Qty', type: 'numeric' },
  { data: 'eta', title: 'ETA', type: 'date' },
  { data: 'status', title: 'Status' },
]

const rows = Array.from({ length: 5 }, (_, i) => ({
  ref: `REF-00${i + 1}`,
  qty: i + 1,
  eta: '2026-08-03',
  status: 'draft',
}))

function setup(): CellStore {
  return createCellStore(rows.map((r) => ({ ...r })), columns)
}

const rect = (startRow: number, endRow: number, startCol: number, endCol: number) => ({
  startRow,
  endRow,
  startCol,
  endCol,
})

describe('clipboard marker — state', () => {
  it('starts empty', () => {
    expect(setup().getClipboardMarker()).toBeNull()
  })

  it('records the mode alongside the rectangle', () => {
    const store = setup()
    store.setClipboardMarker({ mode: 'cut', bounds: rect(1, 2, 0, 1) })
    expect(store.getClipboardMarker()).toEqual({ mode: 'cut', bounds: rect(1, 2, 0, 1) })
  })

  it('is independent of the selection — moving the cursor does not clear it', () => {
    const store = setup()
    store.setClipboardMarker({ mode: 'copy', bounds: rect(0, 1, 0, 1) })
    store.setSelection({ type: 'range', anchor: { row: 4, col: 3 }, focus: { row: 4, col: 3 } })
    expect(store.getClipboardMarker()).not.toBeNull()
    expect(store.getCellState(0, 0).isClipboardSource).toBe(true)
  })
})

describe('clipboard marker — cell state', () => {
  it('marks every cell of the rectangle, including read-only and unmounted ones', () => {
    const store = setup()
    store.setClipboardMarker({ mode: 'copy', bounds: rect(1, 3, 1, 3) })
    for (let r = 1; r <= 3; r++) {
      for (let c = 1; c <= 3; c++) {
        expect(store.getCellState(r, c).isClipboardSource).toBe(true)
      }
    }
    expect(store.getCellState(0, 1).isClipboardSource).toBe(false)
    expect(store.getCellState(1, 0).isClipboardSource).toBe(false)
  })

  it('paints only the OUTER edges of the block, never a box per cell', () => {
    const store = setup()
    store.setClipboardMarker({ mode: 'copy', bounds: rect(1, 3, 1, 3) })

    expect(store.getCellState(1, 1).clipboardEdges).toEqual({
      top: true, bottom: false, left: true, right: false,
    })
    // The middle cell of a 3x3 block carries no border at all.
    expect(store.getCellState(2, 2).clipboardEdges).toEqual({
      top: false, bottom: false, left: false, right: false,
    })
    expect(store.getCellState(3, 3).clipboardEdges).toEqual({
      top: false, bottom: true, left: false, right: true,
    })
  })

  it('carries the mode down to the cell, and null outside the block', () => {
    const store = setup()
    store.setClipboardMarker({ mode: 'cut', bounds: rect(0, 0, 0, 0) })
    expect(store.getCellState(0, 0).clipboardMode).toBe('cut')
    expect(store.getCellState(1, 0).clipboardMode).toBeNull()
    expect(store.getCellState(1, 0).clipboardEdges).toEqual({})
  })
})

describe('clipboard marker — repaint scope', () => {
  it('repaints the union of the old and the new rectangle, and nothing else', () => {
    const store = setup()
    store.setClipboardMarker({ mode: 'copy', bounds: rect(0, 0, 0, 0) })

    const before = (r: number, c: number) => store.getRevision(r, c)
    const snapshot = [
      before(0, 0), before(2, 2), before(4, 3),
    ]
    store.setClipboardMarker({ mode: 'copy', bounds: rect(2, 2, 2, 2) })

    expect(store.getRevision(0, 0)).toBeGreaterThan(snapshot[0]) // left the marker
    expect(store.getRevision(2, 2)).toBeGreaterThan(snapshot[1]) // joined it
    expect(store.getRevision(4, 3)).toBe(snapshot[2])            // untouched
  })

  it('is a no-op when clearing an already-empty marker', () => {
    const store = setup()
    const rev = store.getRevision(0, 0)
    store.setClipboardMarker(null)
    expect(store.getRevision(0, 0)).toBe(rev)
  })
})

describe('clipboard marker — invalidation', () => {
  it('drops on a column change, because the column indices just moved', () => {
    const store = setup()
    store.setClipboardMarker({ mode: 'copy', bounds: rect(0, 1, 0, 1) })
    store.setColumns([columns[2], columns[0], columns[1], columns[3]])
    expect(store.getClipboardMarker()).toBeNull()
    expect(store.getCellState(0, 0).isClipboardSource).toBe(false)
  })

  it('drops when a refetch changes the row COUNT — the indices cannot be trusted', () => {
    const store = setup()
    store.setClipboardMarker({ mode: 'copy', bounds: rect(0, 1, 0, 1) })
    store.setData(rows.slice(0, 3).map((r) => ({ ...r })))
    expect(store.getClipboardMarker()).toBeNull()
  })

  it('survives a refetch that returns the same number of rows', () => {
    const store = setup()
    store.setClipboardMarker({ mode: 'copy', bounds: rect(0, 1, 0, 1) })
    store.setData(rows.map((r) => ({ ...r, qty: 99 })))
    expect(store.getClipboardMarker()).toEqual({ mode: 'copy', bounds: rect(0, 1, 0, 1) })
  })
})
