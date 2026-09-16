import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import BulkActionsBar from '../components/BulkActionsBar'

// The grouped-actions bar (Figma 546:12289) appears once more than one row is
// checkbox-selected. It carries the live count, a Delete action, and two ways to
// clear the selection (the leading checkbox and the trailing "Deselect all").

function renderBar(props: Partial<React.ComponentProps<typeof BulkActionsBar>> = {}) {
  const onDelete = props.onDelete ?? jest.fn()
  const onClear = props.onClear ?? jest.fn()
  const utils = render(
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(BulkActionsBar, {
        count: 3,
        onDelete,
        onClear,
        ...props,
      }),
    ),
  )
  return { ...utils, onDelete, onClear }
}

describe('BulkActionsBar (grouped actions)', () => {
  it('renders the selected-row count', () => {
    renderBar({ count: 5 })
    expect(screen.getByText(/5/)).toBeInTheDocument()
    expect(screen.getByText(/selected/i)).toBeInTheDocument()
  })

  it('exposes a toolbar role with an accessible label', () => {
    renderBar()
    expect(screen.getByRole('toolbar', { name: /bulk actions/i })).toBeInTheDocument()
  })

  it('fires onDelete when the Delete action is clicked', () => {
    const { onDelete } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('fires onClear from the trailing "Deselect all" button', () => {
    const { onClear } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: /deselect all/i }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('fires onClear when the leading (checked) checkbox is clicked', () => {
    const { onClear } = renderBar()
    const checkbox = screen.getByRole('checkbox', { name: /deselect all/i }) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('disables Delete and Deselect-all while a bulk operation is in flight', () => {
    renderBar({ busy: true })
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /deselect all/i })).toBeDisabled()
  })

  it('keeps Delete enabled when not busy', () => {
    renderBar({ busy: false })
    expect(screen.getByRole('button', { name: /delete/i })).toBeEnabled()
  })

  it('honours translated strings from the i18n dictionary', () => {
    render(
      React.createElement(
        I18nProvider as any,
        {
          locale: 'pl',
          dict: { 'dynamicTable.bulk.delete': 'Usuń', 'dynamicTable.bulk.selected': 'zaznaczone' },
        },
        React.createElement(BulkActionsBar, { count: 2, onDelete: jest.fn(), onClear: jest.fn() }),
      ),
    )
    expect(screen.getByRole('button', { name: 'Usuń' })).toBeInTheDocument()
    expect(screen.getByText(/zaznaczone/)).toBeInTheDocument()
  })
})

describe('BulkActionsBar — export action', () => {
  it('shows the Export action only when onExport is provided', () => {
    const { rerender } = render(
      React.createElement(
        I18nProvider as any,
        { locale: 'en', dict: {} },
        React.createElement(BulkActionsBar, { count: 2, onCopy: jest.fn(), onClear: jest.fn() }),
      ),
    )
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument()

    rerender(
      React.createElement(
        I18nProvider as any,
        { locale: 'en', dict: {} },
        React.createElement(BulkActionsBar, {
          count: 2,
          onCopy: jest.fn(),
          onClear: jest.fn(),
          onExport: jest.fn(),
        }),
      ),
    )
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
  })

  it('calls onExport with the chosen format from the grouped-actions bar', () => {
    const onExport = jest.fn()
    render(
      React.createElement(
        I18nProvider as any,
        { locale: 'en', dict: {} },
        React.createElement(BulkActionsBar, { count: 2, onCopy: jest.fn(), onClear: jest.fn(), onExport }),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByText(/export to csv/i))
    expect(onExport).toHaveBeenCalledWith('csv')
  })

  it('disables the Export trigger while a bulk operation is in flight', () => {
    render(
      React.createElement(
        I18nProvider as any,
        { locale: 'en', dict: {} },
        React.createElement(BulkActionsBar, {
          count: 2,
          busy: true,
          onCopy: jest.fn(),
          onClear: jest.fn(),
          onExport: jest.fn(),
        }),
      ),
    )
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled()
  })
})
