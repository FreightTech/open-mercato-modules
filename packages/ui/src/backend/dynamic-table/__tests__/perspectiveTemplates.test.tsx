import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import PerspectiveTabs from '../components/PerspectiveTabs'
import type { PerspectiveConfig, PerspectiveTemplate } from '../types/perspective'

/**
 * PERSONAL VIEWS + SHARED TEMPLATES — the UI contract.
 *
 * Workshop A3 recorded a user discovering, after the fact, that her change had
 * reached the whole organisation: „Czyli jak tu porobiłam, to porobiłam
 * wszystkim?" — „Tak."
 *
 * The model these tests pin makes that impossible:
 *   1. A shared template is COPIED, never applied. Opening the shelf and taking
 *      a copy writes a NEW personal view; nobody else's screen moves.
 *   2. Publishing is explicit, opt-in, and asks who may copy it.
 *   3. The publish affordance is absent when the server says this user lacks
 *      the feature — not merely disabled.
 *   4. A copy remembers which template and version it came from.
 */

const perspectives: PerspectiveConfig[] = [
  {
    id: 'persp-1',
    name: 'Open transports',
    columns: { visible: ['ref'], hidden: [] },
    filters: [],
    sorting: [],
  },
]

const template: PerspectiveTemplate = {
  id: 'tmpl-1',
  name: 'Ops standard',
  columns: { visible: ['ref', 'client'], hidden: [] },
  filters: [],
  sorting: [],
  roleId: 'role-a',
  roleName: 'Operations',
  version: '2026-08-02T11:00:00.000Z',
}

type Props = React.ComponentProps<typeof PerspectiveTabs>

function renderTabs(props: Partial<Props> = {}) {
  const handlers = {
    onPerspectiveSelect: jest.fn(),
    onPerspectiveRename: jest.fn(),
    onPerspectiveDelete: jest.fn(),
    onPerspectiveEdit: jest.fn(),
    onPerspectiveDuplicate: jest.fn(),
    onPerspectiveSetDefault: jest.fn(),
    onPerspectivePublish: jest.fn(),
    onPerspectiveTemplateCopy: jest.fn(),
    onAddPerspective: jest.fn(),
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
      } as Props),
    ),
  )
  return { ...utils, ...handlers }
}

const openViewMenu = () => fireEvent.click(screen.getByRole('button', { name: /view options/i }))

describe('shared template shelf', () => {
  it('is absent until somebody has actually published a view', () => {
    renderTabs()
    expect(screen.queryByText('Templates')).toBeNull()
  })

  it('lists the templates published to this user and copies one on click', () => {
    const { onPerspectiveTemplateCopy } = renderTabs({ sharedTemplates: [template] })
    fireEvent.click(screen.getByText('Templates'))
    expect(screen.getByText('Ops standard')).toBeInTheDocument()
    expect(screen.getByText('Shared with Operations')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Ops standard'))
    expect(onPerspectiveTemplateCopy).toHaveBeenCalledTimes(1)
    const [copied, name] = onPerspectiveTemplateCopy.mock.calls[0]
    expect(copied.id).toBe('tmpl-1')
    expect(name).toBe('Ops standard')
  })

  it('de-duplicates the copy name against views the user already has', () => {
    const { onPerspectiveTemplateCopy } = renderTabs({
      sharedTemplates: [template],
      savedPerspectives: [...perspectives, { ...perspectives[0], id: 'p-2', name: 'Ops standard' }],
    })
    fireEvent.click(screen.getByText('Templates'))
    fireEvent.click(screen.getByText('Ops standard', { selector: '.hot-col-menu-item-title' }))
    expect(onPerspectiveTemplateCopy.mock.calls[0][1]).toBe('Ops standard (copy)')
  })

  it('says when a copy is already held, and when the template has moved on since', () => {
    const copiedSame: PerspectiveConfig = {
      ...perspectives[0],
      id: 'p-copy',
      name: 'My ops',
      origin: { templateId: 'tmpl-1', version: template.version, name: 'Ops standard', copiedAt: '' },
    }
    const { unmount } = renderTabs({
      sharedTemplates: [template],
      savedPerspectives: [copiedSame],
    })
    fireEvent.click(screen.getByText('Templates'))
    expect(screen.getByText('Already copied to your views')).toBeInTheDocument()
    unmount()

    renderTabs({
      sharedTemplates: [template],
      savedPerspectives: [
        { ...copiedSame, origin: { ...copiedSame.origin!, version: '2026-07-01T00:00:00.000Z' } },
      ],
    })
    fireEvent.click(screen.getByText('Templates'))
    expect(screen.getByText('Updated since your copy — copy again')).toBeInTheDocument()
  })
})

describe('publishing a view', () => {
  it('is offered only when the server says this user may publish', () => {
    renderTabs({ publishableRoles: [] })
    openViewMenu()
    expect(screen.queryByRole('menuitem', { name: /share as template/i })).toBeNull()
  })

  it('asks who may copy it and never publishes to nobody', () => {
    const { onPerspectivePublish } = renderTabs({
      publishableRoles: [
        { id: 'role-a', name: 'Operations' },
        { id: 'role-b', name: 'Finance' },
      ],
    })
    openViewMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /share as template/i }))

    // The dialog names the view and explains that nothing changes for anyone
    // until they copy it.
    expect(screen.getByText(/Colleagues can copy "Open transports"/)).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: 'Share template' })
    expect(confirm).toBeDisabled()

    fireEvent.click(screen.getByLabelText('Finance'))
    fireEvent.click(confirm)
    expect(onPerspectivePublish).toHaveBeenCalledWith('persp-1', ['role-b'])
  })

  it('pre-selects the current audience so re-publishing cannot silently narrow it', () => {
    const published: PerspectiveConfig = {
      ...perspectives[0],
      publication: { roleIds: ['role-a'], publishedAt: '2026-08-03T00:00:00.000Z' },
    }
    const { onPerspectivePublish } = renderTabs({
      savedPerspectives: [published],
      publishableRoles: [
        { id: 'role-a', name: 'Operations' },
        { id: 'role-b', name: 'Finance' },
      ],
    })
    openViewMenu()
    // An already-published view offers to UPDATE, not to publish again.
    fireEvent.click(screen.getByRole('menuitem', { name: /update shared template/i }))
    expect((screen.getByLabelText('Operations') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Share template' }))
    expect(onPerspectivePublish).toHaveBeenCalledWith('persp-1', ['role-a'])
  })

  it('shows where a copied view came from, as information rather than an action', () => {
    renderTabs({
      savedPerspectives: [
        {
          ...perspectives[0],
          origin: { templateId: 'tmpl-1', version: 'v1', name: 'Ops standard', copiedAt: '' },
        },
      ],
    })
    openViewMenu()
    const note = screen.getByText('Copied from "Ops standard"')
    expect(note).toBeInTheDocument()
    expect(note.closest('button')).toBeNull()
  })
})

describe('the Default view tab', () => {
  const base: PerspectiveConfig = {
    id: 'p-base',
    name: '__base__',
    columns: { visible: ['ref'], hidden: ['client'] },
    filters: [],
    sorting: [],
    isBaseView: true,
  }

  it('selects the base row once the user has personalized it', () => {
    const { onPerspectiveSelect } = renderTabs({ savedPerspectives: [...perspectives, base] })

    // It never appears as a tab of its own — the tab it personalizes is
    // already on screen.
    expect(screen.queryByText('__base__')).toBeNull()

    fireEvent.click(screen.getByText('Default view'))
    expect(onPerspectiveSelect).toHaveBeenCalledWith('p-base')
  })

  it('falls back to the coded defaults when there is no personalization', () => {
    const { onPerspectiveSelect } = renderTabs()
    fireEvent.click(screen.getByText('Default view'))
    expect(onPerspectiveSelect).toHaveBeenCalledWith(null)
  })

  it('reaches Configure view from its own ⋯, so the base tab has a save path', () => {
    const onConfigureBaseView = jest.fn()
    renderTabs({ onConfigureBaseView })
    fireEvent.click(screen.getByRole('button', { name: /default view options/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /configure view/i }))
    expect(onConfigureBaseView).toHaveBeenCalledTimes(1)
  })

  it('offers a RESET only once there is a personalization to undo, and confirms first', () => {
    const withoutBase = renderTabs({
      onConfigureBaseView: jest.fn(),
      onBaseViewReset: jest.fn(),
    })
    fireEvent.click(screen.getByRole('button', { name: /default view options/i }))
    expect(screen.queryByRole('menuitem', { name: /reset to defaults/i })).toBeNull()
    withoutBase.unmount()

    const onBaseViewReset = jest.fn()
    const { onPerspectiveDelete } = renderTabs({
      onConfigureBaseView: jest.fn(),
      onBaseViewReset,
      savedPerspectives: [...perspectives, base],
    })
    fireEvent.click(screen.getByRole('button', { name: /default view options/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /reset to defaults/i }))

    // It says RESET, not delete — a different act deserves different words.
    expect(screen.getByText(/go back to the standard layout/)).toBeInTheDocument()
    expect(onBaseViewReset).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(onBaseViewReset).toHaveBeenCalledTimes(1)
    // NEVER a delete: the upstream soft-delete keeps the row's reserved name in
    // the unique index, so deleting it would block every later base-view save.
    expect(onPerspectiveDelete).not.toHaveBeenCalled()
  })

  it('never renames or deletes the base tab as if it were a saved view', () => {
    renderTabs({
      onConfigureBaseView: jest.fn(),
      onBaseViewReset: jest.fn(),
      savedPerspectives: [...perspectives, base],
    })
    fireEvent.click(screen.getByRole('button', { name: /default view options/i }))
    expect(screen.queryByRole('menuitem', { name: /rename view/i })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /^delete view/i })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /duplicate view/i })).toBeNull()
  })
})
