// DynamicTable.tsx


'use client';

import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { createCellStore, CellStore } from './store/index';
import {
  CellStoreContext,
  useStickyOffsets,
  ROW_HEADER_WIDTH,
  useKeyboardNavigation,
  useCopyHandler,
  useRowActionShortcuts,
  columnMountsEditor,
} from './hooks/index';
import {
  createCellHandlers,
  createRowHandlers,
  createDragHandlers,
  createMouseHandlers,
  createColumnHeaderHandlers,
  createRowHeaderHandlers,
  createContextMenuHandlers,
  createResizeHandlers,
  DragState,
} from './handlers/index';
import { createPerspectiveHandlers, resolvePerspectiveState } from './handlers/perspectiveHandlers';
import { TableDateFormatContext } from './hooks/useTableDateFormat';
import { useColumnWidthPersistence } from './hooks/useColumnWidthPersistence';
import { useColumnVirtualizer } from './hooks/useColumnVirtualizer';
import { getPinnedColumnIndices } from './utils/columnWindow';
import { computeColumnFill } from './utils/columnFill';
import { useDensityPreference } from './hooks/useDensityPreference';
import { DENSITY_ATTRIBUTE, resolveDensityRowHeight } from './types/density';
import { DensityControl } from './components/DensityControl';
import { ToolbarOverflow } from './components/ToolbarOverflow';
import { dispatch, useEventHandlers } from './events/events';
import {
  ColumnDef,
  ContextMenuState,
  SortState,
  FilterRow,
  TableEvents,
  FilterChangeEvent,
  PaginationProps,
  ContextMenuAction,
  SavedFilter,
  TableUIConfig,
  LoadFilterSuggestions,
  LoadLookupSources,
  KeyboardShortcutsConfig,
  OnRowAction,
  SelectionBounds,
} from './types/index';
import {
  PerspectiveConfig,
  PerspectiveTemplate,
  SortRule,
  PerspectiveChangeEvent,
  LookupColumnRef,
} from './types/perspective';
import type { TableViewMode } from './types/perspective';
import type { TableBodyRenderContext, ExportAllResult } from './types/index';
import { ViewModeSwitch } from './components/ViewModeSwitch';
import { buildLookupColumnDefs } from './utils/lookupColumns';
import type { LoadRollupSources, RollupColumnRef } from './types/rollup';
import { buildRollupColumnDefs } from './utils/rollupColumns';
import { applyCellWrites } from './handlers/cellWrites';
import type { CellWrite, CellWriteOrigin, CellWriteReport } from './handlers/cellWrites';
import { coerceCellValue } from './utils/coerceCellValue';
import { parseClipboardGrid, selectionToTsv } from './utils/clipboard';
import { detectFillPattern, generateFill, invertFillMode } from './utils/fillPatterns';
import type { FillMode, FillSeed } from './utils/fillPatterns';
import { buildFillLines, cellsInRect, computeFillPreview } from './utils/fillGeometry';
import { compileConditionalFormats } from './utils/conditionalFormat';
import type { ConditionalFormatRule } from './utils/conditionalFormat';
import { buildFormulaColumnDefs, isFormulaColumnKey } from './utils/formulaColumns';
import { fieldMetaFromColumns } from './formula/check';
import type { FormulaColumnRef } from './formula/types';
import { badgeFitWidth, recordBadgeFit, planBadgeWidths } from './utils/badgeAutoFit';
import type { GroupRule, AggregationRule, AggregateResult, VisualRow as VisualRowType } from './types/grouping';

import { useGrouping, computeAggregates } from './hooks/useGrouping';

// Import components
import PerspectiveTabs from './components/PerspectiveTabs';
import ConfigureViewPanel from './components/ConfigureViewPanel';
import SearchBar from './components/SearchBar';
import ActiveFilterChips from './components/ActiveFilterChips';
import EmptyState from './components/EmptyState';
import LoadErrorState from './components/LoadErrorState';
import StaleDataBar from './components/StaleDataBar';
import ContextMenu from './components/ContextMenu';
import VirtualRow from './components/VirtualRow';
import GroupHeaderRow from './components/GroupHeaderRow';
import GroupSummaryRow from './components/GroupSummaryRow';
import FooterTotalsRow from './components/FooterTotalsRow';
import ColumnHeaders from './components/ColumnHeaders';
import BulkActionsBar from './components/BulkActionsBar';
import ExportMenu from './components/ExportMenu';
import {
  extractExportRows,
  extractExportRowsFromData,
  toCsv,
  toXlsxBlob,
  slugifyFileName,
  downloadBlob,
  type ExtractedTable,
  type ExportFormat,
} from './utils/exportTable';
import Debugger from './components/Debugger';
import FullscreenOverlay from './components/FullscreenOverlay';
import { Maximize2, FunnelX, Replace } from 'lucide-react';
import { generateSortRuleId, generatePerspectiveId, BASE_VIEW_PERSPECTIVE_NAME } from './types/perspective';
import { useAnnotations, annotationKey } from './hooks/useAnnotations';
import type { AnnotationComment } from './hooks/useAnnotations';
import CellCommentDialog from './components/CellCommentDialog';
import CellCommentHoverPopup from './components/CellCommentHoverPopup';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../primitives/dialog';
import { Button } from '../../primitives/button';
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context';
import { flash } from '../FlashMessages';
import TablePagination from './components/TablePagination';

/**
 * Stable empty default for `defaultGrouping`. A fresh `[]` per render would give
 * every effect that depends on it a new identity each commit — and one of those
 * effects RESETS the table's group rules, so an inline default would silently
 * undo the user's own grouping on the next render.
 */
const EMPTY_GROUP_RULES: GroupRule[] = [];

// Built-in action ids for the drag-selection context menu (handled internally
// in DynamicTable, not dispatched to consumer cellActions handlers).
const SELECTION_COPY_ID = '__cellsel_copy';
const SELECTION_ANNOTATE_ID = '__cellsel_annotate';

/** Input types that are buttons/toggles, not places a caret can sit. */
const NON_TEXT_INPUT_TYPES = ['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'];

/**
 * Is this element a place the user is typing into?
 *
 * Every grid-level keyboard shortcut that shadows a native text-editing key
 * (`Ctrl+Z`, `Ctrl+D`, `Delete`, `Backspace`) has to defer to the search box,
 * a filter input or an open cell editor. One predicate so a new shortcut
 * cannot get the exemption list subtly wrong.
 */
function isTextEntryTarget(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || el.isContentEditable) return true;
  return tag === 'INPUT' && !NON_TEXT_INPUT_TYPES.includes((el as HTMLInputElement).type);
}

if (typeof window !== 'undefined') {
  // @ts-ignore - CSS import handled by bundler
  import('./styles/DynamicTable.css');
  // @ts-ignore - v2 appearance theme layer (scoped under .hot-appearance-v2)
  import('./styles/DynamicTable.v2.css');
}

// ============================================
// PROPS INTERFACE
// ============================================

export interface DynamicTableProps {
  data?: any[];
  columns?: ColumnDef[];
  colHeaders?: boolean;
  rowHeaders?: boolean;
  height?: string | number;
  width?: string | number;
  idColumnName?: string;
  /**
   * Column holding a value that is **unique per visual row**, used as the
   * identity key for checkbox selection. Defaults to `idColumnName`. Set this
   * when `idColumnName` is an entity key that repeats across rows (e.g. a
   * transport grid with one row per leg but `idColumnName='unitId'`), otherwise
   * selecting one row also selects its siblings sharing the same id.
   */
  rowKeyColumn?: string;
  tableName?: string;
  /**
   * The LIST request failed (HEDGE-119) — as opposed to "the list is empty".
   * Both reach this component as `data: []`, so without this flag the zero-row
   * region cannot tell them apart and renders `EmptyState` for a 500. Defaults
   * false; every pre-existing host keeps its current behaviour.
   */
  /**
   * REQUIRED, not optional — HEDGE-123.
   *
   * It was `loadError?: boolean` and defaulted to `false`, which quietly meant
   * "every caller that has not thought about this asserts the fetch succeeded".
   * The hook-driven tables were fixed; six components that fetch their own data
   * and render this component directly were simply never visited, and went on
   * reporting a 500 as "no rows" — a contractor with a failed address request
   * looked like a contractor with no addresses.
   *
   * Optionality is what let that happen silently. Required, the compiler names
   * every site that renders a table, so a new one cannot be added without
   * someone deciding what a failed load looks like. Pass `false` for a table
   * whose rows are local and cannot fail.
   */
  loadError: boolean;
  /** Re-runs the failed list request, from the error state's retry button. */
  onRetryLoad?: () => void;
  /**
   * Stable identifier for this table, used to persist per-user column widths in
   * localStorage across reloads. Scoped to the signed-in user (falling back to
   * the active organization). When omitted, manual column resizes are not
   * remembered. Pass the same id you use for `perspectives` so widths track the
   * table, not the page instance.
   */
  tableId?: string;
  /**
   * Row density. `'sm'` = 36px rows, `'md'` = 44px rows. Omitted uses the
   * 32px default (Figma 220:2935 — the tight v2 baseline).
   */
  density?: 'sm' | 'md';
  /** Zebra-stripe alternate rows with the secondary surface (v2 design). */
  striped?: boolean;
  /** Called with the selected row IDs whenever the v2 checkbox-column selection changes. */
  onSelectionChange?: (selectedIds: string[]) => void;
  /**
   * Batch-delete the given row IDs. When provided, selecting more than one row
   * via the checkbox column reveals a grouped-actions bar with a Delete action.
   */
  onBulkDelete?: (ids: string[]) => void | Promise<void>;
  /**
   * Fetch the entire dataset (all pages, ignoring the active perspective's
   * filters) for a whole-table export. Supplied by `useDynamicTablePage`. When
   * present, the toolbar Export button exports every row across all columns;
   * when absent it falls back to the currently-loaded page.
   */
  /**
   * Fetch the whole dataset for the toolbar export. MAY REJECT — a page that
   * fails mid-pagination must abort the export, never shorten it (HEDGE-123).
   *
   * The union with {@link ExportAllResult} must stay in step with the identical
   * prop in `types/index.ts`. It did not, briefly: `types/index.ts` was widened
   * for HEDGE-123 and this declaration was not, which broke every host that
   * spreads `{...table.props}` into this component. `packages/ui`'s own tsc
   * cannot catch that — the hosts live in other packages — so the workspace
   * typecheck is the gate that matters for this prop.
   */
  onExportAll?: () => Promise<any[] | ExportAllResult>;
  tableRef: React.RefObject<HTMLDivElement | null>;
  /** Message to display when data is empty (e.g., "No addresses") */
  emptyMessage?: string;
  columnActions?: (column: ColumnDef, colIndex: number) => ContextMenuAction[];
  rowActions?: (rowData: any, rowIndex: number) => ContextMenuAction[];
  cellActions?: (rowData: any, col: ColumnDef, rowIndex: number, colIndex: number) => ContextMenuAction[];
  actionsRenderer?: (rowData: any, rowIndex: number) => React.ReactNode;
  pagination?: PaginationProps;
  /**
   * The dataset-wide search term currently narrowing `data` (the `SearchBar`'s
   * query). Read-only, used for ONE thing: find-and-replace's scope label says
   * "…in 100 loaded rows (filtered by "abc")", so a loaded-page match count can
   * never be mistaken for a dataset count. Omitted → the clause is omitted.
   */
  searchQuery?: string;

  // NEW - Perspective management
  /**
   * Array of perspective configurations to display in the perspective tabs/dropdown.
   * Perspectives define saved views with filters, sorting, column visibility, etc.
   * 
   * VIRTUAL PERSPECTIVES:
   * Perspectives with IDs starting with '__' (double underscore) are considered
   * "virtual" or "system" perspectives. They are hidden from the UI tabs (via
   * PerspectiveTabs.tsx filter) but can still be active to provide functionality
   * like URL-based filtering.
   * 
   * Example virtual perspective: `{ id: '__url_filters__', name: 'Filters from URL', ... }`
   */
  savedPerspectives?: PerspectiveConfig[];
  
  /**
   * The ID of the currently active perspective. When controlled by parent component,
   * the table will sync its internal state (filters, sorting, columns) to match
   * the active perspective.
   * 
   * CONTROLLED MODE:
   * When both `savedPerspectives` and `activePerspectiveId` are provided, the table
   * operates in controlled mode. The parent component manages perspective state and
   * the table syncs to match.
   * 
   * CLEARING PERSPECTIVES:
   * Set to `null` to clear the active perspective. The table will update its internal
   * state but will NOT re-apply the perspective if the parent tries to set it again
   * to the same value (prevents infinite loops when user manually clears filters).
   * 
   * VIRTUAL PERSPECTIVES:
   * Virtual perspective IDs (starting with '__') can be used as `activePerspectiveId`
   * to provide hidden functionality without cluttering the UI.
   */
  activePerspectiveId?: string | null;

  /**
   * The view that opens by default FOR THIS USER (workshop A4). Rendered as a
   * star on the tab and used to disable "Set as my default" on the view that
   * already is one. Per-user by contract: `isDefault` is scoped to `userId`
   * upstream, so this never reflects — or changes — anyone else's choice.
   */
  defaultPerspectiveId?: string | null;

  /**
   * Views colleagues have published as SHARED TEMPLATES. Offered for copying —
   * never applied to anyone automatically. A copy lands in the user's own space
   * and records which template and which version it came from.
   */
  sharedTemplates?: PerspectiveTemplate[];

  /**
   * Whether this user may publish a view as a shared template. Comes from the
   * server's own RBAC answer (`perspectives.role_defaults`), so the affordance
   * is absent exactly when the endpoint would refuse it.
   */
  canPublishTemplates?: boolean;

  /** Roles a template can be published to. Empty unless `canPublishTemplates`. */
  publishableRoles?: Array<{ id: string; name: string }>;

  /** Default columns to hide when no perspective is active */
  defaultHiddenColumns?: string[];

  /**
   * How rows are grouped when no perspective is active — the table's DEFAULT
   * VIEW, and the only way a host can open on a grouping without first writing
   * a saved view into the database.
   *
   * It seeds state exactly as `defaultHiddenColumns` does: on mount and on every
   * reset to the base view. A saved perspective replaces it wholesale, so a view
   * saved with no grouping opens with no grouping — the alternative (merging)
   * would make "ungrouped" a thing a user cannot save.
   *
   * Rules naming a column the table does not declare are dropped rather than
   * applied; see `resolvePerspectiveState`.
   */
  defaultGrouping?: GroupRule[];

  /**
   * ⚠ `DynamicTableProps` IS DECLARED TWICE — here and in `types/index.ts`.
   *
   * They have drifted in BOTH directions, which is how FMS's production build
   * broke: this copy carried `defaultGrouping` and not `renderBody`, the other
   * carried `renderBody` and not `defaultGrouping`, and the component and its
   * consumers each resolved a different one. `tsc` reported a prop that is
   * plainly used as not existing.
   *
   * Reconciled rather than merged: collapsing two ~150-member interfaces is a
   * change worth doing on its own, not while unblocking a deploy. Anything
   * added to one MUST be added to the other until then.
   */
  /** An alternative body renderer — the tile grid. Called only while
   *  `viewMode` is not `'table'`. */
  renderBody?: (ctx: TableBodyRenderContext) => React.ReactNode;

  // DEPRECATED - Keep for backward compatibility (converts to perspectives internally)
  savedFilters?: SavedFilter[];
  activeFilterId?: string | null;
  hiddenColumns?: string[];

  // Debug mode - shows floating event log panel
  debug?: boolean;

  // UI visibility configuration
  uiConfig?: TableUIConfig;

  /** When true, automatically selects the first cell when table receives focus with no existing selection */
  autoSelectOnFocus?: boolean;

  /**
   * When true, Tab navigation enters edit mode on the target cell (Excel-like behavior).
   * When false, Tab only selects the cell without entering edit mode.
   * @default true
   */
  autoEditOnTab?: boolean;

  /**
   * Function to load filter suggestions from the server.
   * When provided, the filter popover will fetch suggestions via this function
   * instead of extracting values from currently loaded data.
   * Recommended for large datasets (1000+ rows) to avoid client-side performance issues.
   */
  loadFilterSuggestions?: LoadFilterSuggestions;

  /**
   * Loads the table's FK lookup sources. When provided, the Configure View
   * drawer shows a "Linked columns" section so the user can attach read-only
   * columns pulled from FK-related records to the active perspective.
   */
  loadLookupSources?: LoadLookupSources;

  /**
   * Loads the table's one-to-many rollup sources. When provided, the Configure
   * View drawer shows a "Summarised columns" section so the user can attach
   * read-only aggregates over child records ("sum of this folder's cost lines")
   * to the active perspective.
   */
  loadRollupSources?: LoadRollupSources;

  /**
   * Date/time format presets this table offers. When provided (non-empty), the
   * Configure View drawer shows a "Date format" selector so each perspective can
   * carry its own display format, and the active choice is published to cell
   * renderers via `useTableDateFormat()`. The `value` strings are opaque host
   * tokens the table stores and round-trips but never interprets. Omit to leave
   * date formatting entirely to the host's renderers.
   */
  dateFormatOptions?: { value: string; label: string }[];

  /**
   * Keyboard shortcuts configuration for row-level actions.
   * Shortcuts only fire when a single cell is selected (not editing, not multi-select).
   */
  keyboardShortcuts?: KeyboardShortcutsConfig;

  /**
   * Callback fired when a keyboard shortcut triggers a row action.
   * Receives the shortcut id, the row data, and the row index.
   */
  onRowAction?: OnRowAction;

  /**
   * Refs to adjacent DynamicTable containers for cross-table navigation.
   * ArrowDown at the last row / ArrowUp at the first row moves focus to
   * `next` / `prev`. Tab past the last editable cell also moves to `next`,
   * and Shift+Tab before the first editable cell moves to `prev`.
   */
  siblingTableRefs?: {
    prev?: React.RefObject<HTMLDivElement | null>;
    next?: React.RefObject<HTMLDivElement | null>;
  };
  /**
   * Callback when a row is clicked. Enables clickable row mode with hover highlighting.
   * The callback receives the row index, row data, and the mouse event.
   * Clicks on interactive elements (buttons, inputs, etc.) are excluded.
   */
  onRowClick?: (rowIndex: number, rowData: any, event: React.MouseEvent) => void;

  /**
   * ID of the row to highlight (same style as hover).
   * When set, the row with matching ID will be visually highlighted and scrolled into view
   * if not already visible. Useful for syncing selection state with external components.
   */
  highlightedRowId?: string | null;

  /**
   * Width in pixels for the actions column.
   * Increase this when you have more action buttons (e.g., 3+ icons).
   * @default 80
   */
  actionsColumnWidth?: number;

  /** Enable cell comments and color annotations */
  enableComments?: boolean;
  /** Entity type for annotations. String or function that resolves per-row (e.g., for mixed transport types). */
  commentsEntityType?: string | ((row: any) => string);
  /**
   * B8a — resolve the annotation target for ONE CELL.
   *
   * Defaults to today's behaviour: `{ entityType: commentsEntityType,
   * rowId: String(row[idColumnName]) }`, so no existing consumer changes.
   *
   * Declare it when a row is not one record. On the transport list a row is a
   * unit-leg: `truckPlate` belongs to the leg, `containerNumber` belongs to the
   * container that rides on both legs, `bookingNumber` to the sea leg. Without
   * this, one comment on the container appeared on every leg of that container
   * — "on się teraz powiela w innych miejscach".
   *
   * MUST be a pure function of `(row, col)`; it is called once per rendered
   * cell and once per row × column when the annotation request is built.
   */
  commentsCellTarget?: (row: Record<string, any>, col: ColumnDef) => { entityType: string; rowId: string };
  /** Optional view context label stored as metadata (e.g., "project_sea_containers"). */
  commentsViewContext?: string;
  /** Called after any annotation or comment change (create, update, delete). */
  onAnnotationChange?: () => void;
  /**
   * Server-computed aggregate over the WHOLE filtered dataset (`?aggregate=`).
   * Supplied by `useDynamicTablePage`. When absent, the pinned totals row still
   * renders — folded from the loaded page and labelled as page-scoped, which is
   * the honest answer rather than a silent lie.
   */
  aggregateResult?: AggregateResult | null;
  /** The dataset aggregate request is in flight. */
  aggregateLoading?: boolean;
  /** The dataset aggregate request failed — the footer says so instead of showing 0. */
  aggregateError?: boolean;
}

// ============================================
// MAIN DYNAMIC TABLE COMPONENT
// ============================================
const DynamicTable: React.FC<DynamicTableProps> = ({
  data = [],
  columns = [],
  colHeaders = true,
  rowHeaders = false,
  height = 'auto',
  width = 'auto',
  idColumnName = 'id',
  rowKeyColumn,
  tableName = 'Table Name',
  loadError,
  onRetryLoad,
  tableId,
  density,
  striped = false,
  onSelectionChange,
  onBulkDelete,
  onExportAll,
  tableRef,
  emptyMessage,
  columnActions,
  rowActions,
  cellActions,
  actionsRenderer,
  pagination,
  searchQuery,
  // New perspective props
  savedPerspectives: propSavedPerspectives,
  activePerspectiveId: controlledActivePerspectiveId,
  defaultPerspectiveId,
  sharedTemplates,
  canPublishTemplates = false,
  publishableRoles,
  defaultHiddenColumns = [],
  defaultGrouping = EMPTY_GROUP_RULES,
  // Deprecated props (backward compatibility)
  savedFilters: deprecatedSavedFilters,
  activeFilterId: deprecatedActiveFilterId,
  hiddenColumns: deprecatedHiddenColumns = [],
  debug = false,
  uiConfig = {},
  autoSelectOnFocus = false,
  autoEditOnTab = true,
  loadFilterSuggestions,
  loadLookupSources,
  loadRollupSources,
  dateFormatOptions,
  keyboardShortcuts,
  onRowAction,
  siblingTableRefs,
  onRowClick,
  highlightedRowId,
  actionsColumnWidth: actionsColumnWidthProp = 80,
  enableComments = false,
  commentsEntityType,
  commentsCellTarget,
  commentsViewContext,
  onAnnotationChange,
  aggregateResult = null,
  aggregateLoading = false,
  aggregateError = false,
  renderBody,
}) => {
  // NOTE: the `appearance` prop is a deprecated no-op — every table renders the
  // v2 design system. The prop is retained in the type only for Tier-3 BC.

  // -------------------- BACKWARD COMPATIBILITY --------------------
  // Convert deprecated savedFilters to savedPerspectives format
  const savedPerspectives = useMemo<PerspectiveConfig[]>(() => {
    if (propSavedPerspectives) {
      return propSavedPerspectives;
    }
    // Convert old savedFilters to perspectives
    if (deprecatedSavedFilters && deprecatedSavedFilters.length > 0) {
      return deprecatedSavedFilters.map(filter => ({
        id: filter.id,
        name: filter.name,
        color: filter.color,
        columns: {
          visible: columns.map(c => c.data),
          hidden: [] as string[],
        },
        filters: filter.rows,
        sorting: [] as SortRule[],
        grouping: [] as GroupRule[],
        aggregations: [] as AggregationRule[],
        lookupColumns: [] as LookupColumnRef[],
      }));
    }
    return [];
  }, [propSavedPerspectives, deprecatedSavedFilters, columns]);

  // Use new prop or deprecated prop
  const controlledActiveId = controlledActivePerspectiveId !== undefined
    ? controlledActivePerspectiveId
    : deprecatedActiveFilterId;

  // Merge hidden columns from deprecated prop and new prop
  const initialHiddenColumns = useMemo(() => {
    return [...new Set([...defaultHiddenColumns, ...deprecatedHiddenColumns])];
  }, [defaultHiddenColumns, deprecatedHiddenColumns]);

  // -------------------- UI CONFIG --------------------
  const {
    hideToolbar = false,
    hideTitle = false,
    searchSuggestions,
    searchDebounceMs,
    searchPlaceholder,
    formatGroupValue,
    hideSearch = false,
    hideAddRowButton = false,
    hidePerspectiveTabs: hidePerspectiveTabsExplicit,
    hidePagination = false,
    hideActionsColumn = false,
    topBarStart,
    topBarEnd,
    searchBarEnd,
    searchBarStart,
    beforeBody,
    enableFullscreen = false,
    onFullscreenChange,
    enableFillHandle = false,
    fillConfirmThreshold = 100,
    readOnlyStyle = 'muted',
    rowHoverStyle = 'default',
    disableBuiltinColumnMenu = false,
    borderless = false,
    bulkActions,
    hideExportButton = false,
    exportFileName,
    enableColumnVirtualization = false,
    columnOverscan,
    hideDensityControl = false,
    expandToolbarActions = false,
    toolbarOverflowExtras,
    densityLevel: densityLevelOverride,
    viewModes,
    onViewModeChange,
  } = uiConfig;

  // -------------------- DENSITY (PER-USER) --------------------
  // One attribute on the container flips a block of CSS custom properties
  // (styles/density.css) and restyles every mounted cell with ZERO React work.
  // `comfortable` is the default and matches today's rendering exactly, so a
  // user who never opens the picker sees no change at all.
  const { density: densityLevel } = useDensityPreference(densityLevelOverride, tableId);
  // NOTE the distinct attribute name. `data-density` is the LEGACY developer
  // prop ('sm' | 'md'), and `DynamicTable.v2.css` carries rules keyed on
  // `:not([data-density])` that define part of today's DEFAULT rendering —
  // reusing that attribute would switch those rules off the moment a user
  // picked `comfortable`, which is the "opting out is a no-op" guarantee,
  // broken. Spread rather than written literally because the attribute name is
  // owned by types/density.ts, not by this file.
  const densityAttribute = useMemo(
    () => ({ [DENSITY_ATTRIBUTE]: densityLevel }) as Record<string, string>,
    [densityLevel],
  );

  // Auto-hide perspective tabs when no perspectives are configured
  const hasPerspectives = !!(propSavedPerspectives || deprecatedSavedFilters);
  const hidePerspectiveTabs = hidePerspectiveTabsExplicit ?? !hasPerspectives;

  // Translator + locale are read HERE, above the column build, because the
  // formula column defs need `t` for their per-cell error tooltips and the
  // footer/summary rows need `locale` for number formatting.
  const t = useT();
  const locale = useLocale();

  // -------------------- REFS --------------------
  const storeRef = useRef<CellStore | null>(null);
  const dragStateRef = useRef<DragState>({
    isDragging: false,
    type: null,
    start: null,
  });

  // -------------------- CONSTANTS --------------------
  const actionsColumnWidth = actionsColumnWidthProp;

  // -------------------- BASE COLUMNS --------------------
  // -------------------- LINKED (LOOKUP) COLUMNS --------------------
  // Read-only columns surfaced from FK-related records, carried by the active
  // perspective. Initialised from the active perspective on mount; updated via
  // the Configure View "Linked columns" section and perspective select.
  const [lookupColumns, setLookupColumns] = useState<LookupColumnRef[]>(() => {
    const activePerspective = controlledActiveId
      ? savedPerspectives.find(p => p.id === controlledActiveId)
      : null;
    return activePerspective?.lookupColumns ?? [];
  });
  const lookupColumnDefs = useMemo(() => buildLookupColumnDefs(lookupColumns), [lookupColumns]);

  // -------------------- ROLLUP (SUMMARISED) COLUMNS --------------------
  // The one-to-many direction: aggregates over the records that point AT this
  // row. Same lifecycle as linked columns — carried by the active perspective,
  // updated by the Configure View "Summarised columns" section. The VALUE is
  // attached to the row by the host's list route (which sees the `rollups`
  // query param the host derives from these refs); the grid only renders it.
  const [rollupColumns, setRollupColumns] = useState<RollupColumnRef[]>(() => {
    const activePerspective = controlledActiveId
      ? savedPerspectives.find(p => p.id === controlledActiveId)
      : null;
    return activePerspective?.rollupColumns ?? [];
  });
  const rollupColumnDefs = useMemo(
    () => buildRollupColumnDefs(rollupColumns, { locale }),
    [rollupColumns, locale],
  );

  // -------------------- CALCULATED (FORMULA) COLUMNS --------------------
  // Same lifecycle as linked columns: carried by the active perspective,
  // initialised on mount, updated by the Configure View "Calculated columns"
  // section and by a perspective switch.
  const [formulas, setFormulas] = useState<FormulaColumnRef[]>(() => {
    const activePerspective = controlledActiveId
      ? savedPerspectives.find(p => p.id === controlledActiveId)
      : null;
    return activePerspective?.formulas ?? [];
  });

  const nativeColumns = useMemo(() => {
    let raw: ColumnDef[];
    if (columns.length > 0) {
      raw = columns;
    } else if (data.length > 0 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
      raw = Object.keys(data[0])
        .filter((k) => k !== '_isNew')
        .map((k) => ({ data: k }));
    } else {
      raw = [];
    }
    // Virtual columns go LAST and in a fixed order (linked, then summarised) so
    // adding one never shifts the index of a native column.
    if (lookupColumnDefs.length === 0 && rollupColumnDefs.length === 0) return raw;
    return [...raw, ...lookupColumnDefs, ...rollupColumnDefs];
  }, [columns, data, lookupColumnDefs, rollupColumnDefs]);

  // A formula may reference native and linked columns, never another formula —
  // `fields` is therefore derived from the NON-formula set. Memoised per
  // (formulas, fields): the returned defs own the per-row evaluation cache, so
  // rebuilding them on every render would throw that cache away every frame.
  const formulaColumnDefs = useMemo(
    () => buildFormulaColumnDefs(formulas, { fields: fieldMetaFromColumns(nativeColumns), translate: t }),
    [formulas, nativeColumns, t],
  );

  const baseColumns = useMemo(
    () => (formulaColumnDefs.length > 0 ? [...nativeColumns, ...formulaColumnDefs] : nativeColumns),
    [nativeColumns, formulaColumnDefs],
  );

  // -------------------- PERSPECTIVE STATE --------------------
  const initialState = useMemo(() => {
    // Find active perspective
    const activePerspective = controlledActiveId
      ? savedPerspectives.find(p => p.id === controlledActiveId)
      : null;
    return resolvePerspectiveState({
      baseColumns,
      perspective: activePerspective,
      defaultHiddenColumns: initialHiddenColumns,
      defaultGrouping,
    });
  }, []); // Only compute on mount

  const [visibleColumns, setVisibleColumns] = useState<string[]>(initialState.visibleColumns);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(initialState.hiddenColumns);
  const [filters, setFilters] = useState<FilterRow[]>(initialState.filters);
  const [sortRules, setSortRules] = useState<SortRule[]>(initialState.sortRules);
  const [groupRules, setGroupRules] = useState<GroupRule[]>(initialState.groupRules);
  /**
   * How this table draws its rows. Held EXACTLY like `groupRules` — seeded from
   * the active perspective, dispatched upward in PERSPECTIVE_CHANGE, persisted
   * by the host's perspective save. It is a property of the view, so it is
   * state of the same kind, in the same place, saved by the same path. Anything
   * else (a `useState` + `localStorage`, as `RfqBoardPage` does for its Kanban
   * toggle) cannot belong to a saved view.
   */
  const [viewMode, setViewMode] = useState<TableViewMode>(initialState.viewMode ?? 'table');
  const [aggregations, setAggregations] = useState<AggregationRule[]>(initialState.aggregations);
  const [conditionalFormats, setConditionalFormats] = useState<ConditionalFormatRule[]>(
    initialState.conditionalFormats,
  );
  const [dateFormat, setDateFormat] = useState<string | undefined>(initialState.dateFormat);
  /**
   * Columns pinned sticky-left, seeded from the view rather than from nothing.
   *
   * HEDGE-102: this was `useState(new Set())` with no reader and no writer, so
   * a pin lived until the next render of the page and was gone on reload. It is
   * a property of the view — the same kind of state as `viewMode` and
   * `conditionalFormats` above — so it is seeded, applied and saved by the same
   * paths those use.
   */
  const [frozenColumns, setFrozenColumns] = useState<Set<string>>(
    () => new Set(initialState.frozenColumns),
  );
  const [internalActivePerspectiveId, setInternalActivePerspectiveId] = useState<string | null>(
    controlledActiveId ?? null
  );

  // Active perspective ID (controlled or internal)
  const activePerspectiveId = controlledActiveId !== undefined
    ? controlledActiveId
    : internalActivePerspectiveId;

  // `initialState` above is computed on mount only, but `savedPerspectives` and
  // `controlledActiveId` arrive asynchronously — the host fetches them from
  // /api/perspectives/:tableId. So on mount they are empty/null and the grid
  // always initialises to the DEFAULT column set, while the toolbar goes on to
  // render the saved view's tab as active. Without the sync below, that desync
  // persists until the user manually clicks the tab: saved columns, filters and
  // sorting silently never apply, and returning from a detail page looks like
  // the view "reset to Default".
  //
  // Keyed on the perspective ID, never on the `savedPerspectives` array
  // identity — the host rebuilds that array on every refetch, and re-applying
  // on identity change would stomp on the user's in-session edits.
  //
  // THIS IS THE ONLY EFFECT THAT APPLIES A PERSPECTIVE. A second "sync controlled
  // props" effect used to live further down the file, copying the perspective's
  // raw fields without `defaultHiddenColumns`. Both ran on the same commit, so
  // which one won was an effect-ordering accident. Do not add another.
  const appliedPerspectiveRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (appliedPerspectiveRef.current === activePerspectiveId) return;
    // Nothing to apply yet: an id is set but its config hasn't loaded. Stay put
    // rather than resetting to defaults, and retry once the fetch lands.
    const perspective = activePerspectiveId
      ? savedPerspectives.find(p => p.id === activePerspectiveId)
      : null;
    if (activePerspectiveId && !perspective) return;

    appliedPerspectiveRef.current = activePerspectiveId;
    const next = resolvePerspectiveState({
      baseColumns,
      perspective,
      defaultHiddenColumns: initialHiddenColumns,
      defaultGrouping,
    });
    setVisibleColumns(next.visibleColumns);
    setHiddenColumns(next.hiddenColumns);
    setFilters(next.filters);
    setSortRules(next.sortRules);
    setGroupRules(next.groupRules);
    setViewMode(next.viewMode ?? 'table');
    setAggregations(next.aggregations);
    setLookupColumns(next.lookupColumns);
    setRollupColumns(next.rollupColumns);
    setFormulas(next.formulas);
    setConditionalFormats(next.conditionalFormats);
    setFrozenColumns(new Set(next.frozenColumns));
    setDateFormat(next.dateFormat);
    // Keep the internal mirror in step while the parent controls the id, so a
    // later switch to uncontrolled mode does not resurrect a stale view.
    if (controlledActiveId !== undefined) {
      setInternalActivePerspectiveId(activePerspectiveId ?? null);
    }
  }, [activePerspectiveId, controlledActiveId, savedPerspectives, baseColumns, initialHiddenColumns, defaultGrouping]);

  // Display name: use perspective name if selected (except for built-in perspectives starting with '_'), otherwise default tableName
  const displayTableName = useMemo(() => {
    if (activePerspectiveId && !activePerspectiveId.startsWith('_')) {
      const activePerspective = savedPerspectives.find(p => p.id === activePerspectiveId);
      // The base-view row is a personalization of the "Default view" TAB, not a
      // named view — its reserved internal name must never reach the heading.
      if (activePerspective && !activePerspective.isBaseView) {
        return activePerspective.name;
      }
    }
    return tableName;
  }, [activePerspectiveId, savedPerspectives, tableName]);

  // -------------------- MODERN LAYOUT STATE --------------------
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const [configPanelInitialSection, setConfigPanelInitialSection] = useState<string | null>(null);
  // Perspective currently open for editing in the Configure View panel. Null when
  // the panel was opened to create a brand-new view ("Add view").
  const [editingPerspectiveId, setEditingPerspectiveId] = useState<string | null>(null);
  /**
   * Whether the Configure View drawer is currently configuring the BASE
   * ("Default view") tab. Explicit state rather than "no view is active",
   * because "Add view" is also reached from that state and must keep demanding
   * a name for the new view.
   */
  const [configureBaseView, setConfigureBaseView] = useState(false);
  /** This user's saved personalization of the base tab, if any. */
  const baseViewPerspective = useMemo(
    () => savedPerspectives.find((p) => p.isBaseView) ?? null,
    [savedPerspectives],
  );

  // -------------------- COMMENTS STATE --------------------
  const [commentDialog, setCommentDialog] = useState<{
    /**
     * B8a — the target this dialog writes to, resolved from the CELL, not from
     * the row. On a leg-scoped column it is the leg; on a container-scoped
     * column, the container. Carried explicitly so the dialog never has to
     * re-derive it from the row and land on a different record.
     */
    entityType: string;
    rowId: string;
    columnKey: string;
    columnTitle: string;
    rowLabel?: string;
    annotationId?: string | null;
    currentColor?: string | null;
    anchorRect?: DOMRect | null;
    /** Bulk cells carry their own scope — one range can span two entity types. */
    bulkCells?: { entityType: string; rowId: string; columnKey: string }[];
  } | null>(null);

  // Read-only hover preview of a commented cell's thread (shown on hovering the
  // comment indicator; click opens the full dialog above).
  const [commentHover, setCommentHover] = useState<{
    comments: AnnotationComment[];
    columnTitle?: string;
    anchorRect: DOMRect;
  } | null>(null);


  // -------------------- FULLSCREEN STATE --------------------
  const [isFullscreen, setIsFullscreen] = useState(false);

  // -------------------- COMPUTED COLUMNS (ordered by perspective) --------------------
  const cols = useMemo(() => {
    // Get columns in the order specified by visibleColumns
    const orderedCols: ColumnDef[] = [];
    for (const key of visibleColumns) {
      const col = baseColumns.find(c => c.data === key);
      if (col) {
        orderedCols.push(col);
      }
    }
    return orderedCols;
  }, [baseColumns, visibleColumns]);

  /**
   * B8a — the annotation target of one cell. Everything that reads or writes an
   * annotation goes through this ONE resolver, so the fetch, the render, the
   * dialog and the bulk write can never disagree about which record a comment
   * belongs to.
   */
  const resolveCommentTarget = useCallback(
    (rowData: Record<string, any> | undefined, col: ColumnDef): { entityType: string; rowId: string } => {
      if (!rowData) return { entityType: '', rowId: '' };
      if (commentsCellTarget) return commentsCellTarget(rowData, col);
      const entityType =
        typeof commentsEntityType === 'function' ? commentsEntityType(rowData) : commentsEntityType || '';
      return { entityType, rowId: String(rowData[idColumnName] ?? '') };
    },
    [commentsCellTarget, commentsEntityType, idColumnName],
  );

  /**
   * Every distinct (entityType, rowId) on screen. Computed over rows × VISIBLE
   * columns because a cell's target may depend on its column: a page showing
   * only leg columns must not request container annotations, and one showing
   * both must request both.
   */
  const annotationTargets = useMemo(() => {
    if (!enableComments) return [] as Array<{ entityType: string; rowId: string }>;
    const seen = new Set<string>();
    const out: Array<{ entityType: string; rowId: string }> = [];
    for (const row of data) {
      for (const col of cols) {
        const target = resolveCommentTarget(row, col);
        if (!target.entityType || !target.rowId) continue;
        const key = `${target.entityType}:${target.rowId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(target);
      }
    }
    return out;
  }, [enableComments, data, cols, resolveCommentTarget]);

  const { annotations, refresh: refreshAnnotations } = useAnnotations({
    enabled: enableComments && annotationTargets.length > 0,
    targets: annotationTargets,
  });

  /**
   * The annotation map key for one cell, handed to every row. Stable identity
   * (it only changes when the resolver does) so `VirtualRow`'s `React.memo`
   * survives — a fresh function per render would repaint every mounted row on
   * every keystroke.
   */
  const cellAnnotationKeyAt = useCallback(
    (rowData: Record<string, any>, column: ColumnDef): string | null => {
      const target = resolveCommentTarget(rowData, column);
      if (!target.entityType || !target.rowId) return null;
      return annotationKey(target, column.data);
    },
    [resolveCommentTarget],
  );

  // Compile the highlighting rule set ONCE per change. `Cell` must never
  // compile: it runs per cell per render, and a 57-column page mounts thousands.
  const compiledFormats = useMemo(
    () => compileConditionalFormats(conditionalFormats),
    [conditionalFormats],
  );

  // -------------------- STORE INITIALIZATION --------------------
  if (!storeRef.current) {
    storeRef.current = createCellStore(data, cols);
  }
  const store = storeRef.current;

  // -------------------- GROUPING --------------------
  // `totalRows` is not optional in practice: without it EVERY subtotal is
  // labelled "this page only", because the hook cannot prove the loaded page is
  // the whole filtered dataset.
  const groupingResult = useGrouping(data, groupRules, cols, aggregations, {
    totalRows: pagination?.total,
  });
  const isGrouped = groupingResult.visualRows !== null;

  /**
   * Is an alternative body renderer drawing the rows right now?
   *
   * When it is, the SPREADSHEET affordances are turned off — the cell-range
   * drag, the fill handle, the clipboard grid, the `role="grid"` semantics.
   * Not because they would crash (every one of them bails when it cannot find a
   * `td[data-row]`), but because leaving them armed would announce a grid with
   * rows and columns to a screen reader that is looking at a wall of tiles.
   *
   * Everything ABOVE and BELOW the body stays: the toolbar, the search box, the
   * filters, the perspective tabs, the selection bar, the pagination. That is
   * what makes the two renderers structurally unable to diverge — they are not
   * two views of the data, they are one view with two bodies.
   */
  // Report the mode the table actually settled on — the initial one, and any
  // restored from a perspective, neither of which goes through the switcher.
  const reportedViewMode = useRef<TableViewMode | null>(null);
  useEffect(() => {
    if (reportedViewMode.current === viewMode) return;
    reportedViewMode.current = viewMode;
    onViewModeChange?.(viewMode);
  }, [viewMode, onViewModeChange]);

  const usingCustomBody = viewMode !== 'table' && !!renderBody;

  // -------------------- OTHER STATE --------------------
  const [rowCount, setRowCount] = useState(store.getRowCount());
  const [storeRevision, setStoreRevision] = useState(0);
  // SINGLE SOURCE OF TRUTH FOR SORT.
  // `sortRules` is the only sort state: it is what the perspective carries, what
  // the Configure View drawer edits, what the column menu writes and what the
  // server query is built from. `sortState` is a pure projection of its primary
  // rule onto the header's column index — never stored, so a header click and a
  // menu sort can no longer disagree (which is what made a sorted column render
  // no indicator at all).
  const sortState = useMemo<SortState>(() => {
    const primary = sortRules[0];
    if (!primary) return { columnIndex: null, direction: null };
    const columnIndex = cols.findIndex((c) => c.data === primary.field);
    if (columnIndex < 0) return { columnIndex: null, direction: null };
    return { columnIndex, direction: primary.direction };
  }, [sortRules, cols]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // -------------------- COMPUTED VALUES --------------------
  const { leftOffsets, rightOffsets } = useStickyOffsets(cols, store, rowHeaders);

  // Only reserve the Actions column when it actually has something to render:
  // row actions (the kebab), a custom actions renderer, or an in-progress new
  // row (whose save button lives in this column). Read-only/display tables with
  // none of these drop the empty column entirely. Recomputed on every render;
  // adding/removing a new row bumps `storeRevision` (see setStoreRevision),
  // which re-renders and re-reads `store.hasNewRows()` so the column toggles.
  const showActionsColumn = !hideActionsColumn && (!!rowActions || !!actionsRenderer || store.hasNewRows());

  // Sticky-column scroll shadows (v2 affordance — CSS scopes them):
  //  • Actions column gets a LEFT-edge shadow while there's content still to
  //    reveal to the right (not scrolled all the way right).
  //  • First (sticky) column gets a RIGHT-edge shadow while there's content
  //    hidden to the left (i.e. scrolled right at all → can scroll back left).
  const [actionsScrollShadow, setActionsScrollShadow] = useState(false);
  const [firstColScrollShadow, setFirstColScrollShadow] = useState(false);
  // Frozen-column float shadow: ON only once the pinned block has actually
  // reached its sticky point (content scrolling UNDER its right edge) — not
  // while a not-yet-pinned frozen column is still drifting left with the scroll.
  const [frozenColShadow, setFrozenColShadow] = useState(false);
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    // The `querySelector` + `getComputedStyle` + two `getBoundingClientRect`
    // calls below each force a synchronous style/layout flush, and this fires on
    // EVERY scroll event — vertical included, since it is one scroller. That is
    // the same scroll-path DOM work this file documents removing at Defect 7.
    //
    // Two changes keep it off the scroll path: the frozen edge and its sticky
    // target are measured ONCE per effect run (both only change with
    // `frozenColumns` / `cols.length`, which are already dependencies), and the
    // handler itself is coalesced onto an animation frame so a burst of scroll
    // events costs one measurement per painted frame instead of one per event.
    let frozenEdge: HTMLElement | null = null;
    let frozenTarget = 0;
    const measureFrozenEdge = () => {
      frozenEdge = el.querySelector('.hot-headers-sticky [data-frozen-edge="true"]');
      frozenTarget = frozenEdge ? parseFloat(getComputedStyle(frozenEdge).left) || 0 : 0;
    };

    const update = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      setActionsScrollShadow(maxScroll > 1 && Math.ceil(el.scrollLeft) < maxScroll - 1);
      setFirstColScrollShadow(el.scrollLeft > 1);
      // The rightmost pinned column is "stuck" when its rendered left equals its
      // sticky target (inline `left`); while drifting it sits further right.
      if (frozenEdge && el.scrollLeft > 1) {
        const rel = frozenEdge.getBoundingClientRect().left - el.getBoundingClientRect().left;
        setFrozenColShadow(rel <= frozenTarget + 1);
      } else {
        setFrozenColShadow(false);
      }
    };

    let frame: number | null = null;
    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        update();
      });
    };

    measureFrozenEdge();
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    // A resize can add or remove the frozen edge, so re-measure before updating.
    const ro = new ResizeObserver(() => {
      measureFrozenEdge();
      onScroll();
    });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
      ro.disconnect();
    };
    // isFullscreen: entering/leaving fullscreen re-parents tableContent (the
    // scroller remounts), so re-attach the listener to the new node.
    // frozenColumns: re-measure engagement when the pinned set changes.
  }, [tableRef, cols.length, showActionsColumn, isFullscreen, frozenColumns]);

  const totalWidth = useMemo(() => {
    return (
      cols.reduce((sum, _, idx) => sum + store.getColumnWidth(idx), 0) +
      (rowHeaders ? 50 : 0) +
      (showActionsColumn ? actionsColumnWidth : 0)
    );
  }, [cols, store, rowHeaders, actionsColumnWidth, showActionsColumn, storeRevision]);

  /** Row furniture that sits outside the column widths. */
  const furnitureWidth = (rowHeaders ? 50 : 0) + (showActionsColumn ? actionsColumnWidth : 0);

  // Stable width getter for the pinned totals row, so its `memo` survives a
  // render that changed nothing it cares about. Widths only move when the store
  // revision does, which is exactly what invalidates this.
  const getColumnWidth = useCallback(
    (colIndex: number) => store.getColumnWidth(colIndex),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, storeRevision],
  );

  // Page-scoped fallback for the pinned totals: folded with the SAME function
  // the group subtotals use, so the two can never disagree. It is shown
  // immediately (so the footer is never blank) and `FooterTotalsRow` labels it
  // honestly as page-scoped until the server's dataset figure lands.
  const pageAggregates = useMemo(() => {
    if (aggregations.length === 0) return undefined;
    const columnsByField = new Map(cols.map((c) => [c.data, c] as const));
    const indices = data.map((_, i) => i);
    return computeAggregates(data, indices, aggregations, columnsByField);
  }, [data, aggregations, cols]);
  const pageAggregateValues = pageAggregates?.values;
  const pageAggregateBreakdowns = pageAggregates?.breakdowns;

  // When grouped, virtualizer count is visual rows length; otherwise original row count
  const virtualizerCount = isGrouped ? groupingResult.visualRows!.length : rowCount;

  // Row height by density: sm=36, md=44; default 32 (Figma 220:2935 — tighter
  // baseline for all v2 tables). Includes the 4px inter-row gap (2px transparent
  // border top + bottom) so the visible row pill is ~28px, matching Figma.
  // The user's density preference wins when they have actually expressed one.
  // At `comfortable` (the default) this is the ORIGINAL expression, unchanged —
  // that is what makes shipping density a pixel-level no-op for everyone who
  // never opens the picker. Row height is the single number CSS cannot own:
  // rows are absolutely positioned by the virtualizer, so JS has to know it.
  const dataRowHeight =
    densityLevel !== 'comfortable'
      ? resolveDensityRowHeight(densityLevel)
      : density === 'md' ? 44 : density === 'sm' ? 36 : 32;

  // Row selection (v2 checkbox column for bulk / grouped actions).
  // Selection identity must be unique per visual row — fall back to
  // `idColumnName`, but allow consumers to point at a distinct unique column
  // when `idColumnName` is a repeating entity key (see `rowKeyColumn`).
  const selectionColumnName = rowKeyColumn ?? idColumnName;
  const selectable = rowHeaders;
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  // v2 Actions column shows a kebab (•••) menu built from `rowActions`, unless
  // the consumer supplies a custom `actionsRenderer`.
  const showRowActionsMenu = !!rowActions && !actionsRenderer;
  const pageRowIds = useMemo(
    () => data
      .map((r) => (r == null ? undefined : r[selectionColumnName]))
      .filter((id) => id != null)
      .map((id) => String(id)),
    [data, selectionColumnName]
  );
  const allSelected = pageRowIds.length > 0 && pageRowIds.every((id) => selectedRowIds.has(id));
  const someSelected = !allSelected && pageRowIds.some((id) => selectedRowIds.has(id));
  const handleToggleRowSelect = useCallback((rowId: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      onSelectionChange?.(Array.from(next));
      return next;
    });
  }, [onSelectionChange]);
  const handleToggleSelectAll = useCallback(() => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      const everySelected = pageRowIds.length > 0 && pageRowIds.every((id) => next.has(id));
      if (everySelected) pageRowIds.forEach((id) => next.delete(id));
      else pageRowIds.forEach((id) => next.add(id));
      onSelectionChange?.(Array.from(next));
      return next;
    });
  }, [pageRowIds, onSelectionChange]);
  // Toggle every row in a group: select all unless they're already all selected.
  const handleToggleGroupSelect = useCallback((groupRowIds: string[]) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      const everySelected = groupRowIds.length > 0 && groupRowIds.every((id) => next.has(id));
      if (everySelected) groupRowIds.forEach((id) => next.delete(id));
      else groupRowIds.forEach((id) => next.add(id));
      onSelectionChange?.(Array.from(next));
      return next;
    });
  }, [onSelectionChange]);

  // Grouped (bulk) actions — surfaced when >1 row is selected.
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  // Holds the last visible selection count so the bar can finish its close
  // animation showing the real number instead of flashing "1 selected".
  const bulkBarCountRef = useRef(0);
  const clearSelection = useCallback(() => {
    setSelectedRowIds(new Set());
    onSelectionChange?.([]);
  }, [onSelectionChange]);
  const handleBulkDelete = useCallback(async () => {
    if (!onBulkDelete) return;
    const ids = Array.from(selectedRowIds);
    if (ids.length === 0) return;
    setIsBulkDeleting(true);
    try {
      await onBulkDelete(ids);
      // Resolved → rows deleted; drop the now-stale selection.
      clearSelection();
    } catch {
      // Rejected → cancelled from the confirm modal; keep the selection.
    } finally {
      setIsBulkDeleting(false);
    }
  }, [onBulkDelete, selectedRowIds, clearSelection]);

  const rowVirtualizer = useVirtualizer({
    count: virtualizerCount,
    getScrollElement: () => tableRef?.current,
    // Group headers share the data-row height so the grouped band lines up
    // with the rest of the rows (same pill height + inter-row gap).
    estimateSize: () => dataRowHeight,
    overscan: 10,
  });

  // Row height is the one density value CSS cannot own (rows are absolutely
  // positioned by the virtualiser, which caches item sizes), so a density
  // switch must invalidate that cache SYNCHRONOUSLY — before paint. The 50ms
  // timer below is for the fullscreen re-parent, which genuinely needs the DOM
  // to settle; using it here would paint one frame of overlapping rows.
  useLayoutEffect(() => {
    rowVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataRowHeight]);

  // Re-measure when fullscreen state or row density changes
  useEffect(() => {
    // Small delay to ensure DOM is ready after fullscreen transition
    const timer = setTimeout(() => {
      rowVirtualizer.measure();
    }, 50);
    return () => clearTimeout(timer);
  }, [isFullscreen, dataRowHeight, rowVirtualizer]);

  const virtualRows = rowVirtualizer.getVirtualItems();

  // -------------------- HANDLERS --------------------
  // Anchor Defect 5: these factories return the callbacks that are passed into
  // every mounted `VirtualRow` (`onCellSave`, `onSaveNewRow`, `onCancelNewRow`,
  // `onRowHeaderDoubleClick`). Constructing them in the render body gave each a
  // fresh identity on EVERY render, which defeated `VirtualRow`'s `React.memo`
  // outright — a keystroke in the filter box re-rendered every mounted row and
  // therefore every mounted cell.
  //
  // They are memoised over exactly what they close over. `store`, `tableRef`
  // and `dragStateRef` are stable for the table's lifetime; `cols` changes only
  // on a perspective reorder/show-hide, which genuinely must rebuild them (the
  // handlers index into `cols`). No mutable state is captured, so there is no
  // stale-closure hazard here — a factory that captured React state instead of
  // reading it from the store would need a ref, not a wider dep list.
  const { handleCellSave: handleCellSaveBase } = useMemo(
    () => createCellHandlers(store, cols, tableRef, idColumnName),
    [store, cols, tableRef, idColumnName],
  );
  const hasFormulaColumns = useMemo(() => cols.some((c) => isFormulaColumnKey(c.data)), [cols]);
  // A formula cell reads OTHER columns of its row, but `setCellValue` bumps only
  // the edited cell's revision — so editing an input left the calculated column
  // showing a stale number until something else forced a repaint. Repainting the
  // row is the fix; widening `setCellValue` would make every write pay for a
  // feature almost no view uses. The evaluator's cache is already correct under
  // in-place mutation, so this is purely a repaint trigger.
  const handleCellSave = useCallback(
    (row: number, col: number, newValue: any, clearEditing: boolean = true) => {
      handleCellSaveBase(row, col, newValue, clearEditing);
      if (hasFormulaColumns) store.bumpRowRevisions(row, cols.length);
    },
    [handleCellSaveBase, hasFormulaColumns, store, cols.length],
  );
  const { handleAddRow, handleSaveNewRow, handleCancelNewRow } = useMemo(
    () => createRowHandlers(store, cols, tableRef),
    [store, cols, tableRef],
  );
  const dragHandlers = useMemo(
    () => createDragHandlers(store, cols, dragStateRef),
    [store, cols],
  );
  const { handleMouseDown, handleMouseMove, handleMouseUp, handleDoubleClick } = useMemo(
    () => createMouseHandlers(store, cols, dragStateRef, dragHandlers),
    [store, cols, dragHandlers],
  );

  // Perspective handlers. Created BEFORE the column-header handlers because the
  // header's sort click writes through `handleSortRulesChange` — sort has exactly
  // one owner (see the `sortState` projection above).
  const {
    handleColumnVisibilityChange,
    handleColumnOrderChange,
    handleFiltersChange,
    handleSortRulesChange,
    handleGroupRulesChange,
    handleAggregationsChange,
    handleLookupColumnsChange,
    handleRollupColumnsChange,
    handleFormulasChange,
    handleConditionalFormatsChange,
    handleDateFormatChange,
    handleSavePerspective,
    handlePerspectiveSelect,
    handlePerspectiveRename,
    handlePerspectiveDelete,
    handlePerspectiveDuplicate,
    handlePerspectiveSetDefault,
    handlePerspectivePublish,
    handlePerspectiveTemplateCopy,
  } = useMemo(
    () =>
      createPerspectiveHandlers({
        tableRef,
        columns: baseColumns,
        savedPerspectives,
        activePerspectiveId,
        setVisibleColumns,
        setHiddenColumns,
        setFilters,
        setSortRules,
        setGroupRules,
        setAggregations,
        setLookupColumns,
        setRollupColumns,
        setFormulas,
        setConditionalFormats,
        setFrozenColumns,
        setDateFormat,
        setInternalActivePerspectiveId,
        defaultHiddenColumns: initialHiddenColumns,
        defaultGrouping,
      }),
    // The `set*` functions are React state setters (stable by contract) plus
    // `setInternalActivePerspectiveId`; only the three data inputs can change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tableRef, baseColumns, savedPerspectives, activePerspectiveId, initialHiddenColumns, defaultGrouping],
  );

  /**
   * "Reset to defaults" on the base tab.
   *
   * EMPTIES this user's base-view row rather than deleting it. The upstream
   * `perspectives` table soft-deletes (sets `deleted_at`) while its unique index
   * on `(user_id, tenant_id, organization_id, table_id, name)` ignores that
   * column — so a deleted row keeps owning the reserved `__base__` name and the
   * NEXT save would fail with a duplicate-key 500, permanently. Verified live
   * before this was written, not assumed.
   *
   * An empty `columnOrder` is exactly "no column personalization": both
   * `apiToDynamicTable` and `resolvePerspectiveState` already fall back to the
   * table's own defaults for it, so the row also does not freeze the user at
   * today's column set the way an explicit list would.
   */
  const handleBaseViewReset = useCallback(() => {
    if (!baseViewPerspective) return;
    handleSavePerspective({
      id: baseViewPerspective.id,
      name: BASE_VIEW_PERSPECTIVE_NAME,
      isBaseView: true,
      columns: { visible: [], hidden: [] },
      filters: [],
      sorting: [],
      grouping: [],
      aggregations: [],
      lookupColumns: [],
      rollupColumns: [],
      formulas: [],
      conditionalFormats: [],
      dateFormat: undefined,
    });
    // Repaint the coded defaults immediately; the row we just wrote resolves to
    // the same thing once the host refetches.
    const next = resolvePerspectiveState({
      baseColumns,
      perspective: null,
      defaultHiddenColumns: initialHiddenColumns,
      defaultGrouping,
    });
    setVisibleColumns(next.visibleColumns);
    setHiddenColumns(next.hiddenColumns);
    setFilters(next.filters);
    setSortRules(next.sortRules);
    setGroupRules(next.groupRules);
    setAggregations(next.aggregations);
    setLookupColumns(next.lookupColumns);
    setRollupColumns(next.rollupColumns);
    setFormulas(next.formulas);
    setConditionalFormats(next.conditionalFormats);
    setFrozenColumns(new Set(next.frozenColumns));
    setDateFormat(next.dateFormat);
  }, [baseViewPerspective, handleSavePerspective, baseColumns, initialHiddenColumns, defaultGrouping]);

  // Header click / column menu / Configure View drawer all land here.
  const handleSortDirectionChange = useCallback(
    (colIndex: number, direction: 'asc' | 'desc' | null) => {
      const col = cols[colIndex];
      if (!col) return;
      handleSortRulesChange(
        direction === null
          ? []
          : [{ id: generateSortRuleId(), field: col.data, direction }],
      );
    },
    [cols, handleSortRulesChange],
  );

  const { handleColumnSort, handleColumnHeaderDoubleClick, handleColumnHeaderMouseDown } = useMemo(
    () =>
      createColumnHeaderHandlers(
        store,
        cols,
        tableRef,
        sortState,
        handleSortDirectionChange,
        setContextMenu,
        columnActions,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, cols, tableRef, sortState, handleSortDirectionChange, columnActions],
  );
  // `handleRowHeaderDoubleClick` is a `VirtualRow` prop — memoised for the same
  // reason as the cell handlers. NOTE: `rowActions` is consumer-supplied; a
  // consumer that passes an inline arrow re-creates this every render, and also
  // hands `VirtualRow` a fresh `rowActions` prop directly, so the memo is
  // defeated from the outside. That is a consumer-side fix, not a grid one.
  const { handleRowHeaderDoubleClick } = useMemo(
    () => createRowHeaderHandlers(store, tableRef, setContextMenu, rowActions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, tableRef, rowActions],
  );
  const { handleContextMenuAction, handleContextMenuClose } = useMemo(
    () =>
      createContextMenuHandlers(store, cols, tableRef, contextMenu, setContextMenu, onRowAction),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, cols, tableRef, contextMenu, onRowAction],
  );

  // v2 Actions column: the kebab (•••) button opens the same row menu the
  // right-click context menu uses, anchored below the button.
  const handleRowActionsMenu = useCallback((e: React.MouseEvent, rowIndex: number) => {
    if (!rowActions) return;
    const rowData = store.getRowData(rowIndex);
    const actions = rowActions(rowData, rowIndex);
    if (!actions.length) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({ isOpen: true, position: { x: rect.right, y: rect.bottom + 4 }, actions, type: 'row', index: rowIndex });
  }, [rowActions, store]);
  // Latest-callback ref so the resize handlers (created here) can persist widths
  // via the persistence hook, which is set up later in the body (it needs the
  // ordered `cols` and must register its apply-effect after store.setColumns).
  const persistColumnWidthRef = useRef<(colIndex: number) => void>(() => {});
  const { handleResizeStart } = useMemo(
    () => createResizeHandlers(store, (colIndex) => persistColumnWidthRef.current(colIndex)),
    [store],
  );
  // Columns the user has manually resized — excluded from badge auto-fit so we
  // never fight a deliberate width.
  const userResizedColsRef = useRef<Set<number>>(new Set());
  // Badge auto-fit cache: stable `col.data` key → fitted width. Model-held, so
  // it answers for unmounted columns and survives a perspective reorder.
  const badgeFitRef = useRef<Map<string, number>>(new Map());

  // -------------------- FILL THE CONTAINER --------------------
  // The sum of the DECLARED widths — what the fill measures against. Re-running
  // the fill when it moves is what makes a hand resize, a badge auto-fit or a
  // restored saved width redistribute whatever is left over.
  const declaredTotalWidth = useMemo(
    () => cols.reduce((sum, _, idx) => sum + store.getBaseColumnWidth(idx), 0) + furnitureWidth,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cols, store, furnitureWidth, storeRevision],
  );

  /**
   * Fill the container when the declared widths do not (see
   * `utils/columnFill.ts` for the arithmetic and, more importantly, for why it
   * IS arithmetic rather than `width: 100%`).
   *
   * The surplus is written into the store as resolved PIXELS, so every column
   * keeps an honest declared width — which is precisely what lets column
   * virtualization stay ON while the grid fills the width. Those two used to be
   * mutually exclusive.
   *
   * No feedback loop, by construction: the target is the scroller's own
   * `clientWidth`, so a filled row can never widen the scroller, and
   * `setColumnStretch` notifies nobody when the distribution did not move.
   */
  const applyColumnFill = useCallback(() => {
    const el = tableRef.current;
    if (!el) return;
    const rigid = new Set<number>();
    cols.forEach((col, idx) => {
      // Pinned / frozen columns keep their exact width (sticky offsets depend
      // on it), and so does any column the user sized by hand.
      if (col.sticky || frozenColumns.has(col.data) || userResizedColsRef.current.has(idx)) {
        rigid.add(idx);
      }
    });
    store.setColumnStretch(
      computeColumnFill({
        widths: cols.map((_, idx) => store.getBaseColumnWidth(idx)),
        rigid,
        furnitureWidth,
        containerWidth: el.clientWidth,
      }),
    );
  }, [cols, store, frozenColumns, furnitureWidth, tableRef]);

  useLayoutEffect(() => {
    applyColumnFill();
    const el = tableRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // Re-run on container resize: a browser-window resize, the split view
    // opening, a sidebar collapsing — all of them change what "full width" is.
    const ro = new ResizeObserver(() => applyColumnFill());
    ro.observe(el);
    return () => ro.disconnect();
    // `isFullscreen` re-parents the scroller, so the observer must move with it.
  }, [applyColumnFill, declaredTotalWidth, isFullscreen, tableRef]);

  // -------------------- MODERN LAYOUT COLUMN MENU HANDLERS --------------------
  const handleModernSortAsc = useCallback(
    (colIndex: number) => handleSortDirectionChange(colIndex, 'asc'),
    [handleSortDirectionChange],
  );

  const handleModernSortDesc = useCallback(
    (colIndex: number) => handleSortDirectionChange(colIndex, 'desc'),
    [handleSortDirectionChange],
  );

  const handleModernFilterByField = useCallback((colIndex: number) => {
    const col = cols[colIndex];
    if (!col) return;
    // Add a new empty filter row for this field
    const newFilter: FilterRow = {
      id: `filter-${Date.now()}`,
      field: col.data,
      operator: 'contains',
      values: [],
    };
    handleFiltersChange([...filters, newFilter]);
    // Open the configure view panel with filters section expanded. It inherits
    // the CURRENT context: opened from the base tab, saving keeps the user's
    // Default view rather than insisting on a name for it.
    setEditingPerspectiveId(null);
    setConfigureBaseView(!activePerspectiveId || activePerspectiveId === baseViewPerspective?.id);
    setConfigPanelInitialSection('filters');
    setConfigPanelOpen(true);
  }, [cols, filters, handleFiltersChange, activePerspectiveId, baseViewPerspective]);

  /**
   * A16 / ledger 7.11 / HEDGE-7 — write a COLUMN LAYOUT change THROUGH to this
   * user's view.
   *
   * Two entry points land here, and they are the two that change the layout
   * from OUTSIDE the Configure View drawer: a header drag (or its "Move
   * left/right" menu twin) and the column menu's "Hide field". Both used to
   * move `visibleColumns`/`hiddenColumns` only, which is in-memory state, so the
   * change was gone on the next reload and the only way to keep it was to
   * reopen the drawer and press Save. Column layout is per-user personalization
   * (decision of 2026-08-03) and each of these IS the user's explicit act —
   * nothing else should be needed to keep it.
   *
   * The drawer deliberately does NOT come through here: it owns a Save/Cancel
   * pair whose Cancel reverts the live preview, so writing on every toggle
   * would break the contract the panel documents at its snapshot ref.
   *
   * The payload is built from the SAVED row, not from live table state, with
   * only `columns` replaced. That is the whole point: ad-hoc quick filters stay
   * ephemeral (A2/D6), so persisting the grid's current `filters`/`sortRules`
   * here would quietly promote a throwaway funnel tick into the saved view just
   * because the user nudged a column afterwards.
   *
   * With no saved row yet we are necessarily on the base ("Default view") tab —
   * every named view has a row by construction — so we mint the base row the
   * same way `handleBaseViewReset` and the drawer's base-view Save do, carrying
   * ONLY the column layout.
   *
   * WHOSE VIEW THIS TOUCHES (the HEDGE-5 worry, answered): a `perspectives` row
   * is keyed by `(user_id, tenant_id, organization_id, table_id, name)` and the
   * base row is no exception — the reserved `__base__` name is per user. So the
   * shared-looking "Default view" tab is in fact this user's own personalization
   * of it, and an autosave here cannot change what anyone else sees. The only
   * role-scoped rows are `role_perspectives`, written solely by the explicit
   * Publish action.
   */
  const persistColumnLayout = useCallback((visible: string[], hidden: string[]) => {
    // Only when a host actually owns perspectives. `controlledActiveId` is
    // `undefined` exactly when nobody passed `activePerspectiveId` — an
    // uncontrolled grid (a drawer sub-table, a Storybook story) has nowhere to
    // save to, and should not mint a base-view row on the first drag.
    if (controlledActiveId === undefined) return;
    const target = activePerspectiveId
      ? savedPerspectives.find(p => p.id === activePerspectiveId) ?? null
      : baseViewPerspective;
    if (target) {
      handleSavePerspective({ ...target, columns: { visible, hidden } }, true);
      return;
    }
    if (activePerspectiveId) return; // a named view whose row hasn't loaded — don't invent one
    handleSavePerspective(
      {
        id: generatePerspectiveId(),
        name: BASE_VIEW_PERSPECTIVE_NAME,
        isBaseView: true,
        columns: { visible, hidden },
        // FROM THE LIVE STATE — same rule as the view-mode switch below. A
        // column drag records a column order and a "Hide field" records a
        // column set; neither is a statement that the user wanted their
        // filters, sorting and grouping thrown away, and writing empty literals
        // here made it exactly that.
        filters,
        sorting: sortRules,
        grouping: groupRules,
        aggregations,
        lookupColumns,
        rollupColumns,
        formulas,
        conditionalFormats,
        dateFormat,
        viewMode,
      },
      true,
    );
  }, [activePerspectiveId, controlledActiveId, savedPerspectives, baseViewPerspective, handleSavePerspective,
      filters, sortRules, groupRules, aggregations, lookupColumns, rollupColumns, formulas,
      conditionalFormats, dateFormat, viewMode]);

  /**
   * HEDGE-102 — write a FREEZE change through to this user's view.
   *
   * Deliberately a sibling of `persistColumnLayout` above rather than a shared
   * generic: the two agree on how to find the target row, and differ on the one
   * thing that matters — which key the freshly minted base row carries. Folding
   * them together would mean a `Partial<PerspectiveConfig>` threaded through a
   * mint block whose whole point is being explicit about what it writes, and
   * that block already carries a comment about what writing empty literals here
   * cost last time.
   *
   * Whose view this touches is the same answer as above and it was checked
   * against the schema, not assumed: `perspectives` is unique on
   * `(user_id, tenant_id, organization_id, table_id, name)` with `user_id NOT
   * NULL`, so the shared-looking "Default view" is this user's own row.
   * `role_perspectives` is the only role-scoped surface and only Publish writes
   * it — one user pinning a column cannot move anyone else's grid.
   */
  const persistFrozenColumns = useCallback((next: Set<string>) => {
    if (controlledActiveId === undefined) return;
    const frozen = [...next];
    const target = activePerspectiveId
      ? savedPerspectives.find(p => p.id === activePerspectiveId) ?? null
      : baseViewPerspective;
    if (target) {
      handleSavePerspective({ ...target, frozenColumns: frozen }, true);
      return;
    }
    if (activePerspectiveId) return; // a named view whose row hasn't loaded — don't invent one
    handleSavePerspective(
      {
        id: generatePerspectiveId(),
        name: BASE_VIEW_PERSPECTIVE_NAME,
        isBaseView: true,
        columns: { visible: visibleColumns, hidden: hiddenColumns },
        frozenColumns: frozen,
        // Same rule as the column-layout mint: pinning a column is not a
        // statement that the user wanted their filters and sorting discarded.
        filters,
        sorting: sortRules,
        grouping: groupRules,
        aggregations,
        lookupColumns,
        rollupColumns,
        formulas,
        conditionalFormats,
        dateFormat,
        viewMode,
      },
      true,
    );
  }, [activePerspectiveId, controlledActiveId, savedPerspectives, baseViewPerspective,
      handleSavePerspective, visibleColumns, hiddenColumns, filters, sortRules, groupRules,
      aggregations, lookupColumns, rollupColumns, formulas, conditionalFormats, dateFormat,
      viewMode]);

  /**
   * Pin or unpin a column. The user's explicit act, so it saves itself — the
   * same contract the header drag and "Hide field" got in HEDGE-7.
   */
  const handleModernFreezeToggle = useCallback((colIndex: number) => {
    const col = cols[colIndex];
    if (!col) return;
    // `next` is computed OUTSIDE the state updater and the handler depends on
    // `frozenColumns`, so the closure is always the committed value. Persisting
    // from inside the updater would have been tidier to read and wrong: React
    // may invoke an updater twice (StrictMode does in development), and a save
    // is not a pure function of the previous state.
    const next = new Set(frozenColumns);
    if (next.has(col.data)) {
      next.delete(col.data);
    } else {
      next.add(col.data);
    }
    setFrozenColumns(next);
    persistFrozenColumns(next);
  }, [cols, frozenColumns, persistFrozenColumns]);

  /**
   * A16 — commit a header drag (or a "Move left/right" menu click).
   *
   * Both indices address `cols` — the VIEW order. The write happens on
   * `visibleColumns`, the persisted key array, and is done by KEY, not by
   * position: `visibleColumns` may legitimately carry keys that `baseColumns`
   * has not produced a column for yet (a linked or calculated column added by
   * the perspective), and those must survive a reorder untouched.
   *
   * Column order is PER-USER: it lands in the active view's `columns.visible`,
   * which the perspectives API stores against this user's row.
   */
  const handleColumnReorder = useCallback((fromIndex: number, toIndex: number) => {
    const fromCol = cols[fromIndex];
    const toCol = cols[toIndex];
    if (!fromCol || !toCol || fromIndex === toIndex) return;
    const fromKey = fromCol.data;
    const toKey = toCol.data;
    const fi = visibleColumns.indexOf(fromKey);
    const ti = visibleColumns.indexOf(toKey);
    if (fi < 0 || ti < 0 || fi === ti) return;
    const next = visibleColumns.slice();
    next.splice(fi, 1);
    next.splice(ti, 0, fromKey);
    // Goes through the same writer the Configure View drawer uses, so the host
    // gets its PERSPECTIVE_CHANGE and the two entry points cannot drift.
    handleColumnVisibilityChange(next, hiddenColumns);
    persistColumnLayout(next, hiddenColumns);
  }, [cols, visibleColumns, hiddenColumns, handleColumnVisibilityChange, persistColumnLayout]);

  /**
   * HEDGE-7 — "Hide field" in the column menu, written THROUGH to this user's
   * view.
   *
   * This is the reported defect, and it is a MISSING CALL, not a missing
   * mechanism: hiding a column moved `visibleColumns`/`hiddenColumns` and
   * stopped there, so nothing ever reached the server and a reload brought the
   * column straight back. The user got no undo prompt, no dirty marker and no
   * Save button, so the change looked done — which is exactly how the reporter
   * described it ("it went back to the earlier settings", not "I didn't save").
   *
   * It now takes the same route a "Move left" already takes: `persistColumnLayout`,
   * silent, into this user's own perspective row. One writer, three callers.
   *
   * The mirror action — putting the column back — lives in the Configure View
   * drawer's "Hide fields" section and persists on that drawer's Save. It is not
   * routed through here on purpose; see the note on `persistColumnLayout`.
   */
  const handleModernHideField = useCallback((colIndex: number) => {
    const col = cols[colIndex];
    if (!col) return;
    // Idempotent: a double-fire must not push the same key into `hiddenColumns`
    // twice, which would survive the round trip and show up as a duplicate row
    // in the drawer's field list.
    if (!visibleColumns.includes(col.data)) return;
    const newVisible = visibleColumns.filter(k => k !== col.data);
    const newHidden = hiddenColumns.includes(col.data) ? hiddenColumns : [...hiddenColumns, col.data];
    handleColumnVisibilityChange(newVisible, newHidden);
    persistColumnLayout(newVisible, newHidden);
  }, [cols, visibleColumns, hiddenColumns, handleColumnVisibilityChange, persistColumnLayout]);

  /**
   * The view switcher — write the chosen mode THROUGH to this user's view.
   *
   * Deliberately the same mechanism as `persistColumnLayout`, and for the same
   * reason: clicking the switcher IS the user's explicit act, and a mode that
   * is gone on the next reload is not a property of the view, it is a mood.
   *
   * The payload is built from the SAVED row with only `viewMode` replaced —
   * never from live table state — so switching to the grid cannot quietly
   * promote an ad-hoc quick filter into the saved view. Same trap the column
   * drag documents above; same answer.
   *
   * `silent` because one toast per switch is noise, not feedback. A FAILED
   * write is still reported.
   *
   * With no saved row we are on the base ("Default view") tab by construction,
   * so the base row is minted carrying only the mode. With no perspectives at
   * all (an uncontrolled grid — a drawer sub-table, a story) the mode is still
   * applied, just not persisted: there is nowhere to persist it to, and
   * refusing to switch would be worse than forgetting.
   */
  const handleViewModeChange = useCallback((mode: TableViewMode) => {
    setViewMode(mode);
    onViewModeChange?.(mode);
    if (controlledActiveId === undefined) return;
    const target = activePerspectiveId
      ? savedPerspectives.find(p => p.id === activePerspectiveId) ?? null
      : baseViewPerspective;
    if (target) {
      handleSavePerspective({ ...target, viewMode: mode }, true);
      return;
    }
    if (activePerspectiveId) return; // a named view whose row hasn't loaded — don't invent one
    /**
     * Mint the base row FROM THE LIVE STATE, not from empty literals.
     *
     * This used to write `filters: []`, `sorting: []`, `grouping: []` and a bare
     * `dateFormat: undefined` alongside the real column lists — so flipping
     * list↔grid persisted an "everything cleared" view over whatever the user
     * had on screen, and the next perspective read applied it back. Filters and
     * sorting survived the round trip only because the host owns those; the
     * GROUPING did not, and a table that opens grouped lost its sections the
     * first time anyone touched the view switcher.
     *
     * Measured on the documents list: grouped by case in the table, one click
     * to Grid, and `groupRules` came back `[]`.
     *
     * The switcher's job is to record the MODE. Everything else about the view
     * belongs to the view and travels unchanged.
     */
    handleSavePerspective(
      {
        id: generatePerspectiveId(),
        name: BASE_VIEW_PERSPECTIVE_NAME,
        isBaseView: true,
        columns: { visible: visibleColumns, hidden: hiddenColumns },
        filters,
        sorting: sortRules,
        grouping: groupRules,
        aggregations,
        lookupColumns,
        rollupColumns,
        formulas,
        conditionalFormats,
        dateFormat,
        viewMode: mode,
      },
      true,
    );
  }, [
    controlledActiveId,
    activePerspectiveId,
    savedPerspectives,
    baseViewPerspective,
    handleSavePerspective,
    visibleColumns,
    hiddenColumns,
    filters,
    sortRules,
    groupRules,
    aggregations,
    lookupColumns,
    rollupColumns,
    formulas,
    conditionalFormats,
    dateFormat,
  ]);

  /** Keyboard/menu equivalent of the drag: one step left or right. */
  const handleColumnMove = useCallback((colIndex: number, direction: -1 | 1) => {
    const target = colIndex + direction;
    if (target < 0 || target >= cols.length) return;
    handleColumnReorder(colIndex, target);
  }, [cols.length, handleColumnReorder]);

  const handleModernColumnAction = useCallback((actionId: string, colIndex: number) => {
    if (!tableRef?.current) return;
    dispatch(tableRef.current, TableEvents.COLUMN_CONTEXT_MENU_ACTION, {
      columnIndex: colIndex,
      columnName: cols[colIndex]?.data,
      actionId,
    });
  }, [cols, tableRef]);

  // Apply frozen columns as sticky-left by computing adjusted offsets
  const effectiveLeftOffsets = useMemo(() => {
    if (frozenColumns.size === 0) return leftOffsets;
    const offsets = [...leftOffsets];
    let cumulativeOffset = rowHeaders ? ROW_HEADER_WIDTH : 0;
    // Check existing sticky-left columns first
    for (let i = 0; i < cols.length; i++) {
      if (cols[i].sticky === 'left') {
        cumulativeOffset = (offsets[i] ?? 0) + store.getColumnWidth(i);
      }
    }
    // Apply frozen columns
    for (let i = 0; i < cols.length; i++) {
      if (frozenColumns.has(cols[i].data) && cols[i].sticky !== 'left') {
        offsets[i] = cumulativeOffset;
        cumulativeOffset += store.getColumnWidth(i);
      }
    }
    return offsets;
  }, [frozenColumns, leftOffsets, cols, store, rowHeaders, storeRevision]);

  // Data key of the RIGHTMOST pinned (sticky-left or frozen) column — its right
  // edge is the boundary the scrolling body slides under, so it carries the
  // float shadow. Derived from the resolved offsets so it covers both natively
  // sticky-left columns and menu-frozen ones.
  const lastFrozenColumnKey = useMemo(() => {
    let key: string | null = null;
    for (let i = 0; i < cols.length; i++) {
      if (effectiveLeftOffsets[i] !== undefined) key = cols[i].data;
    }
    return key;
  }, [effectiveLeftOffsets, cols]);

  // -------------------- COLUMN VIRTUALIZATION --------------------
  // Opt-in (`uiConfig.enableColumnVirtualization`), default OFF. When off, the
  // hook returns a FULL window — every column mounted, no spacers — which is
  // byte-identical to the render this grid has always produced.
  //
  // Pinned columns derive from the SAME two sources as `effectiveLeftOffsets`
  // (`ColumnDef.sticky` + the runtime `frozenColumns` key set), because
  // `position: sticky` needs an element that exists: anything pinned is mounted
  // unconditionally.
  const pinnedColumnIndices = useMemo(
    () => getPinnedColumnIndices(cols, frozenColumns),
    [cols, frozenColumns],
  );

  // The caret and the editor must never land on an unmounted column. Held in
  // STATE rather than read during render so that an arrow key which stays
  // inside the same column costs no DynamicTable render at all — this component
  // deliberately does not subscribe to the selection.
  const [forcedColumnIndices, setForcedColumnIndices] = useState<number[]>([]);

  const getColumnKeyByIndex = useCallback(
    (colIndex: number) => cols[colIndex]?.data ?? colIndex,
    [cols],
  );

  const columnVirtualizer = useColumnVirtualizer({
    enabled: enableColumnVirtualization,
    columnCount: cols.length,
    getColumnWidth,
    getScrollElement: () => tableRef.current,
    pinnedLeftIndices: pinnedColumnIndices.left,
    pinnedRightIndices: pinnedColumnIndices.right,
    forcedIndices: forcedColumnIndices,
    overscan: columnOverscan,
    // ROW_HEADER_WIDTH (32), NOT the 50 that `totalWidth` uses for the same
    // gutter — the two disagree today (a pre-existing bug). The 18px difference
    // moves only the scroll-range arithmetic, well inside one overscan column,
    // and never touches a spacer width. Do NOT "fix" it by swapping `totalWidth`
    // for the virtualizer's: that visibly narrows every table by 18px.
    leadingWidth: rowHeaders ? ROW_HEADER_WIDTH : 0,
    trailingWidth: showActionsColumn ? actionsColumnWidth : 0,
    widthRevision: storeRevision,
    getColumnKey: getColumnKeyByIndex,
    hasRowHeader: rowHeaders,
    hasActionsColumn: showActionsColumn,
  });

  const columnVirtualizerRef = useRef(columnVirtualizer);
  columnVirtualizerRef.current = columnVirtualizer;

  // Range-operation contract rule 9: MOVING THE SELECTION TO A COLUMN IMPLIES
  // SCROLLING IT INTO VIEW — in the same commit, before any focus attempt.
  //
  // Subscribing to the store rather than patching each `setSelection` /
  // `setEditingCell` call site covers every path there is (keyboard, Tab,
  // double-click, add-row, context menu, a consumer calling the store directly)
  // and cannot be missed by a future one. The callback runs SYNCHRONOUSLY inside
  // the store notification, so `scrollLeft` is written before React re-renders
  // and long before `Cell`'s `setTimeout(0)` focus effect runs.
  //
  // `setEditingCell` has its own channel: it bumps only the two affected cells'
  // revisions, so a selection subscriber cannot see the editor move.
  useEffect(() => {
    if (!enableColumnVirtualization) return;
    let lastKey = '';
    const sync = () => {
      const sel = store.getSelection();
      const editing = store.getEditingCell();
      const next: number[] = [];
      if (sel.anchor) next.push(sel.anchor.col);
      if (sel.focus) next.push(sel.focus.col);
      if (editing) next.push(editing.col);
      const unique = Array.from(new Set(next)).sort((a, b) => a - b);
      const key = unique.join(',');
      if (key !== lastKey) {
        lastKey = key;
        setForcedColumnIndices(unique);
      }
      // No-op when the target is pinned or already visible.
      const target = editing?.col ?? sel.focus?.col ?? sel.anchor?.col;
      if (target != null) columnVirtualizerRef.current.scrollToColumn(target);
    };
    sync();
    const offSelection = store.subscribeToSelection(sync);
    const offEditing = store.subscribeToEditing(sync);
    return () => {
      offSelection();
      offEditing();
    };
  }, [store, enableColumnVirtualization]);

  /**
   * The VERTICAL companion to the column scroll above: moving the selection to
   * a row implies scrolling that row into view.
   *
   * `Ctrl/Cmd+Shift+ArrowDown` extends to the far edge of the data block, which
   * on a 50-row page is always outside the ~29 mounted rows. Without this the
   * extension is correct in the model and invisible on screen — and a keyboard
   * gesture whose result you cannot see is worse than one that does nothing.
   *
   * Bails out for a row that is already MOUNTED rather than relying on
   * `align: 'auto'`: the virtualizer issues a `scrollTo` either way, and an
   * unconditional scroll on every click would fight the column scroll-into-view
   * above and make a drag-select jitter.
   */
  useEffect(() => {
    let lastRow = -1;
    const sync = () => {
      const editing = store.getEditingCell();
      const sel = store.getSelection();
      const target = editing?.row ?? sel.focus?.row ?? sel.anchor?.row;
      if (target == null || target < 0 || target >= store.getRowCount()) return;
      if (target === lastRow) return;
      lastRow = target;
      // Already painted → nothing to do. A drag-select's focus can only ever be
      // a mounted cell, so this is also what keeps a drag from auto-scrolling.
      const mounted = rowVirtualizer.getVirtualItems();
      if (mounted.length === 0) return;
      if (target >= mounted[0].index && target <= mounted[mounted.length - 1].index) return;
      rowVirtualizer.scrollToIndex(target, { align: 'auto' });
    };
    const offSelection = store.subscribeToSelection(sync);
    const offEditing = store.subscribeToEditing(sync);
    return () => {
      offSelection();
      offEditing();
    };
  }, [store, rowVirtualizer]);

  const keyboardHandler = useKeyboardNavigation(store, cols.length, cols, autoEditOnTab, handleCellSave, siblingTableRefs);
  const shortcutHandler = useRowActionShortcuts(store, keyboardShortcuts, onRowAction);

  // Row click handler using event delegation
  const handleTableClick = useCallback((e: React.MouseEvent) => {
    if (!onRowClick) return;

    const target = e.target as HTMLElement;

    // Skip group header rows
    if (target.closest('tr[data-group-header]')) return;

    // Don't trigger row click if clicking on action buttons, inputs, etc.
    if (target.closest('button, input, select, textarea, a, [data-no-row-click]')) return;

    // Find the row element
    const row = target.closest('tr[data-row]');
    if (!row) return;

    const rowIndex = parseInt(row.getAttribute('data-row') || '', 10);
    if (isNaN(rowIndex)) return;

    const rowData = store.getRowData(rowIndex);
    if (rowData) {
      onRowClick(rowIndex, rowData, e);
    }
  }, [store, onRowClick]);

  /**
   * Every cell of a selection, as annotation TARGETS.
   *
   * Iterates the bounds arithmetically — a cell whose column is outside the
   * virtualization window is still part of the range. De-duplicated on
   * `entityType:rowId:columnKey`, which is also the annotations table's unique
   * key: a range covering both legs of one container resolves the container's
   * columns to the SAME target twice, and the batch endpoint rejects the
   * duplicate. That de-duplication is now correct rather than accidental —
   * before B8a it collapsed two genuinely different legs into one cell.
   */
  const collectBulkCells = useCallback(
    (bounds: { startRow: number; endRow: number; startCol: number; endCol: number }) => {
      const cells: { entityType: string; rowId: string; columnKey: string }[] = [];
      const seen = new Set<string>();
      for (let r = bounds.startRow; r <= bounds.endRow; r++) {
        const rData = store.getRowData(r);
        if (!rData) continue;
        for (let c = bounds.startCol; c <= bounds.endCol; c++) {
          const cConfig = cols[c];
          if (!cConfig) continue;
          const target = resolveCommentTarget(rData, cConfig);
          if (!target.entityType || !target.rowId) continue;
          const key = annotationKey(target, cConfig.data);
          if (seen.has(key)) continue;
          seen.add(key);
          cells.push({ entityType: target.entityType, rowId: target.rowId, columnKey: cConfig.data });
        }
      }
      return cells;
    },
    [store, cols, resolveCommentTarget],
  );

  // Resolve a comment-indicator (or any element inside a cell) to its cell
  // coordinates + the annotation backing it. Used by the hover preview and the
  // click-to-open-dialog paths.
  const resolveCommentCell = useCallback((el: Element) => {
    const cell = el.closest('td[data-row][data-col]') as HTMLElement | null;
    if (!cell) return null;
    const rowIndex = parseInt(cell.getAttribute('data-row') || '', 10);
    const colIndex = parseInt(cell.getAttribute('data-col') || '', 10);
    if (Number.isNaN(rowIndex) || Number.isNaN(colIndex)) return null;
    const rowData = store.getRowData(rowIndex);
    const col = cols[colIndex];
    if (!rowData || !col) return null;
    // B8a — the target comes from the CELL. `rowId` is the target's id, which
    // on a leg-scoped column is the leg and on a container-scoped column the
    // container, NOT the row's id column.
    const target = resolveCommentTarget(rowData, col);
    if (!target.rowId || !target.entityType) return null;
    return {
      rowIndex,
      colIndex,
      rowData,
      col,
      entityType: target.entityType,
      rowId: target.rowId,
      annotation: annotations.get(annotationKey(target, col.data)),
      cell,
    };
  }, [store, cols, resolveCommentTarget, annotations]);

  // Track the cell under the pointer so it can offer the comment affordance
  // (ledger 8.1 — hover used to paint a selection box and nothing else).
  //
  // Written to the STORE, never to React state: `setHoveredCell` repaints the
  // cell left and the cell entered and nothing else, while a `useState` here
  // would re-render every mounted row on every pointer move. Piggy-backs on the
  // container's existing delegated mouseover, so no new listener is added.
  const handleCellHoverOver = useCallback((e: React.MouseEvent) => {
    if (!enableComments || !commentsEntityType) return;
    const td = (e.target as HTMLElement).closest?.('td.hot-cell[data-row][data-col]') as HTMLElement | null;
    if (!td || td.hasAttribute('data-actions-cell')) { store.setHoveredCell(null); return; }
    const row = Number(td.getAttribute('data-row'));
    const col = Number(td.getAttribute('data-col'));
    if (Number.isNaN(row) || Number.isNaN(col)) { store.setHoveredCell(null); return; }
    store.setHoveredCell({ row, col });
  }, [enableComments, commentsEntityType, store]);

  // Hover the comment indicator → show a read-only preview of its thread.
  const handleCommentHoverOver = useCallback((e: React.MouseEvent) => {
    if (!enableComments || !commentsEntityType) return;
    const indicator = (e.target as HTMLElement).closest?.('.cell-comment-indicator');
    if (!indicator) return;
    const info = resolveCommentCell(indicator);
    if (!info?.annotation || info.annotation.comments.length === 0) return;
    setCommentHover({
      comments: info.annotation.comments,
      columnTitle: info.col.title || info.col.data,
      anchorRect: indicator.getBoundingClientRect(),
    });
  }, [enableComments, commentsEntityType, resolveCommentCell]);

  const handleCommentHoverOut = useCallback((e: React.MouseEvent) => {
    const indicator = (e.target as HTMLElement).closest?.('.cell-comment-indicator');
    if (!indicator) return;
    // mouseout bubbles from the icon's children — only close when truly leaving.
    const related = e.relatedTarget as Node | null;
    if (related && indicator.contains(related)) return;
    setCommentHover(null);
  }, []);

  // Open comment dialog on Shift+Click (or a direct click on the comment icon)
  // when comments are enabled.
  // Called from onMouseDown so it runs BEFORE handleMouseDown resets the selection.
  // Returns true if it handled the event (caller should skip normal mousedown).
  const handleCommentMouseDown = useCallback((e: React.MouseEvent): boolean => {
    if (!enableComments || !commentsEntityType) return false;
    // Direct click on the comment indicator opens the full thread dialog — no
    // modifier required (the icon is the affordance).
    const indicator = (e.target as HTMLElement).closest?.('.cell-comment-indicator');
    if (indicator) {
      const info = resolveCommentCell(indicator);
      if (info) {
        e.preventDefault();
        e.stopPropagation();
        setCommentHover(null);
        setCommentDialog({
          entityType: info.entityType,
          rowId: info.rowId,
          columnKey: info.col.data,
          columnTitle: info.col.title || info.col.data,
          rowLabel: info.rowData.name || info.rowData.title || undefined,
          annotationId: info.annotation?.id || null,
          currentColor: info.annotation?.color || null,
          anchorRect: (info.cell as HTMLElement).getBoundingClientRect(),
        });
        return true;
      }
    }
    if (!e.shiftKey) return false;

    const target = e.target as HTMLElement;
    const cell = target.closest('td[data-row][data-col]');
    if (!cell) return false;

    const rowIndex = parseInt(cell.getAttribute('data-row') || '', 10);
    const colIndex = parseInt(cell.getAttribute('data-col') || '', 10);
    if (isNaN(rowIndex) || isNaN(colIndex)) return false;

    const rowData = store.getRowData(rowIndex);
    const colConfig = cols[colIndex];
    if (!rowData || !colConfig) return false;

    const cellTarget = resolveCommentTarget(rowData, colConfig);
    if (!cellTarget.entityType || !cellTarget.rowId) return false;

    // Check if there's a multi-cell selection — must read BEFORE handleMouseDown resets it
    const bounds = store.getSelectionBounds();
    const isMultiCell = bounds && (bounds.startRow !== bounds.endRow || bounds.startCol !== bounds.endCol);

    if (isMultiCell && bounds) {
      const bulkCells = collectBulkCells(bounds);
      if (bulkCells.length > 1) {
        e.preventDefault();
        e.stopPropagation();
        setCommentDialog({
          entityType: cellTarget.entityType,
          rowId: cellTarget.rowId,
          columnKey: colConfig.data,
          columnTitle: colConfig.title || colConfig.data,
          anchorRect: (cell as HTMLElement).getBoundingClientRect(),
          bulkCells,
        });
        return true;
      }
    }

    // Single cell — open comment dialog (also prevent mousedown from resetting)
    e.preventDefault();
    e.stopPropagation();

    const annotation = annotations.get(annotationKey(cellTarget, colConfig.data));

    setCommentDialog({
      entityType: cellTarget.entityType,
      rowId: cellTarget.rowId,
      columnKey: colConfig.data,
      columnTitle: colConfig.title || colConfig.data,
      rowLabel: rowData.name || rowData.title || undefined,
      annotationId: annotation?.id || null,
      currentColor: annotation?.color || null,
      anchorRect: (cell as HTMLElement).getBoundingClientRect(),
    });
    return true;
  }, [enableComments, commentsEntityType, store, cols, resolveCommentTarget, collectBulkCells, annotations]);

  // ── Cell-range selection: committed dotted outline + drag-end context menu ──
  // The dotted outline and the Copy/Comment menu appear ONLY when a drag finishes
  // on a multi-cell range. `rangePhase` drives the `data-range-phase` attribute
  // the CSS keys off of: 'committed' (fade in) → 'exiting' (fade out) → cleared.
  const [rangePhase, setRangePhase] = useState<'idle' | 'committed' | 'exiting'>('idle');
  const rangePhaseRef = useRef<'idle' | 'committed' | 'exiting'>('idle');
  const rangeExitTimerRef = useRef<number | null>(null);
  const applyRangePhase = useCallback((p: 'idle' | 'committed' | 'exiting') => {
    rangePhaseRef.current = p;
    setRangePhase(p);
  }, []);

  // Clear the selection, fading a committed outline out first (opacity 1→0).
  const clearSelectionAnimated = useCallback(() => {
    if (rangePhaseRef.current === 'committed') {
      applyRangePhase('exiting');
      if (rangeExitTimerRef.current) window.clearTimeout(rangeExitTimerRef.current);
      rangeExitTimerRef.current = window.setTimeout(() => {
        store.setSelection({ type: null, anchor: null, focus: null });
        applyRangePhase('idle');
        rangeExitTimerRef.current = null;
      }, 170);
    } else {
      store.setSelection({ type: null, anchor: null, focus: null });
      applyRangePhase('idle');
    }
  }, [store, applyRangePhase]);

  const copySelectionToClipboard = useCallback(() => {
    const cells = store.getCellsInSelection();
    const bounds = store.getSelectionBounds();
    if (!cells.length || !bounds) return;
    const text = selectionToTsv(cells, bounds);
    // Marching ants go up IMMEDIATELY — Excel's marquee appears with the
    // gesture, not a round-trip later, and `navigator.clipboard.writeText` is
    // async. They are taken back down in the failure branch, so an outline
    // claiming the clipboard holds this block never outlives a rejected write.
    store.setClipboardMarker({ mode: 'copy', bounds });
    void navigator.clipboard?.writeText(text)
      .then(() => flash(t('dynamicTable.cellMenu.copied', 'Copied to clipboard'), 'success'))
      .catch(() => {
        store.setClipboardMarker(null);
        flash(t('dynamicTable.cellMenu.copyFailed', 'Could not copy to clipboard'), 'error');
      });
  }, [store, t]);

  // Ctrl/Cmd+C copy. The base handler copies a cell-range selection; when there's
  // no range but rows are checkbox-selected, fall back to copying those rows
  // (visible columns, in page order) as TSV. Either way, flash success.
  const copyRowSelectionText = useCallback((): string | null => {
    if (selectedRowIds.size === 0) return null;
    const rowCount = store.getRowCount();
    const lines: string[] = [];
    for (let r = 0; r < rowCount; r++) {
      const rowData = store.getRowData(r);
      if (!rowData) continue;
      const id = String(rowData[selectionColumnName] ?? '');
      if (!id || !selectedRowIds.has(id)) continue;
      lines.push(cols.map((_, c) => String(store.getCellValue(r, c) ?? '')).join('\t'));
    }
    return lines.length ? lines.join('\n') : null;
  }, [store, selectedRowIds, selectionColumnName, cols]);

  const handleCopied = useCallback((bounds: SelectionBounds | null) => {
    // Excel's marquee. `bounds` is null for the checkbox-row fallback, which
    // has no rectangle to draw around — that path copies rows, not a range.
    if (bounds) store.setClipboardMarker({ mode: 'copy', bounds });
    flash(t('dynamicTable.cellMenu.copied', 'Copied to clipboard'), 'success');
  }, [store, t]);

  const handleCopy = useCopyHandler(store, tableRef, {
    getFallbackText: copyRowSelectionText,
    onCopy: handleCopied,
  });

  // Grouped-actions-bar Copy button: actively write the selected rows to the
  // clipboard (the Ctrl+C path relies on the browser copy event; a button click
  // can't, so it uses the async clipboard API directly). Flashes on success.
  const handleBulkCopy = useCallback(() => {
    const text = copyRowSelectionText();
    if (!text) return;
    void navigator.clipboard?.writeText(text)
      .then(() => flash(t('dynamicTable.cellMenu.copied', 'Copied to clipboard'), 'success'))
      .catch(() => flash(t('dynamicTable.cellMenu.copyFailed', 'Could not copy to clipboard'), 'error'));
  }, [copyRowSelectionText, t]);

  // Shared serializer: turn an extracted table into a downloaded CSV/Excel file.
  // The xlsx serializer is imported lazily so the CSV path never loads SheetJS.
  const serializeAndDownload = useCallback(async (table: ExtractedTable, format: ExportFormat) => {
    if (table.rows.length === 0) {
      flash(t('dynamicTable.export.empty', 'No rows to export'), 'info');
      return;
    }
    const stem = exportFileName?.trim() || slugifyFileName(displayTableName);
    try {
      if (format === 'csv') {
        const blob = new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' });
        downloadBlob(blob, `${stem}.csv`);
      } else {
        const XLSX = await import('xlsx');
        downloadBlob(toXlsxBlob(table, XLSX), `${stem}.xlsx`);
      }
      flash(t('dynamicTable.export.success', 'Export ready'), 'success');
    } catch {
      flash(t('dynamicTable.export.failed', 'Could not export'), 'error');
    }
  }, [exportFileName, displayTableName, t]);

  // Grouped-actions-bar export: the checkbox-selected rows, visible columns in
  // view order. Mirrors the Copy extraction (`store.getCellValue`).
  const handleExportSelection = useCallback((format: ExportFormat) => {
    void serializeAndDownload(
      extractExportRows(store, cols, selectedRowIds, selectionColumnName),
      format,
    );
  }, [serializeAndDownload, store, cols, selectedRowIds, selectionColumnName]);

  // Toolbar export: the WHOLE table — every column (ignoring the active
  // perspective's column visibility) and every row. When the page supplies
  // `onExportAll`, re-fetch all pages from the server (ignoring filters);
  // otherwise fall back to the currently-loaded rows.
  const [isExportingAll, setIsExportingAll] = useState(false);
  const handleExportAll = useCallback(async (format: ExportFormat) => {
    if (isExportingAll) return;
    setIsExportingAll(true);
    try {
      const outcome = onExportAll ? await onExportAll() : data;

      // HEDGE-123 — a file is only written for a result proven complete.
      //
      // `onExportAll` may reject (a page failed, or came back unreadable) — the
      // catch below turns that into a visible error and NO download, which is
      // the point: a failure the user can see and retry, instead of a short
      // file they cannot. It may also resolve carrying its own counts, for the
      // case where rows were fetched but completeness could not be proven.
      // A bare array still means complete, so hosts predating this are unchanged.
      const counted: ExportAllResult | null =
        outcome != null && !Array.isArray(outcome) ? (outcome as ExportAllResult) : null;
      const rows = counted ? counted.rows : (outcome as any[]);

      if (counted && !counted.complete) {
        // Deliberately NOT a download. Handing over a file here would restore
        // exactly the defect this replaces — the numbers exist precisely so the
        // user is told what is missing rather than shown a plausible file.
        flash(
          t(
            'dynamicTable.export.incomplete',
            'Export stopped early and was NOT saved — {reason}. Try again.',
            { reason: counted.reason ?? 'the full table could not be read' },
          ),
          'error',
        );
        return;
      }

      await serializeAndDownload(extractExportRowsFromData(rows ?? [], baseColumns), format);
    } catch (err) {
      // Name the failure. "Could not export" alone left a user unable to say
      // whether it was their filter, the network, or the server.
      const detail = err instanceof Error && err.message ? err.message : null;
      flash(
        detail
          ? t('dynamicTable.export.failedDetail', 'Could not export — {detail}', { detail })
          : t('dynamicTable.export.failed', 'Could not export'),
        'error',
      );
    } finally {
      setIsExportingAll(false);
    }
  }, [isExportingAll, onExportAll, data, serializeAndDownload, baseColumns, t]);

  const openAnnotateForSelection = useCallback(() => {
    if (!enableComments || !commentsEntityType) return;
    const bounds = store.getSelectionBounds();
    if (!bounds) return;
    const anchorCell = tableRef.current?.querySelector(
      `td[data-row="${bounds.endRow}"][data-col="${bounds.endCol}"]`
    ) as HTMLElement | null;
    // MODEL FALLBACK. Under column virtualization the range's bottom-right cell
    // may not be mounted, and an `undefined` rect drops the dialog into the
    // middle of the viewport instead of next to the selection. Column x comes
    // from the prefix-sum geometry (which answers for unmounted columns), row y
    // from the row height — the two facts the DOM was being asked for.
    const anchorRect = anchorCell?.getBoundingClientRect() ?? (() => {
      const el = tableRef.current;
      if (!el) return undefined;
      const box = el.getBoundingClientRect();
      const geo = columnVirtualizer.geometry;
      const x = box.left + (geo.starts[bounds.endCol] ?? 0) - el.scrollLeft;
      const y = box.top + bounds.endRow * dataRowHeight - el.scrollTop;
      const width = store.getColumnWidth(bounds.endCol);
      return new DOMRect(x, y, width, dataRowHeight);
    })();
    const firstRowData = store.getRowData(bounds.startRow);
    const firstCol = cols[bounds.startCol];
    if (!firstRowData || !firstCol) return;
    const firstTarget = resolveCommentTarget(firstRowData, firstCol);
    if (!firstTarget.entityType || !firstTarget.rowId) return;

    const isMultiCell = bounds.startRow !== bounds.endRow || bounds.startCol !== bounds.endCol;
    if (isMultiCell) {
      const bulkCells = collectBulkCells(bounds);
      if (bulkCells.length > 1) {
        setCommentDialog({
          entityType: firstTarget.entityType,
          rowId: firstTarget.rowId,
          columnKey: firstCol.data,
          columnTitle: firstCol.title || firstCol.data,
          anchorRect,
          bulkCells,
        });
        return;
      }
    }
    const annotation = annotations.get(annotationKey(firstTarget, firstCol.data));
    setCommentDialog({
      entityType: firstTarget.entityType,
      rowId: firstTarget.rowId,
      columnKey: firstCol.data,
      columnTitle: firstCol.title || firstCol.data,
      rowLabel: firstRowData.name || firstRowData.title || undefined,
      annotationId: annotation?.id || null,
      currentColor: annotation?.color || null,
      anchorRect,
    });
  }, [enableComments, commentsEntityType, store, cols, resolveCommentTarget, collectBulkCells, annotations, columnVirtualizer, dataRowHeight]);

  // After a drag finishes on a multi-cell range, commit the outline.
  //
  // This used to ALSO pop the cell context menu at the cursor, unprompted, on
  // every range drag — so selecting cells to read them threw a menu over the
  // data you had just selected. Copy is `Ctrl/⌘+C` (and the bulk bar, and
  // right-click), so the popup was interrupting to offer something the
  // keyboard already does. Right-click still opens the same menu, which is
  // where Comment / colour remains discoverable.
  const handleMouseUpWithMenu = useCallback(() => {
    handleMouseUp();
    const bounds = store.getSelectionBounds();
    const isRange = !!bounds && (bounds.startRow !== bounds.endRow || bounds.startCol !== bounds.endCol);
    if (isRange) applyRangePhase('committed');
  }, [handleMouseUp, store, applyRangePhase]);

  // ---- Fill handle (drag-to-fill) ----
  // A fill drag starts on the bottom-right nub of the SELECTION — any size
  // (`[data-fill-handle]`). Excel fills a RECTANGLE in four directions and each
  // source line continues its own series; so does this. Distinct from
  // range-select, which starts on the cell body. Opt-in via
  // `uiConfig.enableFillHandle`.
  //
  // The geometry (axis lock, back-drag, direction) is NOT computed here — it
  // lives in `utils/fillGeometry.ts` as a pure function, because rules a user
  // notices must be provable without a browser.
  const fillStateRef = useRef<{
    source: SelectionBounds;
    pointer: { row: number; col: number };
    modifier: boolean;
  } | null>(null);
  // A large write held back for confirmation. Deliberately a WRITE BATCH, not a
  // fill-shaped triple: the same dialog now guards a big paste, and a second
  // confirmation flow is how the two would drift apart.
  const [pendingWrite, setPendingWrite] = useState<{
    writes: CellWrite[];
    origin: CellWriteOrigin;
    /**
     * Carried through the dialog rather than re-derived from `origin`: a
     * back-drag clear IS the fill handle and must honour `disableFill`, while a
     * Delete-key clear is an ordinary edit and must not. Same origin, different
     * answer — so the answer travels with the batch.
     */
    respectDisableFill?: boolean;
  } | null>(null);

  /**
   * Seed values for one fill line, read by INDEX into the full column array.
   * Never by DOM query: a column may be unmounted by column virtualization and
   * still be part of the source block.
   */
  const readFillSeed = useCallback(
    (cells: Array<{ row: number; col: number }>, seedColIndex: number): FillSeed => {
      const column = cols[seedColIndex];
      const values = cells.map(({ row, col }) => {
        const raw = store.getCellValue(row, col);
        // A boolean column may be backed by a non-boolean value (a timestamp
        // rendered as a checkbox). Seed the boolean STATE so the per-cell save
        // coerces and persists exactly like a manual toggle would.
        return cols[col]?.type === 'boolean' ? Boolean(raw) : raw;
      });
      return { values, column };
    },
    [cols, store],
  );

  /** Re-derive the preview rectangle for the current pointer and modifier. */
  const paintFillPreview = useCallback(() => {
    const fs = fillStateRef.current;
    if (!fs) return;
    // Two passes, deliberately: the axis decides which line is the seed, and the
    // seed decides the default mode. Pass 1 is geometry only, so the mode it is
    // handed is discarded; pass 2 re-labels it with the truth.
    const geometry = computeFillPreview(fs.source, fs.pointer, {
      modifier: false,
      defaultMode: 'series',
    });
    const [firstLine] = buildFillLines(geometry);
    let defaultMode: FillMode = 'copy';
    if (firstLine && firstLine.seedCells.length > 0) {
      defaultMode = detectFillPattern(readFillSeed(firstLine.seedCells, firstLine.seedCol)).defaultMode;
    }
    const mode = fs.modifier ? invertFillMode(defaultMode) : defaultMode;
    store.setFillPreview({ ...geometry, mode });
  }, [store, readFillSeed]);

  const handleFillMouseDown = useCallback((e: React.MouseEvent): boolean => {
    if (!enableFillHandle) return false;
    if (!(e.target as HTMLElement).closest('[data-fill-handle]')) return false;
    const bounds = store.getSelectionBounds();
    if (!bounds) return false;
    // Selection SIZE is unconstrained — an N×M block is a legitimate source.
    // Fillability is a property of the block, not of one corner cell: a source
    // containing a read-only column still fills, that column's writes are just
    // rejected and reported. This mirrors the store's `isFillOrigin`, which is
    // what put the nub on screen in the first place.
    const anyFillable = (() => {
      for (let c = bounds.startCol; c <= bounds.endCol; c++) {
        const col = cols[c];
        if (col && !col.readOnly && !col.disableFill) return true;
      }
      return false;
    })();
    if (!anyFillable) return false;
    fillStateRef.current = {
      source: bounds,
      pointer: { row: bounds.endRow, col: bounds.endCol },
      modifier: e.altKey || e.ctrlKey,
    };
    paintFillPreview();
    e.preventDefault();
    return true;
  }, [enableFillHandle, store, cols, paintFillPreview]);

  const handleFillMouseMove = useCallback((e: React.MouseEvent) => {
    const fs = fillStateRef.current;
    if (!fs) return;
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('td');
    if (!cell) return;
    // A 2D drag crosses the row-header gutter and the actions column, neither of
    // which is a data cell. Reading `data-col` off them yields NaN or an index
    // outside the column array, so they are rejected outright — the preview
    // simply stops updating rather than jumping to column 0.
    if (cell.hasAttribute('data-row-header') || cell.hasAttribute('data-actions-cell')) return;
    const row = parseInt(cell.getAttribute('data-row') || '', 10);
    const col = parseInt(cell.getAttribute('data-col') || '', 10);
    if (Number.isNaN(row) || Number.isNaN(col)) return;
    if (col < 0 || col >= cols.length) return;
    fs.pointer = { row, col };
    // Excel lets the modifier be pressed or released MID-drag, so it is tracked
    // continuously and the preview badge follows.
    fs.modifier = e.altKey || e.ctrlKey;
    paintFillPreview();
  }, [cols, paintFillPreview]);

  /**
   * THE multi-cell write. Fill, paste, cut, clear, find-&-replace and import all
   * come through here — a second write path is how the grid ends up with two
   * undo behaviours and two rejection tables.
   *
   * No `beginUndoGroup()` here: `applyCellWrites` already opens exactly one
   * group around the whole batch, and a second group NESTS and destroys the
   * outer one, which would turn a 30x4 paste back into 120 separate Ctrl+Z's.
   *
   * No caller-side `disableFill` filtering either: `applyCellWrites` rejects it
   * when (and only when) `origin === 'fill'`. A paste or a replace MUST still
   * write those columns — `disableFill` excludes identity fields from the DRAG
   * HANDLE, it does not make them read-only.
   *
   * `tableRef.current` is read INSIDE the callback so the batch events reach the
   * live container even if it remounted (fullscreen re-parents it).
   */
  /**
   * Bumped after every multi-cell write. `CellStore` bumps revisions PER CELL,
   * so nothing at this level can observe a batch landing — and find-and-replace
   * has to re-scan after its own Replace All, or it goes on reporting
   * counts for text it just changed. One counter covers every write path
   * (paste, cut, clear, fill, replace, and the large-write dialog).
   */
  const [writeRevision, setWriteRevision] = useState(0);

  const writeCells = useCallback(
    (
      writes: readonly CellWrite[],
      origin: CellWriteOrigin,
      respectDisableFill?: boolean,
    ): CellWriteReport => {
      const report = applyCellWrites(
        {
          store,
          columns: cols,
          handleCellSave,
          coerce: coerceCellValue,
          element: tableRef.current,
          idColumnName,
        },
        writes,
        { origin, respectDisableFill },
      );
      if (report.written > 0) setWriteRevision((n) => n + 1);
      return report;
    },
    [store, cols, handleCellSave, idColumnName, tableRef],
  );

  /**
   * Say what happened. A batch that silently drops 12 of 40 cells is the single
   * worst failure mode of a paste, so rejections are always surfaced — counted
   * by reason, never as a generic "some cells failed".
   */
  const reportWrite = useCallback((report: CellWriteReport) => {
    if (report.rejected.length === 0) {
      if (report.written > 0) {
        // Name the gesture back to the user: "Cleared 12 cells" after Delete
        // reads as confirmation, "Updated 12 cells" reads as a surprise.
        const applied = report.origin === 'cut'
          ? t('dynamicTable.cut.done', 'Cut {count} cells', { count: report.written })
          : report.origin === 'clear'
            ? t('dynamicTable.clear.done', 'Cleared {count} cells', { count: report.written })
            : t('dynamicTable.write.applied', 'Updated {count} cells', { count: report.written });
        flash(applied, 'success');
      }
      return;
    }
    const parts: string[] = [];
    const r = report.rejectedByReason;
    if (r.readOnly) parts.push(t('dynamicTable.write.rejectedReadOnly', '{count} read-only', { count: r.readOnly }));
    if (r.notCoercible) parts.push(t('dynamicTable.write.rejectedNotCoercible', '{count} wrong type', { count: r.notCoercible }));
    if (r.notInSource) parts.push(t('dynamicTable.write.rejectedNotInSource', '{count} not an allowed value', { count: r.notInSource }));
    if (r.required) parts.push(t('dynamicTable.write.rejectedRequired', '{count} required', { count: r.required }));
    if (r.outOfRange) parts.push(t('dynamicTable.write.rejectedOutOfRange', '{count} outside the table', { count: r.outOfRange }));
    flash(
      t('dynamicTable.write.partial', 'Updated {written} cells; skipped {skipped} ({reasons})', {
        written: report.written,
        skipped: report.rejected.length,
        reasons: parts.join(', '),
      }),
      report.written > 0 ? 'info' : 'error',
    );
  }, [t]);

  /** Run a batch now, or hold it for confirmation when it is large. */
  const submitWrites = useCallback((writes: CellWrite[], origin: CellWriteOrigin) => {
    if (writes.length === 0) return;
    // The threshold counts CELLS (rows x columns), not rows — a 40-row paste
    // across 6 columns is 240 persist requests, and that is what the user is
    // being asked about.
    if (writes.length > fillConfirmThreshold) {
      setPendingWrite({ writes, origin });
      return;
    }
    reportWrite(writeCells(writes, origin));
  }, [fillConfirmThreshold, reportWrite, writeCells]);

  /**
   * Turn the preview rectangle into writes and hand them to the ONE write
   * primitive.
   *
   * The undo rule this must not break: `applyCellWrites` opens exactly ONE
   * group around the whole batch. The per-line loop below GENERATES VALUES, it
   * does not write — iterating lines and calling the writer once per line would
   * produce one undo entry per column, so an n-column fill would need n Ctrl+Z's.
   */
  const commitFill = useCallback(() => {
    const fs = fillStateRef.current;
    if (!fs) return;
    fillStateRef.current = null;

    const preview = store.getFillPreview();
    if (!preview) { store.setFillPreview(null); return; }

    // Back-drag: the cells the user dragged back over are EMPTIED. Not a special
    // path — same primitive, same single undo entry, same persistence.
    if (preview.clearing && preview.cleared) {
      const writes: CellWrite[] = cellsInRect(preview.cleared).map(({ row, col }) => ({
        row,
        col,
        value: null,
      }));
      if (writes.length === 0) { store.setFillPreview(null); return; }
      if (writes.length > fillConfirmThreshold) {
        setPendingWrite({ writes, origin: 'clear', respectDisableFill: true });
        return;
      }
      reportWrite(writeCells(writes, 'clear', true));
      store.setFillPreview(null);
      return;
    }

    // Each source LINE continues its own series: one line per source column on a
    // vertical fill, one per source row on a horizontal one. That is Excel's
    // rule and it is what stops a multi-column drag smearing one column's
    // sequence sideways.
    const writes: CellWrite[] = [];
    for (const line of buildFillLines(preview)) {
      if (line.targets.length === 0) continue;
      const seed = readFillSeed(line.seedCells, line.seedCol);
      const pattern = detectFillPattern(seed);
      const mode = fs.modifier ? invertFillMode(pattern.defaultMode) : pattern.defaultMode;
      const values = generateFill(seed, line.targets.length, preview.backwards ? -1 : 1, mode);
      line.targets.forEach((cell, i) => {
        writes.push({ row: cell.row, col: cell.col, value: values[i] });
      });
    }

    if (writes.length === 0) { store.setFillPreview(null); return; }
    if (writes.length > fillConfirmThreshold) {
      // Keep the dashed preview up while the user confirms the large write.
      setPendingWrite({ writes, origin: 'fill' });
      return;
    }
    reportWrite(writeCells(writes, 'fill'));
    store.setFillPreview(null);
  }, [store, fillConfirmThreshold, writeCells, reportWrite, readFillSeed]);

  const confirmPendingWrite = useCallback(() => {
    if (pendingWrite) {
      reportWrite(
        writeCells(pendingWrite.writes, pendingWrite.origin, pendingWrite.respectDisableFill),
      );
    }
    setPendingWrite(null);
    store.setFillPreview(null);
  }, [pendingWrite, writeCells, reportWrite, store]);

  const cancelPendingWrite = useCallback(() => {
    setPendingWrite(null);
    store.setFillPreview(null);
  }, [store]);

  // ---- In-grid Find & Replace ----
  /**
   * Bring a match into view under virtualization.
   *
   * Three things have to happen in order, and skipping any one of them lands the
   * user on the wrong cell:
   *  1. a match inside a COLLAPSED GROUP expands that group first —
   *     `dataIndexToVisualIndex` silently returns the raw data index for a row
   *     that is not visible, which would scroll to an unrelated row;
   *  2. the ROW is scrolled by the virtualizer, which is the only thing that
   *     knows where an unmounted row lives;
   *  3. the COLUMN is scrolled through the column virtualizer's `scrollToColumn`,
   *     which answers from the PREFIX-SUM GEOMETRY — not from a `<td>`.
   *
   * (3) used to be `querySelector('td[data-row][data-col]')?.scrollIntoView()`
   * in a `requestAnimationFrame`. That is an indices→element read, which the
   * range-operation contract forbids for exactly the reason it failed here: a
   * match in a column outside the mounted window has no `<td>`, so the lookup
   * returned null and the bar made a cell active at x=1179 in a 966px
   * viewport with `scrollLeft` still 0 (ledger row 1.24). `scrollToColumn` is
   * model-driven and therefore answers for unmounted columns, and it runs
   * SYNCHRONOUSLY — mounting the column is a consequence of the scroll, not a
   * precondition for it.
   */
  const scrollToCell = useCallback((row: number, col: number) => {
    const groupKey = groupingResult.groupKeyOfDataIndex(row);
    if (groupKey && groupingResult.collapsedGroups.has(groupKey)) {
      groupingResult.toggleGroup(groupKey);
    }
    const visualIndex = groupingResult.visualRows
      ? groupingResult.dataIndexToVisualIndex(row)
      : row;
    rowVirtualizer.scrollToIndex(visualIndex, { align: 'center' });
    columnVirtualizerRef.current.scrollToColumn(col, { align: 'auto' });
  }, [groupingResult, rowVirtualizer]);

  /**
   * Drive the dataset-wide `SearchBar` from inside the grid, through the
   * machinery that already exists — the dataset filters and the page reloads.
   * Its one caller today is the zero-result state's "clear the search" link.
   */
  const handleSearchWholeDataset = useCallback((query: string) => {
    if (!tableRef.current) return;
    dispatch(tableRef.current, TableEvents.SEARCH, { query, timestamp: Date.now() });
  }, [tableRef]);

  /**
   * Clear the dataset-wide search from the zero-result state (ledger 2.20).
   *
   * Goes through the SAME `TableEvents.SEARCH` dispatch the SearchBar uses, so
   * the input box empties too — `SearchBar` mirrors a search dispatched by
   * anyone else. Anything that reached in and reset host state directly would
   * leave the box still showing the dead term.
   */
  const handleClearSearch = useCallback(() => {
    handleSearchWholeDataset('');
  }, [handleSearchWholeDataset]);


  /**
   * Ctrl/Cmd+V. Reads the RICH flavour first (`text/html`) and only falls back
   * to TSV — Excel's `text/plain` mangles any cell containing a tab or a
   * newline, and its HTML flavour does not.
   *
   * Geometry follows Excel: the grid lands at the selection's top-left corner;
   * when the selection is an exact multiple of the copied block in both
   * directions the block is TILED to fill it (that is how "copy one row, select
   * ten, paste" is expected to behave). Cells that would land past the last row
   * or column are still submitted — `applyCellWrites` reports them as
   * `outOfRange` and the user is told, rather than the paste silently shrinking.
   */
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const container = tableRef.current;
    if (!container || !(e.target instanceof Node) || !container.contains(e.target)) return;
    // An open editor owns its own input — never hijack a paste into a text box.
    if (store.getEditingCell()) return;
    const bounds = store.getSelectionBounds();
    if (!bounds) return;

    const grid = parseClipboardGrid({
      html: e.clipboardData?.getData('text/html'),
      text: e.clipboardData?.getData('text/plain'),
    });
    // Never fail silently: "I pressed Ctrl+V and nothing happened" is
    // indistinguishable from a broken grid.
    if (grid.source === 'empty') {
      flash(t('dynamicTable.paste.empty', 'The clipboard has nothing to paste'), 'info');
      return;
    }
    e.preventDefault();

    const selRows = bounds.endRow - bounds.startRow + 1;
    const selCols = bounds.endCol - bounds.startCol + 1;
    const tile =
      selRows >= grid.rowCount &&
      selCols >= grid.colCount &&
      selRows % grid.rowCount === 0 &&
      selCols % grid.colCount === 0;
    const spanRows = tile ? selRows : grid.rowCount;
    const spanCols = tile ? selCols : grid.colCount;

    const writes: CellWrite[] = [];
    for (let dr = 0; dr < spanRows; dr++) {
      for (let dc = 0; dc < spanCols; dc++) {
        writes.push({
          row: bounds.startRow + dr,
          col: bounds.startCol + dc,
          value: grid.rows[dr % grid.rowCount]?.[dc % grid.colCount] ?? '',
        });
      }
    }
    submitWrites(writes, 'paste');
    // Excel ends the marquee on paste. Ours must too — and here it is also a
    // correctness matter: the paste refetches, which can re-order rows under
    // an index-addressed rectangle.
    store.setClipboardMarker(null);
  }, [store, tableRef, submitWrites, t]);

  /**
   * Every cell of a rectangle, as writes of one value.
   *
   * Range-operation contract: the bounds are walked ARITHMETICALLY, so a
   * selection that spans columns scrolled out of the mounted window (column
   * virtualization is live on `/backend/invoicing`) clears exactly the same
   * cells as one that does not. Nothing here asks the DOM what exists.
   *
   * Out-of-range cells are deliberately still submitted — `applyCellWrites`
   * reports them rather than the operation silently shrinking.
   */
  const rectWrites = useCallback((
    bounds: { startRow: number; endRow: number; startCol: number; endCol: number },
    value: unknown,
  ): CellWrite[] => {
    const writes: CellWrite[] = [];
    for (let r = bounds.startRow; r <= bounds.endRow; r++) {
      for (let c = bounds.startCol; c <= bounds.endCol; c++) {
        writes.push({ row: r, col: c, value });
      }
    }
    return writes;
  }, []);

  /**
   * Delete / Backspace on a selection: CLEAR CONTENTS, never delete rows.
   *
   * `null` (not `''`) is the cleared value — `coerceCellValue` maps both to
   * `null` for typed columns, but `null` is also right for the untyped ones,
   * where `''` would persist an empty string into a nullable field.
   *
   * Read-only columns and `required` fields are rejected BY the write
   * primitive and reported by `reportWrite` — a clear that quietly skips half
   * its cells is the failure mode this replaces.
   */
  const clearSelectionContents = useCallback(() => {
    const bounds = store.getSelectionBounds();
    if (!bounds) return false;
    submitWrites(rectWrites(bounds, null), 'clear');
    return true;
  }, [store, rectWrites, submitWrites]);

  /**
   * Ctrl/Cmd+X. Copy, then clear the source — ONE undo entry, because the clear
   * is a single `applyCellWrites` batch and the copy writes nothing.
   *
   * The clipboard is written FIRST and synchronously, inside the native `cut`
   * event: `navigator.clipboard.writeText` would resolve after the clear and a
   * failure there would leave the data gone with nothing to paste back.
   */
  const handleCut = useCallback((e: ClipboardEvent) => {
    const container = tableRef.current;
    if (!container || !(e.target instanceof Node) || !container.contains(e.target)) return;
    // An open editor owns its own cut — never hijack one out of a text box.
    if (store.getEditingCell()) return;
    const bounds = store.getSelectionBounds();
    const cells = store.getCellsInSelection();
    if (!bounds || cells.length === 0 || !e.clipboardData) return;

    e.clipboardData.setData('text/plain', selectionToTsv(cells, bounds));
    e.preventDefault();
    submitWrites(rectWrites(bounds, null), 'cut');
    // The ants mark WHAT IS ON THE CLIPBOARD and where it came from. The source
    // is already empty by this line — see the note above `handleCut` for why
    // this grid clears on cut rather than on paste.
    store.setClipboardMarker({ mode: 'cut', bounds });
  }, [store, tableRef, rectWrites, submitWrites]);

  // ---- Undo / redo ----
  // Replays the inverse edit through the normal save path, so the reverse also
  // persists (PATCH/POST) and is itself redoable. `suppressed` stops the replay
  // from being re-recorded. Rows are resolved by stable id (they survive the
  // post-edit refetch); rows no longer present are skipped.
  const applyUndoEntry = useCallback((entry: { changes: { rowId: any; colKey: string; oldValue: any; newValue: any }[] }, useOldValue: boolean) => {
    store.setUndoSuppressed(true);
    try {
      for (const ch of entry.changes) {
        const rowIdx = store.findRowIndexById(idColumnName, ch.rowId);
        const colIdx = cols.findIndex((c) => c.data === ch.colKey);
        if (rowIdx >= 0 && colIdx >= 0) {
          handleCellSave(rowIdx, colIdx, useOldValue ? ch.oldValue : ch.newValue, false);
        }
      }
    } finally {
      store.setUndoSuppressed(false);
    }
  }, [store, cols, idColumnName, handleCellSave]);

  const undo = useCallback(() => {
    const entry = store.popUndo();
    if (!entry) return;
    applyUndoEntry(entry, true);
    store.pushRedo(entry);
    flash(t('dynamicTable.undo.undone', 'Undone'), 'info');
  }, [store, applyUndoEntry, t]);

  const redo = useCallback(() => {
    const entry = store.popRedo();
    if (!entry) return;
    applyUndoEntry(entry, false);
    store.pushUndo(entry);
    flash(t('dynamicTable.undo.redone', 'Redone'), 'info');
  }, [store, applyUndoEntry, t]);

  // Intercept the built-in selection actions; defer everything else to the
  // normal cell/row/column dispatch.
  const handleMenuActionClick = useCallback((actionId: string) => {
    // Copy → drop the selection (the user is done with it). Comment/colour keeps
    // it (the dialog needs the visible context); it's cleared on dialog close.
    if (actionId === SELECTION_COPY_ID) { copySelectionToClipboard(); setContextMenu(null); clearSelectionAnimated(); return; }
    if (actionId === SELECTION_ANNOTATE_ID) { openAnnotateForSelection(); setContextMenu(null); return; }
    handleContextMenuAction(actionId);
  }, [copySelectionToClipboard, openAnnotateForSelection, handleContextMenuAction, clearSelectionAnimated]);

  // Right-click on a cell ALWAYS opens the context menu — even on a single cell
  // (the drag-end menu in handleMouseUpWithMenu only fires for multi-cell ranges).
  // The clicked cell is selected first so the built-in Copy / Comment actions
  // operate on it; built-in actions are merged with any consumer `cellActions`.
  const handleCellContextMenu = useCallback((e: React.MouseEvent, rowIndex: number, colIndex: number) => {
    const rowData = store.getRowData(rowIndex);
    const col = cols[colIndex];
    if (!col) return;
    // Select the right-clicked cell only when it isn't already inside the current
    // selection — otherwise a right-click on a multi-cell range would collapse it
    // to the single cell and Copy/Comment would lose the range.
    const bounds = store.getSelectionBounds();
    const insideSelection = !!bounds
      && rowIndex >= bounds.startRow && rowIndex <= bounds.endRow
      && colIndex >= bounds.startCol && colIndex <= bounds.endCol;
    if (!insideSelection) {
      store.setSelection({ type: 'range', anchor: { row: rowIndex, col: colIndex }, focus: { row: rowIndex, col: colIndex } });
    }
    const actions: ContextMenuAction[] = [
      { id: SELECTION_COPY_ID, label: t('dynamicTable.cellMenu.copy', 'Copy') },
    ];
    if (enableComments && commentsEntityType) {
      actions.push({ id: SELECTION_ANNOTATE_ID, label: t('dynamicTable.cellMenu.annotate', 'Comment / colour') });
    }
    if (cellActions) actions.push(...cellActions(rowData, col, rowIndex, colIndex));
    e.preventDefault();
    setContextMenu({ isOpen: true, position: { x: e.clientX, y: e.clientY }, actions, type: 'cell', index: rowIndex, colIndex });
  }, [cellActions, store, cols, enableComments, commentsEntityType, t]);

  // Stable identity so CellCommentDialog's outside-click listener isn't churned
  // (re-added with a delay) on every parent render — otherwise the first click
  // outside clears the selection but the dialog needs a second click to close.
  // Closing it both drops the selection AND closes the dialog in one click.
  const handleCommentDialogClose = useCallback(() => {
    setCommentDialog(null);
    clearSelectionAnimated();
  }, [clearSelectionAnimated]);

  // Wrap keyboard handler for React event system
  // Shortcuts are checked first; if one matches, skip normal navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Undo / redo. Cmd/Ctrl+Z (undo), Cmd/Ctrl+Shift+Z or Ctrl+Y (redo). Never
    // hijacked while a cell editor / search box / textarea has focus — there the
    // input's own native undo must win.
    const key = e.key.toLowerCase();
    const metaOrCtrl = e.ctrlKey || e.metaKey;
    // B9 — Shift+F2 opens the comment dialog for the current selection. Excel's
    // own "Insert/Edit Comment" chord, adopted verbatim: the workshop finding
    // was that the feature existed but nobody (including its author) could find
    // the way in, so it gets the shortcut users already have in their fingers.
    if (e.key === 'F2' && e.shiftKey && enableComments && commentsEntityType) {
      if (!isTextEntryTarget(e.target as HTMLElement) && !store.getEditingCell()) {
        e.preventDefault();
        openAnnotateForSelection();
        return;
      }
    }
    if (metaOrCtrl && (key === 'z' || key === 'y')) {
      const isTextEntry = isTextEntryTarget(e.target as HTMLElement);
      if (!isTextEntry && !store.getEditingCell()) {
        e.preventDefault();
        if (key === 'y' || (key === 'z' && e.shiftKey)) redo();
        else undo();
        return;
      }
    }
    // Cmd/Ctrl + D with checkbox-selected rows → bulk delete, identical to the
    // grouped-actions bar's Delete button (so the consumer's confirm modal still
    // applies). preventDefault also suppresses the browser's bookmark-page
    // default. Plain Delete/Backspace is deliberately NOT used — in spreadsheets
    // those clear cell contents, not the row. Guarded so it never fires from a
    // text entry (search box, cell editor).
    const isDeleteCombo = e.key.toLowerCase() === 'd' && (e.ctrlKey || e.metaKey);
    if (isDeleteCombo && selectable && onBulkDelete && selectedRowIds.size > 0) {
      if (!isTextEntryTarget(e.target as HTMLElement) && !store.getEditingCell()) {
        e.preventDefault();
        void handleBulkDelete();
        return;
      }
    }
    // Plain Delete / Backspace on a selection CLEARS CONTENTS — the spreadsheet
    // meaning. The ROW is never touched: bulk row deletion stays on Cmd/Ctrl+D
    // and the grouped-actions bar, both of which route through the consumer's
    // confirm modal.
    if ((e.key === 'Delete' || e.key === 'Backspace') && !metaOrCtrl && !e.altKey) {
      if (!isTextEntryTarget(e.target as HTMLElement) && !store.getEditingCell()) {
        // preventDefault only when there IS something to clear, so Backspace
        // outside a selection still bubbles (it is "back" on some browsers).
        if (clearSelectionContents()) {
          e.preventDefault();
          return;
        }
      }
    }
    // Ctrl+H (control key only — Cmd+H hides the application on macOS) opens
    // FIND AND REPLACE, which is Excel's binding on both platforms. It is an
    // accelerator, never the only path: the same tool is one click away in the
    // toolbar, because a shortcut nobody can discover may as well not exist.
    //
    // Ctrl+F belongs to the BROWSER. Every list carries a Search box in the
    // toolbar that filters the whole dataset server-side; an in-grid finder
    // searching only the loaded page was a second, weaker search stacked under
    // the real one, so it was removed rather than kept behind a flag.
    // The rung below the bar and above "exit editing": Escape dismisses the
    // MARCHING ANTS first, exactly as Excel cancels its marquee before it does
    // anything else. Skipped while an editor is open — there the first Escape
    // still belongs to the edit session.
    if (e.key === 'Escape' && !store.getEditingCell() && store.getClipboardMarker()) {
      e.preventDefault();
      store.setClipboardMarker(null);
      return;
    }
    // Enter on a cell whose column mounts NO editor. `useKeyboardNavigation`
    // already refuses to open the edit session (without that guard the cell
    // blanks and every arrow key afterwards is swallowed — ledger 1.27); this
    // rung exists only to say WHY nothing happened, because a key that silently
    // does nothing is indistinguishable from a broken grid. Raised here rather
    // than in the hook because `flash` and the translations live at this level.
    if (e.key === 'Enter' && !e.shiftKey && !metaOrCtrl && !store.getEditingCell()) {
      const b = store.getSelectionBounds();
      if (b && b.startRow === b.endRow && b.startCol === b.endCol && !columnMountsEditor(cols[b.startCol])) {
        e.preventDefault();
        flash(
          t('dynamicTable.cell.readOnlyColumn', '"{column}" is read-only', {
            column: String(cols[b.startCol]?.title ?? cols[b.startCol]?.data ?? ''),
          }),
          'info',
        );
        return;
      }
    }
    if (shortcutHandler(e.nativeEvent)) return;
    keyboardHandler(e.nativeEvent);
  }, [keyboardHandler, shortcutHandler, selectable, onBulkDelete, selectedRowIds, store, handleBulkDelete, undo, redo, clearSelectionContents, enableComments, commentsEntityType, openAnnotateForSelection, cols, t]);

  // Auto-select cell on focus (when enabled and no existing selection).
  // Reads optional data-focus-direction / data-focus-trigger attributes set
  // by the cross-table arrow and Tab handlers.
  const handleFocus = useCallback(() => {
    const direction = tableRef.current?.getAttribute('data-focus-direction');
    const trigger = tableRef.current?.getAttribute('data-focus-trigger');
    if (direction) tableRef.current?.removeAttribute('data-focus-direction');
    if (trigger) tableRef.current?.removeAttribute('data-focus-trigger');

    if (store.getRowCount() === 0) {
      // Empty table: if Tab-triggered, forward to the next sibling in the
      // same direction so empty tables are transparently skipped.
      if (trigger === 'tab') {
        const nextSibling = direction === 'up'
          ? siblingTableRefs?.prev?.current
          : siblingTableRefs?.next?.current;
        if (nextSibling) {
          nextSibling.setAttribute('data-focus-direction', direction || 'down');
          nextSibling.setAttribute('data-focus-trigger', 'tab');
          nextSibling.focus();
        }
      }
      return;
    }

    if (!autoSelectOnFocus || store.getSelection().anchor) return;

    const rowCount = store.getRowCount();
    const targetRow = direction === 'up' ? rowCount - 1 : 0;
    store.setSelection({
      type: 'range',
      anchor: { row: targetRow, col: 0 },
      focus: { row: targetRow, col: 0 },
    });
  }, [autoSelectOnFocus, store, tableRef, siblingTableRefs]);

  // Returns true when the target element sits inside a modal dialog that
  // does NOT contain this table.  Modal dialogs (delete confirmations,
  // forms) are rendered as sibling portals — keeping selection while
  // they're open is correct because they return focus to the table on
  // close via onCloseAutoFocus.  Drawers/Sheets also carry
  // `role="dialog"` but they *contain* the table, so they must NOT be
  // exempted (sibling tables inside the same drawer need independent
  // selection clearing).
  const isInsideExternalDialog = useCallback((el: HTMLElement): boolean => {
    const dialog = el.closest('[role="dialog"]');
    if (!dialog) return false;
    return !dialog.contains(tableRef?.current);
  }, [tableRef]);

  // Clear selection when DOM focus leaves the table container.
  // This ensures that when a user clicks on another table (or any element
  // outside this table), the stale selection is removed so only the newly
  // focused table shows a highlight.  We skip clearing when focus moves to
  // portal-rendered popups (date pickers, dropdowns, entity search) that
  // logically belong to this table even though they live outside its DOM.
  const handleBlur = useCallback((e: React.FocusEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    // Focus left the window entirely (e.g. alt-tab) — keep selection.
    if (!relatedTarget) return;
    // Focus stayed inside our table container — nothing to clear.
    if (tableRef?.current?.contains(relatedTarget)) return;
    // Focus moved to a portal popup (Radix dropdown/popover, editor popup
    // like calendar or dropdown, context menu) that belongs to this table —
    // keep selection.
    if (relatedTarget.closest('[data-radix-popper-content-wrapper]') ||
        relatedTarget.closest('.hot-editor-popup') ||
        relatedTarget.closest('.hot-context-menu') ||
        relatedTarget.closest('.context-menu') ||
        // The find-and-replace bar renders OUTSIDE the grid container (it has
        // grid. Without this exemption, clicking into it would clear the very
        // selection the active match just established.
        relatedTarget.closest('.hot-comment-popover')) return;
    // Focus moved to a modal dialog (delete confirmation, form, etc.)
    // that does NOT contain this table — keep selection; the dialog will
    // return focus on close via onCloseAutoFocus.
    if (isInsideExternalDialog(relatedTarget)) return;

    store.clearEditing();
    clearSelectionAnimated();
  }, [store, tableRef, isInsideExternalDialog, clearSelectionAnimated]);

  // -------------------- FULLSCREEN HANDLERS --------------------
  // No width bookkeeping here any more. Entering fullscreen used to scale every
  // column by `windowWidth / currentTotal` and exiting used to restore the
  // saved map — which overwrote the user's own widths on the way in and could
  // resurrect stale ones on the way out. The fill effect above already does the
  // job properly: the scroller resizes, its `ResizeObserver` fires, and the
  // surplus is redistributed across the columns that are allowed to take it.
  const handleEnterFullscreen = () => {
    setIsFullscreen(true);
    onFullscreenChange?.(true);
  };

  const handleExitFullscreen = () => {
    setIsFullscreen(false);
    onFullscreenChange?.(false);
  };

  // -------------------- EFFECTS --------------------
  // Register table container ref with store for focus management
  useEffect(() => {
    store.setTableRef(tableRef);
  }, [store, tableRef]);

  // Sync data to store.
  // Skip when the store contains unsaved new rows to prevent wiping
  // in-progress edits (e.g., dropdown selections in insert mode).
  useEffect(() => {
    if (store.hasNewRows()) return;
    store.setData(data);
  }, [data, store]);

  // Sync columns to store when they change (e.g., perspective reorder/hide/show).
  // This ensures setCellValue uses the correct field mapping.
  useEffect(() => {
    store.setColumns(cols);
  }, [cols, store]);

  // Persist manual column-width changes per user (localStorage). Saved widths are
  // applied in a pre-paint layout effect (no layout shift on reload), and the
  // store preserves widths across setColumns() so perspective reorder/show-hide
  // keeps them.
  const { persistResize } = useColumnWidthPersistence({ tableId, store, cols, userResizedColsRef });
  persistColumnWidthRef.current = persistResize;

  // Subscribe to store-level changes (row add/remove, column resize)
  useEffect(() => {
    return store.subscribeToStore(() => {
      setRowCount(store.getRowCount());
      setStoreRevision(prev => prev + 1);
    });
  }, [store]);

  // Auto-fit badge columns to their widest badge. Unlike text (which ellipses),
  // status/type pills must never be clipped — so the column grows to fit the
  // longest badge instead.
  //
  // The measurement has to touch the DOM (a consumer's custom renderer can emit
  // any label, so there is no string in the model to measure), but everything
  // else is model-driven — see `utils/badgeAutoFit.ts` for the full rationale.
  // Two properties matter and are deliberate:
  //
  //  - What we read is INTRINSIC: `badge.scrollWidth` is the pill's own content
  //    width. It does not depend on the cell's current width, the scroll
  //    position, or which columns happen to be mounted. The old code compared it
  //    against `td.clientWidth`, which made the answer geometry-coupled — under
  //    column virtualization that is a scroll-coupled layout feedback loop
  //    (column widens on mount → offsets shift → another column mounts → …).
  //  - The result is cached by the stable `col.data` key and re-applied to
  //    whatever index that key currently occupies, INCLUDING columns that are
  //    not mounted. So `store.getColumnWidth(i)` answers for every `i`, and a
  //    fitted width follows its column through a perspective reorder.
  //
  // Grow-only and idempotent: once a column is wide enough it produces no write,
  // so no write can trigger another pass. Skips columns the user resized by
  // hand. This effect is NOT subscribed to scroll and must never become so.
  useEffect(() => {
    const root = tableRef.current;
    if (!root) return;
    const raf = requestAnimationFrame(() => {
      const cache = badgeFitRef.current;
      root.querySelectorAll<HTMLElement>('td.hot-cell .cell-badge').forEach((badge) => {
        const td = badge.closest('td[data-col]') as HTMLElement | null;
        if (!td) return;
        const colIndex = parseInt(td.getAttribute('data-col') || '', 10);
        // Cache by the stable data key, never the index — a reorder must not
        // move one column's fitted width onto another.
        const key = cols[colIndex]?.data;
        if (!key) return;
        const hasComment = td.getAttribute('data-has-comment') === 'true';
        recordBadgeFit(cache, key, badgeFitWidth(badge.scrollWidth, hasComment));
      });
      // In stretch mode this raises the column's flex-basis + min-width
      // (Cell.tsx), so the badge column no longer shrinks below the badge;
      // in fixed mode it simply widens the column.
      planBadgeWidths(
        cache,
        cols,
        // The DECLARED width, never the painted one: the fill surplus is not
        // the column's own width, and comparing against it would let a badge
        // stay clipped the moment the container narrows and the surplus goes.
        (col) => store.getBaseColumnWidth(col),
        (col) => userResizedColsRef.current.has(col),
      ).forEach(({ col, width }) => store.setColumnWidth(col, width));
    });
    return () => cancelAnimationFrame(raf);
  }, [data, cols, store, tableRef, annotations]);

  // Colour-block adjacency (the `data-cb-{above,below,left,right}` attributes)
  // used to be discovered here by running `querySelectorAll` over the rendered
  // cells on every scroll event. That effect is GONE — anchor Defect 7. It read
  // facts about the data out of the DOM, so it was wrong for any neighbour
  // outside the virtualization window (a painted gap and a rounded corner in
  // the middle of a colour run, moving as you scroll) and it put a full-grid
  // DOM query on the scroll path. Adjacency is now computed in the model by
  // `utils/colorAdjacency.ts` and passed to `Cell` as props. Do not reinstate a
  // DOM scan; throttling one would not make it correct.

  // Scroll highlighted row into view when highlightedRowId changes.
  // Only scrolls if the row is not already visible.
  useEffect(() => {
    if (!highlightedRowId || !tableRef?.current) return;

    // Find the row index by ID
    const rowIndex = data.findIndex(row => row[idColumnName] === highlightedRowId);
    if (rowIndex === -1) return;

    // Use the virtualizer to scroll to this row
    // scrollToIndex brings the row into view with 'auto' behavior (minimal scroll)
    rowVirtualizer.scrollToIndex(rowIndex, { align: 'center', behavior: 'smooth' });
  }, [highlightedRowId, data, idColumnName, rowVirtualizer]);

  // Keyboard navigation is now handled via onKeyDown prop on the table container
  // This ensures React synthetic events fire before the handler, allowing editors to save first

  // Copy handler
  useEffect(() => {
    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, [handleCopy]);

  // Cut handler — the native `cut` event, not a Ctrl+X keybinding, so the
  // clipboard write is a user-gesture write the browser actually permits and
  // the OS-level Edit > Cut menu item works too.
  useEffect(() => {
    document.addEventListener('cut', handleCut);
    return () => document.removeEventListener('cut', handleCut);
  }, [handleCut]);

  // Paste handler — same document-level attachment as copy, and the handler
  // itself checks the event target is inside THIS table, so several grids on
  // one page never fight over a paste.
  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  // Global mouse up for drag end
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      // Commit a fill that was released outside the table container. The
      // container's own onMouseUp commits first when released inside it, after
      // which fillStateRef is null and this is a no-op (no double-commit).
      if (fillStateRef.current) {
        commitFill();
      }
      if (dragStateRef.current.isDragging) {
        dragHandlers.handleDragEnd();
      }
    };

    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [dragHandlers, commitFill]);

  // Click outside handler to clear selection.
  // When multiple DynamicTables coexist inside a dialog/drawer, clicking on
  // another table must clear THIS table's selection.  Portal-rendered popups
  // (date pickers, dropdowns, context menus) are excluded so interacting with
  // them doesn't accidentally clear the selection.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Click is inside our own table container — keep selection.
      if (tableRef?.current?.contains(target)) {
        return;
      }

      // Click is inside a Radix portal popup, context menu, or there's an active
      // editor popup anywhere in the DOM. For editor popups, we check existence
      // (not containment) because clicking OUTSIDE the popup to close it should
      // let the editor's own click-outside handler save the value first.
      if (target.closest('[data-radix-popper-content-wrapper]') ||
          target.closest('.hot-context-menu') ||
          target.closest('.context-menu') ||
          target.closest('.hot-comment-popover') ||
          document.querySelector('.hot-editor-popup')) {
        return;
      }

      // Click landed inside a modal dialog that does NOT contain this
      // table (e.g., delete confirmation overlay) — keep selection.
      // Drawers/Sheets also have `role="dialog"` but they *contain* the
      // table, so clicks inside the same drawer still clear selection.
      if (isInsideExternalDialog(target)) {
        return;
      }

      // If there's an active editing cell, defer clearing so the editor's blur
      // handler has a chance to save the value first. mousedown fires before blur,
      // so without this delay the editor unmounts before onBlur can call onSave.
      const editingCell = store.getEditingCell();
      if (editingCell) {
        setTimeout(() => {
          store.clearEditing();
          clearSelectionAnimated();
        }, 0);
      } else {
        store.clearEditing();
        clearSelectionAnimated();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [store, tableRef, isInsideExternalDialog, clearSelectionAnimated]);

  // Dispatch FILTER_CHANGE when filters change (backward compatibility)
  useEffect(() => {
    if (!tableRef?.current) return;
    dispatch<FilterChangeEvent>(
      tableRef.current,
      TableEvents.FILTER_CHANGE,
      { filters, savedFilterId: activePerspectiveId },
    );
  }, [filters, activePerspectiveId, tableRef]);

  /**
   * Dispatch PERSPECTIVE_CHANGE event whenever table configuration changes.
   * 
   * PURPOSE:
   * Notifies parent components and event listeners when the table's perspective
   * settings change (filters, sorting, column visibility). This enables:
   * - Parent components to sync URL parameters with active filters
   * - External state management to track table configuration
   * - Analytics/logging of user interactions with the table
   * 
   * IMPORTANT:
   * Parent components handling this event should be careful not to create infinite
   * loops. Common patterns:
   * - Extract only sorting changes: `if (payload.config.sorting) { ... }`
   * - Use refs to track initialization state before updating controlled props
   * - Avoid re-setting `activePerspectiveId` in response to this event unless
   *   implementing specific logic like URL sync
   * 
   * This event fires for ALL config changes, not just user interactions. It will
   * fire when:
   * - User adds/removes filters via UI
   * - User clicks column headers to sort
   * - User shows/hides columns
   * - Parent component applies a perspective via `activePerspectiveId` prop
   *   (via the perspective sync effect above)
   * 
   * See the `useDynamicTablePage` hook's PERSPECTIVE_CHANGE handling for an example of safe usage.
   */
  useEffect(() => {
    if (!tableRef?.current) return;
    dispatch<PerspectiveChangeEvent>(
      tableRef.current,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: {
          columns: { visible: visibleColumns, hidden: hiddenColumns },
          filters,
          sorting: sortRules,
          grouping: groupRules,
          aggregations,
          lookupColumns,
          rollupColumns,
          formulas,
          conditionalFormats,
          dateFormat,
          viewMode,
        },
      },
    );
  }, [visibleColumns, hiddenColumns, filters, sortRules, groupRules, aggregations, lookupColumns, rollupColumns, formulas, conditionalFormats, dateFormat, viewMode, tableRef]);

  // -------------------- EVENT HANDLERS --------------------
  useEventHandlers({
    [TableEvents.CELL_SAVE_START]: (payload) => {
      store.setSaveState(payload.rowIndex, payload.colIndex, 'saving');
    },
    [TableEvents.CELL_SAVE_SUCCESS]: (payload) => {
      store.setSaveState(payload.rowIndex, payload.colIndex, 'success');
      setTimeout(() => store.setSaveState(payload.rowIndex, payload.colIndex, null), 2000);
    },
    [TableEvents.CELL_SAVE_ERROR]: (payload) => {
      store.setSaveState(payload.rowIndex, payload.colIndex, 'error');
      setTimeout(() => store.setSaveState(payload.rowIndex, payload.colIndex, null), 3000);
    },
    [TableEvents.NEW_ROW_SAVE_SUCCESS]: (payload) => {
      store.markRowAsSaved(payload.rowIndex, payload.savedRowData);
    },
    [TableEvents.NEW_ROW_SAVE_ERROR]: (payload) => {
      console.error('Failed to save new row:', payload.error);
      // Ledger 4.10 — "Save silently does nothing". The host flashes the reason,
      // but the GRID said nothing at all: the draft row sat there looking
      // identical to one that had never been submitted, so the only way to tell
      // a rejected create from a slow one was to reload. Paint the failure on
      // the row and put the caret back in the first cell, which is the field
      // every rejection so far has been about (an empty required name).
      if (store.isNewRow(payload.rowIndex)) {
        store.setSaveState(payload.rowIndex, 0, 'error');
        setTimeout(() => store.setSaveState(payload.rowIndex, 0, null), 3000);
        store.setEditingCell(payload.rowIndex, 0);
      }
    },
  }, tableRef);

  // -------------------- RENDER --------------------

  // Determine if we should fill available height
  const shouldFillHeight = height === '100%' || height === 'fill'
  const isViewportFill = height === 'fill'
  const outerContainerRef = useRef<HTMLDivElement>(null)
  const [fillHeight, setFillHeight] = useState<number | null>(null)

  // When height='fill', measure available viewport space and set explicit height.
  // This avoids relying on CSS flex chain from parent containers.
  useLayoutEffect(() => {
    if (!isViewportFill || isFullscreen) return
    const el = outerContainerRef.current
    if (!el) return
    // Find the nearest SCROLL-PANE ancestor (e.g. the app shell's scroll
    // container). Fill to ITS visible bottom, not the raw viewport — otherwise
    // the table runs under page chrome (app-shell footer) that lives below the
    // pane and the table's own footer ends up below the fold.
    let scrollPane: HTMLElement | null = el.parentElement
    while (scrollPane && scrollPane !== document.body) {
      const oy = getComputedStyle(scrollPane).overflowY
      if (oy === 'auto' || oy === 'scroll') break
      scrollPane = scrollPane.parentElement
    }
    const measure = () => {
      const rect = el.getBoundingClientRect()
      // Use the pane's CLIENT-area bottom (`top + clientHeight`), not
      // getBoundingClientRect().bottom: clientHeight is the stable laid-out
      // inner height and excludes transient content overflow, so the measure
      // doesn't overshoot while the flex layout is still settling.
      const paneBottom = scrollPane && scrollPane !== document.body
        ? Math.min(window.innerHeight, Math.round(scrollPane.getBoundingClientRect().top) + scrollPane.clientHeight)
        : window.innerHeight
      setFillHeight(Math.max(Math.floor(paneBottom - rect.top), 200))
    }
    measure()
    window.addEventListener('resize', measure)
    // Re-measure when the pane (or container) resizes — the app-shell panes
    // settle a few px after the first layout pass, which the one-shot measure
    // above would otherwise miss (leaving the footer a few px below the fold).
    const ro = new ResizeObserver(measure)
    if (scrollPane && scrollPane !== document.body) ro.observe(scrollPane)
    return () => {
      window.removeEventListener('resize', measure)
      ro.disconnect()
    }
  }, [isViewportFill, isFullscreen])

  // Table content shared between normal and fullscreen modes
  const tableContent = (
    <div
      ref={outerContainerRef}
      className={`hot-container ${shouldFillHeight ? 'flex flex-col flex-1' : ''}${borderless ? ' hot-borderless' : ''} hot-appearance-v2`}
      data-range-phase={rangePhase === 'idle' ? undefined : rangePhase}
      data-readonly-style={readOnlyStyle}
      data-density={density || undefined}
      {...densityAttribute}
      data-striped={striped ? 'true' : undefined}
      data-actions-scroll-shadow={actionsScrollShadow ? 'true' : undefined}
      data-firstcol-scroll-shadow={firstColScrollShadow ? 'true' : undefined}
      data-frozen-shadow={frozenColShadow ? 'true' : undefined}
      data-clickable-rows={onRowClick ? 'true' : undefined}
      data-row-hover-style={onRowClick ? rowHoverStyle : undefined}
      style={{
        height: isFullscreen ? '100%' : (isViewportFill && fillHeight ? fillHeight : (shouldFillHeight ? '100%' : height)),
        width: isFullscreen ? '100%' : width,
        position: 'relative',
        ...(shouldFillHeight && { minHeight: 0 }),
      }}
    >
      {/* Toolbar row 1 (Figma 220:2935): [title  search] … [add  actions  expand].
          Title + search sit on the left; the add-row "+", the consumer slot
          (searchBarEnd, e.g. the page's primary button) and the fullscreen
          toggle are right-aligned on the SAME line. */}
      {/* Lead row: a custom `topBarStart` (e.g. category tabs) gets its own line
          ABOVE the title on full list pages (those with perspective tabs), so
          the title + search + buttons row stays uncluttered. Embedded sub-tables
          (no perspective tabs) keep topBarStart inline in the toolbar below. */}
      {!hideToolbar && topBarStart && !hidePerspectiveTabs && (
        <div className="hot-toolbar-lead-row">{topBarStart}</div>
      )}

      {/* Card wrapper (v2): on full list pages the toolbar + perspective tabs +
          grid sit on a single white, rounded card floating on the page canvas;
          the lead row (category tabs) above stays OUTSIDE this card. Embedded
          sub-tables (no perspective tabs) use `display:contents` so the wrapper
          is inert and they keep rendering flush. */}
      <div className={hidePerspectiveTabs ? 'contents' : `hot-card${shouldFillHeight ? ' flex flex-col flex-1 min-h-0' : ''}`}>

      {!hideToolbar && (
        <div className="hot-toolbar">
          {/* Custom slot: top bar start (inline only for embedded tables) */}
          {hidePerspectiveTabs && topBarStart}

          {!hideTitle && (
            <h3 className="hot-toolbar-title">{displayTableName}</h3>
          )}

          {!hideSearch && (
            <SearchBar
              tableRef={tableRef}
              placeholder={searchPlaceholder ?? 'Search...'}
              debounceMs={searchDebounceMs}
              renderSuggestions={searchSuggestions}
            />
          )}

          {/* Spacer */}
          <div className="hot-toolbar-spacer" />

          <div className="hot-toolbar-actions">
            {/* A13 — WHICH filters are running, and the one-click way out of
                any single one of them. Rendered here, immediately before the
                clear-all, so the chips and their clear-all read as one group;
                it adds no toolbar row — the strip scrolls inside this one. */}
            <ActiveFilterChips
              filters={filters}
              columns={baseColumns}
              onRemove={(filterId) => handleFiltersChange(filters.filter((f) => f.id !== filterId))}
            />
            {/* The one place that answers "am I actually seeing everything?"
                for the whole grid, and the one-click way back to everything.
                These rules are TEMPORARY and are never written to the saved
                view (A2/D6). */}
            {filters.length > 0 && (
              <button
                type="button"
                className="hot-clear-filters-btn"
                onClick={() => handleFiltersChange([])}
                title={t(
                  'dynamicTable.quickFilter.clearAllHint',
                  'These filters are temporary and are not saved with the view',
                )}
                data-clear-all-filters=""
              >
                <FunnelX className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="text-body-regular-xs">
                  {t('dynamicTable.quickFilter.clearAll', 'Clear all filters ({count})', {
                    count: filters.length,
                  })}
                </span>
              </button>
            )}
            {/* A function gets the filter pair, so a header can narrow the
                table in BOTH view modes — see `SearchBarRenderContext`. */}
            {typeof searchBarStart === 'function'
              ? searchBarStart({ data, filters, setFilters: handleFiltersChange })
              : searchBarStart}
            {!hideAddRowButton && (
              <button
                onClick={handleAddRow}
                className="hot-add-row-btn"
                title="Add new row"
              >
                +
              </button>
            )}
            {searchBarEnd}
            {/* Export, row height and fullscreen are SECONDARY controls. Each
                one used to spend toolbar width on every table in the app,
                crowding the primary action a page actually cares about. They
                now sit behind one overflow button by default; a table that
                wants them one click away sets `expandToolbarActions`. */}
            {/* View switcher — list / grid. Sits with density, export and
                fullscreen because it is the same KIND of control: it changes
                how you are looking at the rows, not which rows you are looking
                at. Rendered ahead of the overflow menu so it is never buried:
                a mode you cannot see you are in is worse than no mode. */}
            {viewModes && viewModes.length > 1 && (
              <ViewModeSwitch
                options={viewModes}
                value={viewMode}
                onChange={handleViewModeChange}
              />
            )}
            {expandToolbarActions ? (
              <>
                {!hideExportButton && (
                  <ExportMenu variant="toolbar" onExport={handleExportAll} disabled={isExportingAll} />
                )}
                {!hideDensityControl && <DensityControl variant="toolbar" tableKey={tableId} />}
                {enableFullscreen && !isFullscreen && (
                  <button onClick={handleEnterFullscreen} className="fullscreen-toggle-btn" title="Enter fullscreen">
                    <Maximize2 className="w-4 h-4" />
                  </button>
                )}
              </>
            ) : (
              <ToolbarOverflow
                onExport={hideExportButton ? undefined : handleExportAll}
                exportDisabled={isExportingAll}
                showDensity={!hideDensityControl}
                densityTableKey={tableId}
                onFullscreen={enableFullscreen && !isFullscreen ? handleEnterFullscreen : undefined}
                extras={toolbarOverflowExtras}
              />
            )}
          </div>

          {/* Custom slot: top bar end */}
          {topBarEnd}
        </div>
      )}

      {/* Toolbar row 2 (Figma 220:2935): [perspective tabs] … [pagination].
          Pagination is right-aligned on the tabs line (no bottom footer). */}
      {(!hidePerspectiveTabs || (pagination && !hidePagination)) && (
        <div className="hot-tabs-row">
          {!hidePerspectiveTabs && (
            <PerspectiveTabs
              savedPerspectives={savedPerspectives}
              activePerspectiveId={activePerspectiveId}
              onPerspectiveSelect={handlePerspectiveSelect}
              onPerspectiveRename={handlePerspectiveRename}
              onPerspectiveDelete={handlePerspectiveDelete}
              onPerspectiveDuplicate={handlePerspectiveDuplicate}
              onPerspectiveSetDefault={handlePerspectiveSetDefault}
              defaultPerspectiveId={defaultPerspectiveId}
              sharedTemplates={sharedTemplates}
              publishableRoles={canPublishTemplates ? publishableRoles : undefined}
              onPerspectivePublish={canPublishTemplates ? handlePerspectivePublish : undefined}
              onPerspectiveTemplateCopy={handlePerspectiveTemplateCopy}
              onPerspectiveEdit={(id) => {
                // Load the perspective's config into the working state, then open
                // the panel pre-populated for editing. Saving with the same name
                // updates it in place (save upserts by name).
                handlePerspectiveSelect(id);
                setEditingPerspectiveId(id);
                setConfigureBaseView(false);
                setConfigPanelInitialSection(null);
                setConfigPanelOpen(true);
              }}
              onConfigureBaseView={() => {
                // Configure the BASE tab, not a new view: the drawer's Save
                // then personalizes "Default view" for this user instead of
                // demanding a name for something they already have.
                setEditingPerspectiveId(null);
                setConfigureBaseView(true);
                setConfigPanelInitialSection(null);
                setConfigPanelOpen(true);
              }}
              onBaseViewReset={handleBaseViewReset}
              onAddPerspective={() => { setEditingPerspectiveId(null); setConfigureBaseView(false); setConfigPanelInitialSection(null); setConfigPanelOpen(true); }}
            />
          )}
          <div className="hot-tabs-row-spacer" />
          {pagination && !hidePagination && (
            <TablePagination pagination={pagination} />
          )}
        </div>
      )}

      {/* HEDGE-165 — the failed load that still has rows to show.
          `LoadErrorState` below is gated on `rowCount === 0`, so until this bar
          existed `loadError === true && rowCount > 0` rendered NOTHING: the
          rows `placeholderData` is holding stayed on screen with no indication
          that they answer the previous request rather than the current one.
          Sits above the column headers so it is visible wherever the body is
          scrolled to. Mounted only in that state — nothing on the healthy path
          moves, and no table pays for a permanently-mounted live region. */}
      {loadError && rowCount > 0 && (
        <StaleDataBar tableName={tableName} onRetry={onRetryLoad} />
      )}

      {/* Grouped-actions bar — shown whenever ≥1 row is selected (Figma 546:12289).
          Sits between the perspective tabs and the column headers. Kept mounted
          (not conditionally rendered) so it can animate open/closed via the
          grid-rows collapse on the wrapper — avoids the hard layout shift.
          `bulkBarCountRef` freezes the last visible count so the text doesn't
          flash "0 selected" mid-collapse. */}
      {selectable && (() => {
        const bulkBarOpen = selectedRowIds.size >= 1;
        if (bulkBarOpen) bulkBarCountRef.current = selectedRowIds.size;
        return (
          <div
            className={`hot-bulk-bar-wrap${bulkBarOpen ? ' is-open' : ''}`}
            aria-hidden={!bulkBarOpen}
          >
            <div className="hot-bulk-bar-inner">
              <BulkActionsBar
                count={bulkBarOpen ? selectedRowIds.size : bulkBarCountRef.current}
                busy={isBulkDeleting}
                onCopy={handleBulkCopy}
                onDelete={onBulkDelete ? handleBulkDelete : undefined}
                onExport={hideExportButton ? undefined : handleExportSelection}
                onClear={clearSelection}
                actions={bulkActions}
                selectedIds={Array.from(selectedRowIds)}
              />
            </div>
          </div>
        );
      })()}

      {/* A full-width band between the toolbar and the body — the folder row
          in the documents module. Rendered for BOTH view modes. */}
      {beforeBody ? (
        <div className="hot-before-body">
          {typeof beforeBody === 'function'
            ? beforeBody({ data, filters, setFilters: handleFiltersChange })
            : beforeBody}
        </div>
      ) : null}

      {/* Table Container */}
      <div
        ref={tableRef}
        /* The spreadsheet container is focusable so it can receive Escape and
           the arrow keys. A tile grid's tiles are the focusable things. */
        tabIndex={usingCustomBody ? undefined : 0}
        data-fill-enabled={!usingCustomBody && enableFillHandle ? 'true' : undefined}
        /* P5 — the density guardrail. The perf harness reads these when
           present and falls back to counting mounted <th>s when they are
           absent, so WITHOUT them a successful column virtualization reports
           as a "57 → 21 column loss", i.e. exactly the regression the product
           owner forbade. They must never be derived from the mounted window. */
        data-dt-columns={cols.length}
        data-dt-rows={data.length}
        data-column-window={`${columnVirtualizer.startIndex}:${columnVirtualizer.endIndex}`}
        data-column-virtualized={columnVirtualizer.virtualized ? 'true' : undefined}
        /* aria-colcount counts ALL columns, never the mounted subset — a grid
           whose rendered cells are a subset is required to declare it, which is
           what makes the per-cell aria-colindex meaningful. */
        /* An alternative body is not a grid of cells. Announcing one — with a
           column count and a row count that address nothing on screen — is
           worse than announcing nothing. */
        role={usingCustomBody ? 'presentation' : 'grid'}
        aria-colcount={usingCustomBody ? undefined : columnVirtualizer.ariaColCount}
        aria-rowcount={usingCustomBody ? undefined : virtualizerCount}
        className={`hot-virtual-container ${shouldFillHeight ? 'flex-1' : ''}${usingCustomBody ? ' hot-custom-body' : ''}`}
        onFocus={usingCustomBody ? undefined : handleFocus}
        onBlur={usingCustomBody ? undefined : handleBlur}
        onClick={usingCustomBody ? undefined : (e) => {
          handleTableClick(e);
        }}
        onMouseDown={usingCustomBody ? undefined : (e) => {
          // Skip normal mouse handlers on group header rows
          if ((e.target as HTMLElement).closest('tr[data-group-header]')) return;
          // Comment handler runs first — if it opens the dialog, skip normal mousedown
          if (handleCommentMouseDown(e)) return;
          // Fill handle: a drag starting on the corner nub fills instead of
          // selecting. Leaves the source selection intact; skips normal mousedown.
          if (handleFillMouseDown(e)) return;
          // A new drag starts here: drop any committed outline + selection menu so
          // the dotted border only re-appears once THIS drag finishes.
          if (rangePhaseRef.current !== 'idle') applyRangePhase('idle');
          setContextMenu(null);
          handleMouseDown(e);
          // Focus the table container so it can receive keyboard events (e.g., Escape)
          // But not when clicking inside the currently editing cell — that would steal
          // focus from the editor input, killing the edit session.
          const editingCell = store.getEditingCell();
          if (editingCell) {
            const cell = (e.target as HTMLElement).closest('td');
            const clickRow = parseInt(cell?.getAttribute('data-row') || '', 10);
            const clickCol = parseInt(cell?.getAttribute('data-col') || '', 10);
            if (clickRow === editingCell.row && clickCol === editingCell.col) {
              return;
            }
          }
          // preventScroll: focusing this tabIndex=0 scroll container would
          // otherwise make the browser scroll it fully into view. When the
          // table sits partly below the fold (e.g. a banner above it pushing
          // it down), that scroll fires on the first mousedown and shifts the
          // page out from under the cursor — so the click misses its target
          // and the user has to click a second time. See cross-table focus
          // forwarding which already relies on explicit scroll control.
          tableRef.current?.focus({ preventScroll: true });
        }}
        onMouseMove={usingCustomBody ? undefined : (e) => {
          if (fillStateRef.current) { handleFillMouseMove(e); return; }
          handleMouseMove(e);
        }}
        onMouseUp={usingCustomBody ? undefined : () => {
          if (fillStateRef.current) { commitFill(); return; }
          handleMouseUpWithMenu();
        }}
        onMouseOver={usingCustomBody ? undefined : (e) => { handleCellHoverOver(e); handleCommentHoverOver(e); }}
        onMouseOut={usingCustomBody ? undefined : handleCommentHoverOut}
        onMouseLeave={usingCustomBody ? undefined : () => store.setHoveredCell(null)}
        onDoubleClick={usingCustomBody ? undefined : handleDoubleClick}
        onKeyDown={usingCustomBody ? undefined : handleKeyDown}
        style={{
          height: isFullscreen ? 'calc(100% - 90px)' : (shouldFillHeight ? undefined : (typeof height === 'string' && height !== 'auto' ? height : '600px')),
          overflow: 'auto',
          position: 'relative',
          outline: 'none',
          ...(shouldFillHeight && { minHeight: 0 }),
        }}
      >
        {usingCustomBody ? (
          renderBody!({
            data,
            columns: cols,
            visualRows: groupingResult.visualRows,
            groupRules,
            collapsedGroups: groupingResult.collapsedGroups,
            toggleGroup: groupingResult.toggleGroup,
            selectedRowIds,
            rowKeyColumn: selectionColumnName,
            selectable,
            toggleRowSelect: handleToggleRowSelect,
            toggleGroupSelect: handleToggleGroupSelect,
            clearSelection,
            searchQuery,
            filters,
            setFilters: handleFiltersChange,
            filterCount: filters.length,
            clearSearch: handleClearSearch,
            clearFilters: handleFiltersChange ? () => handleFiltersChange([]) : undefined,
          })
        ) : (
          <>
            {/* Column Headers */}
            {colHeaders && (
              <ColumnHeaders
                columns={cols}
                rowHeaders={rowHeaders}
                leftOffsets={effectiveLeftOffsets}
                rightOffsets={rightOffsets}
                totalWidth={totalWidth}
                sortState={sortState}
                actionsColumnWidth={actionsColumnWidth}
                showActionsColumn={showActionsColumn}
                onSort={handleColumnSort}
                onResizeStart={(e, colIndex) => { userResizedColsRef.current.add(colIndex); handleResizeStart(e, colIndex); }}
                onDoubleClick={handleColumnHeaderDoubleClick}
                onMouseDown={(e) => handleColumnHeaderMouseDown(e, dragHandlers.handleDragStart)}
                onMouseMove={handleMouseMove}
                modernLayout={!disableBuiltinColumnMenu}
                onSortAsc={handleModernSortAsc}
                onSortDesc={handleModernSortDesc}
                onFilterByField={handleModernFilterByField}
                /* A1 — the header quick filter writes straight into the same
                   ephemeral `filters` state the Configure View drawer edits.
                   Nothing extra persists it, which is the A2/D6 guarantee. */
                filters={filters}
                onFiltersChange={handleFiltersChange}
                loadFilterSuggestions={loadFilterSuggestions}
                onFreezeToggle={handleModernFreezeToggle}
                onHideField={handleModernHideField}
                /* A16 — reorder from the header itself, not only from the
                   Configure View drawer. Per-user, like every other view
                   preference. */
                onColumnReorder={handleColumnReorder}
                onColumnMove={handleColumnMove}
                frozenColumns={frozenColumns}
                lastFrozenColumnKey={lastFrozenColumnKey}
                columnActions={columnActions}
                onColumnAction={handleModernColumnAction}
                selectable={selectable}
                allSelected={allSelected}
                someSelected={someSelected}
                onToggleSelectAll={handleToggleSelectAll}
                columnWindow={columnVirtualizer}
              />
            )}

            {/* Virtual Body */}
            <table className="hot-table" style={{ width: `${totalWidth}px` }}>
              <tbody
                style={{
                  display: 'block',
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  position: 'relative',
                }}
              >
                {virtualRows.map((virtualItem) => {
                  // When grouped, dispatch between GroupHeaderRow and VirtualRow
                  if (isGrouped) {
                    const vr = groupingResult.visualRows![virtualItem.index];
                    if (vr.type === 'groupHeader') {
                      const groupRowIds = vr.memberDataIndices
                        .map((idx) => {
                          const r = data[idx];
                          return r == null ? undefined : r[selectionColumnName];
                        })
                        .filter((id) => id != null)
                        .map((id) => String(id));
                      const groupSelected = groupRowIds.length > 0 && groupRowIds.every((id) => selectedRowIds.has(id));
                      const groupSomeSelected = !groupSelected && groupRowIds.some((id) => selectedRowIds.has(id));
                      return (
                        <GroupHeaderRow
                          key={`gh-${vr.groupKey}`}
                          visualRow={vr}
                          virtualItem={virtualItem}
                          totalWidth={totalWidth}
                          columns={cols}
                          onToggle={groupingResult.toggleGroup}
                          selectable={selectable}
                          selected={groupSelected}
                          someSelected={groupSomeSelected}
                          onToggleSelect={() => handleToggleGroupSelect(groupRowIds)}
                          formatGroupValue={formatGroupValue}
                        />
                      );
                    }
                    if (vr.type === 'groupSummary') {
                      return (
                        <GroupSummaryRow
                          key={`gs-${vr.groupKey}`}
                          visualRow={vr}
                          virtualItem={virtualItem}
                          columns={cols}
                          rowHeaders={rowHeaders}
                          leftOffsets={effectiveLeftOffsets}
                          rightOffsets={rightOffsets}
                          actionsColumnWidth={actionsColumnWidth}
                          showActionsColumn={showActionsColumn}
                          totalWidth={totalWidth}
                          aggregations={aggregations}
                          label={t('dynamicTable.aggregation.summaryRowLabel', 'Sum')}
                          locale={locale}
                          storeRevision={storeRevision}
                          columnWindow={columnVirtualizer}
                        />
                      );
                    }
                    // dataRow — use dataIndex for the store
                    return (
                      <VirtualRow
                        key={`dr-${vr.dataIndex}`}
                        rowIndex={vr.dataIndex}
                        columns={cols}
                        virtualRow={virtualItem}
                        rowHeaders={rowHeaders}
                        leftOffsets={effectiveLeftOffsets}
                        lastFrozenColumnKey={lastFrozenColumnKey}
                        rightOffsets={rightOffsets}
                        actionsColumnWidth={actionsColumnWidth}
                        showActionsColumn={showActionsColumn}
                        totalWidth={totalWidth}
                        storeRevision={storeRevision}
                        onSaveNewRow={handleSaveNewRow}
                        onCancelNewRow={handleCancelNewRow}
                        onRowHeaderDoubleClick={handleRowHeaderDoubleClick}
                        onCellSave={handleCellSave}
                        onCellContextMenu={handleCellContextMenu}
                        actionsRenderer={actionsRenderer}
                        showRowActionsMenu={showRowActionsMenu}
                        rowActions={rowActions}
                        onRowActionsMenu={handleRowActionsMenu}
                        highlightedRowId={highlightedRowId}
                        idColumnName={idColumnName}
                        rowKeyColumn={selectionColumnName}
                        annotations={enableComments ? annotations : undefined}
                        commentsEnabled={enableComments && !!commentsEntityType}
                        annotationKeyAt={enableComments ? cellAnnotationKeyAt : undefined}
                        selectable={selectable}
                        selectedRowIds={selectedRowIds}
                        onToggleRowSelect={handleToggleRowSelect}
                        compiledFormats={compiledFormats}
                        columnWindow={columnVirtualizer}
                      />
                    );
                  }

                  // Not grouped — standard rendering
                  return (
                    <VirtualRow
                      key={virtualItem.index}
                      rowIndex={virtualItem.index}
                      columns={cols}
                      virtualRow={virtualItem}
                      rowHeaders={rowHeaders}
                      leftOffsets={effectiveLeftOffsets}
                      lastFrozenColumnKey={lastFrozenColumnKey}
                      rightOffsets={rightOffsets}
                      actionsColumnWidth={actionsColumnWidth}
                      showActionsColumn={showActionsColumn}
                      totalWidth={totalWidth}
                      storeRevision={storeRevision}
                      onSaveNewRow={handleSaveNewRow}
                      onCancelNewRow={handleCancelNewRow}
                      onRowHeaderDoubleClick={handleRowHeaderDoubleClick}
                      onCellSave={handleCellSave}
                      onCellContextMenu={handleCellContextMenu}
                      actionsRenderer={actionsRenderer}
                      showRowActionsMenu={showRowActionsMenu}
                      rowActions={rowActions}
                      onRowActionsMenu={handleRowActionsMenu}
                      highlightedRowId={highlightedRowId}
                      idColumnName={idColumnName}
                      rowKeyColumn={selectionColumnName}
                      annotations={enableComments ? annotations : undefined}
                      commentsEnabled={enableComments && !!commentsEntityType}
                      annotationKeyAt={enableComments ? cellAnnotationKeyAt : undefined}
                      selectable={selectable}
                      selectedRowIds={selectedRowIds}
                      onToggleRowSelect={handleToggleRowSelect}
                      compiledFormats={compiledFormats}
                      columnWindow={columnVirtualizer}
                    />
                  );
                })}
              </tbody>
            </table>

            {/* Ledger 2.20 — the zero-result state.
                A search that matches nothing used to leave the header row and
                several hundred pixels of nothing: no message, no icon, and no
                way back other than finding the search box again and emptying it
                by hand. The headers STAY (they are the context that tells you
                which table you emptied); the panel sits under them, says which
                of the three reasons applies, and offers the undo for that
                reason. */}
            {/* HEDGE-119 — a FAILED load is not an empty table.
                `loadError` wins over `EmptyState` because both arrive here as
                `rowCount === 0`: a rejected query leaves `data` undefined and
                the grid holds zero rows either way. Deciding by row count
                alone is what made a 500 read as "Nothing here yet". */}
            {rowCount === 0 && (loadError
              ? <LoadErrorState tableName={tableName} onRetry={onRetryLoad} />
              : <EmptyState
                  emptyMessage={emptyMessage}
                  searchQuery={searchQuery}
                  filterCount={filters.length}
                  onClearSearch={handleClearSearch}
                  onClearFilters={handleFiltersChange ? () => handleFiltersChange([]) : undefined}
                />)}

            {/* Pinned totals. Rendered OUTSIDE the virtualiser deliberately: a
                row inside the rows container scrolls away with them, and a
                footer that scrolls away is not a footer. It is sticky to the
                bottom of this scroller exactly as the header is to the top. */}
            {aggregations.length > 0 && (
              <FooterTotalsRow
                columns={cols}
                aggregations={aggregations}
                result={aggregateResult}
                pageValues={pageAggregateValues}
                pageBreakdowns={pageAggregateBreakdowns}
                pageRowCount={data.length}
                loading={aggregateLoading}
                error={aggregateError}
                getColumnWidth={getColumnWidth}
                rowHeaders={rowHeaders}
                leftOffsets={effectiveLeftOffsets}
                rightOffsets={rightOffsets}
                actionsColumnWidth={actionsColumnWidth}
                showActionsColumn={showActionsColumn}
                totalWidth={totalWidth}
                locale={locale}
                columnWindow={columnVirtualizer}
              />
            )}
          </>
        )}
      </div>

      </div>{/* /hot-card */}

      {/* Configure View Side Panel */}
      {(
        <ConfigureViewPanel
          isOpen={configPanelOpen}
          onOpenChange={setConfigPanelOpen}
          columns={baseColumns}
          visibleColumns={visibleColumns}
          hiddenColumns={hiddenColumns}
          filters={filters}
          sortRules={sortRules}
          groupRules={groupRules}
          aggregations={aggregations}
          lookupColumns={lookupColumns}
          rollupColumns={rollupColumns}
          formulas={formulas}
          conditionalFormats={conditionalFormats}
          sampleRow={data[0]}
          dateFormat={dateFormat}
          viewMode={viewMode}
          dateFormatOptions={dateFormatOptions}
          onColumnVisibilityChange={handleColumnVisibilityChange}
          onFiltersChange={handleFiltersChange}
          onSortRulesChange={handleSortRulesChange}
          onGroupRulesChange={handleGroupRulesChange}
          onAggregationsChange={handleAggregationsChange}
          onLookupColumnsChange={handleLookupColumnsChange}
          onRollupColumnsChange={handleRollupColumnsChange}
          onFormulasChange={handleFormulasChange}
          onConditionalFormatsChange={handleConditionalFormatsChange}
          onDateFormatChange={handleDateFormatChange}
          onSavePerspective={handleSavePerspective}
          activePerspectiveId={activePerspectiveId}
          editingPerspective={savedPerspectives.find((p) => p.id === editingPerspectiveId) ?? null}
          baseViewPerspective={baseViewPerspective}
          isBaseViewMode={configureBaseView}
          loadFilterSuggestions={loadFilterSuggestions}
          loadLookupSources={loadLookupSources}
          loadRollupSources={loadRollupSources}
          initialExpandedSection={configPanelInitialSection}
        />
      )}

      {/* Large-write confirmation — every written cell triggers a persist
          request, so the same dialog guards a big fill, paste, cut and clear.
          The title names the gesture: "Fill cells?" on a Delete would read as
          the wrong operation about to run. */}
      <Dialog open={!!pendingWrite} onOpenChange={(open) => { if (!open) cancelPendingWrite(); }}>
        <DialogContent className="hot-dialog">
          <DialogHeader>
            <DialogTitle>
              {pendingWrite?.origin === 'paste'
                ? t('dynamicTable.paste.confirmTitle', 'Paste into these cells?')
                : pendingWrite?.origin === 'cut'
                  ? t('dynamicTable.cut.confirmTitle', 'Cut these cells?')
                  : pendingWrite?.origin === 'clear'
                    ? t('dynamicTable.clear.confirmTitle', 'Clear these cells?')
                    : t('dynamicTable.fill.confirmTitle', 'Fill cells?')}
            </DialogTitle>
            <DialogDescription>
              {t('dynamicTable.write.confirmBody', 'This will overwrite {count} cells.', {
                count: pendingWrite?.writes.length ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancelPendingWrite}>{t('dynamicTable.fill.cancel', 'Cancel')}</Button>
            <Button onClick={confirmPendingWrite}>
              {pendingWrite?.origin === 'paste'
                ? t('dynamicTable.paste.confirm', 'Paste')
                : pendingWrite?.origin === 'cut'
                  ? t('dynamicTable.cut.confirm', 'Cut')
                  : pendingWrite?.origin === 'clear'
                    ? t('dynamicTable.clear.confirm', 'Clear')
                    : t('dynamicTable.fill.confirm', 'Fill')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cell Comment Dialog */}
      {enableComments && commentsEntityType && commentDialog && (
        <CellCommentDialog
          isOpen={true}
          onClose={handleCommentDialogClose}
          /* Resolved when the dialog was opened, from the cell that opened it. */
          entityType={commentDialog.entityType}
          viewContext={commentsViewContext}
          rowId={commentDialog.rowId}
          columnKey={commentDialog.columnKey}
          columnTitle={commentDialog.columnTitle}
          rowLabel={commentDialog.rowLabel}
          annotationId={commentDialog.annotationId}
          currentColor={commentDialog.currentColor}
          onAnnotationChange={() => { refreshAnnotations(); onAnnotationChange?.(); }}
          anchorRect={commentDialog.anchorRect}
          bulkCells={commentDialog.bulkCells}
        />
      )}

      {/* Cell Comment hover preview (read-only) — suppressed while the editable
          dialog is open. */}
      {enableComments && commentsEntityType && commentHover && !commentDialog && (
        <CellCommentHoverPopup
          comments={commentHover.comments}
          columnTitle={commentHover.columnTitle}
          anchorRect={commentHover.anchorRect}
        />
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          isOpen={contextMenu.isOpen}
          position={contextMenu.position}
          actions={contextMenu.actions}
          onClose={handleContextMenuClose}
          onActionClick={handleMenuActionClick}
        />
      )}

      {/* Debugger */}
      {debug && <Debugger tableRef={tableRef} />}
    </div>
  );

  return (
      <TableDateFormatContext.Provider value={dateFormat}>
      <CellStoreContext.Provider value={store}>
        {isFullscreen ? (
          <FullscreenOverlay
            isOpen={isFullscreen}
            onClose={handleExitFullscreen}
            tableName={displayTableName}
          >
            {tableContent}
          </FullscreenOverlay>
        ) : (
          tableContent
        )}
      </CellStoreContext.Provider>
      </TableDateFormatContext.Provider>
  );
};

export default DynamicTable;
