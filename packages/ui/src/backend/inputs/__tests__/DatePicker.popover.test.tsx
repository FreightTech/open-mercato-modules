/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { DatePicker } from '../DatePicker'
import { pickCalendarSide } from '../useCalendarPopover'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

// A value far from today, so "opens on today's month" can never pass by accident.
// February 2031 starts on a Saturday: five weeks in a Sunday-first grid.
const VALUE = new Date(2031, 1, 18)

const weeks = () => document.querySelectorAll('[role="dialog"] tbody tr').length
const caption = () => screen.getByRole('status').textContent
const trigger = () => screen.getByRole('button', { name: /2031|Pick a date/ })

function Harness({ initial }: { initial: Date | null }) {
  const [value, setValue] = React.useState<Date | null>(initial)
  return <DatePicker value={value} onChange={setValue} />
}

describe('DatePicker — the calendar popover', () => {
  it('opens on the month of the selected value', () => {
    render(<Harness initial={VALUE} />)
    fireEvent.click(trigger())
    expect(caption()).toBe('February 2031')
  })

  it('opens on the value month again after the user navigated away', () => {
    render(<Harness initial={VALUE} />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: 'Go to the Next Month' }))
    expect(caption()).toBe('March 2031')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(trigger())
    expect(caption()).toBe('February 2031')
  })

  it('always shows six weeks, whatever the month', () => {
    render(<Harness initial={VALUE} />)
    fireEvent.click(trigger())
    expect(weeks()).toBe(6)
    fireEvent.click(screen.getByRole('button', { name: 'Go to the Next Month' }))
    expect(weeks()).toBe(6)
  })
})

describe('pickCalendarSide', () => {
  it('opens below when the calendar fits there', () => {
    expect(pickCalendarSide({ top: 100, bottom: 136 }, 400, 800)).toBe('bottom')
  })

  it('opens above when it does not fit below and there is more room above', () => {
    expect(pickCalendarSide({ top: 500, bottom: 536 }, 400, 800)).toBe('top')
  })

  it('opens on the roomier side when it fits on neither', () => {
    expect(pickCalendarSide({ top: 200, bottom: 236 }, 500, 600)).toBe('bottom')
    expect(pickCalendarSide({ top: 380, bottom: 416 }, 500, 600)).toBe('top')
  })
})
