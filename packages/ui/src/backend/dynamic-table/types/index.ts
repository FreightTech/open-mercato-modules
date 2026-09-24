// types/index.ts

import type { PerspectiveConfig } from './perspective';
// The batch-save event strings are DEFINED in `handlers/cellWrites` (the module
// that emits them) and imported here so there is exactly one spelling of each.
// Do not retype them below.
import {
  CELL_BATCH_SAVE_EVENT,
  CELL_BATCH_SAVE_RESULT_EVENT,
} from '../handlers/cellWrites';
import type {
  CellWrite,
  CellWriteOrigin,
  CellWriteReport,
  CellWriteResult,
  CellWriteRejectReason,
  CellWriteRejectionCounts,
  CellValueCoercer,
  CoerceReason,
  CoerceResult,
} from '../handlers/cellWrites';
import type {
  FillDetector,
  FillMode,
  FillPattern,
  FillSeed,
} from '../utils/fillPatterns';
import type { DensityLevel } from './density';

// Multi-cell write vocabulary. RE-EXPORTED, never redeclared — a second
// declaration of `FillMode` is exactly the drift this barrel exists to prevent.
export type {
  CellWrite,
  CellWriteOrigin,
  CellWriteReport,
  CellWriteResult,
  CellWriteRejectReason,
  CellWriteRejectionCounts,
  CellValueCoercer,
  CoerceReason,
  CoerceResult,
  FillDetector,
  FillMode,
  FillPattern,
  FillSeed,
};

export type CellId = `${number}:${number}`;

export interface SelectionState {
  type: 'cell' | 'range' | 'row' | 'column' | 'rowRange' | 'colRange' | null;
  anchor: { row: number; col: number } | null;
  focus: { row: number; col: number } | null;
}

export interface SelectionBounds {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

export interface RangeEdges {
  top?: boolean;
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
}

/** Which way a fill drag runs. Excel locks to ONE axis; so does this. */
export type FillAxis = 'vertical' | 'horizontal';

/**
 * Active drag-to-fill ("fill handle") preview — a RECTANGLE, exactly as Excel
 * draws it. Built on `SelectionBounds` so there is one rectangle type in the
 * grid, not two.
 *
 * `source` is the block the drag started from (the selection at mousedown);
 * `bounds` is the union of source + extension, i.e. the outline the user sees.
 * When the handle is dragged BACK INTO the source, `bounds === source`,
 * `clearing` is true and `cleared` names the sub-rect that will be EMPTIED.
 */
export interface FillPreview {
  /** The block the drag started from (the selection at mousedown). */
  source: SelectionBounds;
  /** Union of source + extension — the outline Excel draws. */
  bounds: SelectionBounds;
  axis: FillAxis;
  /** True when the extension runs up/left, so the series extrapolates backwards. */
  backwards: boolean;
  /** True when the handle was dragged back into the source: `bounds === source`. */
  clearing: boolean;
  /** Only set while `clearing`. Always a sub-rect of `source`. */
  cleared: SelectionBounds | null;
  mode: FillMode;
}

/**
 * Excel's MARCHING ANTS: the animated dashed outline that marks what is on the
 * clipboard, from `Ctrl+C`/`Ctrl+X` until it is dismissed.
 *
 * It is a SEPARATE rectangle from the selection on purpose — the whole point is
 * that it survives you moving the cursor somewhere else, which is exactly when
 * a user needs to be told what a `Ctrl+V` is about to paste.
 *
 * Addressed by INDEX into the full view-order column array and the loaded row
 * list, like every other rectangle in this grid, so a marked column that is
 * outside the virtualization window is still marked.
 */
export interface ClipboardMarker {
  /** Which gesture produced it. Both draw the same outline (Excel does too). */
  mode: 'copy' | 'cut';
  bounds: SelectionBounds;
}

export interface CellState {
  value: any;
  isSelected: boolean;
  isInRange: boolean;
  rangeEdges: RangeEdges;
  isEditing: boolean;
  saveState: SaveStateType;
  isNewRow: boolean;
  /** True while a fill-handle drag is previewing this cell (source OR extension). */
  isFillPreview: boolean;
  /** In the extension only — this cell will be WRITTEN on release. */
  isFillTarget: boolean;
  /** In `cleared` — this cell will be EMPTIED on release (back-drag). */
  isFillClearing: boolean;
  /**
   * Carries the drag nub: the bottom-right corner of a selection with at least
   * one fillable column. Computed in the STORE (it needs the whole selection
   * and the column defs) so `Cell` holds no column knowledge.
   */
  isFillOrigin: boolean;
  /** Outer edges of the fill-preview rectangle, for the dashed border. */
  fillEdges: RangeEdges;
  /** Inside the clipboard marker — carries the marching-ants outline. */
  isClipboardSource: boolean;
  /** Outer edges of the clipboard rectangle. Only these are painted. */
  clipboardEdges: RangeEdges;
  /** `null` when this cell is not in the marker. */
  clipboardMode: 'copy' | 'cut' | null;
  /**
   * The one cell the pointer is currently over. Lives in the STORE, not in
   * React state: a `useState` on DynamicTable would re-render every mounted row
   * on every pointer move, whereas `setHoveredCell` repaints exactly the cell
   * left and the cell entered — the same two-cell cost `setEditingCell` pays.
   * Used by the hover comment affordance (ledger 8.1).
   */
  isHovered: boolean;
}

export type SaveStateType = 'saving' | 'success' | 'error' | null;

/** One cell mutation captured for undo/redo, keyed by stable row id + column. */
export interface UndoCellChange {
  rowId: any;
  colKey: string;
  oldValue: any;
  newValue: any;
}

/** A single undoable action — one inline edit (1 change) or one fill (N changes). */
export interface UndoEntry {
  changes: UndoCellChange[];
}

// ============================================
// IN-GRID FIND & REPLACE
// ============================================
// Not persisted, and deliberately NOT part of `PerspectiveConfig` — a saved view
// must not carry a stale search.

export interface FindOptions {
  query: string;
  matchCase: boolean;
  /** Match the whole cell rather than a substring (Excel's "Match entire cell"). */
  wholeCell: boolean;
}



export type ReplaceRejectReason = 'readOnly' | 'unsupportedColumn' | 'uncoercible' | 'rowGone';

export interface ReplaceResult {
  replaced: number;
  rejected: Array<{ row: number; col: number; reason: ReplaceRejectReason }>;
}

export type CellSubscriber = () => void;

/**
 * Status-palette variant for `type: 'badge'` cells. Maps 1:1 onto the
 * `--status-v2-*` token triplets (bg / border / text). v2 design system.
 */
export type DynamicTableBadgeVariant =
  | 'neutral' | 'primary' | 'outline' | 'success' | 'error' | 'warning'
  | 'info' | 'purple' | 'teal' | 'orange' | 'sky' | 'rose';

export interface ColumnDef {
  data: string;
  title?: string;
  /** Tooltip text shown on hover over the column header */
  headerTooltip?: string;
  width?: number;
  type?: 'text' | 'numeric' | 'date' | 'dropdown' | 'boolean' | 'multiselect';
  /** Horizontal alignment of cell content. v2 design (right-align numbers, centre checkboxes). */
  align?: 'left' | 'center' | 'right';
  /** Render the cell text in the monospace (Geist Mono) face — refs, codes, dates, amounts. v2 design. */
  mono?: boolean;
  /**
   * Render the cell value as a status pill (v2 design). Presentation-only —
   * the column's `type` still governs sort/filter/edit behaviour, so a status
   * column stays `type: 'dropdown'`/`'text'` and just *displays* as a badge.
   */
  badge?: boolean;
  /**
   * With `badge`: resolve a cell value to a status-palette variant.
   * A function wins over `badgeMap`; both fall back to `'neutral'`.
   */
  badgeVariant?: DynamicTableBadgeVariant | ((value: any, rowData: any) => DynamicTableBadgeVariant);
  /** With `badge`: static value → variant lookup (e.g. `{ Active: 'success' }`). */
  badgeMap?: Record<string, DynamicTableBadgeVariant>;
  readOnly?: boolean;
  /**
   * The module refuses an empty value for this field (its create/update
   * validator would 400). Multi-cell writes reject an emptying write on a
   * required column up front with reason `'required'`, rather than firing N
   * doomed PATCHes and leaving the grid showing values the server never took.
   */
  required?: boolean;
  /**
   * Fill-series behaviour for the drag handle. `'auto'` (default) runs the
   * pattern chain — numeric step, date step, weekday step, `REF-001` suffix —
   * and falls back to copying. `'copy'` forces plain tiling for a column whose
   * values only *look* like a series (a postcode, a phone number).
   */
  fillSeries?: 'auto' | 'copy';
  /**
   * Exclude this column from the drag-to-fill handle while still allowing normal
   * inline edits. Use for unique / identity fields (e.g. an invoice number)
   * where copying one value down would create duplicates. Default: false.
   */
  disableFill?: boolean;
  sticky?: 'left' | 'right';
  source?: any[];
  renderer?: (value: any, rowData: any, col: any, rowIndex: number, colIndex: number) => React.ReactNode;
  /**
   * Optional formatter for this column's value in a group-summary (subtotal)
   * row. When omitted, the table uses a dedicated locale number formatter.
   * Use this for columns that need bespoke summary formatting (e.g. currency).
   */
  summaryRenderer?: (value: number, col: any) => React.ReactNode;
  editor?: (
    value: any,
    onChange: (v: any) => void,
    onSave: () => void,
    onCancel: () => void,
    rowData: any,
    col: any,
    rowIndex: number,
    colIndex: number
  ) => React.ReactNode;
  /** Returns CSS class name(s) for conditional cell styling based on value/row data */
  cellClassName?: (value: any, rowData: any, rowIndex: number, colIndex: number) => string | undefined;
  /**
   * Optional formatter for this column's value when the row is exported to
   * CSV/Excel. Use it for columns whose stored cell value is not human-readable
   * (e.g. a relation column that stores `JSON.stringify({ id, name })`).
   * When omitted, the raw cell value is stringified — matching the Copy button.
   */
  exportValue?: (value: any, rowData: any) => string | number | null | undefined;
}

export interface DragState {
  isDragging: boolean;
  type: 'cell' | 'row' | 'column' | null;
  start: { row: number; col: number } | null;
}

export interface SortState {
  columnIndex: number | null;
  direction: 'asc' | 'desc' | null;
}

export interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  actions: ContextMenuAction[];
  type: 'column' | 'row' | 'cell' | null;
  index: number | null;
  colIndex?: number | null;
}

export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  separator?: boolean;
}

export interface FilterRow {
  id: string;
  field: string;
  operator: string;
  values: any[];
}

export type FilterColor = 'blue' | 'green' | 'purple' | 'orange' | 'pink' | 'teal' | 'yellow' | 'red';

export interface SavedFilter {
  id: string;
  name: string;
  rows: FilterRow[];
  color?: FilterColor;
}

// Event types
export interface CellEditSaveEvent {
  rowIndex: number;
  colIndex: number;
  oldValue: any;
  newValue: any;
  prop: string;
  rowData: any;
  id?: string;
}

/** One cell inside a {@link CellBatchSaveEvent}. Mirrors `CellEditSaveEvent`. */
export interface CellBatchSaveEntry {
  rowIndex: number;
  colIndex: number;
  prop: string;
  oldValue: any;
  newValue: any;
  rowData: any;
  id?: string;
}

/**
 * Emitted ONCE per multi-cell write, alongside the per-cell `CELL_EDIT_SAVE`s.
 * Additive: a consumer that ignores it keeps working exactly as before.
 */
export interface CellBatchSaveEvent {
  origin: CellWriteOrigin;
  writes: CellBatchSaveEntry[];
}

/** The applied/rejected tally for one multi-cell write. */
export interface CellBatchSaveResultEvent {
  applied: number;
  rejected: { rowIndex: number; colIndex: number; reason?: CellWriteRejectReason }[];
}

export interface CellSaveStartEvent {
  rowIndex: number;
  colIndex: number;
}

export interface CellSaveSuccessEvent {
  rowIndex: number;
  colIndex: number;
}

export interface CellSaveErrorEvent {
  rowIndex: number;
  colIndex: number;
  error?: string;
}

export interface NewRowSaveEvent {
  rowIndex: number;
  rowData: any;
}

export interface NewRowSaveStartEvent {
  rowIndex: number;
}

export interface NewRowSaveSuccessEvent {
  rowIndex: number;
  savedRowData: any;
}

export interface NewRowSaveErrorEvent {
  rowIndex: number;
  error?: string;
}

export interface ColumnSortEvent {
  columnIndex: number;
  columnName: string;
  direction: 'asc' | 'desc' | null;
}

export interface SearchEvent {
  query: string;
  timestamp: number;
}

export interface FilterChangeEvent {
  filters: FilterRow[];
  savedFilterId?: string | null;
}

export interface FilterSaveEvent {
  filter: SavedFilter;
}

export interface FilterSelectEvent {
  id: string | null;
  filterRows: FilterRow[];
}

export interface FilterRenameEvent {
  id: string;
  newName: string;
}

export interface FilterDeleteEvent {
  id: string;
}

export interface ColumnContextMenuEvent {
  columnIndex: number;
  columnName: string;
  actionId: string;
}

export interface RowContextMenuEvent {
  rowIndex: number;
  rowData: any;
  actionId: string;
}

export interface CellContextMenuEvent {
  rowIndex: number;
  colIndex: number;
  rowData: any;
  col: ColumnDef;
  actionId: string;
}

export const TableEvents = {
  CELL_EDIT_SAVE: 'table:cell:edit:save',
  CELL_SAVE_START: 'table:cell:save:start',
  CELL_SAVE_SUCCESS: 'table:cell:save:success',
  CELL_SAVE_ERROR: 'table:cell:save:error',
  /** One multi-cell write (paste / cut / clear / fill / replace / import). */
  CELL_BATCH_SAVE: CELL_BATCH_SAVE_EVENT,
  /** The applied/rejected tally for that same write. */
  CELL_BATCH_SAVE_RESULT: CELL_BATCH_SAVE_RESULT_EVENT,
  NEW_ROW_SAVE: 'table:new:row:save',
  NEW_ROW_SAVE_START: 'table:new:row:save:start',
  NEW_ROW_SAVE_SUCCESS: 'table:new:row:save:success',
  NEW_ROW_SAVE_ERROR: 'table:new:row:save:error',
  FILTER_CHANGE: 'table:filter:change',
  FILTER_SAVE: 'table:filter:save',
  FILTER_SELECT: 'table:filter:select',
  FILTER_RENAME: 'table:filter:rename',
  FILTER_DELETE: 'table:filter:delete',
  COLUMN_SORT: 'table:column:sort',
  SEARCH: 'table:search',
  COLUMN_CONTEXT_MENU_ACTION: 'table:column:context:action',
  ROW_CONTEXT_MENU_ACTION: 'table:row:context:action',
  CELL_CONTEXT_MENU_ACTION: 'table:cell:context:action',
  // Perspective events
  PERSPECTIVE_SAVE: 'table:perspective:save',
  PERSPECTIVE_SELECT: 'table:perspective:select',
  PERSPECTIVE_RENAME: 'table:perspective:rename',
  PERSPECTIVE_DELETE: 'table:perspective:delete',
  PERSPECTIVE_CHANGE: 'table:perspective:change',
  PERSPECTIVE_DUPLICATE: 'table:perspective:duplicate',
  PERSPECTIVE_SET_DEFAULT: 'table:perspective:setDefault',
  PERSPECTIVE_PUBLISH: 'table:perspective:publish',
  PERSPECTIVE_TEMPLATE_COPY: 'table:perspective:templateCopy',
} as const;

// Type mapping for event payloads - maps event names to their payload types
export type TableEventPayloads = {
  [TableEvents.CELL_EDIT_SAVE]: CellEditSaveEvent;
  [TableEvents.CELL_SAVE_START]: CellSaveStartEvent;
  [TableEvents.CELL_SAVE_SUCCESS]: CellSaveSuccessEvent;
  [TableEvents.CELL_SAVE_ERROR]: CellSaveErrorEvent;
  [TableEvents.CELL_BATCH_SAVE]: CellBatchSaveEvent;
  [TableEvents.CELL_BATCH_SAVE_RESULT]: CellBatchSaveResultEvent;
  [TableEvents.NEW_ROW_SAVE]: NewRowSaveEvent;
  [TableEvents.NEW_ROW_SAVE_START]: NewRowSaveStartEvent;
  [TableEvents.NEW_ROW_SAVE_SUCCESS]: NewRowSaveSuccessEvent;
  [TableEvents.NEW_ROW_SAVE_ERROR]: NewRowSaveErrorEvent;
  [TableEvents.FILTER_CHANGE]: FilterChangeEvent;
  [TableEvents.FILTER_SAVE]: FilterSaveEvent;
  [TableEvents.FILTER_SELECT]: FilterSelectEvent;
  [TableEvents.FILTER_RENAME]: FilterRenameEvent;
  [TableEvents.FILTER_DELETE]: FilterDeleteEvent;
  [TableEvents.COLUMN_SORT]: ColumnSortEvent;
  [TableEvents.SEARCH]: SearchEvent;
  [TableEvents.COLUMN_CONTEXT_MENU_ACTION]: ColumnContextMenuEvent;
  [TableEvents.ROW_CONTEXT_MENU_ACTION]: RowContextMenuEvent;
  [TableEvents.CELL_CONTEXT_MENU_ACTION]: CellContextMenuEvent;
  // Perspective event payloads (types imported from ./perspective)
  [TableEvents.PERSPECTIVE_SAVE]: import('./perspective').PerspectiveSaveEvent;
  [TableEvents.PERSPECTIVE_SELECT]: import('./perspective').PerspectiveSelectEvent;
  [TableEvents.PERSPECTIVE_RENAME]: import('./perspective').PerspectiveRenameEvent;
  [TableEvents.PERSPECTIVE_DELETE]: import('./perspective').PerspectiveDeleteEvent;
  [TableEvents.PERSPECTIVE_CHANGE]: import('./perspective').PerspectiveChangeEvent;
  [TableEvents.PERSPECTIVE_DUPLICATE]: import('./perspective').PerspectiveDuplicateEvent;
  [TableEvents.PERSPECTIVE_SET_DEFAULT]: import('./perspective').PerspectiveSetDefaultEvent;
  [TableEvents.PERSPECTIVE_PUBLISH]: import('./perspective').PerspectivePublishEvent;
  [TableEvents.PERSPECTIVE_TEMPLATE_COPY]: import('./perspective').PerspectiveTemplateCopyEvent;
};

// Type for event handler map - each key is an event name, value is handler function
export type EventHandlers = {
  [K in keyof TableEventPayloads]?: (payload: TableEventPayloads[K], event?: Event) => void;
};

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  limit: number;
  /** Total record count across all pages — drives the v2 footer's "X–Y of Z" text. */
  total?: number;
  limitOptions?: number[];
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

/**
 * Style preset for read-only cells.
 * - 'muted': Gray background - indicates cells are not editable
 * - 'normal': Same as editable cells - transparent background (default)
 * - 'subtle': Very subtle background tint - minimal visual difference
 */
export type ReadOnlyStyle = 'muted' | 'normal' | 'subtle';

/**
 * Style preset for row hover in clickable row mode.
 * - 'default': Light blue background (same as selection)
 * - 'subtle': Very light gray background
 * - 'accent': Uses theme accent color
 */
export type RowHoverStyle = 'default' | 'subtle' | 'accent';

/**
 * A custom batch action shown in the grouped-actions (bulk) bar that appears
 * when ≥1 row is selected. Configured per-table via `uiConfig.bulkActions`;
 * rendered after the built-in Copy (and optional Delete) buttons.
 */
export interface BulkActionConfig {
  /** Stable identifier (used as the React key). */
  id: string;
  /** Button label. */
  label: string;
  /** Optional leading icon (e.g. a lucide-react element). */
  icon?: React.ReactNode;
  /** Invoked with the currently-selected row ids when the button is clicked. */
  onClick: (selectedIds: string[]) => void | Promise<void>;
  /** Optionally disable the action for the current selection. */
  disabled?: (selectedIds: string[]) => boolean;
}

/**
 * What `TableUIConfig.searchSuggestions` receives.
 *
 * `inputRef` is handed over so the panel can attach its OWN `keydown` listener
 * to the input: arrow-key navigation of a list has to be driven from the control
 * that holds focus, and focus never leaves the box. `submit` puts a query into
 * the box AND into the dataset in one move — what clicking a hint does.
 */
export type SearchSuggestionsContext = {
  /** What the box holds right now, undebounced. */
  query: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Close the panel and leave the query alone. */
  close: () => void;
  /** Set the query and search for it immediately. */
  submit: (query: string) => void;
};

export type SearchSuggestionsRenderer = (ctx: SearchSuggestionsContext) => React.ReactNode;

/**
 * What `searchBarStart` is handed when it is a function.
 *
 * Deliberately small: the rows currently loaded and the filter pair. A header
 * is not a body renderer and must not be given selection, grouping toggles or
 * paging — those belong to the table's own chrome, and handing them out is how
 * two controls end up disagreeing about one piece of state.
 */
export interface SearchBarRenderContext {
  /** The rows on this page, after search and filters. */
  data: any[];
  filters: FilterRow[];
  setFilters: (filters: FilterRow[]) => void;
}

export interface TableUIConfig {
  /** Hide the entire toolbar (header with title, search, buttons) */
  hideToolbar?: boolean;
  /** Hide just the title in the toolbar */
  hideTitle?: boolean;
  /** Hide just the search bar */
  hideSearch?: boolean;
  /** Hide the "Add Row" button */
  hideAddRowButton?: boolean;
  /** Hide the perspective tabs row (All, Base, +) */
  hidePerspectiveTabs?: boolean;
  /**
   * Offer a view switcher in the toolbar's icon cluster.
   *
   * Two or more entries render an M3 segmented button; fewer render nothing,
   * so a table with one way to draw itself is byte-identical to today. The
   * chosen mode is a property of the SAVED VIEW (`PerspectiveConfig.viewMode`),
   * not of the session — see that type for why.
   *
   * A mode other than `'table'` needs `renderBody`; without it the switcher
   * would offer a mode that draws nothing.
   */
  viewModes?: TableViewModeOption[];
  /**
   * Fired when the view switcher changes mode, and once on mount with the
   * initial mode.
   *
   * The table owns `viewMode` internally, which is right — it decides whether
   * to call `renderBody`. But a host often has chrome that belongs to only one
   * of the two renderers: the documents list draws folders as a row of tiles
   * INSIDE its grid body, so the folder chips it puts in `searchBarStart` are
   * a duplicate there and the only thing that can reach a folder in the list.
   * Without this the host cannot tell which it is looking at, and the same
   * folders appear twice in two different shapes.
   */
  onViewModeChange?: (mode: import('./perspective').TableViewMode) => void;
  /** Hide the pagination controls */
  hidePagination?: boolean;
  /** Hide the Actions column */
  hideActionsColumn?: boolean;
  /**
   * Hide the toolbar Export button (CSV/Excel download of the selected rows,
   * or the current page when nothing is selected). Default: false (shown).
   */
  hideExportButton?: boolean;
  /**
   * Base file name (without extension) for exported CSV/Excel files. When
   * omitted, the table name is slugified. Example: 'invoices' → 'invoices.csv'.
   */
  exportFileName?: string;
  /** Custom content rendered at the start of the top bar (before title) */
  topBarStart?: React.ReactNode;
  /** Custom content rendered at the end of the top bar (after add button) */
  topBarEnd?: React.ReactNode;
  /** v2 only: content rendered at the right end of the search row (e.g. a
   *  primary action button placed on the same line as the search input). */
  searchBarEnd?: React.ReactNode;
  /**
   * v2 only: content rendered FIRST in the search-row actions (before the add
   * button / searchBarEnd / export), e.g. a leading toolbar action.
   *
   * MAY BE A RENDER FUNCTION, and that is what makes chrome shared between the
   * two renderers possible. `renderBody` is called only when the view mode is
   * not `table`, so anything needing `filters` / `setFilters` could previously
   * only exist in the GRID — the documents module drew its folder row there and
   * the list view saw no change at all, which is precisely the bug that
   * prompted this. A header that narrows the table has to be reachable from
   * both, and this slot is the one both render.
   */
  searchBarStart?: React.ReactNode | ((ctx: SearchBarRenderContext) => React.ReactNode);

  /**
   * Full-width content between the toolbar and the table body, in BOTH view
   * modes.
   *
   * `searchBarStart` puts its content INSIDE the search row, squeezed beside
   * the title and the search box. That is right for a leading toolbar action
   * and wrong for a band: the documents module's folder row landed there and
   * came out as a cramped strip to the right of the heading, nothing like the
   * row of folders it is meant to be.
   *
   * A function receives the same small context, so a band can narrow the
   * table from a place both renderers paint.
   */
  beforeBody?: React.ReactNode | ((ctx: SearchBarRenderContext) => React.ReactNode);
  /**
   * A suggestions panel under the search box — the Drive-style "hits as you
   * type" affordance.
   *
   * NOT a `ReactNode` like the slots above, and not anywhere near them: those
   * render into `.hot-toolbar-actions`, which sits AFTER the toolbar spacer, on
   * the far right of the row. A hint panel has to be under the input it
   * belongs to, so `SearchBar` owns the anchoring (measured + portalled, because
   * `.hot-card` clips) and this hands back only the contents.
   *
   * A render prop because relevance is domain knowledge: what a good hint shows,
   * where it comes from and what it means to click one is the host's business.
   */
  searchSuggestions?: SearchSuggestionsRenderer;
  /** Debounce before the search box publishes a query. Default 300ms; a table
   *  with `searchSuggestions` usually wants less, so the panel feels live. */
  searchDebounceMs?: number;
  /** Placeholder for the search box. Default: "Search…". */
  searchPlaceholder?: string;
  /**
   * Rename a group heading — given the field, the raw value and the row count.
   *
   * The grouping engine has one word for a group with no value, `(Empty)`
   * (`EMPTY_GROUP_VALUE`), and it names the TABLE'S INTERNALS rather than the
   * data. Grouped by case, that pile is "No case" — the documents nobody has
   * filed — and only the host knows that. Without this hook a host can rename
   * the sections in its own body renderer and not in the table, which is how one
   * list ends up calling the same pile two different things.
   *
   * Return `undefined` to keep the default.
   */
  formatGroupValue?: (ctx: { field: string; value: string; count: number }) => string | undefined;
  /** Enable fullscreen toggle button. Default: false */
  enableFullscreen?: boolean;
  /** Callback when fullscreen state changes */
  onFullscreenChange?: (isFullscreen: boolean) => void;
  /**
   * Enable the Excel/Airtable-style fill handle: a grab-nub on the single
   * active editable cell that drag-fills its value up/down the column.
   * Default: false (opt-in per table).
   */
  enableFillHandle?: boolean;
  /**
   * Above this many target cells, a fill drag asks for confirmation before
   * writing (each filled cell fires a save → a persist request). Default: 100.
   */
  fillConfirmThreshold?: number;
  /**
   * Visual style for read-only cells. Default: 'normal' (the design's table
   * does not tint read-only columns)
   * - 'muted': Gray background - indicates cells are not editable
   * - 'normal': Same as editable cells - no visual difference
   * - 'subtle': Very subtle background - minimal visual indication
   */
  readOnlyStyle?: ReadOnlyStyle;
  /**
   * Hover style for clickable rows. Only applies when onRowClick is set.
   * - 'default': Light blue (selection color)
   * - 'subtle': Light gray
   * - 'accent': Theme accent color
   * @default 'default'
   */
  rowHoverStyle?: RowHoverStyle;
  /**
   * Disable the built-in column header context menu (modern layout).
   * When true, reverts to classic double-click behavior for column actions.
   * @default false
   */
  disableBuiltinColumnMenu?: boolean;
  /**
   * Remove the outer border and border-radius from the table container.
   * Use when the table fills the full page and should blend with the layout.
   * @default false
   */
  borderless?: boolean;
  /**
   * Custom batch actions appended to the grouped-actions (bulk) bar shown when
   * ≥1 row is selected. Each is rendered after the built-in Copy / Delete
   * buttons and receives the selected row ids on click.
   */
  bulkActions?: BulkActionConfig[];
  /**
   * Virtualize COLUMNS in addition to rows.
   *
   * Default FALSE — opt-in per table, because it changes rendering for 56
   * consumer files. With it off the grid mounts every column exactly as it does
   * today (the window "fails open" to the full set), so switching the flag off
   * is a byte-identical render, not a fallback path.
   *
   * THE NAME IS LOAD-BEARING: `apps/web/src/app/dev/dynamic-table-stress/`
   * spreads this literal key when `?colvirt=1`. Any other spelling and the
   * measurement toggle silently no-ops.
   *
   * @default false
   */
  enableColumnVirtualization?: boolean;
  /**
   * Horizontal overscan in columns, i.e. how many unseen columns are mounted
   * either side of the viewport. Raising it spends the density budget this
   * feature exists to buy — diagnose blank columns as a commit-latency problem
   * before reaching for this.
   *
   * @default 3 (DEFAULT_COLUMN_OVERSCAN)
   */
  columnOverscan?: number;
  /**
   * Hide the row-density picker in the toolbar. Density is a PER-USER
   * preference (see `hooks/useDensityPreference`), so hiding the control does
   * not pin the level — a user who set `dense` elsewhere still gets `dense`
   * here. Use `densityLevel` for that.
   *
   * @default false
   */
  hideDensityControl?: boolean;
  /**
   * Keep Export / Row height / Fullscreen as separate toolbar buttons.
   *
   * Default is CONDENSED — one overflow button — because those three are
   * secondary controls that were each spending toolbar width on every table in
   * the app, crowding out the primary action a page actually cares about
   * ("Create Offer", "Add Location"). Set this when a table genuinely wants
   * them one click away.
   */
  expandToolbarActions?: boolean;
  /**
   * Rows a HOST appends inside the toolbar's overflow menu.
   *
   * Exists so a host adds items to the table's one menu instead of rendering a
   * second button next to it — which is what an earlier build did, leaving two
   * near-identical overflow buttons side by side.
   */
  toolbarOverflowExtras?: React.ReactNode;
  /**
   * DEVELOPER override for tables whose structure demands a fixed density (a
   * two-row summary strip, a fixed-height drawer sub-table). Read-only: it wins
   * for THIS table and is never persisted, so it cannot silently become the
   * user's setting everywhere. Omit for the normal case.
   */
  densityLevel?: DensityLevel;
}

/**
 * Function type for loading filter suggestions from a server.
 * When provided, the filter popover will use this instead of extracting values from loaded data.
 * This is recommended for large datasets (1000+ rows) to avoid client-side performance issues.
 *
 * @param field - The field/column name to get suggestions for
 * @param query - The current search query typed by the user (for filtering suggestions server-side)
 * @returns Promise resolving to an array of suggestion strings
 */
export type LoadFilterSuggestions = (field: string, query: string) => Promise<string[]>;

/**
 * A whitelisted field a linked (lookup) column can surface from a related record.
 */
export interface LookupSourceFieldOption {
  /** Target field key, e.g. `'tax_id'`. */
  key: string;
  /** Translated, user-facing field label. */
  label: string;
}

/**
 * A foreign-key relationship the current table can attach linked columns to.
 * Supplied by the host (which knows its `tableId`) via {@link LoadLookupSources}
 * so `packages/ui` never imports the host's lookup module.
 */
export interface LookupSourceOption {
  /** Registered lookup source key (an FK relationship), e.g. `'contractor'`. */
  key: string;
  /** Translated, user-facing relationship label, e.g. `'Contractor'`. */
  label: string;
  /** Whitelisted fields that may be surfaced as linked columns. */
  fields: LookupSourceFieldOption[];
}

/**
 * Loads the foreign-key lookup sources available for this table. When provided,
 * the Configure View drawer shows a "Linked columns" section. Called lazily when
 * the drawer opens.
 */
export type LoadLookupSources = () => Promise<LookupSourceOption[]>;

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

/**
 * Defines a keyboard shortcut for a row action.
 * Shortcuts only fire when a single cell is selected (not editing, not multi-select).
 */
export interface RowActionShortcut {
  /** Unique identifier for this shortcut (e.g., 'view', 'delete') */
  id: string;
  /** Display label for documentation/tooltips (e.g., 'Open detail') */
  label: string;
  /** The key to match (e.g., 'Enter', 'd', 'Backspace') — uses KeyboardEvent.key */
  key: string;
  /** Whether Shift must be held. Default: false */
  shift?: boolean;
  /** Whether Ctrl/Cmd must be held. Default: false */
  ctrlOrCmd?: boolean;
  /** Whether Alt must be held. Default: false */
  alt?: boolean;
}

/**
 * Configuration for DynamicTable keyboard shortcuts.
 */
export interface KeyboardShortcutsConfig {
  /** Row-level action shortcuts (fire when a single row is selected) */
  rowActions?: RowActionShortcut[];
}

/**
 * Callback fired when a keyboard shortcut triggers a row action.
 * @param actionId - The `id` of the matched RowActionShortcut
 * @param rowData - The data object for the currently selected row
 * @param rowIndex - The index of the currently selected row
 */
export type OnRowAction = (actionId: string, rowData: any, rowIndex: number) => void;

export interface DynamicTableProps {
  data?: any[];
  columns?: ColumnDef[];
  colHeaders?: boolean;
  rowHeaders?: boolean;
  height?: string | number;
  width?: string | number;
  idColumnName?: string;
  tableName?: string;
  /**
   * Stable identifier for this table, used to persist per-user column widths in
   * localStorage across reloads. Scoped to the signed-in user (falling back to
   * the active organization). When omitted, manual column resizes are not
   * remembered. Pass the same id you use for `perspectives` so widths track the
   * table, not the page instance.
   */
  tableId?: string;
  tableRef: React.RefObject<HTMLDivElement | null>;
  columnActions?: (column: ColumnDef, colIndex: number) => ContextMenuAction[];
  rowActions?: (rowData: any, rowIndex: number) => ContextMenuAction[];
  actionsRenderer?: (rowData: any, rowIndex: number) => React.ReactNode;
  pagination?: PaginationProps;
  /**
   * The dataset-wide search term currently narrowing `data` (the `SearchBar`'s
   * query). Read-only, and used for ONE thing: find-and-replace's scope label
   * says "…in 100 loaded rows (filtered by "abc")" so a loaded-page match count
   * can never be mistaken for a dataset count. Omitted → the clause is omitted.
   */
  searchQuery?: string;



  // DEPRECATED - Keep for backward compatibility (converts to perspectives internally)
  savedFilters?: SavedFilter[];
  activeFilterId?: string | null;
  hiddenColumns?: string[];

  // Debug mode - shows floating event log panel
  debug?: boolean;

  // UI visibility configuration
  uiConfig?: TableUIConfig;


  /**
   * Refs to adjacent DynamicTable containers for cross-table navigation.
   * ArrowDown at the last row / ArrowUp at the first row moves focus to
   * `next` / `prev`. Tab past the last editable cell also moves to `next`,
   * and Shift+Tab before the first editable cell moves to `prev`.
   */
  /** When true, automatically selects the first cell when table receives focus */
  autoSelectOnFocus?: boolean;
  /** When true, Tab navigation enters edit mode on the target cell. @default true */
  autoEditOnTab?: boolean;
  /** Function to load filter suggestions from the server */
  loadFilterSuggestions?: LoadFilterSuggestions;
  /** Function to load the table's FK lookup sources. When set, the Configure
   *  View drawer shows a "Linked columns" section. */
  loadLookupSources?: LoadLookupSources;
  /** Keyboard shortcuts for row-level actions */
  keyboardShortcuts?: KeyboardShortcutsConfig;
  /** Callback fired when a keyboard shortcut triggers a row action */
  onRowAction?: OnRowAction;
  /** Refs to adjacent DynamicTable containers for cross-table navigation */
  siblingTableRefs?: {
    prev?: React.RefObject<HTMLDivElement | null>;
    next?: React.RefObject<HTMLDivElement | null>;
  };
  /** Callback when a row is clicked. Enables clickable row mode with hover highlighting. */
  onRowClick?: (rowIndex: number, rowData: any, event: React.MouseEvent) => void;
  /** Callback when a row is double-clicked */
  onRowDoubleClick?: (rowIndex: number, rowData: any, event: React.MouseEvent) => void;
  /** ID of the row to highlight (same style as hover) */
  highlightedRowId?: string | null;
  /** Width in pixels for the actions column. @default 80 */
  actionsColumnWidth?: number;
  /** Enable cell comments and color annotations */
  enableComments?: boolean;
  /** Entity type for annotations. String or function that resolves per-row. */
  commentsEntityType?: string | ((row: any) => string);
  /**
   * B8a — resolve the annotation target for ONE CELL, so a row that is not one
   * record can scope each column to the record its value actually belongs to.
   * Defaults to `{ entityType: commentsEntityType, rowId: row[idColumnName] }`.
   * See the same prop on `DynamicTable` for the full rationale.
   */
  commentsCellTarget?: (row: Record<string, any>, col: ColumnDef) => { entityType: string; rowId: string };
  /** Optional view context label stored as metadata (e.g., "project_sea_containers"). */
  commentsViewContext?: string;
  /** Called after any annotation or comment change (create, update, delete). */
  onAnnotationChange?: () => void;
  /** Message to display when table has no data */
  emptyMessage?: string;
  /** Saved perspective configurations */
  savedPerspectives?: PerspectiveConfig[];
  /** Currently active perspective ID */
  activePerspectiveId?: string | null;
  /**
   * The view that opens by default FOR THIS USER (workshop A4). Drives the star
   * on the tab and the enabled state of "Set as my default". Per-user: upstream
   * scopes `isDefault` by `userId`.
   */
  defaultPerspectiveId?: string | null;
  /**
   * Views colleagues published as SHARED TEMPLATES. Offered for copying only —
   * never applied to anyone automatically, which is what keeps every saved
   * setting per-user after sharing exists.
   */
  sharedTemplates?: import('./perspective').PerspectiveTemplate[];
  /** Whether this user may publish a view (server's `perspectives.role_defaults` answer). */
  canPublishTemplates?: boolean;
  /** Roles a template can be published to. Empty unless `canPublishTemplates`. */
  publishableRoles?: Array<{ id: string; name: string }>;
  /** Columns hidden by default */
  defaultHiddenColumns?: string[];
  /** Density of row padding (v2 design). */
  density?: 'sm' | 'md';
  /** Zebra-stripe alternate rows with the secondary surface (v2 design). */
  striped?: boolean;
  /** Called with the selected row IDs whenever the v2 checkbox-column
   *  selection changes. Drives bulk actions (e.g. mark-paid). */
  onSelectionChange?: (selectedIds: string[]) => void;
  /**
   * Fetch the entire dataset (all pages, ignoring the active perspective's
   * filters) for a whole-table export. Supplied by `useDynamicTablePage`. When
   * present, the toolbar Export button exports every row across all columns;
   * when absent it falls back to the currently-loaded page.
   *
   * MAY REJECT, and the caller must let it (HEDGE-123). A page that fails
   * mid-pagination must abort the export, never shorten it — a short CSV looks
   * exactly like a complete one and goes into a reconciliation unnoticed.
   *
   * May also resolve to an {@link ExportAllResult} instead of a bare array, to
   * report a result it could not prove complete. A bare array still means
   * "complete", so existing implementations are unaffected.
   */
  onExportAll?: () => Promise<any[] | ExportAllResult>;
  /**
   * Server-computed aggregate over the whole filtered dataset, from
   * `useDynamicTablePage`. Absent/null → the pinned totals row folds the loaded
   * page instead and says so.
   */
  aggregateResult?: import('./grouping').AggregateResult | null;
  aggregateLoading?: boolean;
  aggregateError?: boolean;
  /**
   * The LIST request itself failed (HEDGE-119) — not "the table is empty".
   *
   * Supplied by `useDynamicTablePage` from the dataset query's error state.
   * When true the zero-row region renders `LoadErrorState` instead of
   * `EmptyState`, because a rejected query and a genuinely empty table both
   * arrive as `data: []` and were previously indistinguishable on screen.
   * Defaults false, so every existing host keeps its current behaviour.
   */
  loadError: boolean;
  /** Re-runs the failed list request from the error state's retry button. */
  onRetryLoad?: () => void;
  /**
   * Draw the table's BODY as something other than rows.
   *
   * THE POINT OF THIS PROP is that the alternative renderer cannot own state
   * the table also owns. `DynamicTable` stays mounted and keeps everything it
   * already keeps — the toolbar, the search box, the filters, the perspective
   * tabs, the grouping, the selection, the pagination and the bulk-action bar.
   * Only the region between the toolbar and the footer changes. So a second
   * view cannot diverge from the table by construction, rather than by anyone
   * remembering to keep them in step.
   *
   * Called only while `viewMode` is not `'table'`. When it is absent the mode
   * has nothing to switch to and the switcher is not rendered.
   */
  renderBody?: (ctx: TableBodyRenderContext) => React.ReactNode;

  /**
   * ⚠ `DynamicTableProps` IS DECLARED TWICE — here and in `DynamicTable.tsx`.
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
  /** Grouping applied when a perspective declares none. See the fuller note on
   *  the sibling declaration. */
  defaultGrouping?: import('./grouping').GroupRule[];
}

/**
 * Everything an alternative body renderer is given. It is READ-MOSTLY on
 * purpose: the callbacks mutate the table's own state, so a renderer changes
 * the same thing the table would have changed.
 */
export interface TableBodyRenderContext {
  /** The current page of rows, exactly as the table has them. */
  data: any[];
  /** The resolved, visible columns in display order. */
  columns: ColumnDef[];
  /**
   * The grouped layout when a `GroupRule[]` is active, else `null`. Section
   * headers carry `memberDataIndices`, which is what makes a group's
   * select-all select rows a collapsed section is hiding.
   */
  visualRows: import('./grouping').VisualRow[] | null;
  /** The active grouping. Empty ⇒ the body renders one flat run of rows. */
  groupRules: import('./grouping').GroupRule[];
  collapsedGroups: ReadonlySet<string>;
  toggleGroup: (groupKey: string) => void;
  /** Row-key values of the selected rows. Same set the bulk bar counts. */
  selectedRowIds: ReadonlySet<string>;
  /** The column whose value identifies a row for selection. */
  rowKeyColumn: string;
  selectable: boolean;
  toggleRowSelect: (rowId: string, opts?: { shiftKey?: boolean }) => void;
  toggleGroupSelect: (rowIds: string[]) => void;
  clearSelection: () => void;
  /** The needle currently narrowing the rows, for an honest empty state. */
  searchQuery?: string;
  /**
   * The live filter rules — the SAME array the Configure View drawer and the
   * header quick filters edit.
   *
   * A body renderer that offers its own quick filter (a chip row, a facet
   * list) writes through `setFilters` rather than holding a selection of its
   * own. That is what makes such a control visible to the table view, to the
   * active-filter chips and to a saved view; a private selection would be a
   * second filter model that can disagree with the list.
   */
  filters: FilterRow[];
  setFilters: (filters: FilterRow[]) => void;
  /** How many filter rules are active, for an honest empty state. */
  filterCount: number;
  /** Drop the search / the filters — the two ways out of an empty result. */
  clearSearch: () => void;
  clearFilters?: () => void;
}

/** One segment of the view switcher. */
export interface TableViewModeOption {
  mode: import('./perspective').TableViewMode;
  /** Accessible label. Also the tooltip. */
  label: string;
  icon: React.ReactNode;
}

// Re-export filter types
export * from './filters';

// Re-export perspective types
export * from './perspective';

// Re-export grouping types
export * from './grouping';

// Re-export rollup ("summarised column") types. Single export site — see the
// header of ./rollup for why nothing else may re-export these names.
export * from './rollup';

/**
 * The outcome of a whole-table export fetch (HEDGE-123).
 *
 * Exists so a partial result can never be mistaken for a complete one. The
 * defect this replaces returned a bare `any[]` whichever happened: a page that
 * 500'd, a page that came back as `200` with an unparseable body, and a walk
 * that hit an internal iteration cap all produced the same value as a clean
 * finish — a shorter array, with nothing to distinguish it.
 *
 * That is the CSV mirror of the empty-list defect in HEDGE-119. There the user
 * read a failed fetch as "no rows"; here they read a truncated file as "these
 * are all the rows". The second is worse, because a file looks like an answer:
 * a failure is visible and can be retried, a short export goes into a
 * reconciliation and is never questioned.
 *
 * Hard failures REJECT rather than resolving to this. This type is only for
 * the case where rows were genuinely fetched but completeness cannot be proven.
 */
export interface ExportAllResult {
  /** The rows actually collected. */
  rows: any[];
  /** How many rows the server said exist, when it reported a total. */
  expected: number | null;
  /**
   * False when the walk stopped without proving it had everything. The caller
   * must NOT hand the user a file in that case — it must say how many of how
   * many it got.
   */
  complete: boolean;
  /** Why completeness could not be proven. Present only when `complete` is false. */
  reason?: string;
}
