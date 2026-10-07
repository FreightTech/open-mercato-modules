/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Calendar } from '../calendar'

// A calendar whose height follows the month resizes its popover on every month
// switch: the popover flipped across its field and the ‹ › arrows moved away from
// the cursor. February 2026 starts on a Sunday and has 28 days — four weeks in a
// Sunday-first grid, the shortest a month gets.
const weeks = (container: HTMLElement) => container.querySelectorAll('tbody tr').length

describe('Calendar — six fixed weeks', () => {
  it('renders six weeks for a four-week month', () => {
    const { container } = render(<Calendar mode="single" defaultMonth={new Date(2026, 1, 1)} />)
    expect(screen.getByRole('status')).toHaveTextContent('February 2026')
    expect(weeks(container)).toBe(6)
  })

  it('keeps six weeks on every month switch', () => {
    const { container } = render(<Calendar mode="single" defaultMonth={new Date(2026, 1, 1)} />)
    for (const caption of ['March 2026', 'April 2026', 'May 2026']) {
      fireEvent.click(screen.getByRole('button', { name: 'Go to the Next Month' }))
      expect(screen.getByRole('status')).toHaveTextContent(caption)
      expect(weeks(container)).toBe(6)
    }
  })

  it('still lets a caller opt out', () => {
    const { container } = render(<Calendar mode="single" defaultMonth={new Date(2026, 1, 1)} fixedWeeks={false} />)
    expect(weeks(container)).toBe(4)
  })
})
