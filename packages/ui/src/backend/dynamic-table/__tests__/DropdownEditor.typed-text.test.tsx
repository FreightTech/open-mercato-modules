/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DropdownEditor } from '../components/editors'

// Typed text in a dropdown cell is a filter, never a value: "No" typed into a
// boolean column must save 'false', and text that names no option must not be
// saved at all (it used to reach the API raw — refused, or the cell cleared).
const col = { source: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }, { value: '', label: '—' }] }

function setup() {
  const onSave = jest.fn()
  const onCancel = jest.fn()
  render(
    <I18nProvider locale="en" dict={{}}>
      <DropdownEditor value="" onChange={() => {}} onSave={onSave} onCancel={onCancel} col={col} />
    </I18nProvider>,
  )
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

// Owner 07.10: the editor opens on the current choice — its label in the box, the list on it.
describe('DropdownEditor — opens on the current choice', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  function open(value: string) {
    const onSave = jest.fn()
    render(
      <I18nProvider locale="en" dict={{}}>
        <DropdownEditor value={value} onChange={() => {}} onSave={onSave} onCancel={() => {}} col={col} />
      </I18nProvider>,
    )
    return { input: screen.getByPlaceholderText('Type to filter...') as HTMLTextAreaElement, onSave }
  }

  it('shows the label, not the stored value', () => {
    expect(open('false').input.value).toBe('No')
  })

  it('highlights the current option, so Enter keeps it', () => {
    const { input, onSave } = open('false')
    expect(document.querySelector('.hot-dropdown-option.highlighted')?.textContent).toBe('No')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith('false', false)
  })

  it('a value that is no option opens as typed, on the first option', () => {
    const { input } = open('legacy')
    expect(input.value).toBe('legacy')
    expect(document.querySelector('.hot-dropdown-option.highlighted')?.textContent).toBe('Yes')
  })
})
