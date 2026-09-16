import { createCellStore, CellStore } from '../store/index'
import type { ColumnDef, UndoCellChange } from '../types/index'

/**
 * Spec 0 / Phase 2 — undo/redo bookkeeping.
 *
 * Three rules govern the stacks and every one of them is load-bearing:
 *  1. A change recorded OUTSIDE a group is its own entry (one inline edit = one Ctrl+Z).
 *  2. A change recorded INSIDE a group coalesces (a whole fill drag = one Ctrl+Z).
 *  3. Recording is suppressed while a replay is applying an undo, otherwise every
 *     undo would push a fresh undo entry and the stack would never drain.
 *
 * Recording a NEW change clears the redo stack — the standard editor contract.
 */

const columns: ColumnDef[] = [
  { data: 'id' },
  { data: 'ref' },
]

const change = (n: number): UndoCellChange => ({
  rowId: `r${n}`,
  colKey: 'ref',
  oldValue: `old${n}`,
  newValue: `new${n}`,
})

function makeStore(): CellStore {
  return createCellStore([{ id: 'r1', ref: 'A1' }], columns)
}

describe('CellStore — undo recording', () => {
  it('starts with both stacks empty', () => {
    const store = makeStore()
    expect(store.canUndo()).toBe(false)
    expect(store.canRedo()).toBe(false)
    expect(store.popUndo()).toBeNull()
    expect(store.popRedo()).toBeNull()
  })

  it('records one ungrouped change as one entry', () => {
    const store = makeStore()
    store.recordCellChange(change(1))

    expect(store.canUndo()).toBe(true)
    expect(store.popUndo()).toEqual({ changes: [change(1)] })
    expect(store.canUndo()).toBe(false)
  })

  it('records two ungrouped changes as two separate entries, newest first', () => {
    const store = makeStore()
    store.recordCellChange(change(1))
    store.recordCellChange(change(2))

    expect(store.popUndo()).toEqual({ changes: [change(2)] })
    expect(store.popUndo()).toEqual({ changes: [change(1)] })
    expect(store.canUndo()).toBe(false)
  })

  it('caps the undo stack at 100 entries, dropping the oldest', () => {
    const store = makeStore()
    for (let i = 0; i < 105; i++) store.recordCellChange(change(i))

    let depth = 0
    let last: ReturnType<CellStore['popUndo']> = null
    while (store.canUndo()) {
      last = store.popUndo()
      depth++
    }

    expect(depth).toBe(100)
    // The five oldest were shifted off, so the bottom entry is #5.
    expect(last).toEqual({ changes: [change(5)] })
  })
})

describe('CellStore — undo grouping', () => {
  it('coalesces every change made inside a group into one entry', () => {
    const store = makeStore()
    store.beginUndoGroup()
    store.recordCellChange(change(1))
    store.recordCellChange(change(2))
    store.recordCellChange(change(3))
    store.endUndoGroup()

    expect(store.popUndo()).toEqual({ changes: [change(1), change(2), change(3)] })
    expect(store.canUndo()).toBe(false)
  })

  it('pushes nothing for an empty group', () => {
    const store = makeStore()
    store.beginUndoGroup()
    store.endUndoGroup()

    expect(store.canUndo()).toBe(false)
  })

  it('returns to per-change entries after the group closes', () => {
    const store = makeStore()
    store.beginUndoGroup()
    store.recordCellChange(change(1))
    store.endUndoGroup()
    store.recordCellChange(change(2))

    expect(store.popUndo()).toEqual({ changes: [change(2)] })
    expect(store.popUndo()).toEqual({ changes: [change(1)] })
  })

  it('does not push the group until endUndoGroup is called', () => {
    const store = makeStore()
    store.beginUndoGroup()
    store.recordCellChange(change(1))

    expect(store.canUndo()).toBe(false)

    store.endUndoGroup()
    expect(store.canUndo()).toBe(true)
  })
})

describe('CellStore — undo suppression', () => {
  it('drops recorded changes while suppressed', () => {
    const store = makeStore()
    store.setUndoSuppressed(true)
    store.recordCellChange(change(1))

    expect(store.canUndo()).toBe(false)

    store.setUndoSuppressed(false)
    store.recordCellChange(change(2))
    expect(store.popUndo()).toEqual({ changes: [change(2)] })
  })

  it('drops grouped changes while suppressed, leaving an empty group', () => {
    const store = makeStore()
    store.setUndoSuppressed(true)
    store.beginUndoGroup()
    store.recordCellChange(change(1))
    store.recordCellChange(change(2))
    store.endUndoGroup()
    store.setUndoSuppressed(false)

    expect(store.canUndo()).toBe(false)
  })

  it('leaves an explicit pushUndo/pushRedo untouched by suppression', () => {
    // Replay code re-pushes the entry it just consumed onto the opposite stack.
    // That must work while recording is suppressed, or undo/redo cannot round-trip.
    const store = makeStore()
    store.setUndoSuppressed(true)

    store.pushRedo({ changes: [change(1)] })
    expect(store.canRedo()).toBe(true)
    expect(store.popRedo()).toEqual({ changes: [change(1)] })

    store.pushUndo({ changes: [change(2)] })
    expect(store.canUndo()).toBe(true)
  })
})

describe('CellStore — redo invalidation', () => {
  it('clears the redo stack when a new ungrouped change is recorded', () => {
    const store = makeStore()
    store.pushRedo({ changes: [change(9)] })
    expect(store.canRedo()).toBe(true)

    store.recordCellChange(change(1))

    expect(store.canRedo()).toBe(false)
  })

  it('clears the redo stack when a group closes with changes', () => {
    const store = makeStore()
    store.pushRedo({ changes: [change(9)] })

    store.beginUndoGroup()
    store.recordCellChange(change(1))
    store.endUndoGroup()

    expect(store.canRedo()).toBe(false)
  })

  it('keeps the redo stack when an empty group closes', () => {
    const store = makeStore()
    store.pushRedo({ changes: [change(9)] })

    store.beginUndoGroup()
    store.endUndoGroup()

    expect(store.canRedo()).toBe(true)
  })

  it('keeps the redo stack when a change is dropped by suppression', () => {
    // The undo replay itself must not wipe the redo stack it is feeding.
    const store = makeStore()
    store.pushRedo({ changes: [change(9)] })
    store.setUndoSuppressed(true)

    store.recordCellChange(change(1))

    expect(store.canRedo()).toBe(true)
  })

  it('round-trips one edit: record → popUndo → pushRedo → popRedo → pushUndo', () => {
    const store = makeStore()
    store.recordCellChange(change(1))

    const undone = store.popUndo()!
    store.setUndoSuppressed(true)
    store.pushRedo(undone)
    store.setUndoSuppressed(false)

    expect(store.canUndo()).toBe(false)
    expect(store.canRedo()).toBe(true)

    const redone = store.popRedo()!
    store.setUndoSuppressed(true)
    store.pushUndo(redone)
    store.setUndoSuppressed(false)

    expect(store.canUndo()).toBe(true)
    expect(store.canRedo()).toBe(false)
    expect(store.popUndo()).toEqual({ changes: [change(1)] })
  })
})
