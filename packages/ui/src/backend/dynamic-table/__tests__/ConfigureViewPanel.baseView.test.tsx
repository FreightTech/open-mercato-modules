import * as React from 'react'
import { render, fireEvent, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import ConfigureViewPanel from '../components/ConfigureViewPanel'
import { BASE_VIEW_PERSPECTIVE_NAME } from '../types/perspective'
import type { PerspectiveConfig } from '../types/perspective'
import type { ColumnDef } from '../types/index'

/**
 * THE BASE-VIEW SAVE GAP.
 *
 * `handleSave` used to be gated on `if (saveName.trim())` and always minted a
 * fresh id. Two consequences, both reported as bugs rather than as design:
 *
 *   1. The "Default view" tab had NO save path at all. Hiding a column there
 *      survived until the next reload — half of why workshop A5 read as data
 *      loss ("my changes disappeared").
 *   2. Because the id was always new, the host could only match a save back to
 *      a row BY NAME, so renaming a view in this drawer CLONED it.
 *
 * These tests pin both fixes, plus the per-user guarantee that the base view is
 * an ordinary personal row and therefore cannot leak to anyone else.
 */

const columns: ColumnDef[] = [
  { data: 'client', title: 'Client' },
  { data: 'amount', title: 'Amount', type: 'numeric' },
]

const noop = () => {}

function renderPanel(props: Record<string, unknown> = {}) {
  const onSavePerspective = jest.fn()
  const utils = render(
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(ConfigureViewPanel as any, {
        isOpen: true,
        onOpenChange: noop,
        columns,
        visibleColumns: ['client'],
        hiddenColumns: ['amount'],
        filters: [],
        sortRules: [],
        onColumnVisibilityChange: noop,
        onFiltersChange: noop,
        onSortRulesChange: noop,
        onSavePerspective,
        activePerspectiveId: null,
        isBaseViewMode: true,
        ...props,
      }),
    ),
  )
  return { ...utils, onSavePerspective }
}

const nameInput = () =>
  document.querySelector('.hot-config-panel-save input') as HTMLInputElement

const primaryButton = () =>
  Array.from(document.querySelectorAll('.hot-config-panel-footer button')).at(-1) as HTMLButtonElement

describe('saving the Default view', () => {
  it('offers a save with no name, and says so on the button', () => {
    renderPanel()
    expect(primaryButton()).toHaveTextContent('Save Default view')
    expect(primaryButton()).not.toBeDisabled()
    expect(screen.getByText(/Leave the name empty/)).toBeInTheDocument()
  })

  it('writes the current arrangement as this user\'s base-view row', () => {
    const { onSavePerspective } = renderPanel()
    fireEvent.click(primaryButton())

    expect(onSavePerspective).toHaveBeenCalledTimes(1)
    const saved: PerspectiveConfig = onSavePerspective.mock.calls[0][0]
    expect(saved.isBaseView).toBe(true)
    expect(saved.name).toBe(BASE_VIEW_PERSPECTIVE_NAME)
    expect(saved.columns).toEqual({ visible: ['client'], hidden: ['amount'] })
    // No colour: the tab it personalizes is a fixed part of the strip.
    expect(saved.color).toBeUndefined()
  })

  it('updates the existing base row instead of inserting a second one', () => {
    const base: PerspectiveConfig = {
      id: 'p-base-uuid',
      name: BASE_VIEW_PERSPECTIVE_NAME,
      columns: { visible: ['client', 'amount'], hidden: [] },
      filters: [],
      sorting: [],
      isBaseView: true,
    }
    const { onSavePerspective } = renderPanel({
      baseViewPerspective: base,
      activePerspectiveId: 'p-base-uuid',
    })
    fireEvent.click(primaryButton())
    expect(onSavePerspective.mock.calls[0][0].id).toBe('p-base-uuid')
  })

  it('still demands a name when the drawer was opened from "Add view"', () => {
    // Same table state, different intent. "Add view" opens from the base tab
    // too, and must not quietly overwrite the user's Default view.
    renderPanel({ isBaseViewMode: false })
    expect(primaryButton()).toHaveTextContent('Save as new view')
    expect(primaryButton()).toBeDisabled()
    expect(screen.queryByText(/Leave the name empty/)).toBeNull()
  })

  it('still creates a NEW named view the moment a name is typed', () => {
    const { onSavePerspective } = renderPanel()
    fireEvent.change(nameInput(), { target: { value: 'Tomorrow' } })
    expect(primaryButton()).toHaveTextContent('Save as new view')

    fireEvent.click(primaryButton())
    const saved: PerspectiveConfig = onSavePerspective.mock.calls[0][0]
    expect(saved.name).toBe('Tomorrow')
    expect(saved.isBaseView).toBeUndefined()
  })
})

describe('editing an existing view', () => {
  const existing: PerspectiveConfig = {
    id: 'p-uuid-1',
    name: 'Open transports',
    color: 'blue',
    columns: { visible: ['client'], hidden: [] },
    filters: [],
    sorting: [],
    origin: { templateId: 'tmpl-1', version: 'v1', name: 'Ops standard', copiedAt: '' },
    publication: { roleIds: ['role-a'], publishedAt: '2026-08-03T00:00:00.000Z' },
  }

  it('keeps the row\'s id through a RENAME, so the save updates rather than clones', () => {
    const { onSavePerspective } = renderPanel({
      editingPerspective: existing,
      activePerspectiveId: 'p-uuid-1',
    })
    expect(primaryButton()).toHaveTextContent('Save view')

    fireEvent.change(nameInput(), { target: { value: 'Open transports (renamed)' } })
    fireEvent.click(primaryButton())

    const saved: PerspectiveConfig = onSavePerspective.mock.calls[0][0]
    expect(saved.id).toBe('p-uuid-1')
    expect(saved.name).toBe('Open transports (renamed)')
  })

  it('carries the template origin forward, so a copy never forgets where it came from', () => {
    const { onSavePerspective } = renderPanel({
      editingPerspective: existing,
      activePerspectiveId: 'p-uuid-1',
    })
    fireEvent.click(primaryButton())
    const saved: PerspectiveConfig = onSavePerspective.mock.calls[0][0]
    expect(saved.origin).toEqual(existing.origin)
    expect(saved.publication).toEqual(existing.publication)
    expect(saved.isBaseView).toBeUndefined()
  })
})
