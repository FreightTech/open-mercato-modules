/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render } from '@testing-library/react'
import { NumericEditor } from '../components/editors'

// A Polish user types a decimal comma: "1850,50" is 1850.5. parseFloat read it as 1850 and the
// FMS RFS rate lost its grosze (07.10).
function setup(value: unknown = '') {
  const onSave = jest.fn()
  const onChange = jest.fn()
  const { container } = render(<NumericEditor value={value} onChange={onChange} onSave={onSave} onCancel={() => {}} col={{}} />)
  const input = container.querySelector('textarea') as HTMLTextAreaElement
  return { input, onSave, onChange }
}

describe('NumericEditor — decimal comma', () => {
  it('saves "1850,50" as 1850.5', () => {
    const { input, onSave, onChange } = setup()
    fireEvent.change(input, { target: { value: '1850,50' } })
    expect(onChange).toHaveBeenLastCalledWith(1850.5)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith(1850.5, false)
  })

  it('reads spaced thousands', () => {
    const { input, onSave } = setup()
    fireEvent.change(input, { target: { value: '12 600,5' } })
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(onSave).toHaveBeenCalledWith(12600.5, false)
  })

  it('keeps text that is not a number as typed (the column decides)', () => {
    const { input, onSave } = setup()
    fireEvent.change(input, { target: { value: 'n/a' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith('n/a', false)
  })
})
