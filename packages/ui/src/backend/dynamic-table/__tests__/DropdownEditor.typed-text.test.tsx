/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { DropdownEditor } from '../components/editors'

// Typed text in a dropdown cell is a filter, never a value: "No" typed into a
// boolean column must save 'false', and text that names no option must not be
// saved at all (it used to reach the API raw — refused, or the cell cleared).
const col = { source: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }, { value: '', label: '—' }] }

function setup() {
  const onSave = jest.fn()
  const onCancel = jest.fn()
  render(<DropdownEditor value="" onChange={() => {}} onSave={onSave} onCancel={onCancel} col={col} />)
  const input = screen.getByPlaceholderText('Type to filter...')
  return { input, onSave, onCancel }
}

describe('DropdownEditor — typed text', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  it('saves the option a typed label names', () => {
    const { input, onSave } = setup()
    fireEvent.change(input, { target: { value: 'no' } })
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(onSave).toHaveBeenCalledWith('false', false)
  })

  it('drops text that names no option', () => {
    const { input, onSave, onCancel } = setup()
    fireEvent.change(input, { target: { value: 'maybe' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('clears on empty text', () => {
    const { input, onSave } = setup()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(onSave).toHaveBeenCalledWith('', false)
  })
})
