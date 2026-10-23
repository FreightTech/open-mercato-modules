import * as React from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import ConfigureViewPanel from '../components/ConfigureViewPanel'
import type { ColumnDef } from '../types/index'

/**
 * F8.03 (FMS acc-v17, walk 23.10): Escape on "Dostosuj widok" closed the drawer and dropped the edits made in it without
 * a word. A dismissal with edits not saved asks first; nothing edited, it closes as before.
 */
const confirmMock = jest.fn()
jest.mock('../../confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock, ConfirmDialogElement: null }),
}))

const columns: ColumnDef[] = [
  { data: 'reference', title: 'Reference #' },
  { data: 'client', title: 'Client' },
]

function setup() {
  const onOpenChange = jest.fn()
  const onSortRulesChange = jest.fn()
  const props = {
    isOpen: true,
    onOpenChange,
    columns,
    visibleColumns: ['reference', 'client'],
    hiddenColumns: [],
    filters: [],
    sortRules: [] as Array<{ field: string; direction: 'asc' | 'desc' }>,
    onColumnVisibilityChange: jest.fn(),
    onFiltersChange: jest.fn(),
    onSortRulesChange,
    onSavePerspective: jest.fn(),
  }
  const el = (p: typeof props) => React.createElement(I18nProvider as any, { locale: 'en', dict: {} }, React.createElement(ConfigureViewPanel, p as any))
  const view = render(el(props))
  // The host applies an edit made in the drawer (the panel is controlled).
  const edit = () => view.rerender(el({ ...props, sortRules: [{ field: 'client', direction: 'asc' }] }))
  return { onOpenChange, onSortRulesChange, edit }
}

const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

describe('ConfigureViewPanel — Escape with unsaved edits', () => {
  beforeEach(() => confirmMock.mockReset())

  it('nothing edited: closes at once', async () => {
    const { onOpenChange } = setup()
    await act(async () => escape())
    expect(confirmMock).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('edited, and the person keeps editing: the drawer stays, the edit stays', async () => {
    confirmMock.mockResolvedValueOnce(false)
    const { onOpenChange, onSortRulesChange, edit } = setup()
    edit()
    await act(async () => escape())
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(onSortRulesChange).not.toHaveBeenCalled()
  })

  it('edited, then "Cancel" clicked: an explicit cancel — rolled back and closed, nothing asked', async () => {
    const { onOpenChange, onSortRulesChange, edit } = setup()
    edit()
    const buttons = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === 'Cancel')
    await act(async () => fireEvent.click(buttons[buttons.length - 1]!))
    expect(confirmMock).not.toHaveBeenCalled()
    expect(onSortRulesChange).toHaveBeenCalledWith([])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('edited, and the person drops the edits: rolled back and closed', async () => {
    confirmMock.mockResolvedValueOnce(true)
    const { onOpenChange, onSortRulesChange, edit } = setup()
    edit()
    await act(async () => escape())
    expect(onSortRulesChange).toHaveBeenCalledWith([])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
