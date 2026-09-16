import * as React from 'react'
import { render, fireEvent, act, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import type { ColumnDef } from '../types/index'
import type { PerspectiveConfig } from '../types/perspective'

/**
 * MOUNT TESTS.
 *
 * Wave 1 built five components and referenced none of them. A capability that
 * no render path reaches is not shipped, so these tests assert the thing the
 * unit tests structurally cannot: that the grid actually PUTS THEM ON SCREEN.
 *
 * Everything here is written from what a user would see, not from the props.
 */

const columns: ColumnDef[] = [
  { data: 'client', title: 'Client' },
  { data: 'amount', title: 'Amount', type: 'numeric' },
  { data: 'status', title: 'Status' },
]

// A FACTORY, not a shared constant. The store owns the row objects by
// reference and writes through them, so one paste test would otherwise leave
// 'Gamma'/999 behind for the next.
const makeRows = () => [
  { id: '1', client: 'Acme', amount: 100, status: 'draft' },
  { id: '2', client: 'Beta', amount: 250, status: 'sent' },
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
      rowHeaders: true,
      height: 400,
      ...props,
    }),
  )
}

function perspective(overrides: Partial<PerspectiveConfig> = {}): PerspectiveConfig {
  return {
    id: 'p1',
    name: 'View',
    columns: { visible: ['client', 'amount', 'status'], hidden: [] },
    filters: [],
    sorting: [],
    ...overrides,
  }
}

// jsdom reports every box as 0x0, so the row virtualiser mounts NOTHING and
// the grid renders headers with no cells. Give the layout a viewport-sized box
// for the whole file; anything that needs real pixel geometry belongs in a
// browser test, not here.
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

/** `Harness` holds hooks, so it must be MOUNTED, never called. */
const harness = (props: Record<string, unknown>) => React.createElement(Harness, props)

const footer = () => document.querySelector('[data-footer-totals]') as HTMLElement | null
const footerCell = (field: string) =>
  document.querySelector(`[data-footer-cell="${field}"]`) as HTMLElement | null

describe('DynamicTable — pinned totals row', () => {
  it('is not rendered at all when the view declares no aggregations', () => {
    render(harness({}))
    expect(footer()).toBeNull()
  })

  it('appears the moment the view aggregates a column, and says the number covers ONE PAGE', () => {
    render(harness({
        savedPerspectives: [
          perspective({ aggregations: [{ id: 'agg-amount', field: 'amount', fn: 'sum' }] }),
        ],
        activePerspectiveId: 'p1',
      }),
    )

    const el = footer()
    expect(el).not.toBeNull()
    // Unlabelled totals are the defect this row exists to end.
    expect(el!.getAttribute('data-footer-scope')).toBe('page')
    expect(footerCell('amount')!.textContent).toContain('350')
    // Columns with no rule stay blank rather than showing a meaningless 0.
    expect(footerCell('client')!.textContent).toBe('')
  })

  it('switches to the dataset figure — and says so — once the server aggregate lands', () => {
    render(harness({
        savedPerspectives: [
          perspective({ aggregations: [{ id: 'agg-amount', field: 'amount', fn: 'sum' }] }),
        ],
        activePerspectiveId: 'p1',
        aggregateResult: { scope: 'dataset', total: 812, values: { 'amount:sum': 91234 } },
      }),
    )

    expect(footer()!.getAttribute('data-footer-scope')).toBe('dataset')
    expect(footerCell('amount')!.textContent).toContain('91')
  })

  it('sits OUTSIDE the virtualised rows, so scrolling cannot take it away', () => {
    render(harness({
        savedPerspectives: [
          perspective({ aggregations: [{ id: 'agg-amount', field: 'amount', fn: 'sum' }] }),
        ],
        activePerspectiveId: 'p1',
      }),
    )
    expect(footer()!.closest('tbody')).toBeNull()
    expect(getComputedStyle(footer()!).position).toBe('sticky')
  })
})

describe('DynamicTable — conditional formatting reaches the cell', () => {
  it('paints a cell whose value matches a view rule', () => {
    render(harness({
        savedPerspectives: [
          perspective({
            conditionalFormats: [
              { id: 'cf-1', field: 'status', operator: 'eq', value: 'draft', style: 'yellow' },
            ],
          }),
        ],
        activePerspectiveId: 'p1',
      }),
    )

    const painted = document.querySelector('td[data-col="2"][data-row="0"]') as HTMLElement
    const notPainted = document.querySelector('td[data-col="2"][data-row="1"]') as HTMLElement
    expect(painted.className).toMatch(/yellow/)
    expect(notPainted.className).not.toMatch(/yellow/)
  })

  it('lets a module-declared cellClassName win over a user rule', () => {
    // The module knows something the user does not (an overdue invoice); a
    // view-scoped colour must not be able to hide it.
    const withClass: ColumnDef[] = [
      ...columns.slice(0, 2),
      { data: 'status', title: 'Status', cellClassName: () => 'module-owned' },
    ]
    render(harness({
        columns: withClass,
        savedPerspectives: [
          perspective({
            conditionalFormats: [
              { id: 'cf-1', field: 'status', operator: 'eq', value: 'draft', style: 'yellow' },
            ],
          }),
        ],
        activePerspectiveId: 'p1',
      }),
    )
    const cell = document.querySelector('td[data-col="2"][data-row="0"]') as HTMLElement
    expect(cell.className).toContain('module-owned')
    expect(cell.className).not.toMatch(/yellow/)
  })
})

describe('DynamicTable — calculated columns reach the grid', () => {
  it('renders a formula column the view declares, computed from the row', () => {
    render(harness({
        savedPerspectives: [
          perspective({
            columns: { visible: ['client', 'amount', 'status', 'formula__double'], hidden: [] },
            formulas: [
              {
                key: 'formula__double',
                label: 'Double',
                expression: 'amount * 2',
                resultType: 'number',
              },
            ],
          }),
        ],
        activePerspectiveId: 'p1',
      }),
    )

    const cells = Array.from(
      document.querySelectorAll('[data-formula-key="formula__double"]'),
    ).map((el) => el.textContent)
    expect(cells).toEqual(['200', '500'])
  })
})

describe('DynamicTable — paste', () => {
  function pasteInto(text: string) {
    const cell = document.querySelector('td[data-row="0"][data-col="0"]') as HTMLElement
    fireEvent.mouseDown(cell)
    const event: any = new Event('paste', { bubbles: true, cancelable: true })
    event.clipboardData = {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    }
    act(() => {
      cell.dispatchEvent(event)
    })
  }

  it('writes a copied TSV block starting at the selected cell', async () => {
    const onCellSave = jest.fn()
    render(harness({}))
    document.addEventListener('table:cell:edit:save', onCellSave as any)
    try {
      pasteInto('Gamma\t999')
      await waitFor(() => expect(onCellSave).toHaveBeenCalled())
      const saved = (onCellSave.mock.calls as any[]).map((c) => [
        c[0].detail.prop,
        c[0].detail.newValue,
      ])
      expect(saved).toEqual([
        ['client', 'Gamma'],
        ['amount', 999],
      ])
    } finally {
      document.removeEventListener('table:cell:edit:save', onCellSave as any)
    }
  })

  it('emits ONE batch event for the whole paste, alongside the per-cell ones', async () => {
    const onBatch = jest.fn()
    render(harness({}))
    document.addEventListener('table:cell:batch:save', onBatch as any)
    try {
      pasteInto('Gamma\t999')
      await waitFor(() => expect(onBatch).toHaveBeenCalledTimes(1))
      expect(onBatch.mock.calls[0][0].detail.origin).toBe('paste')
      expect(onBatch.mock.calls[0][0].detail.writes).toHaveLength(2)
    } finally {
      document.removeEventListener('table:cell:batch:save', onBatch as any)
    }
  })
})

/**
 * Spec 1 / E1 — cut and clear-contents.
 *
 * These reach for the SAME `applyCellWrites` batch the paste path uses, so what
 * is asserted here is that the gesture arrives at it: one batch event, the
 * right origin, and the whole selected rectangle in it.
 */
describe('DynamicTable — cut and clear contents', () => {
  const cellAt = (row: number, col: number) =>
    document.querySelector(`td[data-row="${row}"][data-col="${col}"]`) as HTMLElement

  /** Select (0,0) and extend one column right with Shift+ArrowRight. */
  function selectTwoCells() {
    const cell = cellAt(0, 0)
    fireEvent.mouseDown(cell)
    fireEvent.keyDown(cell, { key: 'ArrowRight', shiftKey: true })
    return cell
  }

  it('Shift+Arrow extends the selection, so Delete clears BOTH cells', async () => {
    const onBatch = jest.fn()
    render(harness({}))
    document.addEventListener('table:cell:batch:save', onBatch as any)
    try {
      let cell!: HTMLElement
      act(() => { cell = selectTwoCells() })
      // Two cells are highlighted — the extension happened, it did not move.
      expect(cellAt(0, 0).getAttribute('data-in-range')).toBe('true')
      expect(cellAt(0, 1).getAttribute('data-in-range')).toBe('true')

      act(() => { fireEvent.keyDown(cell, { key: 'Delete' }) })

      await waitFor(() => expect(onBatch).toHaveBeenCalledTimes(1))
      const detail = onBatch.mock.calls[0][0].detail
      expect(detail.origin).toBe('clear')
      expect(detail.writes.map((w: any) => [w.prop, w.newValue])).toEqual([
        ['client', null],
        ['amount', null],
      ])
    } finally {
      document.removeEventListener('table:cell:batch:save', onBatch as any)
    }
  })

  it('Backspace clears contents too, and never deletes the row', async () => {
    const onBulkDelete = jest.fn()
    const onBatch = jest.fn()
    render(harness({ onBulkDelete, selectable: true }))
    document.addEventListener('table:cell:batch:save', onBatch as any)
    try {
      const cell = cellAt(0, 0)
      fireEvent.mouseDown(cell)
      act(() => { fireEvent.keyDown(cell, { key: 'Backspace' }) })

      await waitFor(() => expect(onBatch).toHaveBeenCalledTimes(1))
      expect(onBatch.mock.calls[0][0].detail.origin).toBe('clear')
      expect(onBulkDelete).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('table:cell:batch:save', onBatch as any)
    }
  })

  it('cut puts the range on the clipboard AND clears it, in that order', async () => {
    const onBatch = jest.fn()
    render(harness({}))
    document.addEventListener('table:cell:batch:save', onBatch as any)
    try {
      const cell = selectTwoCells()
      const setData = jest.fn()
      const event: any = new Event('cut', { bubbles: true, cancelable: true })
      event.clipboardData = { setData, getData: () => '' }
      act(() => { cell.dispatchEvent(event) })

      // The clipboard is written from the PRE-clear values — a user who cuts,
      // panics and pastes back must get exactly what was there.
      expect(setData).toHaveBeenCalledWith('text/plain', 'Acme\t100')
      await waitFor(() => expect(onBatch).toHaveBeenCalledTimes(1))
      expect(onBatch.mock.calls[0][0].detail.origin).toBe('cut')
      expect(onBatch.mock.calls[0][0].detail.writes).toHaveLength(2)
    } finally {
      document.removeEventListener('table:cell:batch:save', onBatch as any)
    }
  })

  it('is a no-op with nothing selected — Backspace still bubbles', () => {
    const onBatch = jest.fn()
    render(harness({}))
    document.addEventListener('table:cell:batch:save', onBatch as any)
    try {
      const grid = document.querySelector('.hot-container') as HTMLElement
      act(() => { fireEvent.keyDown(grid, { key: 'Backspace' }) })
      expect(onBatch).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('table:cell:batch:save', onBatch as any)
    }
  })
})
