import * as React from 'react'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { FlashMessages, flash } from '../FlashMessages'

describe('FlashMessages', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    window.history.replaceState({}, '', 'http://localhost/backend')
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    window.history.replaceState({}, '', 'http://localhost/backend')
  })

  it('auto-dismisses URL-based flashes after stripping query params', () => {
    window.history.replaceState({}, '', 'http://localhost/backend/checkout/pay-links?flash=Saved&type=success')

    renderWithProviders(<FlashMessages />)

    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(window.location.search).toBe('')

    act(() => {
      jest.advanceTimersByTime(3000)
    })

    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('auto-dismisses programmatic flashes', () => {
    renderWithProviders(<FlashMessages />)

    act(() => {
      flash('Pay link published', 'success')
    })

    expect(screen.getByText('Pay link published')).toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(3000)
    })

    expect(screen.queryByText('Pay link published')).not.toBeInTheDocument()
  })

  // HEDGE-173: a failed save is the one case where the flash is the only thing telling the
  // user their work was NOT persisted. CrudForm's persistent formError renders directly above
  // FormFooter — i.e. at the bottom of the form — while Save sits in the header, so on a long
  // form (Edit Role's ACL grid) it is below the fold. If the toast also expires, the screen
  // ends up indistinguishable from a successful save. Measured in
  // .ai/qa/hedge-173/02-measurement-where-the-message-renders.md
  it('keeps error flashes on screen until dismissed', () => {
    renderWithProviders(<FlashMessages />)

    act(() => {
      flash('Cannot grant feature rfq_board.view.', 'error')
    })

    expect(screen.getByText('Cannot grant feature rfq_board.view.')).toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(60_000)
    })

    expect(screen.getByText('Cannot grant feature rfq_board.view.')).toBeInTheDocument()
  })

  it('lets the user dismiss a persistent error flash', () => {
    renderWithProviders(<FlashMessages />)

    act(() => {
      flash('Cannot grant feature rfq_board.view.', 'error')
    })

    act(() => {
      screen.getByRole('button', { name: 'Dismiss' }).click()
    })

    expect(screen.queryByText('Cannot grant feature rfq_board.view.')).not.toBeInTheDocument()
  })

  it('announces errors assertively and non-errors politely', () => {
    const { rerender } = renderWithProviders(<FlashMessages />)

    act(() => {
      flash('Cannot grant feature rfq_board.view.', 'error')
    })

    const errorAlert = screen.getByRole('alert')
    expect(errorAlert).toHaveTextContent('Cannot grant feature rfq_board.view.')
    expect(errorAlert).toHaveAttribute('aria-live', 'assertive')

    rerender(<FlashMessages />)

    act(() => {
      flash('Saved', 'success')
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })
})
