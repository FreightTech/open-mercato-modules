import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import LoadErrorState from '../components/LoadErrorState'
import EmptyState from '../components/EmptyState'

// HEDGE-119 — the failed-load state.
//
// The defect this guards: a list request that 500s and a list that genuinely
// holds zero rows both reach the grid as `data: []`, and before this component
// existed both rendered `EmptyState`. On fto-test that put the words "Nothing
// here yet" in front of an accountant while 17 unpaid invoices sat in the
// database behind an `InvalidFieldNameException`.
//
// So the assertions below are not really about wording. They are about the two
// states being DISTINGUISHABLE — different role, different text, different
// affordance — because the failure mode was that they were not.

function renderWith(node: React.ReactElement) {
  return render(
    React.createElement(I18nProvider as any, { locale: 'en', dict: {} }, node),
  )
}

describe('LoadErrorState (HEDGE-119)', () => {
  it('says the rows could not be LOADED, not that there are none', () => {
    renderWith(React.createElement(LoadErrorState, { tableName: 'Invoices' }))
    expect(screen.getByText(/could not load/i)).toBeInTheDocument()
    // The exact phrase the empty state uses must not appear here.
    expect(screen.queryByText(/nothing here yet/i)).not.toBeInTheDocument()
  })

  it('states outright that the table is not known to be empty', () => {
    renderWith(React.createElement(LoadErrorState, {}))
    // The whole point: an accountant must not read this as "no work to do".
    expect(screen.getByText(/does NOT mean the table is empty/i)).toBeInTheDocument()
  })

  it('names the table when the host supplies one', () => {
    renderWith(React.createElement(LoadErrorState, { tableName: 'Invoices' }))
    expect(screen.getByText(/Invoices/)).toBeInTheDocument()
  })

  it('announces as an alert, where the empty state announces as status', () => {
    // A screen-reader user gets the same distinction a sighted user does.
    const { unmount } = renderWith(React.createElement(LoadErrorState, {}))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    unmount()

    renderWith(React.createElement(EmptyState, { filterCount: 0 }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('offers retry, and fires it', () => {
    const onRetry = jest.fn()
    renderWith(React.createElement(LoadErrorState, { onRetry }))
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('omits the retry button when the host cannot refetch', () => {
    renderWith(React.createElement(LoadErrorState, {}))
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })

  it('never offers "clear search" / "clear filters" — the rows are not filtered away', () => {
    // Offering an undo for something that did not cause the emptiness is the
    // misdiagnosis this component exists to prevent.
    renderWith(React.createElement(LoadErrorState, { onRetry: jest.fn() }))
    expect(screen.queryByRole('button', { name: /clear search/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument()
  })
})
