import { createDragHandlers, createMouseHandlers } from '../handlers/index'
import { createCellStore } from '../store/index'
import type { ColumnDef } from '../types/index'
import type { DragState } from '../handlers/index'
import { columnOpensOnClick, markPickerEditor } from '../utils/pickerColumn'
import { createDateTimeEditor, createMultiSelectEntitySearchEditor } from '../components/editors'
import { createEntitySearchEditor } from '../components/EntitySearchEditor'

/**
 * Owner 07.10, RFS board: "selects inside the dynamic table … the input is too intrusive, and it
 * should open directly on click". A picker cell (a list or a calendar) opens its editor on ONE
 * click; a text cell still needs the double-click (a single click there selects, so typing
 * replaces). A drag or a modified click only selects — those build ranges.
 */

const columns: ColumnDef[] = [
  { data: 'ref', title: 'Ref' },
  { data: 'currency', title: 'Waluta', type: 'dropdown', source: ['PLN', 'EUR'] },
  { data: 'eta', title: 'ETA', type: 'date' },
  { data: 'status', title: 'Status', type: 'dropdown', readOnly: true },
  { data: 'tags', title: 'Tags', type: 'multiselect', openOnClick: false },
]

function setup() {
  const store = createCellStore(
    [
      { ref: 'A1', currency: null, eta: null, status: 'x', tags: [] },
      { ref: 'B2', currency: 'EUR', eta: null, status: 'y', tags: [] },
    ],
    columns,
  )
  const dragStateRef: React.MutableRefObject<DragState> = {
    current: { isDragging: false, type: null, start: null },
  }
  const dragHandlers = createDragHandlers(store, columns, dragStateRef)
  return { store, ...createMouseHandlers(store, columns, dragStateRef, dragHandlers) }
}

function cell(row: number, col: number) {
  const tr = document.createElement('tr')
  const td = document.createElement('td')
  td.setAttribute('data-row', String(row))
  td.setAttribute('data-col', String(col))
  const span = document.createElement('span')
  td.appendChild(span)
  tr.appendChild(td)
  document.body.appendChild(tr)
  return { td, span }
}

const press = (target: HTMLElement, mods: Partial<React.MouseEvent> = {}) =>
  ({ target, button: 0, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, preventDefault() {}, ...mods }) as unknown as React.MouseEvent

afterEach(() => {
  document.body.innerHTML = ''
})

describe('one click opens a picker cell', () => {
  it('a dropdown cell opens on press + release', () => {
    const h = setup()
    h.handleMouseDown(press(cell(0, 1).span))
    expect(h.store.getEditingCell()).toBeNull()
    h.handleMouseUp()
    expect(h.store.getEditingCell()).toEqual({ row: 0, col: 1 })
  })

  it('a date cell opens on one click', () => {
    const h = setup()
    h.handleMouseDown(press(cell(1, 2).td))
    h.handleMouseUp()
    expect(h.store.getEditingCell()).toEqual({ row: 1, col: 2 })
  })

  it('a text cell does not — it still needs the double-click', () => {
    const h = setup()
    h.handleMouseDown(press(cell(0, 0).td))
    h.handleMouseUp()
    expect(h.store.getEditingCell()).toBeNull()
  })

  it('a drag that leaves the cell only selects', () => {
    const h = setup()
    h.handleMouseDown(press(cell(0, 1).td))
    const next = cell(1, 1).td
    const orig = document.elementFromPoint
    document.elementFromPoint = () => next
    h.handleMouseMove({ clientX: 0, clientY: 0 } as React.MouseEvent)
    document.elementFromPoint = orig
    h.handleMouseUp()
    expect(h.store.getEditingCell()).toBeNull()
  })

  it.each(['shiftKey', 'metaKey', 'ctrlKey'] as const)('a %s click only selects', (mod) => {
    const h = setup()
    h.handleMouseDown(press(cell(0, 1).td, { [mod]: true }))
    h.handleMouseUp()
    expect(h.store.getEditingCell()).toBeNull()
  })

  it('a press on an in-cell affordance (comment marker, button) does not open the editor', () => {
    const h = setup()
    const { td } = cell(0, 1)
    const marker = document.createElement('span')
    marker.setAttribute('data-no-row-click', '')
    td.appendChild(marker)
    h.handleMouseDown(press(marker))
    h.handleMouseUp()
    expect(h.store.getEditingCell()).toBeNull()
  })

  it('read-only and opted-out columns stay closed', () => {
    const h = setup()
    h.handleMouseDown(press(cell(0, 3).td))
    h.handleMouseUp()
    h.handleMouseDown(press(cell(0, 4).td))
    h.handleMouseUp()
    expect(h.store.getEditingCell()).toBeNull()
  })
})

describe('columnOpensOnClick', () => {
  it('built-in picker types are pickers, text and numeric are not', () => {
    expect(columnOpensOnClick({ type: 'dropdown' })).toBe(true)
    expect(columnOpensOnClick({ type: 'multiselect' })).toBe(true)
    expect(columnOpensOnClick({ type: 'date' })).toBe(true)
    expect(columnOpensOnClick({ type: 'text' })).toBe(false)
    expect(columnOpensOnClick({ type: 'numeric' })).toBe(false)
    expect(columnOpensOnClick({})).toBe(false)
  })

  it("the package's picker factories mark their editors", () => {
    const config = { endpoint: '/api/x', labelField: 'name' } as never
    expect(columnOpensOnClick({ editor: createEntitySearchEditor(config) })).toBe(true)
    expect(columnOpensOnClick({ editor: createMultiSelectEntitySearchEditor(config) })).toBe(true)
    expect(columnOpensOnClick({ type: 'date', editor: createDateTimeEditor() })).toBe(true)
  })

  it('an unmarked custom editor is not a picker unless the column says so', () => {
    const editor = () => null
    expect(columnOpensOnClick({ type: 'dropdown', editor })).toBe(false)
    expect(columnOpensOnClick({ editor, openOnClick: true })).toBe(true)
    expect(columnOpensOnClick({ editor: markPickerEditor(() => null) })).toBe(true)
    expect(columnOpensOnClick({ type: 'dropdown', openOnClick: false })).toBe(false)
    expect(columnOpensOnClick({ type: 'dropdown', readOnly: true })).toBe(false)
  })
})
