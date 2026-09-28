/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { FormField } from '../form-field'

describe('FormField', () => {
  it("keeps the child's own disabled state", () => {
    render(
      <FormField label="Pole">
        <input aria-label="child" disabled />
      </FormField>,
    )
    expect(screen.getByLabelText('child')).toBeDisabled()
  })

  it('disables the child when the field is disabled, and leaves it enabled otherwise', () => {
    const { rerender } = render(
      <FormField label="Pole" disabled>
        <input aria-label="child" />
      </FormField>,
    )
    expect(screen.getByLabelText('child')).toBeDisabled()
    rerender(
      <FormField label="Pole">
        <input aria-label="child" />
      </FormField>,
    )
    expect(screen.getByLabelText('child')).toBeEnabled()
  })
})
