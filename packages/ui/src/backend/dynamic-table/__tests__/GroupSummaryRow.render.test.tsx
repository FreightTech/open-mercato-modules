import * as React from 'react'
import { render } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import GroupSummaryRow from '../components/GroupSummaryRow'
import { CellStoreContext } from '../hooks/index'
import { createCellStore } from '../store/index'
import type { ColumnDef } from '../types/index'
import type { AggregationRule, GroupSummaryVisualRow } from '../types/grouping'

/**
 * The subtotal renderer went stale when `AggregationFn` widened: it formatted
 * every value with SUM semantics and coalesced null to 0. A `count` of 3 read
 * as "3,00" and a MIN over nothing read as "0,00" — the data was right, only
 * the renderer lied.
 */

const columns: ColumnDef[] = [
  { data: 'client', title: 'Client' },
  { data: 'amount', title: 'Amount', type: 'numeric' },
  { data: 'eta', title: 'ETA', type: 'date' },
]

function renderRow(
  visualRow: GroupSummaryVisualRow,
  aggregations: AggregationRule[],
) {
  const store = createCellStore([], columns)
  render(
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(
        CellStoreContext.Provider as any,
        { value: store },
        React.createElement(
          'table',
          null,
          React.createElement(
            'tbody',
            null,
            React.createElement(GroupSummaryRow as any, {
              visualRow,
              virtualItem: { index: 0, start: 0, size: 32, end: 32, key: 0, lane: 0 },
              columns,
              rowHeaders: false,
              leftOffsets: [],
              rightOffsets: [],
              actionsColumnWidth: 80,
              totalWidth: 600,
              aggregations,
              label: 'Sum',
              locale: 'pl-PL',
              storeRevision: 0,
            }),
          ),
        ),
      ),
    ),
  )
}

const cell = (field: string) =>
  document.querySelector(`[data-group-summary-cell="${field}"]`) as HTMLElement

function summaryRow(overrides: Partial<GroupSummaryVisualRow> = {}): GroupSummaryVisualRow {
  return {
    type: 'groupSummary',
    groupKey: 'client:Acme',
    depth: 0,
    values: {},
    fns: {},
    scope: 'dataset',
    rowsCovered: 3,
    ...overrides,
  }
}

describe('GroupSummaryRow', () => {
  it('renders a count as a whole number, not as money', () => {
    renderRow(
      summaryRow({ values: { amount: 3 }, fns: { amount: 'count' } }),
      [{ id: 'agg-amount', field: 'amount', fn: 'count' }],
    )
    expect(cell('amount').textContent).toBe('3')
  })

  it('renders "nothing to average" as an em dash, never as 0,00', () => {
    renderRow(
      summaryRow({ values: { amount: null }, fns: { amount: 'avg' } }),
      [{ id: 'agg-amount', field: 'amount', fn: 'avg' }],
    )
    expect(cell('amount').textContent).toBe('—')
  })

  it('renders MIN on a date column as a date, not a 13-digit number', () => {
    const t = Date.UTC(2026, 2, 4)
    renderRow(
      summaryRow({ values: { eta: t }, fns: { eta: 'min' } }),
      [{ id: 'agg-eta', field: 'eta', fn: 'min' }],
    )
    expect(cell('eta').textContent).toMatch(/2026/)
    expect(cell('eta').textContent).not.toMatch(/\d{10}/)
  })

  it('says so when the subtotal covers only the loaded page', () => {
    renderRow(
      summaryRow({ scope: 'page', values: { amount: 350 }, fns: { amount: 'sum' } }),
      [{ id: 'agg-amount', field: 'amount', fn: 'sum' }],
    )
    const row = document.querySelector('[data-group-summary]') as HTMLElement
    expect(row.getAttribute('data-group-scope')).toBe('page')
    expect(row.getAttribute('data-group-rows-covered')).toBe('3')
    expect(document.querySelector('[data-group-scope-label]')!.textContent).toContain('page')
  })

  it('adds no caveat when the subtotal really is the whole group', () => {
    renderRow(
      summaryRow({ values: { amount: 350 }, fns: { amount: 'sum' } }),
      [{ id: 'agg-amount', field: 'amount', fn: 'sum' }],
    )
    expect(document.querySelector('[data-group-scope-label]')).toBeNull()
  })

  it('leaves un-aggregated columns blank', () => {
    renderRow(
      summaryRow({ values: { amount: 350 }, fns: { amount: 'sum' } }),
      [{ id: 'agg-amount', field: 'amount', fn: 'sum' }],
    )
    expect(cell('client').textContent).toBe('')
  })
})
