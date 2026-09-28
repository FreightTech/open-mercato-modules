/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ComboboxInput } from '../ComboboxInput'

// Typing an option exactly must commit it before blur: a form saved right after
// typing "EXW" used to submit the old value (the blur timer runs 200 ms later).
describe('ComboboxInput — exact typed option', () => {
  it('commits an exact option label as it is typed, without waiting for blur', () => {
    const onChange = jest.fn()
    render(<ComboboxInput value="" onChange={onChange} suggestions={['FOB', 'EXW']} allowCustomValues={false} placeholder="inc" />)
    const input = screen.getByPlaceholderText('inc')
    fireEvent.change(input, { target: { value: 'EX' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'exw' } })
    expect(onChange).toHaveBeenCalledWith('EXW')
  })

  it('leaves free text alone when custom values are allowed', () => {
    const onChange = jest.fn()
    render(<ComboboxInput value="" onChange={onChange} suggestions={['FOB']} allowCustomValues placeholder="inc" />)
    fireEvent.change(screen.getByPlaceholderText('inc'), { target: { value: 'FOB' } })
    expect(onChange).not.toHaveBeenCalled()
  })
})
