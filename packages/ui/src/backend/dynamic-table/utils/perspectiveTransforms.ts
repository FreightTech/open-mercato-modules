import type { PerspectiveConfig, FilterRow, SortRule, LookupColumnRef } from '../types/index'
import type {
  PerspectiveOrigin,
  PerspectivePublication,
  PerspectiveTemplate,
} from '../types/perspective'
import { BASE_VIEW_PERSPECTIVE_NAME, isTableViewMode } from '../types/perspective'
import type { TableViewMode } from '../types/perspective'
import type { GroupRule, AggregationRule, AggregationFn } from '../types/grouping'
import { isAggregationFn } from '../types/grouping'
import { parseConditionalFormats } from './conditionalFormat'
import { parseFormulaColumns } from './formulaColumns'
import { parseRollupColumns } from './rollupColumns'
import type {
  PerspectiveDto,
  PerspectiveSettings,
  RolePerspectiveDto,
} from '@open-mercato/shared/modules/perspectives/types'

/**
 * @deprecated Collapsed: `PerspectiveConfig` now carries `conditionalFormats`
 * itself, so this is a plain alias. Use `PerspectiveConfig`.
 */
export type DynamicTablePerspectiveConfig = PerspectiveConfig

/**
 * Defensively parse the `_lookups` smuggled inside `settings.filters`. Drops
 * anything that isn't a well-formed `{ source, field, label }` so a malformed or
 * legacy value can never crash the table.
 */
function parseLookupColumns(raw: unknown): LookupColumnRef[] {
  if (!Array.isArray(raw)) return []
  const out: LookupColumnRef[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { source, field, label } = entry as Record<string, unknown>
    if (typeof source !== 'string' || !source) continue
    if (typeof field !== 'string' || !field) continue
    out.push({ source, field, label: typeof label === 'string' && label ? label : field })
  }
  return out
}

/**
 * Defensively parse the `_aggregations` smuggled inside `settings.filters`.
 * Drops anything that isn't a well-formed rule so a malformed/legacy value
 * can never crash the table.
 *
 * The function whitelist is `isAggregationFn` — i.e. `AGGREGATION_FNS` in
 * `types/grouping.ts`, the single source of truth. It used to be a local
 * `['sum']` literal, which meant a view saved with any other function silently
 * lost its rules on reload. That is also the forward-compatibility contract:
 * a view saved by a NEWER client carrying an unknown `fn` degrades to dropping
 * that one rule instead of throwing.
 */
function parseAggregations(raw: unknown): AggregationRule[] {
  if (!Array.isArray(raw)) return []
  const out: AggregationRule[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { id, field, fn, dimension } = entry as Record<string, unknown>
    if (typeof field !== 'string' || !field) continue
    if (!isAggregationFn(fn)) continue
    const rule: AggregationRule = {
      id: typeof id === 'string' && id ? id : `agg-${field}`,
      field,
      fn: fn as AggregationFn,
    }
    // Carry the partition column through the round-trip. Dropping it would
    // turn a saved per-currency breakdown back into a single cross-currency
    // number on the next page load — silently, and looking correct.
    if (typeof dimension === 'string' && dimension) rule.dimension = dimension
    out.push(rule)
  }
  return out
}

/**
 * Defensively parse the `_viewMode` smuggled inside `settings.filters`.
 *
 * Same forward-compatibility contract as `parseAggregations`: a value written
 * by a NEWER client that we do not recognise degrades to `'table'` rather than
 * throwing. A saved view is data a user relies on; it must never be able to
 * break the page that reads it.
 *
 * `undefined` in ⇒ `undefined` out, so "never chosen" survives a round-trip and
 * a host's own default (if it has one) still applies.
 */
export function parseViewMode(raw: unknown): TableViewMode | undefined {
  if (raw === undefined || raw === null) return undefined;
  return isTableViewMode(raw) ? raw : 'table';
}

/**
 * Defensively parse `_origin` — the record of which shared template a view was
 * copied from, and at which version. A malformed or partial value is dropped
 * rather than half-trusted: a wrong `version` would later claim "the template
 * changed" (or hide that it did), which is worse than not knowing.
 */
export function parsePerspectiveOrigin(raw: unknown): PerspectiveOrigin | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { templateId, version, name, copiedAt } = raw as Record<string, unknown>
  if (typeof templateId !== 'string' || !templateId) return undefined
  if (typeof version !== 'string' || !version) return undefined
  return {
    templateId,
    version,
    name: typeof name === 'string' ? name : '',
    copiedAt: typeof copiedAt === 'string' ? copiedAt : '',
  }
}

/** Defensively parse `_published` — which roles this view is shared with. */
export function parsePerspectivePublication(raw: unknown): PerspectivePublication | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { roleIds, publishedAt } = raw as Record<string, unknown>
  if (!Array.isArray(roleIds)) return undefined
  const ids = roleIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (!ids.length) return undefined
  return { roleIds: ids, publishedAt: typeof publishedAt === 'string' ? publishedAt : '' }
}

/**
 * The version stamp a copy records. `updatedAt` when the template has been
 * re-published, else `createdAt` — never empty, so "has it changed since I
 * copied it?" is always answerable.
 */
export function templateVersionOf(dto: { updatedAt?: string | null; createdAt: string }): string {
  return dto.updatedAt || dto.createdAt
}

/**
 * Convert a ROLE-scoped perspective DTO into a shared template.
 *
 * Same settings shape as a personal view — a template IS a view someone
 * published — plus the role it is published to and the version stamp a copy
 * records. Deliberately reuses `apiToDynamicTable` so a template can never
 * decode differently from the view it was made from.
 */
export function apiTemplateToDynamicTable(
  dto: RolePerspectiveDto,
  allColumns: string[],
  defaultHiddenColumns: string[] = [],
): PerspectiveTemplate {
  const base = apiToDynamicTable(dto, allColumns, defaultHiddenColumns)
  return {
    ...base,
    // A template is a thing to copy, never a thing that is your default or your
    // base view — drop both flags rather than carrying them into someone's space.
    isDefault: false,
    isBaseView: false,
    publication: undefined,
    roleId: dto.roleId,
    roleName: dto.roleName ?? null,
    version: templateVersionOf(dto),
  }
}

/**
 * Convert a perspective DTO from the API into a DynamicTable PerspectiveConfig.
 * Handles the mapping between API format (columnOrder, columnVisibility, etc.)
 * and DynamicTable format (visible/hidden arrays, FilterRow[], SortRule[]).
 */
export function apiToDynamicTable(
  dto: PerspectiveDto,
  allColumns: string[],
  defaultHiddenColumns: string[] = [],
): DynamicTablePerspectiveConfig {
  const { columnOrder = [], columnVisibility = {} } = dto.settings

  // A perspective saved before column config was persisted (or migrated from a
  // legacy shape) has an empty `columnOrder`. Falling back to `allColumns` there
  // would reveal every column the table declares hidden by default — the
  // "phantom fields in my saved view" report. Honour the table's defaults
  // instead; an explicit `columnOrder` still wins outright.
  const visible =
    columnOrder.length > 0
      ? columnOrder.filter((col) => columnVisibility[col] !== false)
      : allColumns.filter((col) => !defaultHiddenColumns.includes(col))
  const hidden = allColumns.filter((col) => !visible.includes(col))

  /**
   * Columns this saved view has NEVER EXPRESSED AN OPINION ABOUT.
   *
   * `hidden` above cannot answer that question — it is DERIVED, "everything the
   * table declares that is not visible", so a column added to the table config
   * after this row was written is indistinguishable from one the user hid on
   * purpose. The only place the difference survives is the raw stored maps: a
   * key absent from BOTH `columnOrder` and `columnVisibility` was never decided,
   * because saving writes an entry for every column either way
   * (`dynamicTableToApi` below).
   *
   * Computed here rather than in `resolvePerspectiveState` for exactly that
   * reason: by the time the config reaches the resolver the raw maps are gone.
   * An empty `columnOrder` (a legacy row) means the view has no column opinions
   * at all, and its defaults are already being honoured above — so nothing is
   * "unseen" there either.
   */
  const unseenColumns =
    columnOrder.length > 0
      ? allColumns.filter(
          (col) => !columnOrder.includes(col) && !(col in columnVisibility),
        )
      : []

  const apiFilters = dto.settings.filters as Record<string, unknown> | undefined
  const filters: FilterRow[] = Array.isArray(apiFilters)
    ? (apiFilters as FilterRow[])
    : ((apiFilters?.rows as FilterRow[]) ?? [])
  const color = apiFilters?._color as PerspectiveConfig['color']

  const sorting: SortRule[] = (dto.settings.sorting ?? []).map((s) => ({
    id: s.id,
    field: s.id,
    direction: (s.desc ? 'desc' : 'asc') as 'asc' | 'desc',
  }))

  const grouping: GroupRule[] = (dto.settings.grouping ?? []).map((g) => ({
    id: g.id,
    field: g.field,
    direction: (g.desc ? 'desc' : 'asc') as 'asc' | 'desc',
  }))

  // Aggregations ride inside `filters._aggregations` — the upstream settings
  // schema strips unknown top-level keys, but `filters` is a passthrough record
  // (same channel as `_color`).
  const aggregations = parseAggregations(apiFilters?._aggregations)

  // Linked (lookup) columns ride the same `filters` passthrough channel as
  // `_aggregations`/`_color`.
  const lookupColumns = parseLookupColumns(apiFilters?._lookups)

  // Rollup ("summarised") columns — the one-to-many direction — ride the same
  // channel. A top-level `rollups` key would be stripped by the settings schema
  // and the columns would vanish on the first reload.
  const rollupColumns = parseRollupColumns(apiFilters?._rollups)

  // View-scoped date/time format rides the same passthrough channel. Opaque to
  // the table; only a well-formed string survives (anything else → undefined,
  // so renderers keep their default).
  const rawDateFormat = apiFilters?._dateFormat
  const dateFormat = typeof rawDateFormat === 'string' && rawDateFormat ? rawDateFormat : undefined

  // View-scoped conditional formatting ("Highlighting") rides the same
  // passthrough channel. Same trap as `_aggregations`: a top-level key would be
  // stripped by the settings schema and the rules would vanish on reload.
  const conditionalFormats = parseConditionalFormats(apiFilters?._conditionalFormats)

  // Frozen (pinned sticky-left) columns ride the same passthrough channel, and
  // for the same reason — measured, not assumed: saving a TOP-LEVEL
  // `frozenColumns` against the running API returns 200 OK and the key never
  // reaches the database, because the upstream settings schema is a bare
  // `z.object` whose vocabulary is columnOrder/columnVisibility/filters/
  // sorting/grouping/pageSize/searchValue, and Zod strips the rest (HEDGE-102).
  //
  // Defensive by construction, like the parsers around it: a legacy or
  // hand-edited view that stored a non-array, or an array with non-string
  // entries, loses the malformed parts rather than pinning `undefined` and
  // wedging the sticky-offset maths.
  const frozenColumns = Array.isArray(apiFilters?._frozenColumns)
    ? (apiFilters._frozenColumns as unknown[]).filter(
        (k): k is string => typeof k === 'string' && k.length > 0,
      )
    : undefined

  // Calculated ("formula") columns ride the same passthrough channel. The
  // parser is defensive by construction — a legacy or hand-edited view drops
  // the malformed entries rather than crashing the table. Do not hand-roll a
  // second one.
  const formulas = parseFormulaColumns(apiFilters?._formulas)

  // Personalization metadata rides the same passthrough channel, for the same
  // reason: the upstream settings schema strips unknown TOP-LEVEL keys, so a
  // `origin`/`published` field alongside `columnOrder` would be silently
  // dropped on the way to the database and the view would forget where it came
  // from on the very first reload.
  // How this view draws its rows. Same passthrough channel, same trap: a
  // top-level `viewMode` would be stripped by the settings schema and the view
  // would open as a table every time.
  const viewMode = parseViewMode(apiFilters?._viewMode)

  const origin = parsePerspectiveOrigin(apiFilters?._origin)
  const publication = parsePerspectivePublication(apiFilters?._published)
  // Two independent signals for the base row, and BOTH must hold. The flag is
  // authoritative; the reserved name is the belt-and-braces guard so a
  // hand-edited settings blob cannot make an ordinary named view disappear from
  // the tab strip.
  const isBaseView = apiFilters?._baseView === true && dto.name === BASE_VIEW_PERSPECTIVE_NAME

  return {
    id: dto.id,
    name: dto.name,
    color,
    columns: { visible, hidden },
    unseenColumns,
    filters,
    sorting,
    grouping,
    aggregations,
    lookupColumns,
    rollupColumns,
    formulas,
    dateFormat,
    conditionalFormats,
    frozenColumns,
    viewMode,
    isDefault: dto.isDefault,
    isBaseView,
    origin,
    publication,
  }
}

/**
 * Convert a DynamicTable PerspectiveConfig into the API format (PerspectiveSettings).
 * Used when saving perspectives via the API.
 */
export function dynamicTableToApi(config: DynamicTablePerspectiveConfig): PerspectiveSettings {
  const columnVisibility: Record<string, boolean> = {}
  config.columns.visible.forEach((col) => (columnVisibility[col] = true))
  config.columns.hidden.forEach((col) => (columnVisibility[col] = false))

  return {
    columnOrder: config.columns.visible,
    columnVisibility,
    // `v: 2` marks the current filter shape. The upstream perspectives service
    // (`maybeMigrateLegacyFilterValues`) DROPS any `filters` object that lacks
    // either `v === 2` or a `root` key, treating it as a legacy value it can't
    // migrate — so without this marker the saved filters silently vanish on load.
    // `_aggregations` rides here too (passthrough record), since the settings
    // schema would strip it as an unknown top-level key.
    filters: {
      v: 2,
      rows: config.filters,
      _color: config.color,
      _aggregations: config.aggregations ?? [],
      _lookups: config.lookupColumns ?? [],
      _rollups: config.rollupColumns ?? [],
      _dateFormat: config.dateFormat,
      _conditionalFormats: config.conditionalFormats ?? [],
      _formulas: config.formulas ?? [],
      // Written only when the view actually pins something, so a view that has
      // never used the feature does not grow an empty key — same rule as
      // `_viewMode` below.
      ...(config.frozenColumns && config.frozenColumns.length > 0
        ? { _frozenColumns: config.frozenColumns }
        : {}),
      // Written only when the view has a mode, so a table-only view does not
      // grow a key. `parseViewMode` treats absent and 'table' identically.
      ...(config.viewMode ? { _viewMode: config.viewMode } : {}),
      // Personalization metadata — see `apiToDynamicTable` for why it cannot
      // live at the top level. Written only when set, so a plain personal view
      // does not grow three null keys.
      ...(config.origin ? { _origin: config.origin } : {}),
      ...(config.publication ? { _published: config.publication } : {}),
      ...(config.isBaseView ? { _baseView: true } : {}),
    },
    sorting: config.sorting.map((s) => ({
      id: s.field,
      desc: s.direction === 'desc',
    })),
    grouping: (config.grouping ?? []).map((g) => ({
      id: g.id,
      field: g.field,
      desc: g.direction === 'desc',
    })),
  }
}
