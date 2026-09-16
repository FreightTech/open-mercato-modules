import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import RowHeaderCell from '../components/RowHeaderCell'

// The row-header cell is the per-row selection affordance behind grouped
// selection: in v2 `selectable` mode it shows a checkbox (not the row number),
// and clicking it must toggle selection without starting a grid row-range drag.

function renderHeader(props: Partial<React.ComponentProps<typeof RowHeaderCell>> = {}) {
  const onToggleSelect = props.onToggleSelect ?? jest.fn()
  const onCancel = props.onCancel ?? jest.fn()
  const onDoubleClick = props.onDoubleClick ?? jest.fn()
  // Render inside a table so the <td> is valid markup.
  const utils = render(
    React.createElement(
      'table',
      null,
      React.createElement(
        'tbody',
        null,
        React.createElement(
          'tr',
          null,
          React.createElement(RowHeaderCell, {
            row: 0,
            isNewRow: false,
            isInRowRange: false,
            rowRangeEdges: {},
            onCancel,
            onDoubleClick,
            ...props,
            onToggleSelect,
          }),
        ),
      ),
    ),
  )
  return { ...utils, onToggleSelect, onCancel }
}

describe('RowHeaderCell — grouped selection checkbox', () => {
  it('renders the row number (1-based) when not selectable', () => {
    renderHeader({ selectable: false })
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('renders a selection checkbox in selectable mode', () => {
    renderHeader({ selectable: true, selected: false })
    expect(screen.getByRole('checkbox', { name: /select row/i })).toBeInTheDocument()
  })

  it('reflects the selected state', () => {
    renderHeader({ selectable: true, selected: true })
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  it('toggles selection when the checkbox changes', () => {
    const { onToggleSelect } = renderHeader({ selectable: true, selected: false })
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggleSelect).toHaveBeenCalledTimes(1)
  })

  it('stops the checkbox mousedown from bubbling to the grid drag handler', () => {
    const { container } = renderHeader({ selectable: true, selected: false })
    const checkbox = container.querySelector('input[type="checkbox"]')!
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    const stop = jest.spyOn(event, 'stopPropagation')
    checkbox.dispatchEvent(event)
    expect(stop).toHaveBeenCalled()
  })

  it('shows the cancel (✕) button instead of a checkbox for a new row', () => {
    const { onCancel } = renderHeader({ selectable: true, isNewRow: true })
    expect(screen.queryByRole('checkbox')).toBeNull()
    const cancelBtn = screen.getByTitle('Cancel')
    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
