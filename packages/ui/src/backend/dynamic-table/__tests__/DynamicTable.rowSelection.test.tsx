import * as React from 'react'
import { render, fireEvent, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import type { ColumnDef } from '../types/index'

/**
 * Row selection is OPT-IN (GT, 2026-10-08).
 *
 * The checkbox column used to appear on every table with `rowHeaders` (i.e.
 * every list page), with a bright bar offering Copy and Deselect-all whatever
 * the table could do. Now the column renders only when the table asks for
 * selection, and the bar only when the table defines an action for it.
 */

const columns: ColumnDef[] = [
  { data: 'client', title: 'Client' },
  { data: 'amount', title: 'Amount', type: 'numeric' },
]

const makeRows = () => [
  { id: '1', client: 'Acme', amount: 100 },
  { id: '2', client: 'Beta', amount: 250 },
]

function Harness(props: Record<string, unknown>) {
  const tableRef = React.useRef<HTMLDivElement | null>(null)
  const [data] = React.useState(makeRows)
  return React.createElement(
    I18nProvider as any,
    { locale: 'en', dict: {} },
    React.createElement(DynamicTable as any, {
      data,
      columns,
      tableRef,
      // What `useDynamicTablePage` passes for every list page.
      rowHeaders: true,
      height: 400,
      ...props,
    }),
  )
}

/** `Harness` holds hooks, so it must be MOUNTED, never called. */
const harness = (props: Record<string, unknown> = {}) => React.createElement(Harness, props)

// jsdom reports every box as 0x0, so the row virtualiser would mount nothing.
beforeAll(() => {
  const rect = {
    width: 1200, height: 600, top: 0, left: 0, right: 1200, bottom: 600, x: 0, y: 0,
    toJSON() {},
  }
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  })
  for (const [prop, value] of [
    ['clientHeight', 600],
    ['offsetHeight', 600],
    ['clientWidth', 1200],
    ['offsetWidth', 1200],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value })
  }
})

const rowCheckboxes = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('td.hot-row-header input.hot-row-select'))
const bulkBar = () => screen.queryByRole('toolbar', { name: /bulk actions/i })

describe('DynamicTable — row selection is opt-in', () => {
  it('shows no checkbox column by default, even with rowHeaders and a bulk delete', () => {
    render(harness({ onBulkDelete: jest.fn() }))
    expect(document.querySelectorAll('td.hot-row-header')).toHaveLength(0)
    expect(document.querySelector('input.hot-row-select')).toBeNull()
  })

  it('turns selection on for a table that listens to it', () => {
    const onSelectionChange = jest.fn()
    render(harness({ onSelectionChange }))
    expect(rowCheckboxes()).toHaveLength(2)
    fireEvent.click(rowCheckboxes()[0])
    expect(onSelectionChange).toHaveBeenLastCalledWith(['1'])
  })

  it('lets an explicit rowSelection: false win over a listener', () => {
    render(harness({ rowSelection: false, onSelectionChange: jest.fn() }))
    expect(rowCheckboxes()).toHaveLength(0)
  })

  it('shows checkboxes with rowSelection: true, but no bar when the table defines no action', () => {
    render(harness({ rowSelection: true }))
    expect(rowCheckboxes()).toHaveLength(2)
    fireEvent.click(rowCheckboxes()[0])
    expect(bulkBar()).toBeNull()
  })

  it('shows the bar with only the actions the table defines — no Copy, no Export', () => {
    render(harness({ rowSelection: true, onBulkDelete: jest.fn() }))
    fireEvent.click(rowCheckboxes()[0])
    const bar = bulkBar()
    expect(bar).not.toBeNull()
    expect(bar!.textContent).toContain('1 selected')
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
    expect(Array.from(bar!.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Delete'])
  })

  it('turns selection on for bulkActions and hands them the selected ids', () => {
    const onClick = jest.fn()
    render(harness({ uiConfig: { bulkActions: [{ id: 'assign', label: 'Assign', onClick }] } }))
    expect(rowCheckboxes()).toHaveLength(2)
    fireEvent.click(rowCheckboxes()[1])
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }))
    expect(onClick).toHaveBeenCalledWith(['2'])
  })

  it('puts a draft row\'s cancel next to Save when there is no checkbox column', () => {
    render(harness())
    const add = document.querySelector<HTMLButtonElement>('.hot-add-row-btn')
    expect(add).not.toBeNull()
    fireEvent.click(add!)
    expect(document.querySelector('.hot-row-save-btn')).not.toBeNull()
    const cancel = screen.getByRole('button', { name: /cancel/i })
    expect(cancel.classList.contains('hot-row-cancel-btn')).toBe(true)
    fireEvent.click(cancel)
    expect(document.querySelector('.hot-row-save-btn')).toBeNull()
  })

  it('keeps the draft row\'s cancel in the checkbox column when selection is on', () => {
    render(harness({ rowSelection: true }))
    fireEvent.click(document.querySelector<HTMLButtonElement>('.hot-add-row-btn')!)
    expect(document.querySelector('.hot-row-cancel-btn-header')).not.toBeNull()
    expect(document.querySelector('.hot-row-cancel-btn')).toBeNull()
  })
})
