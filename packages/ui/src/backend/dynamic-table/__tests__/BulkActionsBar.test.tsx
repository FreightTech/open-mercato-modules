import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import BulkActionsBar from '../components/BulkActionsBar'

// The grouped-actions bar appears while rows are checkbox-selected on a table
// that defines an action. It carries the live count, the leading checkbox that
// clears the selection, and only the actions the table defines — no built-in
// Copy / Export (GT, 2026-10-08).

function renderBar(props: Partial<React.ComponentProps<typeof BulkActionsBar>> = {}) {
  // `onDelete: undefined` must mean "no Delete action", not "use the default".
  const onDelete = 'onDelete' in props ? props.onDelete : jest.fn()
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

  it('fires onClear when the leading (checked) checkbox is clicked', () => {
    const { onClear } = renderBar()
    const checkbox = screen.getByRole('checkbox', { name: /deselect all/i }) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('disables Delete and the clearing checkbox while a bulk operation is in flight', () => {
    renderBar({ busy: true })
    expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /deselect all/i })).toBeDisabled()
  })

  it('has no built-in Copy, Export or trailing Deselect-all button', () => {
    renderBar()
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /deselect all/i })).not.toBeInTheDocument()
  })

  it('renders only the actions the table defines, and passes them the selected ids', () => {
    const onClick = jest.fn()
    renderBar({
      onDelete: undefined,
      actions: [{ id: 'assign', label: 'Assign', onClick }],
      selectedIds: ['a', 'b'],
    })
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }))
    expect(onClick).toHaveBeenCalledWith(['a', 'b'])
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
