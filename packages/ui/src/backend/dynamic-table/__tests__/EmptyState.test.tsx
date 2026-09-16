import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import EmptyState from '../components/EmptyState'

/**
 * Ledger 2.20 — a search that matches nothing used to leave the header row and
 * several hundred pixels of void: no message, no icon, and no way back except
 * remembering the toolbar search box still had text in it.
 *
 * What these tests pin is the DIAGNOSIS, not the decoration: the state must say
 * which of the three reasons emptied the table, and offer the undo for that
 * reason and no other.
 */

function renderEmpty(props: Partial<React.ComponentProps<typeof EmptyState>> = {}) {
  return render(
    <I18nProvider locale="en" dict={{}}>
      <EmptyState filterCount={0} {...props} />
    </I18nProvider>,
  )
}

it('names the search term and offers only "Clear search"', () => {
  const onClearSearch = jest.fn()
  renderEmpty({ searchQuery: 'MSKU123', onClearSearch, onClearFilters: jest.fn() })

  expect(screen.getByText(/MSKU123/)).toBeInTheDocument()
  expect(screen.queryByText('Clear filters')).not.toBeInTheDocument()

  fireEvent.click(screen.getByText('Clear search'))
  expect(onClearSearch).toHaveBeenCalled()
})

it('counts the filter rules and offers only "Clear filters"', () => {
  const onClearFilters = jest.fn()
  renderEmpty({ filterCount: 3, onClearSearch: jest.fn(), onClearFilters })

  expect(screen.getByText(/3 filter rule/)).toBeInTheDocument()
  expect(screen.queryByText('Clear search')).not.toBeInTheDocument()

  fireEvent.click(screen.getByText('Clear filters'))
  expect(onClearFilters).toHaveBeenCalled()
})

it('offers both undos when a search sits on top of filters', () => {
  renderEmpty({
    searchQuery: 'abc',
    filterCount: 1,
    onClearSearch: jest.fn(),
    onClearFilters: jest.fn(),
  })

  expect(screen.getByText('Clear search')).toBeInTheDocument()
  expect(screen.getByText('Clear filters')).toBeInTheDocument()
})

it('a genuinely empty table shows the host message and NO undo', () => {
  renderEmpty({ emptyMessage: 'No addresses', onClearSearch: jest.fn(), onClearFilters: jest.fn() })

  expect(screen.getByText('No addresses')).toBeInTheDocument()
  expect(screen.queryByText('Clear search')).not.toBeInTheDocument()
  expect(screen.queryByText('Clear filters')).not.toBeInTheDocument()
})

it('whitespace is not a search', () => {
  renderEmpty({ searchQuery: '   ', emptyMessage: 'No rows', onClearSearch: jest.fn() })
  expect(screen.getByText('No rows')).toBeInTheDocument()
  expect(screen.queryByText('Clear search')).not.toBeInTheDocument()
})
