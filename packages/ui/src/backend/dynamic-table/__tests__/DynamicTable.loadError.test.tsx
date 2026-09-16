import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import type { ColumnDef } from '../types/index'

/**
 * HEDGE-119 — the WIRING, which is where the defect actually lived.
 *
 * `LoadErrorState` existing is not the fix; the fix is that the zero-row branch
 * consults something other than the row count. Both situations arrive at that
 * branch as `data: []`:
 *
 *   - the server said "zero rows"      → EmptyState, correctly
 *   - the request failed               → LoadErrorState
 *
 * Before this, `rowCount === 0` was the ONLY condition and the second case got
 * the first case's UI — an Inbox icon and "Nothing here yet" — which is how a
 * 500 on `/api/invoicing/invoices` reached an accountant as "no invoices".
 *
 * So the pair of tests below is the point: same empty `data`, two different
 * screens, decided by `loadError`.
 */

const columns: ColumnDef[] = [
  { data: 'invoiceNumber', title: 'Invoice' },
  { data: 'grossAmount', title: 'Gross', type: 'numeric' },
]

function renderTable(props: Record<string, unknown> = {}) {
  function Harness() {
    const tableRef = React.useRef<HTMLDivElement | null>(null)
    return React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(DynamicTable as any, {
        data: [],
        columns,
        tableRef,
        tableName: 'Invoices',
        height: 400,
        ...props,
      }),
    )
  }
  return render(React.createElement(Harness))
}

describe('DynamicTable — failed load vs empty table (HEDGE-119)', () => {
  it('renders the EMPTY state when the server truthfully returned zero rows', () => {
    renderTable({ loadError: false })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/could not load/i)).not.toBeInTheDocument()
  })

  it('renders the ERROR state when the list request failed, on identical empty data', () => {
    renderTable({ loadError: true })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/could not load/i)).toBeInTheDocument()
    // The regression, stated literally: this must not say the table is empty.
    expect(screen.queryByText(/nothing here yet/i)).not.toBeInTheDocument()
  })

  it('names the failing table so the user knows WHAT did not load', () => {
    renderTable({ loadError: true, tableName: 'Invoices' })
    // Scoped to the alert: "Invoices" also appears in the toolbar heading.
    expect(screen.getByText(/Could not load Invoices/i)).toBeInTheDocument()
  })

  it('does not blame the search box for a server failure', () => {
    // A search is live AND the request failed. Attributing the empty grid to
    // the search would send the user to clear a filter that is not the cause.
    renderTable({ loadError: true, searchQuery: 'FV/2026' })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(/Nothing matches/i)).not.toBeInTheDocument()
  })

  it('still shows the search diagnosis when the request SUCCEEDED and matched nothing', () => {
    // The counterpart: fixing the error case must not break the case that
    // EmptyState already got right.
    renderTable({ loadError: false, searchQuery: 'FV/2026' })
    expect(screen.getByText(/Nothing matches/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('defaults to the empty state when a host passes no error flag at all', () => {
    // All 24 existing `useDynamicTablePage` hosts pass nothing; none may change
    // behaviour because this prop was added.
    renderTable()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

/**
 * HEDGE-165 — the half HEDGE-119 left open: a failed load that STILL HAS ROWS.
 *
 * Every case above renders `data: []`, which is exactly why the gap survived
 * review: `LoadErrorState` is gated on `rowCount === 0`, so `loadError === true`
 * with rows on screen rendered nothing at all and no test noticed.
 *
 * That is the durable case, not the rare one. `placeholderData` in
 * `useDynamicTablePage` deliberately keeps the previous response's rows, and
 * TanStack keeps `data` when a query that already holds data transitions to
 * `error` — so a failed post-save invalidation, a failed refetch-on-focus, or a
 * failed search inside its retry window all land here: correct-looking rows
 * answering a request that never succeeded.
 *
 * The rows must stay. Only the signal is asserted below.
 */
const rows = [
  { invoiceNumber: 'FV/2026/01', grossAmount: 1230 },
  { invoiceNumber: 'FV/2026/02', grossAmount: 4560 },
]

/**
 * How many rows the grid is HOLDING, not how many cells jsdom painted.
 *
 * The row virtualiser measures a scroller that has no layout in jsdom, so it
 * mounts a window of zero and the tbody comes out empty however many rows were
 * passed. `data-dt-rows` is the density guardrail the perf harness reads — it
 * is `data.length` by construction and never the mounted subset — which makes
 * it the only honest way to assert "the rows are still there" in this
 * environment. Asserting on cell text here would fail for reasons that have
 * nothing to do with this defect.
 */
function heldRowCount(): string | null {
  return document.querySelector('[data-dt-rows]')?.getAttribute('data-dt-rows') ?? null
}

describe('DynamicTable — failed load with rows still on screen (HEDGE-165)', () => {
  it('warns that the visible rows are the PREVIOUS result when a refetch failed', () => {
    renderTable({ loadError: true, data: rows })
    const bar = document.querySelector('[data-stale-data]')
    expect(bar).not.toBeNull()
    expect(bar).toHaveTextContent(/previous result/i)
    // The rows are the point of keeping them — the bar must not replace them.
    expect(heldRowCount()).toBe('2')
    // Neither zero-row state applies: there are rows.
    expect(screen.queryByText(/could not load/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/nothing here yet/i)).not.toBeInTheDocument()
  })

  it('names the table so the user knows WHICH list is stale', () => {
    renderTable({ loadError: true, data: rows, tableName: 'Invoices' })
    expect(document.querySelector('[data-stale-data]')).toHaveTextContent(/Could not refresh Invoices/i)
  })

  it('retry on the bar re-runs the list request', () => {
    const onRetryLoad = jest.fn()
    renderTable({ loadError: true, data: rows, onRetryLoad })
    const retry = document.querySelector('[data-stale-data-retry]') as HTMLElement | null
    expect(retry).not.toBeNull()
    fireEvent.click(retry!)
    expect(onRetryLoad).toHaveBeenCalledTimes(1)
  })

  it('shows nothing extra when the load SUCCEEDED and returned rows', () => {
    // The healthy path is every list in the app; it must not gain a band.
    renderTable({ loadError: false, data: rows })
    expect(document.querySelector('[data-stale-data]')).toBeNull()
    expect(heldRowCount()).toBe('2')
  })

  it('leaves the zero-row error state alone — the bar is not a replacement for it', () => {
    // HEDGE-119's branch stays exactly as it was: with no rows to caveat, the
    // full-height explanation is the right screen, not a one-line band.
    renderTable({ loadError: true, data: [] })
    expect(document.querySelector('[data-stale-data]')).toBeNull()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
