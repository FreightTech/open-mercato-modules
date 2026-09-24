/**
 * A column header press selects the column, and the grid's own mousedown does
 * not undo it.
 *
 * The header's mousedown sets a column selection, then bubbles to the grid's
 * handler — which read "no td under the pointer" as a click on empty space and
 * cleared the selection at once, so a header click selected nothing (and the
 * caret-follow scroll chased the column selection's focus to the last row).
 */
import type React from 'react'
import { createColumnHeaderHandlers, createDragHandlers, createMouseHandlers } from '../handlers/index'
import { createCellStore } from '../store/index'
import type { ColumnDef } from '../types/index'

const columns: ColumnDef[] = ['a', 'b', 'c', 'd', 'e'].map((key) => ({ data: key, title: key.toUpperCase() }))
const rows = Array.from({ length: 12 }, (_, index) => ({ a: index, b: index, c: index, d: index, e: index }))

function setup() {
  const store = createCellStore(rows, columns)
  const dragStateRef = { current: { isDragging: false, type: null, start: null } } as React.MutableRefObject<any>
  const drag = createDragHandlers(store, columns, dragStateRef)
  const mouse = createMouseHandlers(store, columns, dragStateRef, drag)
  const header = createColumnHeaderHandlers(
    store,
    columns,
    { current: null },
    { columnIndex: null, direction: null } as any,
    () => {},
    () => {},
  )
  return { store, drag, mouse, header }
}

/** A `th[data-col]` with a label span inside, the way ColumnHeaders renders it. */
function headerCell(col: number) {
  const th = document.createElement('th')
  th.className = 'hot-col-header'
  th.setAttribute('data-col', String(col))
  const label = document.createElement('span')
  th.appendChild(label)
  document.body.appendChild(th)
  return label
}

const pressOn = (target: HTMLElement) =>
  ({ target, preventDefault() {}, stopPropagation() {}, button: 0, shiftKey: false, metaKey: false, ctrlKey: false } as unknown as React.MouseEvent)

describe('column header selection', () => {
  it('a header click selects the whole column, and the grid mousedown leaves it selected', () => {
    const { store, drag, mouse, header } = setup()
    const target = headerCell(2)
    const event = pressOn(target)
    header.handleColumnHeaderMouseDown(event, drag.handleDragStart)
    // The same event then bubbles to the grid.
    mouse.handleMouseDown(event)
    drag.handleDragEnd()

    const selection = store.getSelection()
    expect(selection.type).toBe('colRange')
    expect(selection.anchor?.col).toBe(2)
    expect(selection.focus?.col).toBe(2)
    expect(store.getCellState(0, 2).isInRange).toBe(true)
    expect(store.getCellState(11, 2).isInRange).toBe(true)
    expect(store.getCellState(0, 1).isInRange).toBe(false)
  })

  it('dragging across three headers selects three columns', () => {
    const { store, drag, mouse, header } = setup()
    const event = pressOn(headerCell(1))
    header.handleColumnHeaderMouseDown(event, drag.handleDragStart)
    mouse.handleMouseDown(event)
    drag.handleDragMove(0, 2)
    drag.handleDragMove(0, 3)
    drag.handleDragEnd()

    const selection = store.getSelection()
    expect(selection.type).toBe('colRange')
    expect([selection.anchor?.col, selection.focus?.col]).toEqual([1, 3])
    for (const col of [1, 2, 3]) expect(store.getCellState(5, col).isInRange).toBe(true)
    expect(store.getCellState(5, 0).isInRange).toBe(false)
    expect(store.getCellState(5, 4).isInRange).toBe(false)
  })

  it('a press on empty space below the rows still clears the selection', () => {
    const { store, drag, mouse, header } = setup()
    header.handleColumnHeaderMouseDown(pressOn(headerCell(2)), drag.handleDragStart)
    drag.handleDragEnd()
    const empty = document.createElement('div')
    document.body.appendChild(empty)
    mouse.handleMouseDown(pressOn(empty))
    expect(store.getSelection().type).toBeNull()
  })
})
