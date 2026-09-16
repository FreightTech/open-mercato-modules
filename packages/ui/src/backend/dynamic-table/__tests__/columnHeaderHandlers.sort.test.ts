import { createColumnHeaderHandlers } from '../handlers/index'
import { createCellStore } from '../store/index'
import { TableEvents } from '../types/index'
import type { ColumnDef, ColumnSortEvent, SortState } from '../types/index'

/**
 * Spec 0 / Phase 3 — sort has ONE owner.
 *
 * `handleColumnSort` used to write its own `sortState` while the column menu and
 * the Configure View drawer wrote `sortRules`. Nothing reconciled them, so a
 * menu-sorted column rendered no indicator (TC-APP-338) and a header-sorted column
 * was invisible to the perspective. The handler now reads a projection of the
 * rules and reports the NEXT direction back to their single owner.
 */

const columns: ColumnDef[] = [
  { data: 'ref', title: 'Ref' },
  { data: 'city', title: 'City' },
]

const unsorted: SortState = { columnIndex: null, direction: null }

function setup(sortState: SortState) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const store = createCellStore([{ ref: 'A1', city: 'WAW' }], columns)
  const events: ColumnSortEvent[] = []
  el.addEventListener(TableEvents.COLUMN_SORT, (e) =>
    events.push((e as CustomEvent<ColumnSortEvent>).detail),
  )
  const onSortChange = jest.fn()
  const { handleColumnSort } = createColumnHeaderHandlers(
    store,
    columns,
    { current: el },
    sortState,
    onSortChange,
    jest.fn(),
  )
  return { handleColumnSort, onSortChange, events }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('handleColumnSort — the Excel cycle', () => {
  it('sorts ascending on the first click of an unsorted column', () => {
    const h = setup(unsorted)
    h.handleColumnSort(0)
    expect(h.onSortChange).toHaveBeenCalledWith(0, 'asc')
  })

  it('flips ascending → descending on the second click', () => {
    const h = setup({ columnIndex: 0, direction: 'asc' })
    h.handleColumnSort(0)
    expect(h.onSortChange).toHaveBeenCalledWith(0, 'desc')
  })

  it('clears the sort on the third click', () => {
    const h = setup({ columnIndex: 0, direction: 'desc' })
    h.handleColumnSort(0)
    expect(h.onSortChange).toHaveBeenCalledWith(0, null)
  })

  it('starts a NEW column at ascending rather than continuing the cycle', () => {
    const h = setup({ columnIndex: 0, direction: 'desc' })
    h.handleColumnSort(1)
    expect(h.onSortChange).toHaveBeenCalledWith(1, 'asc')
  })

  it('never writes sort state itself — the owner does', () => {
    // The handler is handed a read-only projection; the only write is the callback.
    const h = setup(unsorted)
    h.handleColumnSort(0)
    expect(h.onSortChange).toHaveBeenCalledTimes(1)
  })
})

describe('handleColumnSort — COLUMN_SORT event (unchanged contract)', () => {
  it('emits the column name and the new direction', () => {
    const h = setup(unsorted)
    h.handleColumnSort(1)

    expect(h.events).toEqual([{ columnIndex: 1, columnName: 'city', direction: 'asc' }])
  })

  it('emits a null direction when the sort is cleared', () => {
    const h = setup({ columnIndex: 0, direction: 'desc' })
    h.handleColumnSort(0)

    expect(h.events[0]).toMatchObject({ columnName: 'ref', direction: null })
  })

  it('emits exactly one event per click', () => {
    const h = setup(unsorted)
    h.handleColumnSort(0)
    expect(h.events).toHaveLength(1)
  })
})
