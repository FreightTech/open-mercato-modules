import { apiToDynamicTable, dynamicTableToApi } from '../utils/perspectiveTransforms'
import type { PerspectiveConfig } from '../types/index'
import type { PerspectiveDto, PerspectiveSettings } from '@open-mercato/shared/modules/perspectives/types'

const allColumns = ['name', 'departure', 'arrival']

function baseConfig(overrides: Partial<PerspectiveConfig> = {}): PerspectiveConfig {
  return {
    id: 'p1',
    name: 'Ocean ops',
    color: 'blue',
    columns: { visible: allColumns, hidden: [] },
    filters: [{ id: 'f1', field: 'name', operator: 'contains', values: ['x'] } as any],
    sorting: [],
    grouping: [],
    aggregations: [],
    ...overrides,
  }
}

function dtoFromSettings(settings: PerspectiveSettings): PerspectiveDto {
  return { id: 'p1', name: 'Ocean ops', tableId: 'transport', settings, isDefault: false, createdAt: '2026-07-20T00:00:00Z' }
}

describe('perspectiveTransforms — frozenColumns (HEDGE-102)', () => {
  /**
   * ═══ THE ASSERTION THAT IS THE WHOLE POINT ═══
   *
   * `expect(settings.frozenColumns).toBeUndefined()` is not pedantry about
   * shape. The upstream settings schema is a bare `z.object` whose vocabulary
   * is columnOrder / columnVisibility / filters / sorting / grouping / pageSize
   * / searchValue, and Zod strips everything else — so a top-level key is
   * accepted with 200 OK and never reaches the database. Measured against the
   * running API, not inferred: a save carrying both spellings stored only the
   * one inside `filters`.
   *
   * Moving this key to the top level would therefore leave every test that only
   * checks the round-trip passing, and freeze silently broken again in exactly
   * the way HEDGE-102 was filed for.
   */
  it('round-trips frozen columns through filters._frozenColumns, NOT a top-level key', () => {
    const settings = dynamicTableToApi(baseConfig({ frozenColumns: ['name', 'departure'] }))

    expect((settings as any).frozenColumns).toBeUndefined()
    expect((settings.filters as any)._frozenColumns).toEqual(['name', 'departure'])

    const restored = apiToDynamicTable(dtoFromSettings(settings), allColumns)
    expect(restored.frozenColumns).toEqual(['name', 'departure'])
  })

  /** The `v: 2` marker is the other half of the trap — without it the upstream
   *  service drops the whole `filters` object on READ, so the pins would
   *  persist and never come back. */
  it('writes the v:2 marker that keeps the passthrough readable', () => {
    const settings = dynamicTableToApi(baseConfig({ frozenColumns: ['name'] }))
    expect((settings.filters as any).v).toBe(2)
  })

  it('keeps pin ORDER — offsets stack left to right, so the order is data', () => {
    const settings = dynamicTableToApi(baseConfig({ frozenColumns: ['arrival', 'name'] }))
    const restored = apiToDynamicTable(dtoFromSettings(settings), allColumns)
    expect(restored.frozenColumns).toEqual(['arrival', 'name'])
  })

  it('writes no key at all when nothing is pinned, so an untouched view stays clean', () => {
    const settings = dynamicTableToApi(baseConfig({ frozenColumns: [] }))
    expect((settings.filters as any)._frozenColumns).toBeUndefined()

    const restored = apiToDynamicTable(dtoFromSettings(settings), allColumns)
    expect(restored.frozenColumns).toBeUndefined()
  })

  it('unpinning the last column clears the saved key rather than leaving it behind', () => {
    const pinned = dynamicTableToApi(baseConfig({ frozenColumns: ['name'] }))
    expect((pinned.filters as any)._frozenColumns).toEqual(['name'])

    const cleared = dynamicTableToApi(baseConfig({ frozenColumns: [] }))
    expect((cleared.filters as any)._frozenColumns).toBeUndefined()
    expect(apiToDynamicTable(dtoFromSettings(cleared), allColumns).frozenColumns).toBeUndefined()
  })

  it('is undefined for a legacy view saved before the feature existed', () => {
    const restored = apiToDynamicTable(
      dtoFromSettings({ columnOrder: allColumns, columnVisibility: {}, filters: { v: 2, rows: [] } as any }),
      allColumns,
    )
    expect(restored.frozenColumns).toBeUndefined()
  })

  /**
   * Defensive like its neighbours, and for a concrete reason: the frozen keys
   * drive the sticky-left offset maths. A `null` or a number reaching that
   * calculation from a hand-edited or half-migrated row would pin an offset
   * against `undefined` rather than fail loudly.
   */
  it('drops malformed entries instead of carrying them into the offset maths', () => {
    const settings = {
      columnOrder: allColumns,
      columnVisibility: {},
      filters: { v: 2, rows: [], _frozenColumns: ['name', 7, null, '', { k: 1 }, 'arrival'] },
    } as any
    expect(apiToDynamicTable(dtoFromSettings(settings), allColumns).frozenColumns).toEqual(['name', 'arrival'])
  })

  it('ignores a non-array _frozenColumns entirely', () => {
    const settings = {
      columnOrder: allColumns,
      columnVisibility: {},
      filters: { v: 2, rows: [], _frozenColumns: 'name' },
    } as any
    expect(apiToDynamicTable(dtoFromSettings(settings), allColumns).frozenColumns).toBeUndefined()
  })

  it('leaves the neighbours on the channel untouched', () => {
    const restored = apiToDynamicTable(
      dtoFromSettings(dynamicTableToApi(baseConfig({ frozenColumns: ['name'], dateFormat: 'iso-hm' }))),
      allColumns,
    )
    expect(restored.color).toBe('blue')
    expect(restored.filters).toHaveLength(1)
    expect(restored.dateFormat).toBe('iso-hm')
    expect(restored.frozenColumns).toEqual(['name'])
  })
})
