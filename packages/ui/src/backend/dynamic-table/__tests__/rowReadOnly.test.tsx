/**
 * @jest-environment jsdom
 *
 * READ-ONLY PER ROW (0.14.35): `ColumnDef.readOnly` may be `(row, rowIndex) => boolean`.
 *
 * gt-fms worked around its absence twice: the tasks type wizard (a status a module defines keeps its board column —
 * the "Column" cell opened the dropdown and then refused the pick) and invoicing verification (a correction's "before"
 * row — a custom editor that closed itself as it opened). A read-only cell opens no editor by any route, refuses
 * paste / fill / clear, and draws read-only; the column's other rows stay editable. `true` behaves as before.
 */

import * as React from 'react'
import { render, fireEvent, act, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import type { ColumnDef } from '../types/index'
import { applyCellWrites } from '../handlers/cellWrites'
import { coerceCellValue } from '../utils/coerceCellValue'
import { getCellEditor } from '../components/editors'
import { createCellStore } from '../store/index'
import { isCellReadOnly } from '../index'
import { flash } from '../../FlashMessages'

jest.mock('../../FlashMessages', () => ({ flash: jest.fn() }))
const mockFlash = flash as unknown as jest.Mock

/** Row 0 is a correction's "before" row: its Status is read-only. Row 1 is an ordinary row. */
const locked = (row: any) => row?.locked === true
const columns: ColumnDef[] = [
  { data: 'name', title: 'Name' },
  { data: 'status', title: 'Status', readOnly: locked },
  { data: 'note', title: 'Note' },
]
const makeRows = () => [
  { id: 'a', name: 'Before', status: 'old', note: '', locked: true },
  { id: 'b', name: 'After', status: 'new', note: '', locked: false },
]

function Harness(props: { columns?: ColumnDef[] }) {
  const tableRef = React.useRef<HTMLDivElement | null>(null)
  const [data] = React.useState(makeRows)
  return React.createElement(
    I18nProvider as any,
    { locale: 'en', dict: {} },
    React.createElement(DynamicTable as any, { data, columns: props.columns ?? columns, tableRef, height: 400 }),
  )
}

const cellAt = (row: number, col: number) => document.querySelector(`td[data-row="${row}"][data-col="${col}"]`) as HTMLElement
const editorIn = (cell: HTMLElement) => cell.querySelector('input, textarea, select')

// jsdom boxes are 0x0, so the row virtualiser would mount no cells (as DynamicTable.wiring.test.tsx).
beforeAll(() => {
  const rect = { width: 1200, height: 600, top: 0, left: 0, right: 1200, bottom: 600, x: 0, y: 0, toJSON() {} }
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
  for (const [prop, value] of [['clientHeight', 600], ['offsetHeight', 600], ['clientWidth', 1200], ['offsetWidth', 1200]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value })
  }
})

let saves: Array<{ row: number; prop: string; value: unknown }> = []
const onSave = (e: Event) => {
  const d = (e as CustomEvent).detail
  saves.push({ row: d.rowIndex, prop: d.prop, value: d.newValue })
}
beforeEach(() => {
  saves = []
  mockFlash.mockReset()
  document.addEventListener('table:cell:edit:save', onSave)
})
afterEach(() => document.removeEventListener('table:cell:edit:save', onSave))

describe('a cell read-only for its row', () => {
  it('draws read-only only on that row', () => {
    render(React.createElement(Harness))
    expect(cellAt(0, 1).className).toContain('read-only')
    expect(cellAt(1, 1).className).not.toContain('read-only')
    expect(cellAt(0, 0).className).not.toContain('read-only')
  })

  it('opens no editor on double-click, while the same column on another row does', () => {
    render(React.createElement(Harness))
    act(() => { fireEvent.mouseDown(cellAt(0, 1)); fireEvent.doubleClick(cellAt(0, 1)) })
    expect(editorIn(cellAt(0, 1))).toBeNull()
    act(() => { fireEvent.mouseDown(cellAt(1, 1)); fireEvent.doubleClick(cellAt(1, 1)) })
    expect(editorIn(cellAt(1, 1))).not.toBeNull()
  })

  it('opens no editor on Enter, and says why', () => {
    render(React.createElement(Harness))
    const cell = cellAt(0, 1)
    act(() => { fireEvent.mouseDown(cell) })
    act(() => { fireEvent.keyDown(cell, { key: 'Enter' }) })
    expect(editorIn(cellAt(0, 1))).toBeNull()
    expect(mockFlash).toHaveBeenCalledWith('This cell is read-only', 'info')
  })

  it('no route opens it — the store refuses the edit session itself (one-click pickers, Tab, a consumer)', () => {
    const store = createCellStore(makeRows(), columns)
    store.setEditingCell(0, 1)
    expect(store.getEditingCell()).toBeNull()
    store.setEditingCell(1, 1)
    expect(store.getEditingCell()).toEqual({ row: 1, col: 1 })
  })

  it('a paste over the column writes the editable row and refuses the read-only one', async () => {
    render(React.createElement(Harness))
    const cell = cellAt(0, 1)
    act(() => { fireEvent.mouseDown(cell) })
    const event: any = new Event('paste', { bubbles: true, cancelable: true })
    event.clipboardData = { getData: (type: string) => (type === 'text/plain' ? 'X\nY' : '') }
    act(() => { cell.dispatchEvent(event) })
    await waitFor(() => expect(saves.length).toBeGreaterThan(0))
    expect(saves).toEqual([{ row: 1, prop: 'status', value: 'Y' }])
  })

  it('Delete over a range clears the editable row only', async () => {
    render(React.createElement(Harness))
    const cell = cellAt(0, 1)
    act(() => { fireEvent.mouseDown(cell); fireEvent.keyDown(cell, { key: 'ArrowDown', shiftKey: true }) })
    act(() => { fireEvent.keyDown(cell, { key: 'Delete' }) })
    await waitFor(() => expect(saves.length).toBeGreaterThan(0))
    expect(saves).toEqual([{ row: 1, prop: 'status', value: null }])
  })

  it('a fill (and any batch write) over a range rejects the read-only cell with reason readOnly', () => {
    const rows = makeRows()
    const written: Array<[number, number, unknown]> = []
    const report = applyCellWrites(
      {
        store: { getRowData: (r: number) => rows[r], getRowCount: () => rows.length, beginUndoGroup() {}, endUndoGroup() {} } as any,
        columns,
        handleCellSave: (r: number, c: number, v: unknown) => { written.push([r, c, v]) },
        coerce: coerceCellValue,
      },
      [{ row: 0, col: 1, value: 'F' }, { row: 1, col: 1, value: 'F' }],
      { origin: 'fill' },
    )
    expect(written).toEqual([[1, 1, 'F']])
    expect(report.results.find((r) => r.row === 0)).toMatchObject({ status: 'rejected', reason: 'readOnly' })
  })

  it('mounts no editor even when the column has its own, on the read-only row only', () => {
    const custom: ColumnDef = { data: 'status', title: 'Status', readOnly: locked, editor: () => React.createElement('input', { 'data-custom': '' }) }
    const noop = () => {}
    expect(getCellEditor(custom, 'old', noop, noop, noop, makeRows()[0], 0, 1)).toBeNull()
    expect(getCellEditor(custom, 'new', noop, noop, noop, makeRows()[1], 1, 1)).not.toBeNull()
  })

  it('isCellReadOnly: a predicate decides per row, a throwing one counts as read-only', () => {
    expect(isCellReadOnly(columns[1], makeRows()[0], 0)).toBe(true)
    expect(isCellReadOnly(columns[1], makeRows()[1], 1)).toBe(false)
    expect(isCellReadOnly({ readOnly: () => { throw new Error('x') } }, {}, 0)).toBe(true)
  })
})

describe('readOnly: true is unchanged', () => {
  it('the coercer still refuses a whole read-only column, and leaves a per-row column to the row check', () => {
    expect(coerceCellValue('x', { data: 's', readOnly: true })).toEqual({ ok: false, reason: 'readOnly' })
    expect(coerceCellValue('x', { data: 's', readOnly: locked })).toEqual({ ok: true, value: 'x' })
  })

  it('a custom editor still wins over readOnly: true (as before)', () => {
    const custom: ColumnDef = { data: 'status', title: 'Status', readOnly: true, editor: () => React.createElement('input') }
    const noop = () => {}
    expect(getCellEditor(custom, 'old', noop, noop, noop, makeRows()[0], 0, 1)).not.toBeNull()
  })

  it('a whole read-only column draws read-only on every row and refuses every paste', async () => {
    const all = columns.map((c) => (c.data === 'status' ? { ...c, readOnly: true } : c))
    render(React.createElement(Harness, { columns: all }))
    expect(cellAt(0, 1).className).toContain('read-only')
    expect(cellAt(1, 1).className).toContain('read-only')
    const cell = cellAt(0, 1)
    act(() => { fireEvent.mouseDown(cell) })
    const event: any = new Event('paste', { bubbles: true, cancelable: true })
    event.clipboardData = { getData: (type: string) => (type === 'text/plain' ? 'X\nY' : '') }
    act(() => { cell.dispatchEvent(event) })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(saves).toEqual([])
  })
})
