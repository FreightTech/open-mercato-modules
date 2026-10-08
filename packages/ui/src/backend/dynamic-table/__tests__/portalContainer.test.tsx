import * as React from 'react'
import { render, fireEvent } from '@testing-library/react'
import SelectMenu from '../components/SelectMenu'
import { portalContainerFor } from '../utils/portalContainer'

/**
 * GT, 2026-10-08: the Configure View drawer's column lists could not be
 * scrolled with the mouse wheel. Radix's scroll lock exempts only the dialog
 * content's DOM, and the lists were portaled onto document.body.
 */
describe('portalContainerFor', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns the Radix dialog content around the anchor', () => {
    document.body.innerHTML = '<div role="dialog" data-state="open" id="sheet"><button id="t"></button></div>'
    expect(portalContainerFor(document.getElementById('t'))).toBe(document.getElementById('sheet'))
  })

  it('ignores the grid\'s own hand-made popovers (role="dialog" without data-state)', () => {
    document.body.innerHTML = '<div role="dialog" id="popover"><button id="t"></button></div>'
    expect(portalContainerFor(document.getElementById('t'))).toBe(document.body)
  })

  it('falls back to the body outside any dialog, or without an anchor', () => {
    document.body.innerHTML = '<button id="t"></button>'
    expect(portalContainerFor(document.getElementById('t'))).toBe(document.body)
    expect(portalContainerFor(null)).toBe(document.body)
  })
})

describe('SelectMenu inside a Radix dialog', () => {
  it('opens its list inside the dialog content, where the scroll lock lets it scroll', () => {
    const { getByRole } = render(
      React.createElement(
        'div',
        { role: 'dialog', 'data-state': 'open', 'data-testid': 'sheet' },
        React.createElement(SelectMenu, {
          value: 'a',
          onChange: () => {},
          options: Array.from({ length: 40 }, (_, i) => ({ value: String(i), label: `Column ${i}` })),
          ariaLabel: 'Group by',
        }),
      ),
    )
    fireEvent.click(getByRole('combobox', { name: 'Group by' }))
    const list = document.querySelector('.hot-select-menu')
    expect(list).not.toBeNull()
    expect(list!.closest('[data-testid="sheet"]')).not.toBeNull()
  })
})
