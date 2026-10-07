/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { DatePicker } from '../DatePicker'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

// Radix positions through floating-ui, which never settles in jsdom (any await after
// opening a real Popover hangs the test), so the popover is replaced by a stand-in
// that records the placement props the picker hands it.
jest.mock('../../../primitives/popover', () => {
  const React = require('react')
  const Ctx = React.createContext({ open: false, onOpenChange: (_: boolean) => {} })
  return {
    Popover: ({ open, onOpenChange, children }: any) =>
      React.createElement(Ctx.Provider, { value: { open, onOpenChange } }, children),
    PopoverTrigger: ({ children }: any) => {
      const { open, onOpenChange } = React.useContext(Ctx)
      return React.cloneElement(children, { onClick: () => onOpenChange?.(!open) })
    },
    PopoverContent: React.forwardRef(({ children, side, collisionPadding }: any, ref: any) => {
      const { open } = React.useContext(Ctx)
      if (!open) return null
      return React.createElement(
        'div',
        { ref, role: 'dialog', 'data-side': side ?? 'bottom', 'data-padding': JSON.stringify(collisionPadding ?? null) },
        children,
      )
    }),
  }
})

const rect = (top: number, height: number) =>
  ({ top, bottom: top + height, left: 0, right: 200, width: 200, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

/** A field at `fieldTop` in a 768 px window, a calendar popover of `popoverHeight`. */
function fakeLayout(fieldTop: number, popoverHeight: number) {
  const rectSpy = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('aria-haspopup') === 'dialog' ? rect(fieldTop, 36) : rect(0, 0)
  })
  const heightSpy = jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'dialog' ? popoverHeight : 0
  })
  return () => {
    rectSpy.mockRestore()
    heightSpy.mockRestore()
  }
}

function Harness() {
  const [value, setValue] = React.useState<Date | null>(new Date(2031, 1, 18))
  return <DatePicker value={value} onChange={setValue} />
}

const dialog = () => screen.getByRole('dialog')
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Go to the Next Month' }))

describe('DatePicker — placement is chosen once, on open', () => {
  let restore = () => {}
  afterEach(() => restore())

  it('opens below a field with room under it', () => {
    restore = fakeLayout(100, 400)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /2031/ }))
    expect(dialog()).toHaveAttribute('data-side', 'bottom')
  })

  it('opens above a field near the bottom and stays there while switching months', () => {
    restore = fakeLayout(700, 400)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /2031/ }))
    expect(dialog()).toHaveAttribute('data-side', 'top')
    for (const month of ['March 2031', 'April 2031', 'May 2031']) {
      next()
      expect(screen.getByRole('status')).toHaveTextContent(month)
      expect(dialog()).toHaveAttribute('data-side', 'top')
    }
  })

  it('switches off vertical collision flipping once the side is chosen', () => {
    restore = fakeLayout(700, 400)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /2031/ }))
    const padding = JSON.parse(dialog().getAttribute('data-padding') ?? 'null')
    expect(padding.top).toBeLessThan(-10_000)
    expect(padding.bottom).toBeLessThan(-10_000)
    expect(padding.left).toBeUndefined()
    expect(padding.right).toBeUndefined()
  })
})
