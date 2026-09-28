/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Toggle } from '../Toggle'

describe('Toggle', () => {
  it('toggles when the visible track is clicked, also without a text label', () => {
    const onChange = jest.fn()
    const { container } = render(<Toggle aria-label="Reguła" onChange={onChange} />)
    const track = container.querySelector('label')
    expect(track).not.toBeNull()
    fireEvent.click(track!)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('switch', { name: 'Reguła' })).toBeChecked()
  })

  it('with a text label, the label is the (single) click target', () => {
    const onChange = jest.fn()
    const { container } = render(<Toggle label="Włączone" onChange={onChange} />)
    expect(container.querySelectorAll('label')).toHaveLength(1)
    fireEvent.click(screen.getByText('Włączone'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
