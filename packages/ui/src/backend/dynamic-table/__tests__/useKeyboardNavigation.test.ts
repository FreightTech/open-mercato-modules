import { renderHook } from '@testing-library/react'
import { useKeyboardNavigation } from '../hooks/index'
import { createCellStore, CellStore } from '../store/index'
import type { ColumnDef } from '../types/index'

/**
 * Spec 0 / Phase 2 — the keyboard transition table.
 *
 * `useKeyboardNavigation` is a ~240-line branch tree that decides what Enter,
 * Escape, Tab and the arrows mean for every combination of (editing?, selection?,
 * read-only column?, sibling table?). It is the most defect-dense function in the
 * grid and had no test. These assertions ARE the specification of the Excel-like
 * behaviour the product owner asked for:
 *
 *   Enter   — open editor / commit and move DOWN
 *   Tab     — commit and move RIGHT, skipping read-only columns, wrapping rows
 *   Escape  — two steps: leave the editor, then drop the selection
 *   Arrows  — move one cell, clamped at the edges, INCLUDING read-only cells
 */

// col 0 is read-only (an id column); cols 1 and 2 are editable.
const columns: ColumnDef[] = [
  { data: 'id', title: 'ID', readOnly: true },
  { data: 'ref', title: 'Ref' },
  { data: 'city', title: 'City' },
]

const rows = [
  { id: 'r1', ref: 'A1', city: 'WAW' },
  { id: 'r2', ref: 'A2', city: 'KRK' },
  { id: 'r3', ref: 'A3', city: 'WRO' },
]

type Nav = (e: KeyboardEvent) => void

function setup(
  opts: {
    cols?: ColumnDef[]
    data?: any[]
    autoEditOnTab?: boolean
    siblings?: {
      prev?: React.RefObject<HTMLDivElement | null>
      next?: React.RefObject<HTMLDivElement | null>
    }
  } = {},
): { store: CellStore; nav: Nav; table: HTMLDivElement } {
  const cols = opts.cols ?? columns
  const store = createCellStore((opts.data ?? rows).map((r) => ({ ...r })), cols)
  const table = document.createElement('div')
  table.tabIndex = -1
  document.body.appendChild(table)
  store.setTableRef({ current: table })

  const { result } = renderHook(() =>
    useKeyboardNavigation(
      store,
      cols.length,
      cols,
      opts.autoEditOnTab ?? true,
      undefined,
      opts.siblings,
    ),
  )
  return { store, nav: result.current as Nav, table }
}

function press(
  nav: Nav,
  key: string,
  mods: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
): { prevented: boolean } {
  const e = new KeyboardEvent('keydown', { key, ...mods, cancelable: true, bubbles: true })
  nav(e)
  return { prevented: e.defaultPrevented }
}

function selectCell(store: CellStore, row: number, col: number) {
  store.setSelection({ type: 'range', anchor: { row, col }, focus: { row, col } })
}

function siblingRef(): { ref: React.RefObject<HTMLDivElement | null>; el: HTMLDivElement } {
  const el = document.createElement('div')
  el.tabIndex = -1
  document.body.appendChild(el)
  return { ref: { current: el }, el }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('keyboard — Enter', () => {
  it('opens the editor on a single selected cell', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 1)

    expect(press(nav, 'Enter').prevented).toBe(true)
    expect(store.getEditingCell()).toEqual({ row: 1, col: 1 })
  })

  it('commits and moves DOWN one row, reopening the editor', () => {
    const { store, nav } = setup()
    selectCell(store, 0, 1)
    store.setEditingCell(0, 1)

    press(nav, 'Enter')

    expect(store.getEditingCell()).toEqual({ row: 1, col: 1 })
    expect(store.getSelectionBounds()).toEqual({ startRow: 1, endRow: 1, startCol: 1, endCol: 1 })
  })

  it('closes the editor and refocuses the table on the last row', () => {
    const { store, nav, table } = setup()
    const focus = jest.spyOn(table, 'focus')
    selectCell(store, 2, 1)
    store.setEditingCell(2, 1)

    press(nav, 'Enter')

    expect(store.getEditingCell()).toBeNull()
    expect(focus).toHaveBeenCalled()
  })

  it('does nothing on a multi-cell range (Enter is not a range operator)', () => {
    const { store, nav } = setup()
    store.setSelection({ type: 'range', anchor: { row: 0, col: 1 }, focus: { row: 1, col: 2 } })

    expect(press(nav, 'Enter').prevented).toBe(false)
    expect(store.getEditingCell()).toBeNull()
  })

  // Ledger row 1.27. `getCellEditor` returns null for a read-only column with no
  // custom editor, so an edit session opened on one paints nothing while the
  // store reports an editing cell — after which every arrow key falls through
  // the `!editing` guard and the grid soft-locks.
  it('refuses to open an edit session on a read-only column', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 0) // col 0 is readOnly

    press(nav, 'Enter')

    expect(store.getEditingCell()).toBeNull()
  })

  it('leaves the arrows working after Enter on a read-only cell', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 0)

    press(nav, 'Enter')
    press(nav, 'ArrowDown')

    expect(store.getSelectionBounds()).toEqual({ startRow: 2, endRow: 2, startCol: 0, endCol: 0 })
  })

  it('still opens the editor when a read-only column supplies its own editor', () => {
    const cols: ColumnDef[] = [
      { data: 'id', title: 'ID', readOnly: true, editor: () => null },
      { data: 'ref', title: 'Ref' },
    ]
    const { store, nav } = setup({ cols })
    selectCell(store, 0, 0)

    press(nav, 'Enter')

    expect(store.getEditingCell()).toEqual({ row: 0, col: 0 })
  })

  it('leaves Shift+Enter alone — it is reserved for row actions', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 1)

    expect(press(nav, 'Enter', { shiftKey: true }).prevented).toBe(false)
    expect(store.getEditingCell()).toBeNull()
  })
})

describe('keyboard — Escape (two steps)', () => {
  it('step 1: closes the editor and keeps the cell selected', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 1)
    store.setEditingCell(1, 1)

    expect(press(nav, 'Escape').prevented).toBe(true)
    expect(store.getEditingCell()).toBeNull()
    expect(store.getSelectionBounds()).not.toBeNull()
  })

  it('step 2: clears the selection', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 1)

    expect(press(nav, 'Escape').prevented).toBe(true)
    expect(store.getSelectionBounds()).toBeNull()
  })

  it('step 3: bubbles (no preventDefault) so a parent drawer can close', () => {
    const { nav } = setup()
    expect(press(nav, 'Escape').prevented).toBe(false)
  })
})

describe('keyboard — Tab', () => {
  it('seeds at the first EDITABLE cell when nothing is selected, skipping col 0', () => {
    const { store, nav } = setup()

    expect(press(nav, 'Tab').prevented).toBe(true)
    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 0, startCol: 1, endCol: 1 })
    expect(store.getEditingCell()).toEqual({ row: 0, col: 1 })
  })

  it('moves right one editable column', () => {
    const { store, nav } = setup()
    selectCell(store, 0, 1)

    press(nav, 'Tab')

    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 0, startCol: 2, endCol: 2 })
  })

  it('wraps to the next row, skipping the read-only first column', () => {
    const { store, nav } = setup()
    selectCell(store, 0, 2) // last column of row 0

    press(nav, 'Tab')

    expect(store.getSelectionBounds()).toEqual({ startRow: 1, endRow: 1, startCol: 1, endCol: 1 })
  })

  it('Shift+Tab walks backwards and wraps to the previous row', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 1)

    press(nav, 'Tab', { shiftKey: true })

    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 0, startCol: 2, endCol: 2 })
  })

  it('Shift+Tab from nothing seeds at the LAST editable cell', () => {
    const { store, nav } = setup()

    press(nav, 'Tab', { shiftKey: true })

    expect(store.getSelectionBounds()).toEqual({ startRow: 2, endRow: 2, startCol: 2, endCol: 2 })
  })

  it('selects without opening the editor when autoEditOnTab is false', () => {
    const { store, nav } = setup({ autoEditOnTab: false })
    selectCell(store, 0, 1)

    press(nav, 'Tab')

    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 0, startCol: 2, endCol: 2 })
    expect(store.getEditingCell()).toBeNull()
  })

  it('moves from the open editor, not from the stale selection', () => {
    const { store, nav } = setup()
    selectCell(store, 0, 1)
    store.setEditingCell(1, 1)

    press(nav, 'Tab')

    expect(store.getEditingCell()).toEqual({ row: 1, col: 2 })
  })

  it('traps Tab at the very end of a fully-editable table rather than losing focus', () => {
    const { store, nav } = setup()
    selectCell(store, 2, 2) // last row, last column

    // No editable cell exists past this point, so the grid keeps focus.
    expect(press(nav, 'Tab').prevented).toBe(true)
    expect(store.getSelectionBounds()).toEqual({ startRow: 2, endRow: 2, startCol: 2, endCol: 2 })
  })

  it('lets native Tab escape an EMPTY table', () => {
    const { nav } = setup({ data: [] })
    expect(press(nav, 'Tab').prevented).toBe(false)
  })

  it('hands off to the next sibling table when no editable cell remains', () => {
    const next = siblingRef()
    const focus = jest.spyOn(next.el, 'focus')
    const { store, nav } = setup({ siblings: { next: next.ref } })
    selectCell(store, 2, 2)

    expect(press(nav, 'Tab').prevented).toBe(true)
    expect(focus).toHaveBeenCalled()
    expect(next.el.getAttribute('data-focus-direction')).toBe('down')
    expect(next.el.getAttribute('data-focus-trigger')).toBe('tab')
    expect(store.getSelectionBounds()).toBeNull()
  })

  it('hands off backwards to the previous sibling table on Shift+Tab', () => {
    const prev = siblingRef()
    const { store, nav } = setup({ siblings: { prev: prev.ref } })
    selectCell(store, 0, 1)

    press(nav, 'Tab', { shiftKey: true })

    expect(prev.el.getAttribute('data-focus-direction')).toBe('up')
    expect(store.getSelectionBounds()).toBeNull()
  })

  it('traps Tab when EVERY column is read-only', () => {
    const allReadOnly = columns.map((c) => ({ ...c, readOnly: true }))
    const { store, nav } = setup({ cols: allReadOnly })

    expect(press(nav, 'Tab').prevented).toBe(true)
    // With no prior bounds it parks on the first row so the user is not stranded.
    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 })
  })
})

describe('keyboard — arrows', () => {
  it('seeds the first cell on ArrowDown when nothing is selected', () => {
    const { store, nav } = setup()

    expect(press(nav, 'ArrowDown').prevented).toBe(true)
    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 })
  })

  it('seeds the LAST cell on ArrowUp when nothing is selected', () => {
    const { store, nav } = setup()

    press(nav, 'ArrowUp')

    expect(store.getSelectionBounds()).toEqual({ startRow: 2, endRow: 2, startCol: 2, endCol: 2 })
  })

  it('moves onto read-only cells — read-only skipping is a Tab rule only', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 1)

    press(nav, 'ArrowLeft')

    expect(store.getSelectionBounds()).toEqual({ startRow: 1, endRow: 1, startCol: 0, endCol: 0 })
  })

  it('clamps at the left edge', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 0)

    press(nav, 'ArrowLeft')

    expect(store.getSelectionBounds()).toEqual({ startRow: 1, endRow: 1, startCol: 0, endCol: 0 })
  })

  it('clamps at the right edge', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 2)

    press(nav, 'ArrowRight')

    expect(store.getSelectionBounds()).toEqual({ startRow: 1, endRow: 1, startCol: 2, endCol: 2 })
  })

  it('clamps at the top and bottom rows', () => {
    const { store, nav } = setup()
    selectCell(store, 0, 1)
    press(nav, 'ArrowUp')
    expect(store.getSelectionBounds()!.startRow).toBe(0)

    selectCell(store, 2, 1)
    press(nav, 'ArrowDown')
    expect(store.getSelectionBounds()!.startRow).toBe(2)
  })

  it('collapses a multi-cell range onto its FOCUS, then moves', () => {
    const { store, nav } = setup()
    store.setSelection({ type: 'range', anchor: { row: 0, col: 0 }, focus: { row: 2, col: 2 } })

    press(nav, 'ArrowDown')

    // A range is not a cursor, but the cursor is where the extension ENDED.
    // After Shift+Down×3 a plain ArrowDown has to continue from row 3, not jump
    // back to the anchor — otherwise every Shift+Arrow selection is a trap.
    // Row 2 is the last row here, so the collapse is all that is visible.
    expect(store.getSelectionBounds()).toEqual({ startRow: 2, endRow: 2, startCol: 2, endCol: 2 })
  })

  it('collapses onto the focus and steps one cell when there is room', () => {
    const { store, nav } = setup()
    store.setSelection({ type: 'range', anchor: { row: 2, col: 2 }, focus: { row: 0, col: 0 } })

    press(nav, 'ArrowDown')

    expect(store.getSelectionBounds()).toEqual({ startRow: 1, endRow: 1, startCol: 0, endCol: 0 })
  })

  it('is inert while the editor is open (arrows belong to the editor)', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 1)
    store.setEditingCell(1, 1)

    expect(press(nav, 'ArrowDown').prevented).toBe(false)
    expect(store.getSelectionBounds()).toEqual({ startRow: 1, endRow: 1, startCol: 1, endCol: 1 })
  })

  it('is inert on an empty table', () => {
    const { store, nav } = setup({ data: [] })
    press(nav, 'ArrowDown')
    expect(store.getSelectionBounds()).toBeNull()
  })

  it('ArrowUp on the first row hands off to the previous sibling table', () => {
    const prev = siblingRef()
    const focus = jest.spyOn(prev.el, 'focus')
    const { store, nav } = setup({ siblings: { prev: prev.ref } })
    selectCell(store, 0, 1)

    press(nav, 'ArrowUp')

    expect(focus).toHaveBeenCalled()
    expect(prev.el.getAttribute('data-focus-direction')).toBe('up')
    expect(store.getSelectionBounds()).toBeNull()
  })

  it('ArrowDown on the last row hands off to the next sibling table', () => {
    const next = siblingRef()
    const { store, nav } = setup({ siblings: { next: next.ref } })
    selectCell(store, 2, 1)

    press(nav, 'ArrowDown')

    expect(next.el.getAttribute('data-focus-direction')).toBe('down')
    expect(store.getSelectionBounds()).toBeNull()
  })
})

/**
 * Spec 1 / E1 — Shift+Arrow EXTENDS from a stable anchor.
 *
 * Pinned by `TC-APP-355` as broken ("Shift+Arrow moves the selection"); these
 * are the assertions that make it right. The property that matters is that the
 * anchor never moves, which is what makes extension reversible: grow three,
 * shrink two, and you have a range of two — not a cursor that wandered.
 */
describe('keyboard — Shift+Arrow extends the selection', () => {
  it('grows the range downwards while the anchor stays put', () => {
    const { store, nav } = setup()
    selectCell(store, 0, 1)

    press(nav, 'ArrowDown', { shiftKey: true })

    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 1, startCol: 1, endCol: 1 })
    expect(store.getSelection().anchor).toEqual({ row: 0, col: 1 })
  })

  it('grows across columns too', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 0)

    press(nav, 'ArrowRight', { shiftKey: true })
    press(nav, 'ArrowRight', { shiftKey: true })

    expect(store.getSelectionBounds()).toEqual({ startRow: 1, endRow: 1, startCol: 0, endCol: 2 })
  })

  it('SHRINKS back when the direction reverses — the anchor is stable', () => {
    const { store, nav } = setup()
    selectCell(store, 0, 1)

    press(nav, 'ArrowDown', { shiftKey: true })
    press(nav, 'ArrowDown', { shiftKey: true })
    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 2, startCol: 1, endCol: 1 })

    press(nav, 'ArrowUp', { shiftKey: true })

    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 1, startCol: 1, endCol: 1 })
    expect(store.getSelection().anchor).toEqual({ row: 0, col: 1 })
  })

  it('extends BACKWARDS past the anchor, inverting the rectangle', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 1)

    press(nav, 'ArrowUp', { shiftKey: true })

    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 1, startCol: 1, endCol: 1 })
    expect(store.getSelection().anchor).toEqual({ row: 1, col: 1 })
    expect(store.getSelection().focus).toEqual({ row: 0, col: 1 })
  })

  it('clamps at the table edge without collapsing the range', () => {
    const { store, nav } = setup()
    selectCell(store, 0, 0)

    press(nav, 'ArrowDown', { shiftKey: true })
    press(nav, 'ArrowDown', { shiftKey: true })
    press(nav, 'ArrowDown', { shiftKey: true }) // already at the last row

    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 2, startCol: 0, endCol: 0 })
  })

  it('never hands off to a sibling table — extension is one table', () => {
    const prev = siblingRef()
    const focus = jest.spyOn(prev.el, 'focus')
    const { store, nav } = setup({ siblings: { prev: prev.ref } })
    selectCell(store, 0, 1)

    press(nav, 'ArrowUp', { shiftKey: true })

    expect(focus).not.toHaveBeenCalled()
    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 0, startCol: 1, endCol: 1 })
  })

  it('seeds a single cell when there is nothing to extend from', () => {
    const { store, nav } = setup()

    press(nav, 'ArrowDown', { shiftKey: true })

    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 0, startCol: 0, endCol: 0 })
  })

  it('is inert while the editor is open', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 1)
    store.setEditingCell(1, 1)

    expect(press(nav, 'ArrowDown', { shiftKey: true }).prevented).toBe(false)
    expect(store.getSelectionBounds()).toEqual({ startRow: 1, endRow: 1, startCol: 1, endCol: 1 })
  })

  it('a plain Arrow afterwards RESETS the anchor to one cell', () => {
    const { store, nav } = setup()
    selectCell(store, 0, 1)
    press(nav, 'ArrowDown', { shiftKey: true })
    press(nav, 'ArrowDown', { shiftKey: true })

    press(nav, 'ArrowUp')

    expect(store.getSelectionBounds()).toEqual({ startRow: 1, endRow: 1, startCol: 1, endCol: 1 })
    expect(store.getSelection().anchor).toEqual({ row: 1, col: 1 })
  })
})

describe('keyboard — Ctrl/Cmd+Arrow jumps to the data edge', () => {
  it('Ctrl+ArrowDown lands on the last row of a dense block', () => {
    const { store, nav } = setup()
    selectCell(store, 0, 1)

    press(nav, 'ArrowDown', { ctrlKey: true })

    expect(store.getSelectionBounds()).toEqual({ startRow: 2, endRow: 2, startCol: 1, endCol: 1 })
  })

  it('stops at the last cell BEFORE a blank, then skips the blank run', () => {
    const data = [
      { id: 'r1', ref: 'A1', city: 'WAW' },
      { id: 'r2', ref: 'A2', city: 'KRK' },
      { id: 'r3', ref: '', city: 'WRO' },
      { id: 'r4', ref: '', city: 'GDN' },
      { id: 'r5', ref: 'A5', city: 'POZ' },
    ]
    const { store, nav } = setup({ data })
    selectCell(store, 0, 1)

    press(nav, 'ArrowDown', { ctrlKey: true })
    expect(store.getSelectionBounds()!.startRow).toBe(1) // end of the data block

    press(nav, 'ArrowDown', { ctrlKey: true })
    expect(store.getSelectionBounds()!.startRow).toBe(4) // first cell after the gap
  })

  it('Cmd+Shift+ArrowDown EXTENDS to the data edge in one press', () => {
    const { store, nav } = setup()
    selectCell(store, 0, 1)

    press(nav, 'ArrowDown', { metaKey: true, shiftKey: true })

    expect(store.getSelectionBounds()).toEqual({ startRow: 0, endRow: 2, startCol: 1, endCol: 1 })
    expect(store.getSelection().anchor).toEqual({ row: 0, col: 1 })
  })

  it('Ctrl+Shift+ArrowRight extends to the last column', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 0)

    press(nav, 'ArrowRight', { ctrlKey: true, shiftKey: true })

    expect(store.getSelectionBounds()).toEqual({ startRow: 1, endRow: 1, startCol: 0, endCol: 2 })
  })
})

describe('keyboard — unhandled keys', () => {
  it('ignores a plain character key', () => {
    const { store, nav } = setup()
    selectCell(store, 1, 1)

    expect(press(nav, 'a').prevented).toBe(false)
    expect(store.getEditingCell()).toBeNull()
    expect(store.getSelectionBounds()).toEqual({ startRow: 1, endRow: 1, startCol: 1, endCol: 1 })
  })
})
