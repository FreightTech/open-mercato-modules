/** @jest-environment jsdom */
/** A closed dialog frees the page's scroll — unless another dialog is still open (the timer's guard leaves this as it was). */
import * as React from 'react'
import { render } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { Dialog, DialogContent, DialogTitle } from '../dialog'

function OpenDialog() {
  return (
    <I18nProvider locale={'en' as never} dict={{}}>
      <Dialog open>
        <DialogContent>
          <DialogTitle>Test</DialogTitle>
        </DialogContent>
      </Dialog>
    </I18nProvider>
  )
}

describe('DialogContent — unmounting', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('frees the scroll the dialog locked', () => {
    const view = render(<OpenDialog />)
    view.unmount()
    document.body.style.overflow = 'hidden'
    document.body.style.pointerEvents = 'none'
    jest.runOnlyPendingTimers()
    expect(document.body.style.overflow).toBe('')
    expect(document.body.style.pointerEvents).toBe('')
  })

  it('leaves the scroll locked while another dialog is open', () => {
    const other = render(<OpenDialog />)
    const view = render(<OpenDialog />)
    view.unmount()
    document.body.style.overflow = 'hidden'
    jest.runOnlyPendingTimers()
    expect(document.body.style.overflow).toBe('hidden')
    other.unmount()
    jest.runOnlyPendingTimers()
  })
})
