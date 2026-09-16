/**
 * Regression tests for the two ways a saved view used to disagree with what the
 * grid actually rendered (INF feedback #1, F3/F4):
 *
 *  - a column key declared twice in a table config vanished entirely, and
 *  - a perspective saved without column config revealed every default-hidden
 *    column ("phantom fields in my saved view").
 */
import { resolvePerspectiveState, dedupeColumnKeys } from '../handlers/perspectiveHandlers'
import { apiToDynamicTable } from '../utils/perspectiveTransforms'
import type { ColumnDef } from '../types/index'
import type { PerspectiveDto, PerspectiveSettings } from '@open-mercato/shared/modules/perspectives/types'

function cols(...keys: string[]): ColumnDef[] {
  return keys.map((k) => ({ data: k }) as ColumnDef)
}

function dto(settings: Partial<PerspectiveSettings>): PerspectiveDto {
  return {
    id: 'p1',
    name: 'My view',
    tableId: 'fms-files',
    settings: settings as PerspectiveSettings,
    isDefault: false,
    createdAt: '2026-08-02T00:00:00Z',
  }
}

describe('dedupeColumnKeys', () => {
  it('keeps the first occurrence and preserves order', () => {
    expect(dedupeColumnKeys(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c'])
  })

  it('is a no-op for already-unique keys', () => {
    expect(dedupeColumnKeys(['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('resolvePerspectiveState — duplicate column keys', () => {
  // The Folders table config declared `notes` twice: once visible, once
  // hidden-by-default. Both copies were then filtered out by the
  // defaultHiddenColumns pass, so Notes never rendered at all.
  it('keeps a column that is declared both visible and hidden-by-default', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const state = resolvePerspectiveState({
      baseColumns: cols('reference', 'notes', 'mode', 'notes'),
      perspective: null,
      defaultHiddenColumns: ['mode', 'notes'],
    })
    warn.mockRestore()

    expect(state.visibleColumns).toEqual(['reference'])
    expect(state.hiddenColumns).toEqual(['mode', 'notes'])
    // Crucially: exactly one 'notes' across the two lists, not zero and not two.
    expect([...state.visibleColumns, ...state.hiddenColumns].filter((k) => k === 'notes')).toHaveLength(1)
  })

  it('does not emit duplicate keys into visibleColumns', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const state = resolvePerspectiveState({ baseColumns: cols('a', 'b', 'a') })
    warn.mockRestore()

    expect(state.visibleColumns).toEqual(['a', 'b'])
  })
})

describe('apiToDynamicTable — empty columnOrder', () => {
  const allColumns = ['reference', 'status', 'mode', 'vessel']
  const defaultHidden = ['mode', 'vessel']

  it('honours the table defaults when the saved view has no column config', () => {
    const config = apiToDynamicTable(dto({}), allColumns, defaultHidden)

    expect(config.columns.visible).toEqual(['reference', 'status'])
    expect(config.columns.hidden).toEqual(['mode', 'vessel'])
  })

  it('still shows everything when the table declares no defaults', () => {
    const config = apiToDynamicTable(dto({}), allColumns)

    expect(config.columns.visible).toEqual(allColumns)
    expect(config.columns.hidden).toEqual([])
  })

  it('lets an explicit columnOrder override the defaults', () => {
    const config = apiToDynamicTable(
      dto({ columnOrder: ['reference', 'mode'], columnVisibility: { reference: true, mode: true } }),
      allColumns,
      defaultHidden,
    )

    // 'mode' is default-hidden but explicitly saved as visible — the saved view wins.
    expect(config.columns.visible).toEqual(['reference', 'mode'])
    expect(config.columns.hidden).toEqual(['status', 'vessel'])
  })

  it('respects an explicit false in columnVisibility', () => {
    const config = apiToDynamicTable(
      dto({ columnOrder: ['reference', 'status'], columnVisibility: { reference: true, status: false } }),
      allColumns,
      defaultHidden,
    )

    expect(config.columns.visible).toEqual(['reference'])
    expect(config.columns.hidden).toContain('status')
  })
})
