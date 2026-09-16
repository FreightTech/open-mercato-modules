import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import FooterTotalsRow from '../components/FooterTotalsRow'
import type { ColumnDef } from '../types/index'
import type { AggregationRule, AggregateResult } from '../types/grouping'

const columns: ColumnDef[] = [
  { data: 'invoice', title: 'Invoice' },
  { data: 'grossAmount', title: 'Gross', type: 'numeric' },
  { data: 'client', title: 'Client' },
]

const aggregations: AggregationRule[] = [
  { id: 'agg-grossAmount', field: 'grossAmount', fn: 'sum' },
  { id: 'agg-client', field: 'client', fn: 'countDistinct' },
]

function renderFooter(props: Partial<React.ComponentProps<typeof FooterTotalsRow>> = {}) {
  return render(
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(FooterTotalsRow, {
        columns,
        aggregations,
        getColumnWidth: () => 120,
        locale: 'en-US',
        ...props,
      }),
    ),
  )
}

const cell = (field: string) => document.querySelector(`[data-footer-cell="${field}"]`)!

describe('FooterTotalsRow', () => {
  it('renders one cell per column and a value only for aggregated columns', () => {
    renderFooter({ pageValues: { grossAmount: 1500, client: 3 }, pageRowCount: 50 })
    expect(cell('grossAmount').textContent).toBe('1,500.00')
    expect(cell('client').textContent).toBe('3')
    expect(cell('invoice').textContent).toBe('')
  })

  it('formats each column with ITS OWN function — a count is not given decimals', () => {
    renderFooter({ pageValues: { grossAmount: 1500, client: 3 } })
    expect(cell('client').textContent).toBe('3')
  })
})

describe('FooterTotalsRow — scope labelling (the honesty contract)', () => {
  // An unlabelled total is the defect. These assertions are the guard.
  it('labels a dataset total with the matching row count', () => {
    const result: AggregateResult = {
      scope: 'dataset',
      total: 1240,
      values: { 'grossAmount:sum': 18400, 'client:countDistinct': 12 },
    }
    renderFooter({ result })
    const row = document.querySelector('[data-footer-totals]')!
    expect(row.getAttribute('data-footer-scope')).toBe('dataset')
    expect(screen.getByText(/All 1240 matching rows/)).toBeTruthy()
  })

  it('falls back to page scope, and SAYS so, before the dataset figure lands', () => {
    renderFooter({ pageValues: { grossAmount: 900 }, pageRowCount: 50, result: null })
    const row = document.querySelector('[data-footer-totals]')!
    expect(row.getAttribute('data-footer-scope')).toBe('page')
    expect(screen.getByText(/This page only \(50 rows\)/)).toBeTruthy()
  })

  it('reads the server values by field:fn, not by field', () => {
    const result: AggregateResult = {
      scope: 'dataset',
      total: 2,
      values: { 'grossAmount:sum': 18400, 'client:countDistinct': 12 },
    }
    renderFooter({ result })
    expect(cell('grossAmount').textContent).toBe('18,400.00')
    expect(cell('client').textContent).toBe('12')
  })

  it('coerces the STRING values that actually come off the wire', () => {
    const result = {
      scope: 'dataset',
      total: '1240',
      values: { 'grossAmount:sum': '18400.0000', 'client:countDistinct': '12' },
    } as unknown as AggregateResult
    renderFooter({ result })
    expect(cell('grossAmount').textContent).toBe('18,400.00')
    expect(cell('grossAmount').textContent).not.toBe('0.00')
  })
})

describe('FooterTotalsRow — loading and failure', () => {
  it('says it is calculating rather than showing a stale zero', () => {
    renderFooter({ loading: true, result: null })
    expect(document.querySelector('[data-footer-totals]')!.getAttribute('data-footer-state')).toBe(
      'loading',
    )
    expect(screen.getByText(/Calculating/)).toBeTruthy()
  })

  it('shows a failure message and NO numbers when the aggregate request failed', () => {
    renderFooter({ error: true, pageValues: { grossAmount: 1500 } })
    expect(screen.getByText(/Could not calculate totals/)).toBeTruthy()
    expect(cell('grossAmount').textContent).toBe('')
  })
})

/**
 * Ledger 3.3 — the label used to be a zero-width box that overflowed rightwards
 * over "the leading (blank) columns", with nothing checking that they were
 * blank. On a view whose FIRST column carries an aggregate it painted straight
 * over that column's number: measured in a browser as a width:0 label cell at
 * x=295 sitting on a 132px value cell at x=295, rendering "19 TOTAL THIS PAGE
 * ONLY (19 ROWS)" — a number with its own caption stacked on top of it.
 */
describe('FooterTotalsRow — the label can never cover a value (3.3)', () => {
  it('clamps the label to the blank lead it is allowed to overflow into', () => {
    // `invoice` (col 0) has no rule; `grossAmount` (col 1) does. Lead = 1 column.
    renderFooter({ pageValues: { grossAmount: 1500, client: 3 } })
    const row = document.querySelector('[data-footer-totals]')!
    expect(row.getAttribute('data-footer-layout')).toBe('inline')
    const clip = document.querySelector('.hot-footer-totals-label-clip') as HTMLElement
    // getColumnWidth is stubbed at 120 per column, and only column 0 is blank.
    expect(clip.style.maxWidth).toBe('120px')
  })

  it('widens the clamp when more leading columns are blank', () => {
    renderFooter({
      aggregations: [{ id: 'a', field: 'client', fn: 'countDistinct' }],
      pageValues: { client: 3 },
    })
    const clip = document.querySelector('.hot-footer-totals-label-clip') as HTMLElement
    expect(clip.style.maxWidth).toBe('240px') // invoice + grossAmount
  })

  it('gives the label its own line when the FIRST column is aggregated', () => {
    renderFooter({
      aggregations: [{ id: 'a', field: 'invoice', fn: 'count' }],
      pageValues: { invoice: 19 },
      pageRowCount: 19,
    })
    const row = document.querySelector('[data-footer-totals]')!
    expect(row.getAttribute('data-footer-layout')).toBe('stacked')
    // No overflowing label cell at all — nothing to collide with.
    expect(document.querySelector('.hot-footer-totals-label-cell')).toBeNull()
    expect(document.querySelector('.hot-footer-totals-caption')).toBeTruthy()
    // The scope statement is NOT dropped in the process; it is the whole point.
    expect(screen.getByText(/This page only/)).toBeTruthy()
    expect(cell('invoice').textContent).toBe('19')
  })
})
