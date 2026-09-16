'use client'

import * as React from 'react'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiCall } from '../../utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { flash } from '../../FlashMessages'
import { dispatch, useEventHandlers } from '../events/events'
import {
  apiToDynamicTable,
  apiTemplateToDynamicTable,
  dynamicTableToApi,
} from '../utils/perspectiveTransforms'
import TableDeleteDialog from '../components/TableDeleteDialog'
import type {
  ColumnDef,
  FilterRow,
  DynamicTableProps,
  PaginationProps,
  TableUIConfig,
  CellEditSaveEvent,
  CellSaveStartEvent,
  CellSaveSuccessEvent,
  CellSaveErrorEvent,
  NewRowSaveEvent,
  NewRowSaveErrorEvent,
  KeyboardShortcutsConfig,
  OnRowAction,
  LoadLookupSources,
  ExportAllResult,
} from '../types/index'
import { TableEvents } from '../types/index'
import { mergeSharedFilters } from '../split-view/sharedCriteria'
import { lookupColumnsToParam } from '../utils/lookupColumns'
import { rollupColumnsToParam } from '../utils/rollupColumns'
import type { LoadRollupSources, RollupColumnRef } from '../types/rollup'
import type { AggregationRule, AggregateResult, GroupRule } from '../types/grouping'
import type {
  PerspectiveConfig,
  PerspectiveSaveEvent,
  PerspectiveSelectEvent,
  PerspectiveRenameEvent,
  PerspectiveDeleteEvent,
  PerspectiveChangeEvent,
  PerspectiveDuplicateEvent,
  PerspectiveSetDefaultEvent,
  PerspectivePublishEvent,
  PerspectiveTemplateCopyEvent,
  PerspectiveTemplate,
  SortRule,
  LookupColumnRef,
  TableViewMode,
} from '../types/perspective'
import { BASE_VIEW_PERSPECTIVE_NAME, PERSPECTIVE_NAME_MAX_LENGTH } from '../types/perspective'
import type {
  PerspectivesIndexResponse,
  PerspectiveDto,
  PerspectiveSaveResponse,
} from '@open-mercato/shared/modules/perspectives/types'

// Stable identity so it can sit in effect dependency arrays without churning.
const EMPTY_COLUMNS: string[] = []

/**
 * The one perspective-write failure a user can actually act on.
 *
 * The upstream table SOFT-deletes views, but its unique index on
 * `(user, tenant, org, table, name)` ignores `deleted_at` — so a name you used
 * on a view you deleted earlier is still taken, forever, and the write comes
 * back as a duplicate-key 500 with no field-level detail. Every generic
 * "Failed to …" message sent the user round the same loop; naming the cause
 * tells them the one thing that will work.
 */
function perspectiveWriteError(response: { result?: unknown }, fallback: string): string {
  const message = (response.result as { message?: string } | undefined)?.message ?? ''
  return message.includes('duplicate key')
    ? 'A view you deleted earlier still holds this name. Pick a different name.'
    : fallback
}

const LAST_PERSPECTIVE_KEY_PREFIX = 'dt:lastPerspective:'

/**
 * How long a burst of single-cell saves is allowed to accumulate before ONE
 * list refetch runs. Long enough to swallow a paste/fill (whose per-cell PUTs
 * land within a few tens of ms of each other) and a human typing across
 * adjacent cells; short enough that a server-derived column updates while the
 * user is still looking at the row they changed.
 */
const LIST_REFETCH_COALESCE_MS = 400

/**
 * Remember which view the user was last on, per table. Session-scoped: it must
 * survive navigating into a record and back (the actual complaint) without
 * outliving the browser session or needing a server round-trip. Storage access
 * is guarded — SSR has no `window`, and Safari private mode throws on write.
 */
function readLastPerspectiveId(tableId: string | undefined): string | null {
  if (!tableId || typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(`${LAST_PERSPECTIVE_KEY_PREFIX}${tableId}`)
  } catch {
    return null
  }
}

function writeLastPerspectiveId(tableId: string | undefined, id: string | null): void {
  if (!tableId || typeof window === 'undefined') return
  try {
    const key = `${LAST_PERSPECTIVE_KEY_PREFIX}${tableId}`
    if (id) window.sessionStorage.setItem(key, id)
    else window.sessionStorage.removeItem(key)
  } catch {
    /* storage unavailable — last-view memory is best-effort */
  }
}

// ─── Config Types ────────────────────────────

export interface DynamicTablePageDeleteConfig<TRow = any> {
  title?: string | ((row: TRow) => string)
  description?: string | ((row: TRow) => string)
  nameColumn?: string
  /** Base URL or function returning full URL for the DELETE request */
  url?: string | ((row: TRow) => string)
}

export interface DynamicTablePageCellEditConfig {
  url?: string | ((payload: CellEditSaveEvent, rowData: any) => string)
  method?: 'PUT' | 'PATCH' | 'POST'
  mapPayload?: (payload: CellEditSaveEvent, rowData: any) => Record<string, unknown>
}

export interface DynamicTableCreateHandlerContext {
  tableRef: React.RefObject<HTMLElement>
  invalidate: () => void
}

export interface DynamicTablePageCreateConfig {
  url?: string
  mapPayload?: (rowData: any) => Record<string, unknown>
  /** Fully custom create flow. Replaces built-in logic. Handler must dispatch NEW_ROW_SAVE_START/SUCCESS/ERROR events. */
  handler?: (payload: NewRowSaveEvent, ctx: DynamicTableCreateHandlerContext) => Promise<void>
}

export interface DynamicTablePageHooks<TRow = any> {
  beforeCellEdit?: (
    payload: CellEditSaveEvent,
    rowData: any
  ) => { url?: string; payload?: Record<string, unknown>; method?: 'PUT' | 'PATCH' | 'POST' } | void
  beforeCreate?: (rowData: any) => Record<string, unknown> | Promise<Record<string, unknown>> | void
  validateCreate?: (rowData: any) => string | null
  afterMutation?: (
    type: 'cellEdit' | 'create' | 'delete',
    context: any
  ) => void | Promise<void>
  beforeDelete?: (row: TRow) => boolean | Promise<boolean>
}

export interface DynamicTablePageConfig<TRow = any> {
  source: string
  columns: ColumnDef[]
  tableName: string

  perspectives?: string
  /**
   * Entity id for the generic `/api/entities/filter-suggestions` endpoint.
   *
   * Prefer `loadFilterSuggestions` for any list whose columns are denormalised
   * or whose values are skewed: the generic endpoint samples a page of rows and
   * de-duplicates what it sees, so it under-reports common columns and returns
   * `[]` (silently) for anything that isn't a plain column on the entity's own
   * table.
   */
  filterSuggestions?: string
  /**
   * Custom suggestion loader — takes precedence over `filterSuggestions`.
   * Point this at a module route backed by `distinctColumnValues` so the list
   * offers real, scope-constrained values for every column it shows.
   */
  loadFilterSuggestions?: (field: string, query: string) => Promise<string[]>
  /**
   * Prefix for this instance's per-table CLIENT storage keys — the last-used
   * perspective (`sessionStorage`) and column widths (`localStorage`).
   *
   * Absent or `''` → today's keys, byte-for-byte, so no existing user loses a
   * saved width. A host that can mount the same table twice (split view) passes
   * something unique per instance, e.g. `pane:{paneId}:` — without it, both
   * instances derive the same key from `tableId` and overwrite each other.
   *
   * Deliberately NOT applied to density: that stays a user-global preference,
   * so an embedded table never silently gets a different row height from the
   * same table full-page.
   *
   * Spec: .ai/specs/2026-08-04-module-table-registry.md
   */
  storageScope?: string
  /** Loads the table's FK lookup sources. When set, the Configure View drawer
   *  shows a "Linked columns" section and the list request carries the active
   *  perspective's linked columns as a `lookups` param for server enrichment. */
  loadLookupSources?: LoadLookupSources
  /**
   * Loads the table's one-to-many rollup sources. When set, the Configure View
   * drawer shows a "Summarised columns" section, and this hook serialises the
   * active perspective's rollup columns into a `rollups` param for the list
   * route to aggregate.
   */
  loadRollupSources?: LoadRollupSources

  defaultSort?: { field: string; direction: 'asc' | 'desc' }
  defaultPageSize?: number
  /** Initial filters to seed on mount (e.g., from URL params). Only read once. */
  initialFilters?: FilterRow[]
  /**
   * Filters a WORKSPACE is driving this table with, already translated into
   * this table's own field names by `mapCriteriaForTable`.
   *
   * Held in a different place from the user's own `filters` on purpose. Merging
   * them into that state would overwrite what the user set in this pane, and
   * turning the workspace toggle back off could then restore nothing — the
   * local filters would be gone. These combine with `filters` ONLY where the
   * list request is built, and a shared rule wins over a local rule on the same
   * field for that request alone (see `mergeSharedFilters`).
   *
   * Absent ⇒ this hook behaves exactly as it did before the workspace existed.
   */
  sharedFilters?: FilterRow[]
  /**
   * The workspace search box's value, while the workspace is driving this pane.
   *
   * PRESENCE IS THE SWITCH, and the distinction matters:
   *   `undefined` → no workspace search; the pane's own search box applies.
   *   `''`        → the workspace bar IS on and its box is empty; the pane's
   *                 own (now HIDDEN) search must not keep filtering, so this
   *                 empty needle wins.
   * Any non-empty string replaces the pane's own search for the request. This
   * mirrors the UI: while the bar is on, each pane's search row is hidden, and
   * filtering by a box nobody can see is how a user comes to distrust the grid.
   * The pane's own `search` state is left untouched throughout, so switching the
   * workspace off restores it.
   */
  sharedSearch?: string
  idColumn?: string

  delete?: boolean | string | DynamicTablePageDeleteConfig<TRow>
  create?: boolean | DynamicTablePageCreateConfig
  cellEdit?: false | DynamicTablePageCellEditConfig

  queryKey?: string
  /** Extra values appended to the query key for cache invalidation (e.g., scopeVersion) */
  queryKeyDeps?: unknown[]
  extraParams?: Record<string, string> | (() => Record<string, string>)
  mapApiItem?: (item: any) => TRow | null

  hooks?: DynamicTablePageHooks<TRow>

  tableProps?: Partial<
    Omit<
      DynamicTableProps,
      'data' | 'columns' | 'tableRef' | 'pagination' | 'savedPerspectives' | 'activePerspectiveId' | 'tableName'
    >
  >
}

// ─── Return Type ─────────────────────────────

export interface DynamicTablePageResult<TRow = any> {
  props: DynamicTableProps
  /** Delete confirmation dialog. Render inline as {table.deleteDialog}. Returns null when no deletion is pending. */
  deleteDialog: React.ReactNode
  /** Trigger the delete dialog for a given row */
  setRowToDelete: (row: TRow | null) => void
  query: ReturnType<typeof useQuery>
  /**
   * Dataset-wide aggregate for the active view's aggregation rules. `null`
   * until it lands, or when the list route has not adopted `?aggregate=`.
   */
  aggregateResult: AggregateResult | null
  aggregateLoading: boolean
  aggregateError: boolean
  /**
   * The LIST request failed (HEDGE-119). Exposed for hosts that render their
   * own body instead of the grid, so they can refuse to draw an "empty"
   * affordance over a request that never landed.
   */
  isError: boolean
  isLoading: boolean
  refresh: () => void
  state: {
    page: number
    limit: number
    search: string
    filters: FilterRow[]
    sortField: string
    sortDir: 'asc' | 'desc'
    /**
     * The active grouping, mirrored up from the table.
     *
     * READ-ONLY, and it is a MIRROR, not the source: `DynamicTable` owns the
     * grouping state and reports it in PERSPECTIVE_CHANGE. A host that wants to
     * label something by the active grouping reads it here; a host that wants
     * to CHANGE it uses the Configure View drawer like everything else.
     */
    grouping: GroupRule[]
    /** How the table is currently drawing its rows. Same mirror contract. */
    viewMode: TableViewMode
  }
}

// ─── Hook ────────────────────────────────────

export function useDynamicTablePage<TRow = any>(
  config: DynamicTablePageConfig<TRow>
): DynamicTablePageResult<TRow> {
  const {
    source,
    columns,
    tableName,
    perspectives: perspectivesTableId,
    defaultSort,
    defaultPageSize = 50,
    idColumn = 'id',
    storageScope = '',
    hooks,
  } = config

  const tableRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  // Identity for this INSTANCE's client-side storage (last-used perspective,
  // column widths) — as opposed to `perspectivesTableId`, which identifies the
  // TABLE and must stay unscoped so every instance loads the same saved views
  // from the server. With an empty scope this is byte-identical to the old key.
  const storageTableId = perspectivesTableId
    ? `${storageScope}${perspectivesTableId}`
    : undefined

  // Organization scope. Features AND rows are org-scoped, and switching org
  // dispatches a client-side event with NO page reload — so without this in the
  // query key a cached table goes on showing the PREVIOUS organization's rows.
  // That is authorised data in the wrong scope, presented as current, which is
  // how someone invoices the wrong customer.
  //
  // Placed in the DEFAULT key rather than left to each table's `queryKeyDeps`:
  // only 3 of 20 tables opted in, so 17 carried the bug. One place fixes all.
  const organizationScopeVersion = useOrganizationScopeVersion()

  // ── State ──

  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(defaultPageSize)
  const [sortField, setSortField] = useState(defaultSort?.field ?? 'id')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSort?.direction ?? 'asc')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<FilterRow[]>(() => config.initialFilters ?? [])
  // Mirrors of table-owned view state, kept so a HOST can read them (a grid
  // renderer, a heading, an export label). Written only from PERSPECTIVE_CHANGE
  // — never set from here, because a second writer is a second source of truth.
  const [grouping, setGrouping] = useState<GroupRule[]>([])
  const [viewMode, setViewMode] = useState<TableViewMode>('table')

  const [savedPerspectives, setSavedPerspectives] = useState<PerspectiveConfig[]>([])
  // Views other people published for anyone to COPY. Never applied
  // automatically — see `PerspectiveTemplate`.
  const [sharedTemplates, setSharedTemplates] = useState<PerspectiveTemplate[]>([])
  const [activePerspectiveId, setActivePerspectiveId] = useState<string | null>(null)
  // Mirror of the active perspective's linked (lookup) columns. Synced from the
  // DynamicTable's perspective events so the list request can carry them to the
  // server for enrichment. The grid renders the columns itself from the same
  // perspective state.
  const [lookupColumns, setLookupColumns] = useState<LookupColumnRef[]>([])
  // Mirror of the active perspective's rollup ("summarised") columns, for the
  // same reason as `lookupColumns` — except the cost is higher: each distinct
  // SOURCE is one GROUP BY on the server, so the param carries only what the
  // active view actually asked for, and an empty param leaves the route
  // behaving byte-identically to before rollups existed.
  const [rollupColumns, setRollupColumns] = useState<RollupColumnRef[]>([])
  // Mirror of the active perspective's aggregation rules. Same reason as
  // `lookupColumns`: the grid owns the rules, but the DATASET-wide totals can
  // only be computed on the server, so the request has to carry them.
  const [aggregations, setAggregations] = useState<AggregationRule[]>([])

  const [pendingDelete, setPendingDelete] = useState<TRow | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  // Bulk delete drives a confirmation modal. The promise resolver bridges the
  // modal outcome back to the DynamicTable so it only clears its selection once
  // the rows are actually deleted (and keeps it on cancel).
  const [pendingBulkDelete, setPendingBulkDelete] = useState<string[] | null>(null)
  const bulkResolverRef = useRef<{ resolve: () => void; reject: (reason?: unknown) => void } | null>(null)

  const queryKeyBase = config.queryKey ?? source

  // ── List invalidation, COALESCED ──
  //
  // Every successful cell save used to call `invalidateQueries` on the spot, so
  // a three-cell edit produced three PUTs and three IDENTICAL GETs of the same
  // page (ledger row 9.7) — and a paste or a fill, which is one gesture, fires
  // one per written cell. The refetch is not what makes the screen correct: the
  // store writes the row object optimistically and the grid already renders the
  // new value. The refetch exists to pick up SERVER-DERIVED changes (computed
  // columns, a status recalculated by a subscriber), and for that a single
  // trailing refetch after the burst is exactly as correct as N of them.
  //
  // Trailing edge, not leading: the last write in a burst must be included.
  const listInvalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelPendingListInvalidation = useCallback(() => {
    if (listInvalidateTimerRef.current) {
      clearTimeout(listInvalidateTimerRef.current)
      listInvalidateTimerRef.current = null
    }
  }, [])
  const scheduleListInvalidation = useCallback(() => {
    cancelPendingListInvalidation()
    listInvalidateTimerRef.current = setTimeout(() => {
      listInvalidateTimerRef.current = null
      queryClient.invalidateQueries({ queryKey: [queryKeyBase] })
    }, LIST_REFETCH_COALESCE_MS)
  }, [cancelPendingListInvalidation, queryClient, queryKeyBase])
  /** Row-count changes (create / delete) refetch NOW — and supersede any pending burst. */
  const invalidateListNow = useCallback(() => {
    cancelPendingListInvalidation()
    queryClient.invalidateQueries({ queryKey: [queryKeyBase] })
  }, [cancelPendingListInvalidation, queryClient, queryKeyBase])
  useEffect(() => cancelPendingListInvalidation, [cancelPendingListInvalidation])

  // Columns the host table hides by default. Needed when rehydrating saved
  // perspectives: one saved without column config must fall back to the table's
  // defaults rather than revealing every hidden column.
  const defaultHiddenColumns = config.tableProps?.defaultHiddenColumns ?? EMPTY_COLUMNS

  // ── Perspectives ──

  const { data: perspectivesData, isFetched: perspectivesFetched } = useQuery({
    queryKey: ['perspectives', perspectivesTableId],
    queryFn: async () => {
      const response = await apiCall<PerspectivesIndexResponse>(
        `/api/perspectives/${perspectivesTableId}`
      )
      return response.ok ? response.result : null
    },
    enabled: !!perspectivesTableId,
  })

  // ── The list query waits for the perspective to be resolved ──
  //
  // Ledger 4.9: a saved view carrying rollup columns rendered every rollup cell
  // as "—" on the FIRST load. The columns come from the perspective and paint
  // immediately; the VALUES come from `?rollups=` on the list request, and that
  // param is derived from the same perspective — which had not been fetched yet
  // when the list query fired. So load one produced a request WITHOUT the param
  // (rollup columns present, all values null), and only the second request —
  // triggered when `setRollupColumns` finally changed `queryParams` — carried
  // it. Two round-trips, and a window in between where the grid confidently
  // shows em-dashes for numbers that exist.
  //
  // Gating the list on the perspective removes the wasted request rather than
  // re-timing it. `setPerspectiveHydrated(true)` is called in the SAME effect
  // that applies the restored filters/sort/lookups/rollups, so React batches
  // them into one re-render and the first request the user ever sees already
  // carries every param the view asked for.
  //
  // Two escape hatches, because a list that never loads is far worse than a
  // wasted request: a table with no `perspectives` id starts hydrated, and the
  // effect below flips the flag as soon as the perspectives request SETTLES,
  // whatever it returned (404, empty, or columns not built yet).
  const [perspectiveHydrated, setPerspectiveHydrated] = useState(!perspectivesTableId)

  useEffect(() => {
    if (!perspectivesTableId || !perspectivesFetched) return
    if (!perspectivesData?.perspectives || columns.length === 0) setPerspectiveHydrated(true)
  }, [perspectivesTableId, perspectivesFetched, perspectivesData, columns.length])

  // Guards the one-time initial perspective pick. Kept in a ref (not in the
  // effect deps) because `activePerspectiveId` used to be both read and written
  // here — which re-ran the effect and handed DynamicTable a brand-new
  // `savedPerspectives` array identity on every load.
  const initialPerspectivePickedRef = useRef(false)

  useEffect(() => {
    if (perspectivesData?.perspectives && columns.length > 0) {
      const allCols = columns.map((c) => c.data)
      const transformed = perspectivesData.perspectives.map((p) =>
        apiToDynamicTable(p, allCols, defaultHiddenColumns)
      )
      setSavedPerspectives(transformed)
      // Shared templates arrive on the SAME response the personal views do —
      // `rolePerspectives` has always been in the payload and was simply ignored.
      setSharedTemplates(
        (perspectivesData.rolePerspectives ?? []).map((rp) =>
          apiTemplateToDynamicTable(rp, allCols, defaultHiddenColumns)
        )
      )
      if (!initialPerspectivePickedRef.current) {
        // Prefer the view the user was last on over the server default, so
        // navigating into a record and back doesn't silently reset the list.
        // With neither, fall back to this user's saved personalization of the
        // base tab, so "Default view" opens the way they last left it.
        const remembered = readLastPerspectiveId(storageTableId)
        const baseViewId = transformed.find((p) => p.isBaseView)?.id ?? null
        const restored = remembered && transformed.some((p) => p.id === remembered)
          ? remembered
          : (perspectivesData.defaultPerspectiveId ?? baseViewId)
        // Close the gate as soon as the views have LOADED, whether or not one was
        // restored. It used to close only inside `if (restored)`, which made the
        // feature chicken-and-egg: with no remembered view and no server default
        // the ref stayed false forever, the persist effect below returned early,
        // and a manual tab click was never written — so the list could only
        // remember a view if it already remembered one. `remembered` is read
        // above, before the gate closes, so nothing is clobbered.
        initialPerspectivePickedRef.current = true
        if (restored) {
          setActivePerspectiveId(restored)
          // Apply the view's QUERY state here, not via the grid's
          // PERSPECTIVE_CHANGE event.
          //
          // The grid applies the view to ITSELF (columns, the sort arrow in the
          // header) and announces it with PERSPECTIVE_CHANGE. On a tab click
          // that reaches us and the list refetches. On first load it does NOT:
          // the grid's dispatch effect and this hook's listener registration
          // race, child passive effects run before the parent's, and the one
          // dispatch that carries the restored view fires before
          // `useEventHandlers` has attached. Proven in the browser — a cold load
          // of a view sorted by Reference # ↓ issued exactly one list request,
          // `sortField=containerNumber` (the table default), while the header
          // already painted the ↓ on Reference #; clicking the same tab then
          // issued `sortField=referenceNumber&sortDir=desc`.
          //
          // Reading the config straight off the perspective we just restored
          // removes the race entirely rather than re-timing it, and it is the
          // same projection `handlePerspectiveSelect` performs for a click, so
          // the two entry points cannot drift.
          const restoredPerspective = transformed.find((p) => p.id === restored)
          if (restoredPerspective) {
            // Only when the view HAS filters: a view without them must not wipe
            // `initialFilters` seeded from the URL (deep links carry a filter).
            if (restoredPerspective.filters.length > 0) setFilters(restoredPerspective.filters)
            setLookupColumns(restoredPerspective.lookupColumns ?? [])
            setRollupColumns(restoredPerspective.rollupColumns ?? [])
            setAggregations(restoredPerspective.aggregations ?? [])
            if (restoredPerspective.sorting.length > 0) {
              setSortField(restoredPerspective.sorting[0].field)
              setSortDir(restoredPerspective.sorting[0].direction)
            }
          }
        }
        // Released in the SAME batch as the setters above, so the very first
        // list request carries the restored view's rollups/lookups/sort/filters
        // rather than being issued once without them and again with (4.9).
        setPerspectiveHydrated(true)
      }
    }
  }, [perspectivesData, columns, defaultHiddenColumns, perspectivesTableId])

  // Persist every subsequent switch (tab click, save, delete-active) so the
  // next mount restores it. Gated on the initial pick so the mount-time `null`
  // can't wipe the remembered view before it has been read back.
  useEffect(() => {
    if (!initialPerspectivePickedRef.current) return
    writeLastPerspectiveId(storageTableId, activePerspectiveId)
  }, [activePerspectiveId, perspectivesTableId])

  // ── Workspace-shared criteria ──
  //
  // The ONLY place the workspace's criteria and this pane's own state meet.
  // Both `search`/`filters` above stay exactly what the user set here, so
  // turning the workspace off is a pure removal — nothing to restore, because
  // nothing was overwritten.
  const sharedFilters = config.sharedFilters
  const sharedSearch = config.sharedSearch
  // Identity note: with no shared filters this returns `filters` itself, so the
  // memo below sees the same reference it always did.
  const effectiveFilters = useMemo(
    () => mergeSharedFilters(filters, sharedFilters),
    [filters, sharedFilters],
  )
  const effectiveSearch = sharedSearch !== undefined ? sharedSearch : search

  // ── Data Query ──

  const queryParams = useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', String(limit))
    params.set('pageSize', String(limit))
    params.set('sortField', sortField)
    params.set('sortDir', sortDir)
    if (effectiveSearch) {
      params.set('q', effectiveSearch)
      params.set('search', effectiveSearch)
    }
    if (effectiveFilters.length) params.set('filters', JSON.stringify(effectiveFilters))
    if (lookupColumns.length) params.set('lookups', lookupColumnsToParam(lookupColumns))
    if (rollupColumns.length) params.set('rollups', rollupColumnsToParam(rollupColumns))

    const extra =
      typeof config.extraParams === 'function' ? config.extraParams() : config.extraParams
    if (extra) {
      Object.entries(extra).forEach(([key, value]) => params.set(key, value))
    }

    return params.toString()
  }, [page, limit, sortField, sortDir, effectiveSearch, effectiveFilters, lookupColumns, rollupColumns, config.extraParams])

  // `organizationScopeVersion` leads the deps so EVERY table refetches when the
  // user switches organization, whether or not it opted in via `queryKeyDeps`.
  // The three tables that already pass `scopeVersion` themselves are unaffected
  // — a repeated value in a query key is idempotent.
  const queryKeyDeps = useMemo(
    () => [organizationScopeVersion, ...(config.queryKeyDeps ?? [])],
    [organizationScopeVersion, config.queryKeyDeps],
  )

  const dataQuery = useQuery({
    queryKey: [queryKeyBase, queryParams, ...queryKeyDeps],
    queryFn: async () => {
      const call = await apiCall<{
        items: any[]
        total: number
        totalPages?: number
      }>(`${source}?${queryParams}`)
      if (!call.ok) throw new Error(`Failed to load ${tableName}`)
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
    // See `perspectiveHydrated` above (ledger 4.9). The skeleton stays up for
    // the extra ~50 ms the perspectives request costs; in exchange the first
    // response already carries the view's rollup values instead of a grid full
    // of em-dashes that silently corrects itself a round-trip later.
    enabled: perspectiveHydrated,
    placeholderData: (previousData) => previousData,
  })

  // ── Dataset-wide aggregate ──
  //
  // A SEPARATE request, deliberately: the rows must never wait on a full-table
  // SUM. The grid shows a page-scoped fold immediately and swaps in the dataset
  // figure when it lands. It reuses `queryParams` (same filters, same search)
  // minus paging, so the total always describes exactly the filtered set the
  // page is a window onto.
  // `field:fn`, or `field:fn:dimension` when the rule partitions its aggregate
  // (per-currency totals). The third segment is optional so every previously
  // published route keeps parsing the specs it already knows.
  const aggregateSpec = useMemo(
    () =>
      aggregations
        .map((r) => (r.dimension ? `${r.field}:${r.fn}:${r.dimension}` : `${r.field}:${r.fn}`))
        .join(','),
    [aggregations],
  )

  const aggregateParams = useMemo(() => {
    if (!aggregateSpec) return null
    const params = new URLSearchParams(queryParams)
    params.set('aggregate', aggregateSpec)
    // One row is enough to satisfy a route that always paginates; we only read
    // the `aggregate` key off the response.
    params.set('page', '1')
    params.set('limit', '1')
    params.set('pageSize', '1')
    return params.toString()
  }, [queryParams, aggregateSpec])

  // PROBE ONCE per page. `makeDynamicTableRoute` has no consumers yet, so most
  // list routes simply ignore `?aggregate=` — asking again on every filter
  // keystroke would be one wasted round-trip per keystroke, forever.
  const aggregateUnsupportedRef = useRef(false)

  const aggregateQuery = useQuery({
    queryKey: [queryKeyBase, 'aggregate', aggregateParams, ...queryKeyDeps],
    enabled: !!aggregateParams && !aggregateUnsupportedRef.current,
    queryFn: async () => {
      const call = await apiCall<{ aggregate?: AggregateResult }>(`${source}?${aggregateParams}`)
      // Degrade, never blank. A route that has not adopted `?aggregate=`
      // (or that rejects the param outright) is not an error condition: the
      // footer already holds a page-scoped fold, and saying "this page only"
      // is truthful. Blanking the totals because a probe failed would be a
      // strictly worse answer than the one we already have.
      if (!call.ok || !call.result?.aggregate) {
        aggregateUnsupportedRef.current = true
        return null
      }
      return call.result.aggregate
    },
    placeholderData: (previousData) => previousData,
  })

  const tableData = useMemo(() => {
    const items = dataQuery.data?.items ?? []
    if (config.mapApiItem) {
      return items.map(config.mapApiItem).filter(Boolean)
    }
    return items
  }, [dataQuery.data?.items, config.mapApiItem])

  // ── Whole-table export ──
  // Powers the toolbar Export button: page through `source` collecting every
  // row, ignoring the active perspective (filters + search) and pagination so
  // the export is the whole table. Keeps `extraParams` (tab/category scope) and
  // sort for stable ordering. Mapped through `mapApiItem` like the live table.
  //
  // HEDGE-123 — IT ABORTS, IT DOES NOT SHORTEN.
  //
  // This loop used to end every failure the same way it ended success: `break`,
  // then `return collected`. A page that 500'd, a page that came back `200`
  // with an unparseable body, and a walk that ran into the iteration cap all
  // produced a shorter array and nothing else. The user got a CSV that opened,
  // had headers, had rows, and was missing the rest — with no error anywhere.
  //
  // That is the same server failure as HEDGE-119 wearing different clothes:
  // there a failed fetch rendered as "no invoices", here it writes a short file
  // that reads as "these are all the invoices". The file is the more dangerous
  // of the two, because it looks like an answer and goes into a reconciliation.
  //
  // So: a failed or unparseable page THROWS (the toolbar catches it and says
  // the export failed, and no file is written), and a walk that cannot prove it
  // collected everything returns `complete: false` WITH ITS COUNTS rather than
  // a bare array.
  const exportAllRows = useCallback(async (): Promise<ExportAllResult> => {
    const pageLimit = 100 // upstream list cap
    const collected: any[] = []
    let pageNum = 1
    let expected: number | null = null

    // Bound the walk by what the SERVER says, not by a constant. The old
    // `guard < 1000` was a silent 100,000-row ceiling: a bigger table exported
    // short for a reason that had nothing to do with failure, and said nothing.
    // Once page 1 reports `totalPages` we know exactly how many iterations are
    // needed; the constant below is only a runaway stop for a server that never
    // reports one, and reaching it is now REPORTED rather than swallowed.
    const RUNAWAY_PAGE_CAP = 10_000
    let maxPages = RUNAWAY_PAGE_CAP
    let incomplete: string | null = null

    while (pageNum <= maxPages) {
      const params = new URLSearchParams()
      params.set('page', String(pageNum))
      params.set('limit', String(pageLimit))
      params.set('pageSize', String(pageLimit))
      params.set('sortField', sortField)
      params.set('sortDir', sortDir)
      const extra =
        typeof config.extraParams === 'function' ? config.extraParams() : config.extraParams
      if (extra) Object.entries(extra).forEach(([key, value]) => params.set(key, value))
      if (lookupColumns.length) params.set('lookups', lookupColumnsToParam(lookupColumns))
      if (rollupColumns.length) params.set('rollups', rollupColumnsToParam(rollupColumns))

      const call = await apiCall<{ items: any[]; total: number; totalPages?: number }>(
        `${source}?${params.toString()}`,
      )

      // The two failures that used to be indistinguishable from "done".
      // `!call.result` is NOT redundant with `!call.ok`: `apiCall` returns
      // `ok: true, result: null` for a 200 whose body will not parse, which is
      // exactly what a route erroring after its status line produces.
      if (!call.ok) {
        throw new Error(
          `Export failed on page ${pageNum} (HTTP ${call.status}) after ${collected.length} row(s)`,
        )
      }
      if (!call.result) {
        throw new Error(
          `Export failed on page ${pageNum}: the server returned no readable body after ${collected.length} row(s)`,
        )
      }

      const items = call.result.items ?? []
      collected.push(...items)

      if (typeof call.result.total === 'number') expected = call.result.total
      const total = call.result.total ?? collected.length
      const totalPages = call.result.totalPages ?? Math.ceil(total / pageLimit)
      // Now that the server has declared its own page count, hold the walk to
      // it. `+ 1` of slack absorbs a row appearing mid-walk without turning a
      // benign race into a hard stop.
      if (Number.isFinite(totalPages) && totalPages > 0) {
        maxPages = Math.min(RUNAWAY_PAGE_CAP, totalPages + 1)
      }

      if (items.length === 0 || pageNum >= totalPages) break
      pageNum++

      if (pageNum > maxPages) {
        incomplete =
          maxPages >= RUNAWAY_PAGE_CAP
            ? `stopped at the ${RUNAWAY_PAGE_CAP}-page safety limit`
            : `the server declared ${totalPages} page(s) but did not finish within them`
      }
    }

    const rows = config.mapApiItem
      ? collected.map(config.mapApiItem).filter(Boolean)
      : collected

    // A count shortfall is reported, never silently accepted — but it is NOT a
    // throw. Rows deleted by someone else while the walk was in flight make
    // `collected < expected` legitimately, and failing an export over a benign
    // concurrent edit would get the button distrusted. The caller decides; what
    // matters is that it is told, with both numbers.
    if (!incomplete && expected !== null && collected.length < expected) {
      incomplete = `fetched ${collected.length} of ${expected} row(s)`
    }

    return {
      rows,
      expected,
      complete: incomplete === null,
      ...(incomplete ? { reason: incomplete } : {}),
    }
  }, [source, sortField, sortDir, lookupColumns, rollupColumns, config.extraParams, config.mapApiItem])

  // ── Cell Edit Handler ──

  const handleCellEditSave = useCallback(
    async (payload: CellEditSaveEvent) => {
      if (config.cellEdit === false) return

      dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_START, {
        rowIndex: payload.rowIndex,
        colIndex: payload.colIndex,
      } as CellSaveStartEvent)

      try {
        const rowData = tableData[payload.rowIndex]
        if (!rowData) throw new Error('Row data not found')

        const cellEditConfig = typeof config.cellEdit === 'object' ? config.cellEdit : {}
        let hookResult: { url?: string; payload?: Record<string, unknown>; method?: string } | void = undefined

        if (hooks?.beforeCellEdit) {
          hookResult = hooks.beforeCellEdit(payload, rowData)
        }

        let apiUrl: string
        if (hookResult?.url) {
          apiUrl = hookResult.url
        } else if (typeof cellEditConfig.url === 'function') {
          apiUrl = cellEditConfig.url(payload, rowData)
        } else if (cellEditConfig.url) {
          apiUrl = `${cellEditConfig.url}/${(rowData as any)[idColumn]}`
        } else {
          apiUrl = `${source}/${(rowData as any)[idColumn]}`
        }

        let updatePayload: Record<string, unknown>
        if (hookResult?.payload) {
          updatePayload = hookResult.payload
        } else if (cellEditConfig.mapPayload) {
          updatePayload = cellEditConfig.mapPayload(payload, rowData)
        } else {
          updatePayload = { [payload.prop]: payload.newValue }
        }

        const method = hookResult?.method ?? cellEditConfig.method ?? 'PUT'

        const response = await apiCall<{ error?: string }>(apiUrl, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload),
        })

        if (response.ok) {
          dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_SUCCESS, {
            rowIndex: payload.rowIndex,
            colIndex: payload.colIndex,
          } as CellSaveSuccessEvent)
          scheduleListInvalidation()
          if (hooks?.afterMutation) await hooks.afterMutation('cellEdit', { payload, rowData })
        } else {
          const error = response.result?.error || 'Update failed'
          flash(error, 'error')
          dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_ERROR, {
            rowIndex: payload.rowIndex,
            colIndex: payload.colIndex,
            error,
          } as CellSaveErrorEvent)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        flash(errorMessage, 'error')
        dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_ERROR, {
          rowIndex: payload.rowIndex,
          colIndex: payload.colIndex,
          error: errorMessage,
        } as CellSaveErrorEvent)
      }
    },
    [tableData, scheduleListInvalidation, config.cellEdit, hooks, source, idColumn, queryKeyBase]
  )

  // ── New Row Handler ──

  const handleNewRowSave = useCallback(
    async (payload: NewRowSaveEvent) => {
      if (!config.create) return

      const createConfig = typeof config.create === 'object' ? config.create : {}

      // Custom handler — fully replaces built-in flow
      if (createConfig.handler) {
        await createConfig.handler(payload, {
          tableRef: tableRef as React.RefObject<HTMLElement>,
          invalidate: () => invalidateListNow(),
        })
        return
      }

      try {
        let rowPayload: Record<string, unknown> = { ...payload.rowData }

        if (hooks?.validateCreate) {
          const validationError = hooks.validateCreate(payload.rowData)
          if (validationError) {
            flash(validationError, 'error')
            dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_ERROR, {
              rowIndex: payload.rowIndex,
              error: validationError,
            } as NewRowSaveErrorEvent)
            return
          }
        }

        if (hooks?.beforeCreate) {
          const mapped = await hooks.beforeCreate(payload.rowData)
          if (mapped) rowPayload = mapped
        }

        if (createConfig.mapPayload) {
          rowPayload = createConfig.mapPayload(payload.rowData)
        }

        const createUrl = createConfig.url ?? source

        const response = await apiCall<{ id: string; error?: string }>(createUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rowPayload),
        })

        if (response.ok && response.result) {
          dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_SUCCESS, {
            rowIndex: payload.rowIndex,
            savedRowData: { ...payload.rowData, id: response.result.id },
          })
          invalidateListNow()
          if (hooks?.afterMutation)
            await hooks.afterMutation('create', { payload, result: response.result })
        } else {
          const error = response.result?.error || `Failed to create ${tableName}`
          flash(error, 'error')
          dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_ERROR, {
            rowIndex: payload.rowIndex,
            error,
          } as NewRowSaveErrorEvent)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : `Failed to create ${tableName}`
        flash(errorMessage, 'error')
        dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_ERROR, {
          rowIndex: payload.rowIndex,
          error: errorMessage,
        } as NewRowSaveErrorEvent)
      }
    },
    [config.create, hooks, source, tableName, queryClient, queryKeyBase]
  )

  // ── Delete Handler ──

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return

    if (hooks?.beforeDelete) {
      const proceed = await hooks.beforeDelete(pendingDelete)
      if (!proceed) return
    }

    setIsDeleting(true)
    try {
      const deleteId = (pendingDelete as any)[idColumn]
      let deleteUrl: string
      if (typeof config.delete === 'string') {
        deleteUrl = `${config.delete}/${deleteId}`
      } else if (typeof config.delete === 'object' && config.delete.url) {
        const urlConfig = config.delete.url
        deleteUrl = typeof urlConfig === 'function'
          ? urlConfig(pendingDelete)
          : `${urlConfig}/${deleteId}`
      } else {
        deleteUrl = `${source}/${deleteId}`
      }

      const response = await apiCall<{ error?: string }>(deleteUrl, { method: 'DELETE' })

      if (response.ok) {
        flash(`${tableName} deleted`, 'success')
        invalidateListNow()
        setPendingDelete(null)
        if (hooks?.afterMutation) await hooks.afterMutation('delete', { row: pendingDelete })
      } else {
        flash(response.result?.error || `Failed to delete ${tableName}`, 'error')
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : `Failed to delete ${tableName}`, 'error')
    } finally {
      setIsDeleting(false)
    }
  }, [pendingDelete, hooks, idColumn, config.delete, source, tableName, queryClient, queryKeyBase])

  // ── Bulk Delete Handler ──
  // Drives the DynamicTable grouped-actions bar. Deletes each selected row via
  // the same endpoint convention as the single-row delete, then refreshes the
  // list. Failures are tallied so a partial success still surfaces clearly.
  const buildDeleteUrl = useCallback(
    (id: string) => {
      if (typeof config.delete === 'string') return `${config.delete}/${id}`
      if (config.delete && typeof config.delete === 'object' && config.delete.url) {
        const urlConfig = config.delete.url
        return typeof urlConfig === 'function'
          ? urlConfig({ [idColumn]: id } as TRow)
          : `${urlConfig}/${id}`
      }
      return `${source}/${id}`
    },
    [config.delete, idColumn, source]
  )

  // onBulkDelete prop for DynamicTable: open the confirmation modal and return a
  // promise that resolves once the rows are deleted, or rejects if cancelled.
  const requestBulkDelete = useCallback(
    (ids: string[]) =>
      new Promise<void>((resolve, reject) => {
        if (!ids.length) {
          resolve()
          return
        }
        bulkResolverRef.current = { resolve, reject }
        setPendingBulkDelete(ids)
      }),
    []
  )

  const handleConfirmBulkDelete = useCallback(async () => {
    const ids = pendingBulkDelete
    if (!ids || !ids.length) return
    setIsDeleting(true)
    try {
      let deleted = 0
      let failed = 0
      for (const id of ids) {
        try {
          const response = await apiCall<{ error?: string }>(buildDeleteUrl(id), { method: 'DELETE' })
          if (response.ok) deleted += 1
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (deleted > 0) flash(`${deleted} ${tableName} deleted`, 'success')
      if (failed > 0) flash(`Failed to delete ${failed} ${tableName}`, 'error')
      invalidateListNow()
      if (hooks?.afterMutation) await hooks.afterMutation('delete', { ids })
      bulkResolverRef.current?.resolve()
    } finally {
      bulkResolverRef.current = null
      setPendingBulkDelete(null)
      setIsDeleting(false)
    }
  }, [pendingBulkDelete, buildDeleteUrl, tableName, queryClient, queryKeyBase, hooks])

  const cancelBulkDelete = useCallback(() => {
    bulkResolverRef.current?.reject(new Error('cancelled'))
    bulkResolverRef.current = null
    setPendingBulkDelete(null)
  }, [])

  // ── Perspective Handlers ──

  const handlePerspectiveSave = useCallback(
    async (payload: PerspectiveSaveEvent) => {
      if (!perspectivesTableId) return
      const settings = dynamicTableToApi(payload.perspective)
      // Resolve the row to update BY ID FIRST, name only as a fallback.
      //
      // Name-only matching is what made "rename in the Configure View drawer"
      // create a SECOND view: the panel minted a fresh client-side id, the name
      // had just changed, nothing matched, and the upsert inserted. An id that
      // is already in `savedPerspectives` is a server uuid by construction, so
      // it is safe to send as `perspectiveId`; a client-minted id (a brand-new
      // view) matches nothing and correctly falls through to insert.
      const existingPerspective =
        savedPerspectives.find((p) => p.id === payload.perspective.id) ??
        savedPerspectives.find((p) => p.name === payload.perspective.name)
      const response = await apiCall<PerspectiveSaveResponse>(`/api/perspectives/${perspectivesTableId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // The upstream validator reads `perspectiveId`, not `id` — an `id` key
          // is stripped by zod and the save silently falls back to an upsert by
          // NAME. Harmless here (same name ⇒ same row) but fatal for rename,
          // which changes the name and so used to CLONE the view.
          perspectiveId: existingPerspective?.id,
          name: payload.perspective.name,
          settings,
        }),
      })
      if (response.ok) {
        // `silent` is set for saves the user did not explicitly ask for — the
        // column order written back after a header drag. The write and the
        // refetch still happen; only the confirmation toast is dropped.
        if (!payload.silent) {
          flash(
            payload.perspective.isBaseView ? 'Default view saved' : 'Perspective saved',
            'success',
          )
        }
        queryClient.invalidateQueries({ queryKey: ['perspectives', perspectivesTableId] })
        const savedId = response.result?.perspective?.id
        if (savedId) setActivePerspectiveId(savedId)
      } else {
        // See `perspectiveWriteError` — the deleted-name collision is the one
        // failure here a user can act on, and every perspective write can hit it.
        flash(perspectiveWriteError(response, 'Failed to save perspective'), 'error')
      }
    },
    [perspectivesTableId, savedPerspectives, queryClient]
  )

  const handlePerspectiveSelect = useCallback(
    (payload: PerspectiveSelectEvent) => {
      setActivePerspectiveId(payload.id)
      if (payload.config) {
        setFilters(payload.config.filters)
        setLookupColumns(payload.config.lookupColumns ?? [])
        setRollupColumns(payload.config.rollupColumns ?? [])
        setAggregations(payload.config.aggregations ?? [])
        if (payload.config.sorting.length > 0) {
          setSortField(payload.config.sorting[0].field)
          setSortDir(payload.config.sorting[0].direction)
        }
        setPage(1)
      } else {
        setFilters([])
        setLookupColumns([])
        setRollupColumns([])
        setAggregations([])
        setSortField(defaultSort?.field ?? 'id')
        setSortDir(defaultSort?.direction ?? 'asc')
        setPage(1)
      }
    },
    [defaultSort]
  )

  const handlePerspectiveRename = useCallback(
    async (payload: PerspectiveRenameEvent) => {
      if (!perspectivesTableId) return
      const perspective = savedPerspectives.find((p) => p.id === payload.id)
      if (perspective) {
        // Refuse locally rather than round-trip to a 400 whose body says
        // nothing. The rename input caps typing at the same limit, so this only
        // fires for a name assembled in code (a "(copy)" suffix on an already
        // long name) — and when it does, it names the actual problem instead of
        // "Failed to rename perspective".
        if (payload.newName.length > PERSPECTIVE_NAME_MAX_LENGTH) {
          flash(
            `A view name can be at most ${PERSPECTIVE_NAME_MAX_LENGTH} characters. This one is ${payload.newName.length}.`,
            'error',
          )
          return
        }
        const settings = dynamicTableToApi(perspective)
        const response = await apiCall(`/api/perspectives/${perspectivesTableId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // `perspectiveId`, not `id` — see handlePerspectiveSave. With `id` the
          // rename created a SECOND view under the new name and left the old one.
          body: JSON.stringify({ perspectiveId: payload.id, name: payload.newName, settings }),
        })
        if (response.ok) {
          flash('Perspective renamed', 'success')
          queryClient.invalidateQueries({ queryKey: ['perspectives', perspectivesTableId] })
        } else {
          flash(perspectiveWriteError(response, 'Failed to rename perspective'), 'error')
        }
      }
    },
    [perspectivesTableId, savedPerspectives, queryClient]
  )

  /**
   * A6 — duplicate. A brand-new row (no `perspectiveId`) carrying the source's
   * settings under a new name, and explicitly NOT the default: a copy must never
   * hijack which view opens tomorrow.
   *
   * `publication` is dropped for the same reason, and it is not cosmetic. It
   * rides the settings blob as `_published`, so duplicating a view that had been
   * shared produced a SECOND view that reported itself as a published template —
   * its `⋯` menu said "Update shared template…" and the tab claimed a shelf
   * entry that does not exist, because duplicate never calls `applyToRoles` and
   * so writes no role rows at all. Every view is PRIVATE by default
   * (personalization model, 2026-08-03); publishing is an explicit act on the
   * copy, not something inherited from what it was copied from.
   *
   * `isBaseView` goes too: the base row owns the reserved `__base__` name and
   * there can only be one per user, so a copy carrying the flag would render as
   * a second "Default view".
   */
  const handlePerspectiveDuplicate = useCallback(
    async (payload: PerspectiveDuplicateEvent) => {
      if (!perspectivesTableId) return
      const settings = dynamicTableToApi({
        ...payload.perspective,
        name: payload.newName,
        isDefault: false,
        isBaseView: false,
        publication: undefined,
      })
      const response = await apiCall<PerspectiveSaveResponse>(`/api/perspectives/${perspectivesTableId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: payload.newName, settings, isDefault: false }),
      })
      if (response.ok) {
        flash('View duplicated', 'success')
        queryClient.invalidateQueries({ queryKey: ['perspectives', perspectivesTableId] })
        const savedId = response.result?.perspective?.id
        if (savedId) setActivePerspectiveId(savedId)
      } else {
        flash(perspectiveWriteError(response, 'Failed to duplicate view'), 'error')
      }
    },
    [perspectivesTableId, queryClient]
  )

  /**
   * A4 — make a view this USER's default. `isDefault` is a first-class column
   * on the upstream entity scoped by `userId`; the service demotes the caller's
   * other views in one `nativeUpdate` and touches nobody else's rows.
   */
  const handlePerspectiveSetDefault = useCallback(
    async (payload: PerspectiveSetDefaultEvent) => {
      if (!perspectivesTableId) return
      const perspective = savedPerspectives.find((p) => p.id === payload.id)
      if (!perspective) return
      const settings = dynamicTableToApi(perspective)
      const response = await apiCall(`/api/perspectives/${perspectivesTableId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          perspectiveId: payload.id,
          name: perspective.name,
          settings,
          isDefault: payload.isDefault,
        }),
      })
      if (response.ok) {
        flash('Default view updated', 'success')
        queryClient.invalidateQueries({ queryKey: ['perspectives', perspectivesTableId] })
      } else {
        flash('Failed to set the default view', 'error')
      }
    },
    [perspectivesTableId, savedPerspectives, queryClient]
  )

  /**
   * PUBLISH — make one of MY views copyable by colleagues.
   *
   * One POST does both halves, which is why it is one request and not two:
   * `applyToRoles` writes the role-scoped template rows, and the same call
   * re-saves the personal row with `_published` so the tab menu can say
   * "Update shared template" next time. `setRoleDefault` is pinned to `false`
   * — a template must never become anybody's default view. Publishing changes
   * nobody's screen; it only puts the view on the shelf.
   *
   * The template necessarily carries the view's own name: the upstream service
   * uses one `name` for both the personal row and the role rows, so allowing a
   * different template name here would silently RENAME the publisher's view.
   */
  const handlePerspectivePublish = useCallback(
    async (payload: PerspectivePublishEvent) => {
      if (!perspectivesTableId) return
      const perspective = savedPerspectives.find((p) => p.id === payload.id)
      if (!perspective || !payload.roleIds.length) return
      const settings = dynamicTableToApi({
        ...perspective,
        publication: { roleIds: payload.roleIds, publishedAt: new Date().toISOString() },
      })
      const response = await apiCall(`/api/perspectives/${perspectivesTableId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          perspectiveId: payload.id,
          name: perspective.name,
          settings,
          applyToRoles: payload.roleIds,
          setRoleDefault: false,
        }),
      })
      if (response.ok) {
        flash('View shared as a template', 'success')
        queryClient.invalidateQueries({ queryKey: ['perspectives', perspectivesTableId] })
      } else {
        flash('Failed to share the view', 'error')
      }
    },
    [perspectivesTableId, savedPerspectives, queryClient],
  )

  /**
   * COPY A TEMPLATE — the only way a shared view reaches your screen.
   *
   * Writes a brand-new PERSONAL row (no `perspectiveId`), never the default,
   * carrying `_origin` = which template and which version it came from. That
   * record is what lets a later pass ask "the shared template changed — update
   * yours?" instead of the two silently diverging.
   */
  const handlePerspectiveTemplateCopy = useCallback(
    async (payload: PerspectiveTemplateCopyEvent) => {
      if (!perspectivesTableId) return
      const { template } = payload
      const settings = dynamicTableToApi({
        ...template,
        name: payload.newName,
        isDefault: false,
        isBaseView: false,
        publication: undefined,
        origin: {
          templateId: template.id,
          version: template.version,
          name: template.name,
          copiedAt: new Date().toISOString(),
        },
      })
      const response = await apiCall<PerspectiveSaveResponse>(`/api/perspectives/${perspectivesTableId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: payload.newName, settings, isDefault: false }),
      })
      if (response.ok) {
        flash('Template copied to your views', 'success')
        queryClient.invalidateQueries({ queryKey: ['perspectives', perspectivesTableId] })
        const savedId = response.result?.perspective?.id
        if (savedId) setActivePerspectiveId(savedId)
      } else {
        flash(perspectiveWriteError(response, 'Failed to copy the template'), 'error')
      }
    },
    [perspectivesTableId, queryClient],
  )

  const handlePerspectiveDelete = useCallback(
    async (payload: PerspectiveDeleteEvent) => {
      if (!perspectivesTableId) return
      const url = payload.hardDelete
        ? `/api/perspectives/${perspectivesTableId}/${payload.id}?hardDelete=true`
        : `/api/perspectives/${perspectivesTableId}/${payload.id}`
      const response = await apiCall(url, { method: 'DELETE' })
      if (response.ok) {
        flash('Perspective deleted', 'success')
        queryClient.invalidateQueries({ queryKey: ['perspectives', perspectivesTableId] })
        if (activePerspectiveId === payload.id) {
          setActivePerspectiveId(null)
          setFilters([])
          setSortField(defaultSort?.field ?? 'id')
          setSortDir(defaultSort?.direction ?? 'asc')
        }
      } else {
        flash('Failed to delete perspective', 'error')
      }
    },
    [perspectivesTableId, activePerspectiveId, queryClient, defaultSort]
  )

  const handlePerspectiveChange = useCallback(
    (payload: PerspectiveChangeEvent) => {
      if (payload.config.lookupColumns) {
        setLookupColumns(payload.config.lookupColumns)
        setPage(1)
      }
      // Rollups do NOT reset the page — they add a column to the rows already
      // on screen, they do not change which rows those are.
      if (payload.config.rollupColumns) {
        setRollupColumns(payload.config.rollupColumns)
      }
      // Aggregations do NOT reset the page — they change what the footer says,
      // not which rows are shown.
      if (payload.config.aggregations) {
        setAggregations(payload.config.aggregations)
      }
      // Grouping and view mode are MIRRORED, never acted on: both are folds
      // over the rows already fetched, so neither changes the request and
      // neither may reset the page. Resetting on a grouping change would throw
      // the user back to page 1 for a purely visual regroup.
      if (payload.config.grouping) {
        setGrouping(payload.config.grouping)
      }
      if (payload.config.viewMode) {
        setViewMode(payload.config.viewMode)
      }
      if (payload.config.sorting) {
        if (payload.config.sorting.length > 0) {
          const firstSort = payload.config.sorting[0]
          setSortField(firstSort.field)
          setSortDir(firstSort.direction)
        } else {
          setSortField(defaultSort?.field ?? 'id')
          setSortDir(defaultSort?.direction ?? 'asc')
        }
        setPage(1)
      }
    },
    [defaultSort]
  )

  // ── Register Event Handlers ──

  const eventHandlers = useMemo(() => {
    const handlers: Record<string, any> = {
      [TableEvents.COLUMN_SORT]: (payload: { columnName: string; direction: 'asc' | 'desc' | null }) => {
        setSortField(payload.columnName)
        setSortDir(payload.direction || 'asc')
        setPage(1)
      },
      [TableEvents.SEARCH]: (payload: { query: string }) => {
        setSearch(payload.query)
        setPage(1)
      },
      [TableEvents.FILTER_CHANGE]: (payload: { filters: FilterRow[] }) => {
        setFilters(payload.filters)
        setPage(1)
      },
    }

    if (config.cellEdit !== false) {
      handlers[TableEvents.CELL_EDIT_SAVE] = handleCellEditSave
    }

    if (config.create) {
      handlers[TableEvents.NEW_ROW_SAVE] = handleNewRowSave
    }

    if (perspectivesTableId) {
      handlers[TableEvents.PERSPECTIVE_SAVE] = handlePerspectiveSave
      handlers[TableEvents.PERSPECTIVE_SELECT] = handlePerspectiveSelect
      handlers[TableEvents.PERSPECTIVE_RENAME] = handlePerspectiveRename
      handlers[TableEvents.PERSPECTIVE_DELETE] = handlePerspectiveDelete
      handlers[TableEvents.PERSPECTIVE_CHANGE] = handlePerspectiveChange
      handlers[TableEvents.PERSPECTIVE_DUPLICATE] = handlePerspectiveDuplicate
      handlers[TableEvents.PERSPECTIVE_SET_DEFAULT] = handlePerspectiveSetDefault
      handlers[TableEvents.PERSPECTIVE_PUBLISH] = handlePerspectivePublish
      handlers[TableEvents.PERSPECTIVE_TEMPLATE_COPY] = handlePerspectiveTemplateCopy
    }

    return handlers
  }, [
    config.cellEdit,
    config.create,
    perspectivesTableId,
    handleCellEditSave,
    handleNewRowSave,
    handlePerspectiveSave,
    handlePerspectiveSelect,
    handlePerspectiveRename,
    handlePerspectiveDelete,
    handlePerspectiveChange,
    handlePerspectiveDuplicate,
    handlePerspectiveSetDefault,
    handlePerspectivePublish,
    handlePerspectiveTemplateCopy,
  ])

  useEventHandlers(eventHandlers, tableRef as React.RefObject<HTMLElement>)

  // ── Filter Suggestions ──

  const customLoadFilterSuggestions = config.loadFilterSuggestions
  const loadFilterSuggestions = useMemo(() => {
    // An explicit loader wins: it is the only way a list can suggest values for
    // columns that aren't plain fields on its own entity table.
    if (customLoadFilterSuggestions) return customLoadFilterSuggestions
    if (!config.filterSuggestions) return undefined
    const entityType = config.filterSuggestions

    return async (field: string, query: string): Promise<string[]> => {
      try {
        const params = new URLSearchParams({ entityId: entityType, field, query: query || '' })
        const result = await apiCall<{ items: string[] }>(
          `/api/entities/filter-suggestions?${params.toString()}`,
          { credentials: 'include' }
        )
        if (!result.ok || !result.result) return []
        return result.result.items ?? []
      } catch {
        return []
      }
    }
  }, [config.filterSuggestions, customLoadFilterSuggestions])

  // ── Build DynamicTable Props ──

  const pagination: PaginationProps = useMemo(
    () => ({
      currentPage: page,
      totalPages: Math.ceil((dataQuery.data?.total || 0) / limit),
      limit,
      total: dataQuery.data?.total ?? 0,
      limitOptions: [25, 50, 100],
      onPageChange: setPage,
      onLimitChange: (l: number) => {
        setLimit(l)
        setPage(1)
      },
    }),
    [page, limit, dataQuery.data?.total]
  )

  const dynamicTableProps: DynamicTableProps = useMemo(() => {
    const baseProps: DynamicTableProps = {
      tableRef,
      data: tableData,
      columns,
      tableName,
      // Stable identity for per-user column-width persistence. Reuse the
      // perspectives table id when present, else fall back to the entity source.
      tableId: storageTableId ?? `${storageScope}${source}`,
      idColumnName: idColumn,
      colHeaders: true,
      rowHeaders: true,
      pagination,
      // Read-only, for ONE thing: the in-grid finder's scope label says
      // "…in 100 loaded rows (filtered by \"abc\")". Without it, a finder count
      // and a SearchBar filter can be conflated while both are active.
      // The EFFECTIVE needle, so the label names what actually narrowed the
      // rows — a workspace search when one is driving this pane, this pane's
      // own box otherwise (identical when no workspace is involved).
      searchQuery: effectiveSearch,
      onExportAll: exportAllRows,
      aggregateResult: aggregateQuery.data ?? null,
      aggregateLoading: aggregateQuery.isFetching,
      aggregateError: aggregateQuery.isError,
      // HEDGE-119 — carry the list query's FAILURE to the grid.
      //
      // `tableData` above collapses a rejected query to `[]` (there is no
      // `dataQuery.data` to read items off), so without this flag the grid
      // cannot tell "the server refused" from "the server said zero rows" and
      // paints `EmptyState` for both. That is how a 500 on the invoice queue
      // reached an accountant as the words "Nothing here yet".
      //
      // `placeholderData` keeps the PREVIOUS page's rows visible while a
      // refetch fails, so this is deliberately not `|| isError` on the whole
      // grid: rows we still hold are still shown, and the error state only
      // takes over the zero-row region, which is the case that lies.
      loadError: dataQuery.isError,
      onRetryLoad: () => { void dataQuery.refetch() },
      ...(perspectivesTableId
        ? {
            savedPerspectives,
            activePerspectiveId,
            // A4/A6 — which view opens by default FOR THIS USER. Comes straight
            // off the perspectives index (`isDefault` is scoped by `userId`), so
            // the star on the tab is a per-user fact, never an org-wide one.
            defaultPerspectiveId: perspectivesData?.defaultPerspectiveId ?? null,
            // Personal views + shared templates. `canPublishTemplates` is the
            // server's own answer (`perspectives.role_defaults`), not a guess:
            // a user without the feature never sees the publish affordance, and
            // the endpoint would 403 them anyway.
            sharedTemplates,
            canPublishTemplates: perspectivesData?.canApplyToRoles ?? false,
            publishableRoles: perspectivesData?.roles ?? [],
          }
        : {}),
      ...(loadFilterSuggestions ? { loadFilterSuggestions } : {}),
      ...(config.loadLookupSources ? { loadLookupSources: config.loadLookupSources } : {}),
      ...(config.loadRollupSources ? { loadRollupSources: config.loadRollupSources } : {}),
      ...(config.delete ? { onBulkDelete: requestBulkDelete } : {}),
      ...config.tableProps,
      // LAST, so it cannot be overridden: while a workspace search is driving
      // this pane, that pane's own search box is ignored (see `sharedSearch`).
      // Leaving it on screen would let a user type into a box that does
      // nothing — and the density argument for the bar only holds if the rows
      // it replaces actually go away. Absent `sharedSearch`, this spreads
      // nothing and `config.tableProps` still has the final word.
      ...(sharedSearch !== undefined ? { hideSearch: true } : {}),
    }

    return baseProps
  }, [
    tableData,
    columns,
    tableName,
    idColumn,
    pagination,
    effectiveSearch,
    exportAllRows,
    aggregateQuery.data,
    aggregateQuery.isFetching,
    aggregateQuery.isError,
    dataQuery.isError,
    dataQuery.refetch,
    perspectivesTableId,
    source,
    savedPerspectives,
    activePerspectiveId,
    perspectivesData?.defaultPerspectiveId,
    perspectivesData?.canApplyToRoles,
    perspectivesData?.roles,
    sharedTemplates,
    loadFilterSuggestions,
    config.loadLookupSources,
    config.loadRollupSources,
    config.delete,
    requestBulkDelete,
    config.tableProps,
    sharedSearch,
  ])

  // ── Delete Dialog Props ──

  const deleteConfig = config.delete
  const dialogConfig = useMemo(() => {
    if (!deleteConfig) return null
    if (typeof deleteConfig === 'object' && typeof deleteConfig !== 'boolean') {
      return deleteConfig as DynamicTablePageDeleteConfig
    }
    return {} as DynamicTablePageDeleteConfig
  }, [deleteConfig])

  const cancelDelete = useCallback(() => setPendingDelete(null), [])

  // Return JSX element (not a component) so the Dialog's element type is always
  // TableDeleteDialog — React keeps it mounted across state changes, preserving
  // animation state. Using a component (function) would cause unmount/remount on
  // every dep change since the function identity changes.
  const deleteDialog = dialogConfig ? (
    <>
      <TableDeleteDialog
        row={pendingDelete}
        isDeleting={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={cancelDelete}
        restoreFocusRef={tableRef}
        title={dialogConfig.title}
        description={dialogConfig.description}
        nameColumn={dialogConfig.nameColumn}
      />
      <TableDeleteDialog
        row={pendingBulkDelete ? ({ count: pendingBulkDelete.length } as TRow) : null}
        isDeleting={isDeleting}
        onConfirm={handleConfirmBulkDelete}
        onCancel={cancelBulkDelete}
        restoreFocusRef={tableRef}
        title={(row: any) => `Delete ${row?.count ?? ''} ${tableName}`.replace(/\s+/g, ' ').trim()}
        description={(row: any) =>
          `Are you sure you want to delete ${row?.count ?? 'these'} selected items? This action cannot be undone.`}
      />
    </>
  ) : null

  return {
    props: dynamicTableProps,
    deleteDialog,
    setRowToDelete: setPendingDelete,
    query: dataQuery,
    aggregateResult: aggregateQuery.data ?? null,
    aggregateLoading: aggregateQuery.isFetching,
    aggregateError: aggregateQuery.isError,
    // HEDGE-119 — hosts that render their own body (split views, card modes)
    // need the same signal the grid now gets, so they can refuse to draw an
    // "empty" affordance over a request that never landed.
    isError: dataQuery.isError,
    // `!perspectiveHydrated` counts as loading. TanStack reports `isLoading`
    // false while a query is DISABLED (it is pending but not fetching), so
    // without this the host would drop its skeleton and paint an empty grid for
    // the one frame the list is waiting on the perspective.
    isLoading: (!perspectiveHydrated || dataQuery.isLoading) && !dataQuery.data,
    refresh: () => invalidateListNow(),
    state: { page, limit, search, filters, sortField, sortDir, grouping, viewMode },
  }
}

