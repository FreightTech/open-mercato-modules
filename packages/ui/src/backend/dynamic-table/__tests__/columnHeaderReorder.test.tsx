import * as React from 'react'
import { render, fireEvent, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import ColumnHeaders from '../components/ColumnHeaders'
import { CellStoreContext } from '../hooks/index'
import { createCellStore } from '../store/index'
import type { ColumnDef } from '../types/index'

/**
 * A16a — REORDER A COLUMN FROM ITS HEADER.
 *
 * Today the only way to change column order is the Configure View drawer, and
 * the workshop was blunt about what people expect instead: grab the header and
 * drop it where it belongs, exactly as in Excel.
 *
 * What these tests pin is not the animation — it is the ARITHMETIC, because the
 * grid virtualizes columns and the drop target may be a column that is not
 * mounted, or sit past columns that are not mounted:
 *
 *   • the reorder is reported as ABSOLUTE indices into the full column array,
 *     never as DOM positions;
 *   • dropping on the right half of a header lands AFTER it, and the index the
 *     callback reports already accounts for the source being lifted out first
 *     (drop 0 → right of 2 is `(0, 2)`, not `(0, 3)`);
 *   • a press that never moves is a click, not a drag;
 *   • Escape abandons the drag;
 *   • a pinned column cannot be interleaved with an unpinned one, in either
 *     direction — `position: sticky` offsets are prefix sums over the pinned
 *     run, so a hole in that run paints a broken frozen block.
 */

const columns: ColumnDef[] = [
  { data: 'ref', title: 'Reference' },
  { data: 'container', title: 'Container' },
  { data: 'carrier', title: 'Carrier' },
  { data: 'plate', title: 'Truck plate' },
]

const rows = [{ id: 'r1', ref: 'A', container: 'B', carrier: 'C', plate: 'D' }]

/** Stand in for the header the pointer is physically over. */
function pointAt(colIndex: number, side: 'left' | 'right') {
  const th = document.querySelector<HTMLElement>(`th.hot-col-header[data-col="${colIndex}"]`)!
  // jsdom gives every element a zero rect; fake a 100px-wide box per column so
  // "which half of the header" has an answer.
  const left = colIndex * 100
  th.getBoundingClientRect = () =>
    ({ left, right: left + 100, width: 100, top: 0, bottom: 30, height: 30, x: left, y: 0 }) as DOMRect
  ;(document as any).elementFromPoint = () => th
  return side === 'left' ? left + 10 : left + 90
}

function renderHeaders(options: { leftOffsets?: (number | undefined)[] } = {}) {
  const onColumnReorder = jest.fn()
  const store = createCellStore(rows, columns)
  render(
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(
        CellStoreContext.Provider as any,
        { value: store },
        React.createElement(ColumnHeaders as any, {
          columns,
          rowHeaders: false,
          leftOffsets: options.leftOffsets ?? [],
          rightOffsets: [],
          totalWidth: 400,
          sortState: { columnIndex: null, direction: null },
          actionsColumnWidth: 80,
          modernLayout: true,
          onSort: () => {},
          onResizeStart: () => {},
          onDoubleClick: () => {},
          onMouseDown: () => {},
          onMouseMove: () => {},
          onColumnReorder,
        }),
      ),
    ),
  )
  return { onColumnReorder }
}

function grab(colIndex: number) {
  const th = document.querySelector<HTMLElement>(`th.hot-col-header[data-col="${colIndex}"]`)!
  fireEvent.mouseDown(th, { button: 0, clientX: colIndex * 100 + 50, clientY: 15 })
}

function dragTo(colIndex: number, side: 'left' | 'right') {
  const x = pointAt(colIndex, side)
  fireEvent.mouseMove(document, { clientX: x, clientY: 15 })
  return x
}

describe('ColumnHeaders — drag to reorder (A16a)', () => {
  afterEach(() => {
    delete (document as any).elementFromPoint
  })

  it('moves a column to the left of the header it is dropped on', () => {
    const { onColumnReorder } = renderHeaders()
    grab(3)
    dragTo(1, 'left')
    fireEvent.mouseUp(document)
    expect(onColumnReorder).toHaveBeenCalledWith(3, 1)
  })

  it('moves a column to the right of the header it is dropped on, without off-by-one', () => {
    const { onColumnReorder } = renderHeaders()
    grab(0)
    dragTo(2, 'right')
    fireEvent.mouseUp(document)
    // Slot 3 in the pre-move array; lifting column 0 out shifts it to 2.
    expect(onColumnReorder).toHaveBeenCalledWith(0, 2)
  })

  it('treats a press with no movement as a click, not a drag', () => {
    const { onColumnReorder } = renderHeaders()
    grab(2)
    fireEvent.mouseUp(document)
    expect(onColumnReorder).not.toHaveBeenCalled()
  })

  it('does not report a move that lands the column back where it started', () => {
    const { onColumnReorder } = renderHeaders()
    grab(1)
    dragTo(1, 'left')
    fireEvent.mouseUp(document)
    expect(onColumnReorder).not.toHaveBeenCalled()
  })

  it('abandons the drag on Escape', () => {
    const { onColumnReorder } = renderHeaders()
    grab(3)
    dragTo(0, 'left')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseUp(document)
    expect(onColumnReorder).not.toHaveBeenCalled()
  })

  it('paints the drop indicator on the column the source would land before', () => {
    renderHeaders()
    grab(3)
    dragTo(1, 'left')
    const target = document.querySelector('th.hot-col-header[data-col="1"]')!
    expect(target.getAttribute('data-drop-before')).toBe('true')
    expect(document.querySelector('th[data-reorder-source]')?.getAttribute('data-col')).toBe('3')
  })

  it('refuses to drop an unpinned column inside the frozen block', () => {
    // Columns 0 and 1 are pinned left (offsets 0 and 120).
    const { onColumnReorder } = renderHeaders({ leftOffsets: [0, 120] })
    grab(3)
    dragTo(0, 'right')
    fireEvent.mouseUp(document)
    expect(onColumnReorder).not.toHaveBeenCalled()
  })

  it('refuses to drag a pinned column out of the frozen block', () => {
    const { onColumnReorder } = renderHeaders({ leftOffsets: [0, 120] })
    grab(0)
    dragTo(3, 'right')
    fireEvent.mouseUp(document)
    expect(onColumnReorder).not.toHaveBeenCalled()
  })

  it('still allows reordering WITHIN the frozen block', () => {
    const { onColumnReorder } = renderHeaders({ leftOffsets: [0, 120] })
    grab(1)
    dragTo(0, 'left')
    fireEvent.mouseUp(document)
    expect(onColumnReorder).toHaveBeenCalledWith(1, 0)
  })

  it('offers Move left / Move right in the column menu for keyboard users', () => {
    const onColumnMove = jest.fn()
    const store = createCellStore(rows, columns)
    render(
      React.createElement(
        I18nProvider as any,
        { locale: 'en', dict: {} },
        React.createElement(
          CellStoreContext.Provider as any,
          { value: store },
          React.createElement(ColumnHeaders as any, {
            columns,
            rowHeaders: false,
            leftOffsets: [],
            rightOffsets: [],
            totalWidth: 400,
            sortState: { columnIndex: null, direction: null },
            actionsColumnWidth: 80,
            modernLayout: true,
            onSort: () => {},
            onResizeStart: () => {},
            onDoubleClick: () => {},
            onMouseDown: () => {},
            onMouseMove: () => {},
            onColumnMove,
          }),
        ),
      ),
    )
    fireEvent.click(screen.getAllByTitle('Column options')[1])
    fireEvent.click(screen.getByText('Move left'))
    expect(onColumnMove).toHaveBeenCalledWith(1, -1)
  })
})
