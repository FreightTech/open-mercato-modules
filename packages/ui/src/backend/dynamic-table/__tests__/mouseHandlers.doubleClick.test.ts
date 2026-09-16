import { createDragHandlers, createMouseHandlers } from '../handlers/index'
import { createCellStore } from '../store/index'
import type { ColumnDef } from '../types/index'
import type { DragState } from '../handlers/index'

/**
 * HEDGE-17 — double-click to edit must survive a physical mouse.
 *
 * The browser dispatches `dblclick` on the nearest common ancestor of the second
 * click's mousedown node and its mouseup node — NOT on the node that was pressed.
 * Press inside a cell, slide out of it while the button is held, release, and
 * that ancestor is `<tbody>`, which has no `td`. `handleDoubleClick` used to call
 * `closest('td')`, get null, and return, so the editor never opened.
 *
 * Rows are 32px tall, so 16px of travel from the middle of a cell is enough. A
 * hand on a mouse does that; a two-finger tap on a trackpad moves by nothing —
 * which is why one user reported the feature dead and the person beside her saw
 * it work. The browser measurement is in `.ai/qa/hedge-17/` (BEFORE.txt /
 * AFTER.txt); this pins the handler contract that measurement established.
 */

const columns: ColumnDef[] = [
  { data: 'ref', title: 'Ref' },
  { data: 'city', title: 'City' },
  { data: 'total', title: 'Total', readOnly: true },
]

function setup() {
  const store = createCellStore(
    [
      { ref: 'A1', city: 'WAW', total: 10 },
      { ref: 'B2', city: 'KRK', total: 20 },
    ],
    columns,
  )
  const dragStateRef: React.MutableRefObject<DragState> = {
    current: { isDragging: false, type: null, start: null },
  }
  const dragHandlers = createDragHandlers(store, columns, dragStateRef)
  const handlers = createMouseHandlers(store, columns, dragStateRef, dragHandlers)
  return { store, ...handlers }
}

/** A `dblclick` React would hand us, with an arbitrary DOM node as its target. */
const dblclickOn = (target: HTMLElement) => ({ target }) as unknown as React.MouseEvent

/** The cell markup the grid renders, as `closest('td')` sees it. */
function cellNode(row: number, col: number) {
  const tbody = document.createElement('tbody')
  const tr = document.createElement('tr')
  const td = document.createElement('td')
  td.setAttribute('data-row', String(row))
  td.setAttribute('data-col', String(col))
  const span = document.createElement('span')
  td.appendChild(span)
  tr.appendChild(td)
  tbody.appendChild(tr)
  return { tbody, td, span }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('handleDoubleClick — the target the browser actually gives us', () => {
  it('opens the editor when the target is the cell itself', () => {
    const h = setup()
    const { td } = cellNode(1, 0)
    h.handleDoubleClick(dblclickOn(td))
    expect(h.store.getEditingCell()).toEqual({ row: 1, col: 0 })
  })

  it('opens the editor when the target is a child of the cell', () => {
    const h = setup()
    const { span } = cellNode(1, 1)
    h.handleDoubleClick(dblclickOn(span))
    expect(h.store.getEditingCell()).toEqual({ row: 1, col: 1 })
  })

  it('opens the editor on the PRESSED cell when the target was retargeted to <tbody>', () => {
    const h = setup()
    // The press that begins the second click — this is what writes the anchor.
    h.handleMouseDown({
      target: cellNode(1, 0).span,
      preventDefault: () => {},
    } as unknown as React.MouseEvent)

    // The pointer left the cell before release, so the browser hands us <tbody>.
    h.handleDoubleClick(dblclickOn(document.createElement('tbody')))

    // Row 1, not the row the pointer drifted into.
    expect(h.store.getEditingCell()).toEqual({ row: 1, col: 0 })
  })

  it('still refuses a read-only column when the target was retargeted', () => {
    const h = setup()
    h.handleMouseDown({
      target: cellNode(0, 2).span,
      preventDefault: () => {},
    } as unknown as React.MouseEvent)

    h.handleDoubleClick(dblclickOn(document.createElement('tbody')))
    expect(h.store.getEditingCell()).toBeNull()
  })
})

describe('handleDoubleClick — the fallback cannot invent an edit', () => {
  it('does nothing when nothing is selected', () => {
    const h = setup()
    h.handleDoubleClick(dblclickOn(document.createElement('tbody')))
    expect(h.store.getEditingCell()).toBeNull()
  })

  it('does nothing when the selection came from a row-header press', () => {
    const h = setup()
    // A row-header press writes `rowRange`, never `range`.
    const { td, span } = cellNode(1, 0)
    td.setAttribute('data-row-header', 'true')
    h.handleMouseDown({ target: span, preventDefault: () => {} } as unknown as React.MouseEvent)
    expect(h.store.getSelection().type).toBe('rowRange')

    h.handleDoubleClick(dblclickOn(document.createElement('tbody')))
    expect(h.store.getEditingCell()).toBeNull()
  })

  it('does nothing when the press landed on empty space below the rows', () => {
    const h = setup()
    // Seed a real cell selection first, so the test proves the CLEAR is what
    // stops the fallback rather than there never having been an anchor.
    h.handleMouseDown({
      target: cellNode(1, 0).span,
      preventDefault: () => {},
    } as unknown as React.MouseEvent)
    h.handleMouseDown({
      target: document.createElement('div'),
      preventDefault: () => {},
    } as unknown as React.MouseEvent)

    h.handleDoubleClick(dblclickOn(document.createElement('tbody')))
    expect(h.store.getEditingCell()).toBeNull()
  })

  it('leaves the row-header and actions cells alone when they ARE the target', () => {
    const h = setup()
    const rowHeader = cellNode(1, 0)
    rowHeader.td.setAttribute('data-row-header', 'true')
    h.handleDoubleClick(dblclickOn(rowHeader.td))
    expect(h.store.getEditingCell()).toBeNull()

    const actions = cellNode(1, 1)
    actions.td.setAttribute('data-actions-cell', 'true')
    h.handleDoubleClick(dblclickOn(actions.td))
    expect(h.store.getEditingCell()).toBeNull()
  })
})
