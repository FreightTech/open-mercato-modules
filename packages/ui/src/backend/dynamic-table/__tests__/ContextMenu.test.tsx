import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import ContextMenu, { ContextMenuAction } from '../components/ContextMenu'

// ContextMenu is what pops at the cursor after a multi-cell drag finishes —
// carrying the built-in Copy and optional "Comment / colour" actions. It also
// backs row/column menus, so these tests cover the shared open/close + dispatch
// contract the selection menu relies on.

const actions: ContextMenuAction[] = [
  { id: '__cellsel_copy', label: 'Copy' },
  { id: '__cellsel_annotate', label: 'Comment / colour' },
]

function renderMenu(props: Partial<React.ComponentProps<typeof ContextMenu>> = {}) {
  const onClose = props.onClose ?? jest.fn()
  const onActionClick = props.onActionClick ?? jest.fn()
  const utils = render(
    React.createElement(ContextMenu, {
      isOpen: true,
      position: { x: 100, y: 100 },
      actions,
      onClose,
      onActionClick,
      ...props,
    }),
  )
  return { ...utils, onClose, onActionClick }
}

describe('ContextMenu (selection menu)', () => {
  it('renders nothing when closed', () => {
    const { container } = renderMenu({ isOpen: false })
    expect(container.querySelector('.context-menu')).toBeNull()
  })

  it('renders every action label when open', () => {
    renderMenu()
    expect(screen.getByText('Copy')).toBeInTheDocument()
    expect(screen.getByText('Comment / colour')).toBeInTheDocument()
  })

  it('dispatches the clicked action id and then closes', () => {
    const { onActionClick, onClose } = renderMenu()
    fireEvent.click(screen.getByText('Copy'))
    expect(onActionClick).toHaveBeenCalledWith('__cellsel_copy')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch or close for a disabled action', () => {
    const { onActionClick, onClose } = renderMenu({
      actions: [{ id: 'paste', label: 'Paste', disabled: true }],
    })
    fireEvent.click(screen.getByText('Paste'))
    expect(onActionClick).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders separators without an action button', () => {
    renderMenu({
      actions: [
        { id: 'copy', label: 'Copy' },
        { id: 'sep', label: '', separator: true },
        { id: 'delete', label: 'Delete' },
      ],
    })
    // Two real actions, the separator is a div not a button.
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('closes on Escape', () => {
    const { onClose } = renderMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on an outside mousedown', () => {
    const { onClose } = renderMenu()
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when clicking inside the menu', () => {
    const { onClose, container } = renderMenu()
    const menu = container.querySelector('.context-menu')!
    fireEvent.mouseDown(menu)
    expect(onClose).not.toHaveBeenCalled()
  })
})
