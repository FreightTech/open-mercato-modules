/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DateEditor, DateTimeEditor } from '../components/editors'

// The inline date editor speaks the app's language, as the form DatePicker does:
// it showed "October 2026", Su-first weekdays, Clear / Today and YYYY-MM-DD in a
// Polish UI. It reuses the picker's i18n keys.
const PL = {
  'ui.datePicker.clearButton': 'Wyczyść',
  'ui.datePicker.todayButton': 'Dzisiaj',
  'ui.dateTimePicker.clearButton': 'Wyczyść',
  'ui.dateTimePicker.timeLabel': 'Czas',
}

const noop = () => {}
const weekdays = () => Array.from(document.querySelectorAll('thead th')).map((th) => th.getAttribute('aria-label'))

function renderEditor(locale: string, dict: Record<string, string>, Editor = DateEditor, value = '2026-12-18') {
  return render(
    <I18nProvider locale={locale} dict={dict}>
      <Editor value={value} onChange={noop} onSave={noop} onCancel={noop} col={{}} />
    </I18nProvider>,
  )
}

describe('DateEditor — app locale', () => {
  it('pl: Polish month, Monday first, Wyczyść / Dzisiaj, RRRR-MM-DD', () => {
    renderEditor('pl', PL)
    expect(screen.getByRole('status')).toHaveTextContent('grudzień 2026')
    expect(weekdays()[0]).toBe('poniedziałek')
    expect(weekdays()[6]).toBe('niedziela')
    expect(screen.getByRole('button', { name: 'Wyczyść' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dzisiaj' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'RRRR-MM-DD')
  })

  it('pl-PL resolves to Polish too', () => {
    renderEditor('pl-PL', PL)
    expect(weekdays()[0]).toBe('poniedziałek')
  })

  it('en: English, Sunday first, Clear / Today, YYYY-MM-DD', () => {
    renderEditor('en', {})
    expect(screen.getByRole('status')).toHaveTextContent('December 2026')
    expect(weekdays()[0]).toBe('Sunday')
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'YYYY-MM-DD')
  })

  it('shows six weeks', () => {
    renderEditor('pl', PL)
    expect(document.querySelectorAll('tbody tr')).toHaveLength(6)
  })
})

describe('DateTimeEditor — app locale', () => {
  it('pl: Polish month, Monday first, Czas, Wyczyść', () => {
    renderEditor('pl', PL, DateTimeEditor, '2026-12-18 09:30')
    expect(screen.getByRole('status')).toHaveTextContent('grudzień 2026')
    expect(weekdays()[0]).toBe('poniedziałek')
    expect(screen.getByText('Czas:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Wyczyść' })).toBeInTheDocument()
    expect(document.querySelector('textarea')).toHaveAttribute('placeholder', 'RRRR-MM-DD HH:mm')
  })
})
