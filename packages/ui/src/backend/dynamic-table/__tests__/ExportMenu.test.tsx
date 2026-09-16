/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import ExportMenu from '../components/ExportMenu'

// ExportMenu is the trigger + CSV/Excel popover shared by the toolbar (whole
// table) and the grouped-actions bar (selected rows). It is presentation only —
// the scope difference lives in the two onExport handlers, not here.

function renderMenu(props: Partial<React.ComponentProps<typeof ExportMenu>> = {}) {
  const onExport = props.onExport ?? jest.fn()
  const utils = render(
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(ExportMenu, { onExport, ...props }),
    ),
  )
  return { ...utils, onExport }
}

describe('ExportMenu', () => {
  it('renders an icon-only trigger labelled "Export" in the toolbar variant', () => {
    renderMenu({ variant: 'toolbar' })
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
  })

  it('renders a labelled trigger in the bulk variant', () => {
    renderMenu({ variant: 'bulk' })
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
  })

  it('does not show the format options until the trigger is clicked', () => {
    renderMenu()
    expect(screen.queryByText(/export to csv/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/export to excel/i)).not.toBeInTheDocument()
  })

  it('reveals CSV and Excel options once opened', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(screen.getByText(/export to csv/i)).toBeInTheDocument()
    expect(screen.getByText(/export to excel/i)).toBeInTheDocument()
  })

  it('calls onExport("csv") when the CSV option is chosen', () => {
    const { onExport } = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByText(/export to csv/i))
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledWith('csv')
  })

  it('calls onExport("xlsx") when the Excel option is chosen', () => {
    const { onExport } = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByText(/export to excel/i))
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledWith('xlsx')
  })

  it('disables the trigger when disabled is set', () => {
    renderMenu({ disabled: true })
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled()
  })

  it('honours translated strings from the i18n dictionary', () => {
    render(
      React.createElement(
        I18nProvider as any,
        { locale: 'pl', dict: { 'dynamicTable.export.csv': 'Eksportuj do CSV' } },
        React.createElement(ExportMenu, { onExport: jest.fn() }),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(screen.getByText('Eksportuj do CSV')).toBeInTheDocument()
  })
})
