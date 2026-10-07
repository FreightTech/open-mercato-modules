import * as React from 'react'
import { act, render } from '@testing-library/react'
import { EntitySearchEditor } from '../components/EntitySearchEditor'

/**
 * RFS board, 07.10: the Przewoźnik cell opened with "TRANSKOR" and the caret at the end, so typing a new
 * carrier searched for "TRANSKORBalt" and found nothing. The editor opens with its value selected —
 * typing replaces it.
 */
describe('EntitySearchEditor — open', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('selects the current value, so typing replaces it', () => {
    const { container } = render(
      React.createElement(EntitySearchEditor, {
        config: { entityType: 'contractors:contractor', extractValue: (r: { title?: string }) => r.title ?? '' } as never,
        value: 'TRANSKOR',
        onChange: () => {},
        onSave: () => {},
        onCancel: () => {},
      }),
    )
    act(() => {
      jest.runOnlyPendingTimers()
    })
    const input = container.querySelector('textarea') as HTMLTextAreaElement
    expect(input.value).toBe('TRANSKOR')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('TRANSKOR'.length)
  })
})
