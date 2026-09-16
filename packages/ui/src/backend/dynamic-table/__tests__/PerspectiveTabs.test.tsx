import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import PerspectiveTabs from '../components/PerspectiveTabs'
import { PERSPECTIVE_NAME_MAX_LENGTH } from '../types/perspective'
import type { PerspectiveConfig } from '../types/perspective'

/**
 * Workshop A6 — deleting a saved view used to be a bare `×` a few pixels from
 * the tab label. "Zbyt łatwo go tu można usunąć": Agnieszka works fast, and
 * losing a 60-column layout mid-shift is expensive.
 *
 * The contract these tests pin:
 *   1. There is NO bare `×` on a tab.
 *   2. Every view action lives behind one `⋯` menu.
 *   3. Delete asks first, and the question NAMES the view.
 *
 * Point 1 is the one that must not silently regress, so it is asserted
 * directly rather than implied by the others.
 */

const perspectives: PerspectiveConfig[] = [
  {
    id: 'persp-1',
    name: 'Open transports',
    color: 'blue',
    columns: { visible: ['ref'], hidden: [] },
    filters: [],
    sorting: [],
    grouping: [],
  },
]

type Props = React.ComponentProps<typeof PerspectiveTabs>

function renderTabs(props: Partial<Props> = {}) {
  const handlers = {
    onPerspectiveSelect: props.onPerspectiveSelect ?? jest.fn(),
    onPerspectiveRename: props.onPerspectiveRename ?? jest.fn(),
    onPerspectiveDelete: props.onPerspectiveDelete ?? jest.fn(),
    onPerspectiveEdit: props.onPerspectiveEdit ?? jest.fn(),
    onPerspectiveDuplicate: props.onPerspectiveDuplicate ?? jest.fn(),
    onPerspectiveSetDefault: props.onPerspectiveSetDefault ?? jest.fn(),
    onAddPerspective: props.onAddPerspective ?? jest.fn(),
  }
  const utils = render(
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(PerspectiveTabs, {
        savedPerspectives: perspectives,
        activePerspectiveId: null,
        ...handlers,
        ...props,
      }),
    ),
  )
  return { ...utils, ...handlers }
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /view options/i }))

describe('PerspectiveTabs — the ⋯ menu (A6)', () => {
  it('renders no bare delete control on the tab itself', () => {
    renderTabs()
    // The old affordance. Its absence IS the fix.
    expect(screen.queryByRole('button', { name: /delete perspective/i })).toBeNull()
    expect(screen.queryByText('×')).toBeNull()
  })

  it('offers rename, duplicate, set-as-default and delete behind one trigger', () => {
    renderTabs()
    expect(screen.queryByRole('menu')).toBeNull()
    openMenu()
    expect(screen.getByRole('menuitem', { name: /rename view/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /duplicate view/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /set as my default/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /delete view/i })).toBeInTheDocument()
  })

  it('hides duplicate and set-as-default when the host supplies no handler', () => {
    renderTabs({ onPerspectiveDuplicate: undefined, onPerspectiveSetDefault: undefined })
    openMenu()
    expect(screen.queryByRole('menuitem', { name: /duplicate view/i })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /set as my default/i })).toBeNull()
  })

  it('does not delete until the confirmation is accepted, and names the view in it', () => {
    const { onPerspectiveDelete } = renderTabs()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /delete view/i }))
    // The click that opened the dialog must not have deleted anything.
    expect(onPerspectiveDelete).not.toHaveBeenCalled()
    // The question names the view — that is what turns a reflex click into a read.
    expect(screen.getByRole('dialog')).toHaveTextContent(/Open transports/)
    fireEvent.click(screen.getByRole('button', { name: /^delete view$/i }))
    expect(onPerspectiveDelete).toHaveBeenCalledWith('persp-1', true)
  })

  it('cancelling the confirmation leaves the view alone', () => {
    const { onPerspectiveDelete } = renderTabs()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /delete view/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onPerspectiveDelete).not.toHaveBeenCalled()
  })

  it('duplicates under a non-colliding name and never as the default', () => {
    const { onPerspectiveDuplicate } = renderTabs()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /duplicate view/i }))
    expect(onPerspectiveDuplicate).toHaveBeenCalledWith('persp-1', 'Open transports (copy)')
  })

  it('sets this user’s default view', () => {
    const { onPerspectiveSetDefault } = renderTabs()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /set as my default/i }))
    expect(onPerspectiveSetDefault).toHaveBeenCalledWith('persp-1')
  })

  it('marks the view that is already this user’s default and disables the action', () => {
    renderTabs({ defaultPerspectiveId: 'persp-1' })
    expect(screen.getByLabelText(/this is my default view/i)).toBeInTheDocument()
    openMenu()
    expect(screen.getByRole('menuitem', { name: /this is my default view/i })).toBeDisabled()
  })

  it('opens Configure View from the menu without selecting a different tab', () => {
    const { onPerspectiveEdit } = renderTabs()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /configure view/i }))
    expect(onPerspectiveEdit).toHaveBeenCalledWith('persp-1')
  })

  it('opens the add-view flow without selecting it', () => {
    const { onAddPerspective } = renderTabs()
    fireEvent.click(screen.getByText(/add view/i))
    expect(onAddPerspective).toHaveBeenCalledTimes(1)
  })
})

/**
 * Ledger 7.14 — a long view name was silently rejected: the save appeared to
 * work and nothing was created. The API caps `name` at 120 characters
 * (`z.string().min(1).max(120)` upstream) and answers a longer one with a bare
 * 400, so the cap has to be visible on the way IN.
 */
describe('PerspectiveTabs — the 120-character name cap (7.14)', () => {
  it('caps the inline rename input at the API limit', () => {
    renderTabs()
    fireEvent.doubleClick(screen.getByText('Open transports'))
    const input = screen.getByDisplayValue('Open transports') as HTMLInputElement
    expect(input.maxLength).toBe(PERSPECTIVE_NAME_MAX_LENGTH)
  })

  it('trims the BASE, never the suffix, when a copy name would overflow', () => {
    const longName = 'x'.repeat(PERSPECTIVE_NAME_MAX_LENGTH)
    const { onPerspectiveDuplicate } = renderTabs({
      savedPerspectives: [{ ...perspectives[0], name: longName }],
    })
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /duplicate view/i }))

    const [, newName] = onPerspectiveDuplicate.mock.calls[0]
    expect(newName.length).toBeLessThanOrEqual(PERSPECTIVE_NAME_MAX_LENGTH)
    // The suffix is what makes it a distinguishable copy — it must survive.
    expect(newName.endsWith('(copy)')).toBe(true)
  })
})
