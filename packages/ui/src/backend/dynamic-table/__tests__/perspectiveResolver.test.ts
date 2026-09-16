import { resolvePerspectiveState } from '../handlers/perspectiveHandlers'
import type { ColumnDef } from '../types/index'
import type { PerspectiveConfig } from '../types/perspective'

/**
 * Spec 0 / Phase 3 — `resolvePerspectiveState` is the SINGLE place a saved view
 * becomes table state.
 *
 * Before the collapse there were two: one effect that ran
 * `initializePerspectiveState` (which honours `defaultHiddenColumns`) and a second
 * "sync controlled props" effect that copied `perspective.columns.*` straight onto
 * state (which does not). Both ran on the same commit against the same props, so
 * whether the host's hidden columns survived a view switch depended on effect
 * ordering. These tests pin the one resolver both paths now share.
 */

const cols = (...keys: string[]): ColumnDef[] => keys.map((data) => ({ data }))

const perspective = (over: Partial<PerspectiveConfig> = {}): PerspectiveConfig => ({
  id: 'p1',
  name: 'My view',
  columns: { visible: ['a', 'b'], hidden: ['c'] },
  filters: [],
  sorting: [],
  ...over,
})

describe('resolvePerspectiveState — default view (no perspective)', () => {
  it('shows every column when the host hides none', () => {
    const state = resolvePerspectiveState({ baseColumns: cols('a', 'b', 'c') })

    expect(state.visibleColumns).toEqual(['a', 'b', 'c'])
    expect(state.hiddenColumns).toEqual([])
  })

  it('honours defaultHiddenColumns', () => {
    const state = resolvePerspectiveState({
      baseColumns: cols('a', 'b', 'c'),
      defaultHiddenColumns: ['b'],
    })

    expect(state.visibleColumns).toEqual(['a', 'c'])
    expect(state.hiddenColumns).toEqual(['b'])
  })

  it('ignores a defaultHiddenColumns key the table does not declare', () => {
    const state = resolvePerspectiveState({
      baseColumns: cols('a', 'b'),
      defaultHiddenColumns: ['b', 'ghost'],
    })

    expect(state.hiddenColumns).toEqual(['b'])
  })

  it('treats an explicit null perspective the same as omitting it', () => {
    const withNull = resolvePerspectiveState({
      baseColumns: cols('a', 'b'),
      perspective: null,
      defaultHiddenColumns: ['b'],
    })
    const omitted = resolvePerspectiveState({
      baseColumns: cols('a', 'b'),
      defaultHiddenColumns: ['b'],
    })

    expect(withNull).toEqual(omitted)
  })

  it('resets every rule list, so clearing a view really clears it', () => {
    const state = resolvePerspectiveState({ baseColumns: cols('a') })

    expect(state.filters).toEqual([])
    expect(state.sortRules).toEqual([])
    expect(state.groupRules).toEqual([])
    expect(state.aggregations).toEqual([])
    expect(state.lookupColumns).toEqual([])
    expect(state.dateFormat).toBeUndefined()
  })
})

describe('resolvePerspectiveState — a saved view', () => {
  it('takes the view’s columns, filters and sorting verbatim', () => {
    const state = resolvePerspectiveState({
      baseColumns: cols('a', 'b', 'c'),
      perspective: perspective({
        filters: [{ id: 'f1', field: 'a', operator: 'contains', values: ['x'] }],
        sorting: [{ id: 's1', field: 'b', direction: 'desc' }],
      }),
      defaultHiddenColumns: ['a'],
    })

    // The saved view wins over the host default: `a` stays visible.
    expect(state.visibleColumns).toEqual(['a', 'b'])
    expect(state.hiddenColumns).toEqual(['c'])
    expect(state.filters).toHaveLength(1)
    expect(state.sortRules).toEqual([{ id: 's1', field: 'b', direction: 'desc' }])
  })

  it('defaults the optional rule lists a legacy view omits', () => {
    const legacy = {
      id: 'p1',
      name: 'Legacy',
      columns: { visible: ['a'], hidden: [] },
      filters: [],
      sorting: [],
    } as PerspectiveConfig

    const state = resolvePerspectiveState({ baseColumns: cols('a'), perspective: legacy })

    expect(state.groupRules).toEqual([])
    expect(state.aggregations).toEqual([])
    expect(state.lookupColumns).toEqual([])
  })

  it('carries the view-scoped date format through', () => {
    const state = resolvePerspectiveState({
      baseColumns: cols('a'),
      perspective: perspective({ dateFormat: 'dd.MM.yyyy' }),
    })

    expect(state.dateFormat).toBe('dd.MM.yyyy')
  })

  it('is a pure function of its input — same input, equal output', () => {
    const input = {
      baseColumns: cols('a', 'b'),
      perspective: perspective(),
      defaultHiddenColumns: ['b'],
    }

    expect(resolvePerspectiveState(input)).toEqual(resolvePerspectiveState(input))
  })
})
