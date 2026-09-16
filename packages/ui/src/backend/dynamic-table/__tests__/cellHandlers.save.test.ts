import { createCellHandlers } from '../handlers/index'
import { createCellStore, CellStore } from '../store/index'
import { TableEvents } from '../types/index'
import type { CellEditSaveEvent, ColumnDef } from '../types/index'

/**
 * Spec 0 / Phase 2 — `createCellHandlers.handleCellSave` is the single decision
 * point for "did the user actually change anything?". It owns three contracts,
 * each of which a downstream spec will lean on:
 *
 *  1. Change detection — an unchanged value must NOT dispatch and must NOT record
 *     undo (TC-APP-330 asserts a single cell edit produces exactly one write).
 *  2. Event emission — `CELL_EDIT_SAVE` carries the RAW old value and the
 *     TYPE-PARSED new value, keyed by the column's `data` prop and the row's id.
 *  3. Undo recording — keyed by stable row id + column key (not row index), so a
 *     post-save refetch that reorders rows cannot corrupt the undo stack.
 *
 * New rows are excluded from all three: they are persisted by NEW_ROW_SAVE.
 */

const columns: ColumnDef[] = [
  { data: 'id', title: 'ID' },
  { data: 'ref', title: 'Ref' },
  { data: 'amount', title: 'Amount', type: 'numeric' },
  { data: 'due', title: 'Due', type: 'date' },
  { data: 'paid', title: 'Paid', type: 'boolean' },
  { data: 'tags', title: 'Tags' },
]

type Harness = {
  store: CellStore
  el: HTMLDivElement
  events: CellEditSaveEvent[]
  handleCellSave: ReturnType<typeof createCellHandlers>['handleCellSave']
  handleStartEditing: ReturnType<typeof createCellHandlers>['handleStartEditing']
}

function makeHarness(cols: ColumnDef[] = columns): Harness {
  const el = document.createElement('div')
  el.tabIndex = -1
  document.body.appendChild(el)

  const store = createCellStore(
    [
      { id: 'r1', ref: 'A1', amount: 10, due: '2026-01-01', paid: false, tags: ['x'] },
      { id: 'r2', ref: 'A2', amount: 20, due: '2026-02-01', paid: true, tags: [] },
    ],
    cols,
  )
  store.setTableRef({ current: el })

  const events: CellEditSaveEvent[] = []
  el.addEventListener(TableEvents.CELL_EDIT_SAVE, (e) => {
    events.push((e as CustomEvent<CellEditSaveEvent>).detail)
  })

  const { handleCellSave, handleStartEditing } = createCellHandlers(
    store,
    cols,
    { current: el },
    'id',
  )
  return { store, el, events, handleCellSave, handleStartEditing }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('handleCellSave — change detection', () => {
  it('dispatches nothing when the value is identical', () => {
    const h = makeHarness()
    h.handleCellSave(0, 1, 'A1')

    expect(h.events).toHaveLength(0)
    expect(h.store.canUndo()).toBe(false)
    expect(h.store.getRevision(0, 1)).toBe(0)
  })

  it('treats a numeric value and its string form as unchanged', () => {
    const h = makeHarness()
    h.handleCellSave(0, 2, '10')

    expect(h.events).toHaveLength(0)
    expect(h.store.canUndo()).toBe(false)
  })

  it('treats null, undefined and empty string as the same "empty"', () => {
    const h = makeHarness([{ data: 'id' }, { data: 'note' }])
    h.handleCellSave(0, 1, '')
    h.handleCellSave(0, 1, null)
    h.handleCellSave(0, 1, undefined)

    expect(h.events).toHaveLength(0)
  })

  it('compares arrays structurally, not by reference', () => {
    const h = makeHarness()
    h.handleCellSave(0, 5, ['x'])
    expect(h.events).toHaveLength(0)

    h.handleCellSave(0, 5, ['x', 'y'])
    expect(h.events).toHaveLength(1)
  })

  it('still clears editing and refocuses the table on an unchanged save', () => {
    const h = makeHarness()
    h.store.setEditingCell(0, 1)
    const focus = jest.spyOn(h.el, 'focus')

    h.handleCellSave(0, 1, 'A1')

    expect(h.store.getEditingCell()).toBeNull()
    expect(focus).toHaveBeenCalled()
  })

  it('leaves editing open when clearEditing=false (keyboard navigation owns it)', () => {
    const h = makeHarness()
    h.store.setEditingCell(0, 1)

    h.handleCellSave(0, 1, 'A1-changed', false)

    expect(h.store.getEditingCell()).toEqual({ row: 0, col: 1 })
    expect(h.events).toHaveLength(1)
  })
})

describe('handleCellSave — store write-through', () => {
  it('writes the raw value into both the cell map and the row object', () => {
    const h = makeHarness()
    h.handleCellSave(0, 1, 'A1-changed')

    expect(h.store.getCellValue(0, 1)).toBe('A1-changed')
    expect(h.store.getRowData(0).ref).toBe('A1-changed')
    expect(h.store.getRevision(0, 1)).toBe(1)
  })

  it('reads the old value by column data key, so a reordered column is still correct', () => {
    // `ref` sits at index 1 in the store but index 0 in this handler's column list.
    const reordered: ColumnDef[] = [columns[1], columns[0]]
    const el = document.createElement('div')
    document.body.appendChild(el)
    const store = createCellStore([{ id: 'r1', ref: 'A1' }], reordered)
    store.setTableRef({ current: el })
    const events: CellEditSaveEvent[] = []
    el.addEventListener(TableEvents.CELL_EDIT_SAVE, (e) =>
      events.push((e as CustomEvent<CellEditSaveEvent>).detail),
    )
    const { handleCellSave } = createCellHandlers(store, reordered, { current: el }, 'id')

    handleCellSave(0, 0, 'A1')
    expect(events).toHaveLength(0) // unchanged — resolved via `ref`, not by index

    handleCellSave(0, 0, 'A1-new')
    expect(events[0].prop).toBe('ref')
  })
})

describe('handleCellSave — event emission', () => {
  it('emits CELL_EDIT_SAVE once with prop, id, old and new values', () => {
    const h = makeHarness()
    h.handleCellSave(0, 1, 'A1-changed')

    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({
      rowIndex: 0,
      colIndex: 1,
      prop: 'ref',
      id: 'r1',
      oldValue: 'A1',
      newValue: 'A1-changed',
    })
  })

  it('parses numeric columns to a number', () => {
    const h = makeHarness()
    h.handleCellSave(0, 2, '42.5')
    expect(h.events[0].newValue).toBe(42.5)
  })

  it('parses an unparsable numeric to null', () => {
    const h = makeHarness()
    h.handleCellSave(0, 2, 'abc')
    expect(h.events[0].newValue).toBeNull()
  })

  it('normalises a date column to YYYY-MM-DD', () => {
    const h = makeHarness()
    h.handleCellSave(0, 3, '2026-03-04')
    expect(h.events[0].newValue).toBe('2026-03-04')
  })

  it('parses boolean columns from their string forms', () => {
    const h = makeHarness()
    h.handleCellSave(0, 4, 'true')
    expect(h.events[0].newValue).toBe(true)
  })

  it('emits null for a cleared typed cell', () => {
    const h = makeHarness()
    h.handleCellSave(0, 2, '')
    expect(h.events[0].newValue).toBeNull()
  })

  it('emits one event per changed cell, not one per keystroke', () => {
    const h = makeHarness()
    h.handleCellSave(0, 1, 'A1-changed')
    h.handleCellSave(0, 1, 'A1-changed') // now unchanged
    h.handleCellSave(1, 1, 'A2-changed')

    expect(h.events).toHaveLength(2)
  })

  it('does not dispatch for a new row — NEW_ROW_SAVE owns that persist', () => {
    const h = makeHarness()
    h.store.markRowAsNew(0, true)

    h.handleCellSave(0, 1, 'A1-changed')

    expect(h.events).toHaveLength(0)
    expect(h.store.getCellValue(0, 1)).toBe('A1-changed') // still written locally
    expect(h.store.canUndo()).toBe(false)
  })
})

describe('handleCellSave — undo recording', () => {
  it('records one undo entry keyed by row id and column key', () => {
    const h = makeHarness()
    h.handleCellSave(0, 1, 'A1-changed')

    expect(h.store.canUndo()).toBe(true)
    expect(h.store.popUndo()).toEqual({
      changes: [{ rowId: 'r1', colKey: 'ref', oldValue: 'A1', newValue: 'A1-changed' }],
    })
  })

  it('records the RAW new value, not the type-parsed one', () => {
    // Undo replays through the editor, which expects the raw input value back.
    const h = makeHarness()
    h.handleCellSave(0, 2, '42.5')

    expect(h.store.popUndo()).toEqual({
      changes: [{ rowId: 'r1', colKey: 'amount', oldValue: 10, newValue: '42.5' }],
    })
  })

  it('coalesces into a single entry when the caller opened a group', () => {
    const h = makeHarness()
    h.store.beginUndoGroup()
    h.handleCellSave(0, 1, 'A1-changed')
    h.handleCellSave(1, 1, 'A2-changed')
    h.store.endUndoGroup()

    const entry = h.store.popUndo()!
    expect(entry.changes).toHaveLength(2)
    expect(h.store.canUndo()).toBe(false)
  })

  it('records nothing while a replay suppresses recording', () => {
    const h = makeHarness()
    h.store.setUndoSuppressed(true)

    h.handleCellSave(0, 1, 'A1-changed')

    expect(h.store.canUndo()).toBe(false)
    expect(h.events).toHaveLength(1) // the persist still happens
  })
})

describe('handleStartEditing', () => {
  it('opens the editor on an editable cell', () => {
    const h = makeHarness()
    h.handleStartEditing(0, 1)
    expect(h.store.getEditingCell()).toEqual({ row: 0, col: 1 })
  })

  it('refuses to open the editor on a read-only column', () => {
    const h = makeHarness([{ data: 'id' }, { data: 'ref', readOnly: true }])
    h.handleStartEditing(0, 1)
    expect(h.store.getEditingCell()).toBeNull()
  })
})
