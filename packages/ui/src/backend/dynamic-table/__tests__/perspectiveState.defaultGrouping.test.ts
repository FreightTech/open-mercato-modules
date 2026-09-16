/**
 * `defaultGrouping` — a host's opening grouping when no saved view is active.
 *
 * It exists because a table that should OPEN grouped (the documents list opens
 * grouped by case) previously had no way to say so: grouping arrived only from a
 * saved perspective, so a host could get there only by writing a view into the
 * database on the user's behalf.
 *
 * Two properties carry the whole feature and both are asserted here:
 *
 *  1. A saved perspective REPLACES it, never merges with it. Merging would make
 *     "I saved this view deliberately ungrouped" unsayable — the default would
 *     climb back in on every reload.
 *  2. A rule naming a column the table does not declare is DROPPED. Applied, it
 *     would fold every row under `undefined` and present one section called
 *     "Ungrouped" with nothing on screen explaining why.
 */
import { resolvePerspectiveState, createPerspectiveHandlers } from '../handlers/perspectiveHandlers'
import { apiToDynamicTable } from '../utils/perspectiveTransforms'
import type { PerspectiveDto, PerspectiveSettings } from '@open-mercato/shared/modules/perspectives/types'
import type { ColumnDef } from '../types/index'
import type { GroupRule } from '../types/grouping'
import type { PerspectiveConfig } from '../types/perspective'

function cols(...keys: string[]): ColumnDef[] {
  return keys.map((k) => ({ data: k }) as ColumnDef)
}

function rule(field: string, direction: 'asc' | 'desc' = 'asc'): GroupRule {
  return { id: `g-${field}`, field, direction }
}

function perspective(over: Partial<PerspectiveConfig>): PerspectiveConfig {
  return {
    id: 'p1',
    name: 'Saved',
    columns: { visible: ['name', 'caseNumber'], hidden: [] },
    filters: [],
    sorting: [],
    ...over,
  } as PerspectiveConfig
}

describe('resolvePerspectiveState — defaultGrouping', () => {
  it('seeds the default view when no perspective is active', () => {
    const state = resolvePerspectiveState({
      baseColumns: cols('name', 'caseNumber', 'documentType'),
      perspective: null,
      defaultGrouping: [rule('caseNumber')],
    })
    expect(state.groupRules).toEqual([rule('caseNumber')])
  })

  it('defaults to no grouping when the host declares none', () => {
    const state = resolvePerspectiveState({
      baseColumns: cols('name', 'caseNumber'),
      perspective: null,
    })
    expect(state.groupRules).toEqual([])
  })

  it('drops a rule naming a column the table does not declare', () => {
    const state = resolvePerspectiveState({
      baseColumns: cols('name', 'documentType'),
      perspective: null,
      defaultGrouping: [rule('caseNumber'), rule('documentType')],
    })
    expect(state.groupRules).toEqual([rule('documentType')])
  })

  it('a saved perspective REPLACES the default, it does not merge with it', () => {
    const state = resolvePerspectiveState({
      baseColumns: cols('name', 'caseNumber', 'documentType'),
      perspective: perspective({ grouping: [rule('documentType')] }),
      defaultGrouping: [rule('caseNumber')],
    })
    expect(state.groupRules).toEqual([rule('documentType')])
  })

  /**
   * The one that matters most. A user who groups by nothing and saves has made a
   * decision; if the default merged back in, their view would silently regroup
   * itself every time they opened it and nothing on screen would say why.
   */
  it('a perspective saved with NO grouping opens ungrouped, default or not', () => {
    const state = resolvePerspectiveState({
      baseColumns: cols('name', 'caseNumber'),
      perspective: perspective({ grouping: [] }),
      defaultGrouping: [rule('caseNumber')],
    })
    expect(state.groupRules).toEqual([])
  })

  /**
   * The base view is a personalization of the DEFAULT view, and it is written on
   * a user's first visit as a complete column snapshot. Without this, adding a
   * column to a table's config is invisible for ever to everyone who has already
   * opened it — measured on the documents list, where a `caseNumber` column
   * produced the old ten headers and no group sections.
   */
  describe('a base view does not freeze out columns it has never seen', () => {
    const base = (over: Partial<PerspectiveConfig>): PerspectiveConfig => perspective({
      name: '__base__',
      isBaseView: true,
      ...over,
    })

    it('adopts a new column at its DECLARED position, not appended at the end', () => {
      const state = resolvePerspectiveState({
        baseColumns: cols('name', 'caseNumber', 'documentType', 'actions'),
        perspective: base({
          columns: { visible: ['name', 'documentType', 'actions'], hidden: ['caseNumber'] },
          unseenColumns: ['caseNumber'],
        }),
      })
      expect(state.visibleColumns).toEqual(['name', 'caseNumber', 'documentType', 'actions'])
    })

    it('respects a column the user HID — no opinion means absent, not hidden', () => {
      const state = resolvePerspectiveState({
        baseColumns: cols('name', 'caseNumber', 'documentType'),
        perspective: base({
          columns: { visible: ['name'], hidden: ['documentType', 'caseNumber'] },
          unseenColumns: ['caseNumber'],
        }),
      })
      expect(state.visibleColumns).toEqual(['name', 'caseNumber'])
      expect(state.hiddenColumns).toEqual(['documentType'])
    })

    it('adopts the default grouping when it names a column this view never saw', () => {
      const state = resolvePerspectiveState({
        baseColumns: cols('name', 'caseNumber'),
        perspective: base({
          columns: { visible: ['name'], hidden: ['caseNumber'] },
          unseenColumns: ['caseNumber'],
          grouping: [],
        }),
        defaultGrouping: [rule('caseNumber')],
      })
      expect(state.groupRules).toEqual([rule('caseNumber')])
    })

    /**
     * The other half, and the one that keeps this honest. Once the column IS in
     * the user's set, an empty grouping is a DECISION — they ungrouped it — and
     * re-imposing the default would undo that on every reload.
     */
    it('does NOT re-impose the default once the user has the column and ungrouped it', () => {
      const state = resolvePerspectiveState({
        baseColumns: cols('name', 'caseNumber'),
        perspective: base({
          columns: { visible: ['name', 'caseNumber'], hidden: [] },
          unseenColumns: [],
          grouping: [],
        }),
        defaultGrouping: [rule('caseNumber')],
      })
      expect(state.groupRules).toEqual([])
    })

    it('never touches a NAMED view — its columns were chosen', () => {
      const state = resolvePerspectiveState({
        baseColumns: cols('name', 'caseNumber', 'documentType'),
        perspective: perspective({
          columns: { visible: ['name'], hidden: ['caseNumber', 'documentType'] },
          unseenColumns: ['caseNumber'],
          grouping: [],
        }),
        defaultGrouping: [rule('caseNumber')],
      })
      expect(state.visibleColumns).toEqual(['name'])
      expect(state.groupRules).toEqual([])
    })
  })

  it('leaves the rest of the default state alone', () => {
    const state = resolvePerspectiveState({
      baseColumns: cols('name', 'caseNumber', 'documentType'),
      perspective: null,
      defaultHiddenColumns: ['documentType'],
      defaultGrouping: [rule('caseNumber')],
    })
    expect(state.visibleColumns).toEqual(['name', 'caseNumber'])
    expect(state.hiddenColumns).toEqual(['documentType'])
    expect(state.filters).toEqual([])
    expect(state.sortRules).toEqual([])
  })
})

/**
 * The half of the mechanism that lives in the transform, tested against the
 * shape a real stored base view has. Taken from the `__base__` row this feature
 * was debugged on: `columnOrder` and `columnVisibility` list the ten columns the
 * documents table had before `caseNumber` was added.
 */
describe('apiToDynamicTable — unseenColumns', () => {
  const storedBaseView = (order: string[]): PerspectiveDto => ({
    id: 'a15eebda-7c7a-4d98-922c-7d0b17657ec6',
    name: '__base__',
    tableId: 'freight_documents',
    isDefault: false,
    createdAt: '2026-08-20T00:00:00Z',
    settings: {
      filters: { v: 2, rows: [], _baseView: true },
      sorting: [],
      grouping: [],
      columnOrder: order,
      columnVisibility: Object.fromEntries(order.map((c) => [c, true])),
    } as unknown as PerspectiveSettings,
  })

  it('reports a column the stored row has never heard of', () => {
    const config = apiToDynamicTable(
      storedBaseView(['name', 'documentType', 'createdAt']),
      ['name', 'caseNumber', 'documentType', 'createdAt'],
    )
    expect(config.unseenColumns).toEqual(['caseNumber'])
    // …and the derived `hidden` list is exactly why it had to be computed here:
    // it cannot tell this column from one the user hid.
    expect(config.columns.hidden).toContain('caseNumber')
  })

  it('reports nothing when the row has an opinion about every column', () => {
    const config = apiToDynamicTable(
      storedBaseView(['name', 'caseNumber']),
      ['name', 'caseNumber'],
    )
    expect(config.unseenColumns).toEqual([])
  })

  /** A column explicitly turned OFF is an opinion, not an absence. */
  it('does not report a column the row explicitly hid', () => {
    const dto = storedBaseView(['name', 'caseNumber'])
    ;(dto.settings as unknown as { columnVisibility: Record<string, boolean> })
      .columnVisibility.caseNumber = false
    const config = apiToDynamicTable(dto, ['name', 'caseNumber'])
    expect(config.unseenColumns).toEqual([])
    expect(config.columns.hidden).toContain('caseNumber')
  })

  /** A legacy row with no column config at all has no opinions to preserve —
   *  the table's own defaults are already being honoured for it. */
  it('reports nothing for a legacy row with an empty columnOrder', () => {
    const config = apiToDynamicTable(storedBaseView([]), ['name', 'caseNumber'])
    expect(config.unseenColumns).toEqual([])
  })
})

/**
 * Selecting the "Default view" tab.
 *
 * This is the path that actually broke the feature in the browser: `defaultGrouping`
 * arrived on the props correctly, the resolver returned the right rule, and the grid
 * still drew ONE ungrouped section — because `handlePerspectiveSelect(null)` had its
 * own hand-rolled idea of the default view and set `groupRules` to `[]` behind it.
 *
 * These assert the two properties that second implementation got wrong.
 */
describe('createPerspectiveHandlers — selecting the default view', () => {
  function harness(defaults: { defaultHiddenColumns?: string[]; defaultGrouping?: GroupRule[] }) {
    const calls: Record<string, unknown> = {}
    const set = (key: string) => ((v: unknown) => { calls[key] = v }) as never
    const handlers = createPerspectiveHandlers({
      tableRef: { current: document.createElement('div') },
      columns: cols('name', 'caseNumber', 'documentType'),
      savedPerspectives: [],
      activePerspectiveId: null,
      setVisibleColumns: set('visible'),
      setHiddenColumns: set('hidden'),
      setFilters: set('filters'),
      setSortRules: set('sort'),
      setGroupRules: set('group'),
      setAggregations: set('agg'),
      setLookupColumns: set('lookup'),
      setRollupColumns: set('rollup'),
      setFormulas: set('formulas'),
      setConditionalFormats: set('formats'),
      setFrozenColumns: set('frozen'),
      setDateFormat: set('dateFormat'),
      setInternalActivePerspectiveId: set('activeId'),
      ...defaults,
    })
    return { handlers, calls }
  }

  it('restores the host default GROUPING, not an empty one', () => {
    const { handlers, calls } = harness({ defaultGrouping: [rule('caseNumber')] })
    handlers.handlePerspectiveSelect(null)
    expect(calls.group).toEqual([rule('caseNumber')])
  })

  it('honours defaultHiddenColumns instead of revealing every column', () => {
    const { handlers, calls } = harness({ defaultHiddenColumns: ['documentType'] })
    handlers.handlePerspectiveSelect(null)
    expect(calls.visible).toEqual(['name', 'caseNumber'])
    expect(calls.hidden).toEqual(['documentType'])
  })

  it('still clears filters and sorting — that part was always right', () => {
    const { handlers, calls } = harness({ defaultGrouping: [rule('caseNumber')] })
    handlers.handlePerspectiveSelect(null)
    expect(calls.filters).toEqual([])
    expect(calls.sort).toEqual([])
  })
})
