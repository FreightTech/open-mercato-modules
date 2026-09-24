// handlers.ts

import { CellStore } from '../store/index';
import {
  ColumnDef,
  TableEvents,
  CellEditSaveEvent,
  NewRowSaveEvent,
  NewRowSaveStartEvent,
  ColumnSortEvent,
  ColumnContextMenuEvent,
  RowContextMenuEvent,
  CellContextMenuEvent,
  ContextMenuAction,
  ContextMenuState,
  SortState,
  FilterRow,
  SavedFilter,
  FilterSaveEvent,
  FilterSelectEvent,
  FilterRenameEvent,
  FilterDeleteEvent,
  FilterColor,
} from '../types/index';
import { dispatch } from '../events/events';
import { isCellValueUnchanged } from './cellWrites';
import { coerceCellValue } from '../utils/coerceCellValue';

// ============================================
// CELL HANDLERS
// ============================================
export function createCellHandlers(
  store: CellStore,
  columns: ColumnDef[],
  tableRef: React.RefObject<HTMLDivElement | null>,
  idColumnName: string
) {
  const handleCellSave = (row: number, col: number, newValue: any, clearEditing: boolean = true) => {
    const rowData = store.getRowData(row);
    const colConfig = columns[col];
    const fieldKey = colConfig?.data;

    // Get old value from rowData using field key (handles reordered columns)
    const oldValue = rowData?.[fieldKey];

    // Skip if value unchanged. ONE unchanged test in the codebase — the batch
    // write path reuses this exact predicate to tell "written" from "already
    // had that value", and two definitions would drift.
    if (isCellValueUnchanged(oldValue, newValue)) {
      if (clearEditing) {
        store.clearEditing();
        store.focusTable();
      }
      return;
    }

    // Write the one value source (the row object) so the cell displays the new
    // value immediately; setCellValue also bumps the cell revision to repaint.
    store.setCellValue(row, col, newValue);

    // Only clear editing if requested (keyboard navigation handles its own clearing)
    if (clearEditing) {
      store.clearEditing();
      // Restore focus to the table container so the user can continue
      // navigating with Tab/Arrow keys. Without this, portal-based editors
      // (calendar, dropdown) leave focus on document.body after unmounting.
      store.focusTable();
    }

    // Only dispatch event if not a new row
    if (!store.isNewRow(row)) {
      const coerced = coerceCellValue(newValue, colConfig);
      // Legacy inline-edit semantics, preserved EXACTLY. The old
      // `parseValueByType` had only two outcomes — a parsed value, or `null`
      // when a non-empty value could not become the column's type — and it
      // never looked at `readOnly` or `source` at all. So `notCoercible` maps
      // to `null` and every other verdict passes the value through untouched.
      // `applyCellWrites` is where the strict verdicts matter: a paste of 200
      // cells must report "3 were not numbers", never silently blank them.
      const parsedValue =
        coerced.ok ? coerced.value : coerced.reason === 'notCoercible' ? null : newValue;

      dispatch<CellEditSaveEvent>(tableRef.current as HTMLElement, TableEvents.CELL_EDIT_SAVE, {
        rowIndex: row,
        colIndex: col,
        oldValue,
        newValue: parsedValue,
        prop: fieldKey,
        rowData,
        id: rowData?.[idColumnName],
      });

      // Capture for undo/redo (no-op while a replay is suppressing recording).
      // Keyed by stable row id + column key so it survives a post-edit refetch.
      store.recordCellChange({
        rowId: rowData?.[idColumnName],
        colKey: fieldKey,
        oldValue,
        newValue,
      });
    }
  };

  const handleCellCancel = () => {
    store.clearEditing();
  };

  const handleStartEditing = (row: number, col: number) => {
    const column = columns[col];
    if (column?.readOnly) return;
    store.setEditingCell(row, col);
  };

  return {
    handleCellSave,
    handleCellCancel,
    handleStartEditing,
  };
}

// ============================================
// ROW HANDLERS
// ============================================
export function createRowHandlers(
  store: CellStore,
  columns: ColumnDef[],
  tableRef: React.RefObject<HTMLDivElement | null>
) {
  const handleAddRow = () => {
    const newRowData = columns.reduce(
      (acc, col) => ({ ...acc, [col.data]: '' }),
      { _isNew: true }
    );

    store.addRow(newRowData, 0);
    store.setEditingCell(0, 0);
  };

  const handleSaveNewRow = (rowIndex: number) => {
    // COMMIT THE OPEN EDITOR FIRST — ledger 4.10.
    //
    // A draft row opens with its first cell already in edit mode, so the normal
    // gesture is "type a name, click Save", and every text/numeric editor
    // commits on BLUR. Whether that blur lands before this handler reads the row
    // is decided by event ordering nobody here controls: mousedown moves focus,
    // React re-renders the sticky actions cell on the same tick, and a commit
    // that arrives after `getRowData()` is a create POSTed with an empty name —
    // rejected, and to the user indistinguishable from Save doing nothing.
    //
    // Blurring explicitly makes the ordering ours. It is a no-op when the blur
    // already happened (no editing cell), and it is the ONLY path for a Save
    // triggered by keyboard or by a host, where no focus change occurs at all.
    if (typeof document !== 'undefined' && store.getEditingCell()) {
      const active = document.activeElement as HTMLElement | null;
      if (active && typeof active.blur === 'function' && active !== document.body) {
        active.blur();
      }
    }

    const rowData = { ...store.getRowData(rowIndex) };
    delete rowData._isNew;

    dispatch<NewRowSaveStartEvent>(
      tableRef.current as HTMLElement,
      TableEvents.NEW_ROW_SAVE_START,
      { rowIndex }
    );

    dispatch<NewRowSaveEvent>(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE, {
      rowIndex,
      rowData,
    });
  };

  const handleCancelNewRow = (rowIndex: number) => {
    store.removeRow(rowIndex);
    // The new row was being edited at (rowIndex, 0). Removing it leaves the
    // editing + selection state pointing at that index, which then shifts onto
    // the row that takes its place (e.g. row 0) and lingers — unclearable by
    // Escape/blur. Clear both so no row stays selected after cancel.
    store.clearEditing();
    store.setSelection({ type: null, anchor: null, focus: null });
  };

  return {
    handleAddRow,
    handleSaveNewRow,
    handleCancelNewRow,
  };
}

// ============================================
// DRAG HANDLERS
// ============================================
export type DragState = {
  isDragging: boolean;
  type: 'cell' | 'row' | 'column' | null;
  start: { row: number; col: number } | null;
};

export function createDragHandlers(
  store: CellStore,
  columns: ColumnDef[],
  dragStateRef: React.MutableRefObject<DragState>
) {
  const handleDragStart = (row: number, col: number, type: 'cell' | 'row' | 'column') => {
    dragStateRef.current = { isDragging: true, type, start: { row, col } };

    if (type === 'row') {
      store.setSelection({
        type: 'rowRange',
        anchor: { row, col: 0 },
        focus: { row, col: columns.length - 1 },
      });
    } else if (type === 'column') {
      store.setSelection({
        type: 'colRange',
        anchor: { row: 0, col },
        focus: { row: store.getRowCount() - 1, col },
      });
    } else {
      store.setSelection({
        type: 'range',
        anchor: { row, col },
        focus: { row, col },
      });
    }
  };

  const handleDragMove = (row: number, col: number) => {
    if (!dragStateRef.current.isDragging) return;

    const selection = store.getSelection();
    if (!selection.anchor) return;

    if (dragStateRef.current.type === 'row') {
      store.setSelection({
        ...selection,
        focus: { row, col: columns.length - 1 },
      });
    } else if (dragStateRef.current.type === 'column') {
      store.setSelection({
        ...selection,
        focus: { row: store.getRowCount() - 1, col },
      });
    } else {
      store.setSelection({
        ...selection,
        focus: { row, col },
      });
    }
  };

  const handleDragEnd = () => {
    dragStateRef.current = { isDragging: false, type: null, start: null };
  };

  return {
    handleDragStart,
    handleDragMove,
    handleDragEnd,
  };
}

// ============================================
// MOUSE HANDLERS
// ============================================
export function createMouseHandlers(
  store: CellStore,
  columns: ColumnDef[],
  dragStateRef: React.MutableRefObject<DragState>,
  dragHandlers: ReturnType<typeof createDragHandlers>
) {
  const { handleDragStart, handleDragMove, handleDragEnd } = dragHandlers;

  const handleMouseDown = (e: React.MouseEvent) => {
    // Don't clear editing here - let blur/click-outside handlers save first.
    // The editor's blur handler calls onSave -> handleCellSave -> clearEditing,
    // ensuring the value is saved before the editing state is cleared.

    // A header press is the header's own business: it has just selected the
    // column (`handleColumnHeaderMouseDown`) and bubbles here next. Treating
    // it as "empty space" cleared that selection at once, so a header click
    // selected nothing.
    if ((e.target as HTMLElement).closest('th')) return;

    const cell = (e.target as HTMLElement).closest('td');
    if (!cell) {
      // Clicked on empty space inside table (below rows) - clear selection
      store.clearEditing();
      store.setSelection({ type: null, anchor: null, focus: null });
      return;
    }

    // If clicking inside the currently editing cell, let the editor handle it.
    // This preserves focus so the user can reposition the cursor, select text, etc.
    const editingCell = store.getEditingCell();
    if (editingCell) {
      const row = parseInt(cell.getAttribute('data-row') || '', 10);
      const col = parseInt(cell.getAttribute('data-col') || '', 10);
      if (row === editingCell.row && col === editingCell.col) {
        return;
      }
    }

    // Ignore clicks on action buttons
    if ((e.target as HTMLElement).closest('.hot-row-cancel-btn, .hot-row-save-btn')) {
      return;
    }

    // Ignore clicks on actions cell
    if (cell.getAttribute('data-actions-cell') === 'true') {
      return;
    }

    const isRowHeader = cell.getAttribute('data-row-header') === 'true';
    const row = parseInt(cell.getAttribute('data-row') || '', 10);

    if (isRowHeader && !isNaN(row)) {
      handleDragStart(row, 0, 'row');
      e.preventDefault();
      return;
    }

    const col = parseInt(cell.getAttribute('data-col') || '', 10);

    if (!isNaN(row) && !isNaN(col)) {
      handleDragStart(row, col, 'cell');
      e.preventDefault();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStateRef.current.isDragging) return;

    // Look for both td (body cells) and th (headers)
    const element = document.elementFromPoint(e.clientX, e.clientY);
    const cell = element?.closest('td');
    const header = element?.closest('th');

    // Handle column drag on headers (headers are <th>, not <td>)
    if (!cell && header && dragStateRef.current.type === 'column') {
      const col = parseInt(header.getAttribute('data-col') || '', 10);
      if (!isNaN(col)) {
        handleDragMove(0, col);
      }
      return;
    }

    if (!cell) return;

    if (cell.getAttribute('data-row-header') === 'true' && dragStateRef.current.type !== 'row') {
      return;
    }

    if (cell.getAttribute('data-actions-cell') === 'true') {
      return;
    }

    const row = parseInt(cell.getAttribute('data-row') || '', 10);
    const col = parseInt(cell.getAttribute('data-col') || '', 10);

    if (!isNaN(row) && !isNaN(col)) {
      handleDragMove(row, col);
    } else if (!isNaN(row) && dragStateRef.current.type === 'row') {
      handleDragMove(row, columns.length - 1);
    }
  };

  const handleMouseUp = () => {
    if (dragStateRef.current.isDragging) {
      handleDragEnd();
    }
  };

  /**
   * Open the inline editor for the double-clicked cell.
   *
   * ── Why this does not simply trust `e.target` (HEDGE-17) ──────────────────
   * The browser does not dispatch `dblclick` on the node you pressed. It
   * dispatches it on the nearest common ancestor of the second click's
   * mousedown node and its mouseup node. Hold the button and slide the pointer
   * out of the cell before releasing, and that ancestor climbs to `<tbody>` —
   * which has no `td`, so `closest('td')` returns null and every double-click
   * treated that way used to be dropped on the floor.
   *
   * That is not an exotic gesture. Rows are 32px tall at the default density
   * (28px at `dense`), so from the middle of a cell it takes **16px** of travel
   * while the button is held to cross into the next row. A hand on a physical
   * mouse does that routinely on a firm double-click; a two-finger tap on a
   * trackpad moves the cursor by nothing at all. That is the whole of the
   * reported "works on the touchpad, does not work on the mouse" asymmetry —
   * measured in `.ai/qa/hedge-17/` — and the reason it read as "double-click is
   * broken" to one user and "works for me" to the person next to her.
   *
   * The `dblclick` event itself always fired; only the cell lookup failed. So
   * the fix is to recover the cell, not to touch selection or drag behaviour:
   * when the target has been retargeted away from any cell, fall back to the
   * selection ANCHOR, which `handleMouseDown` → `handleDragStart` just wrote
   * from the press that started this very click. The anchor is the cell the
   * user pressed on — the one they aimed at — not the one they drifted into.
   *
   * Restricted to `type === 'range'`, which is what a cell press produces: a
   * row-header press writes `rowRange`, a column press `colRange`, and a click
   * on empty space clears the selection to `type: null`. Anything else declines
   * and behaves exactly as before, so the fallback can never invent an edit out
   * of a stale selection.
   */
  const handleDoubleClick = (e: React.MouseEvent) => {
    const cell = (e.target as HTMLElement).closest('td');

    let row: number;
    let col: number;

    if (cell) {
      if (cell.getAttribute('data-row-header') === 'true') return;
      if (cell.getAttribute('data-actions-cell') === 'true') return;

      row = parseInt(cell.getAttribute('data-row') || '', 10);
      col = parseInt(cell.getAttribute('data-col') || '', 10);
    } else {
      const { type, anchor } = store.getSelection();
      if (type !== 'range' || !anchor) return;

      row = anchor.row;
      col = anchor.col;
    }

    if (!isNaN(row) && !isNaN(col)) {
      const column = columns[col];
      if (!column?.readOnly) {
        store.setEditingCell(row, col);
      }
    }
  };

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleDoubleClick,
  };
}

// ============================================
// COLUMN HEADER HANDLERS
// ============================================
/**
 * @param sortState  A READ-ONLY projection of the table's sort rules. The handler
 *   never writes it — sort has a single owner (`sortRules`), and `onSortChange` is
 *   how the header hands its click to that owner. Passing a `setSortState` here
 *   was the second source of truth that left menu-sorted columns with no indicator.
 * @param onSortChange  Receives the column index and the NEXT direction in the
 *   Excel cycle (asc → desc → unsorted).
 */
export function createColumnHeaderHandlers(
  store: CellStore,
  columns: ColumnDef[],
  tableRef: React.RefObject<HTMLDivElement | null>,
  sortState: SortState,
  onSortChange: (colIndex: number, direction: 'asc' | 'desc' | null) => void,
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>,
  columnActions?: (column: ColumnDef, colIndex: number) => ContextMenuAction[]
) {
  const handleColumnSort = (colIndex: number) => {
    const col = columns[colIndex];
    let newDirection: 'asc' | 'desc' | null;

    if (sortState.columnIndex === colIndex) {
      if (sortState.direction === null) {
        newDirection = 'asc';
      } else if (sortState.direction === 'asc') {
        newDirection = 'desc';
      } else {
        newDirection = null;
      }
    } else {
      newDirection = 'asc';
    }

    onSortChange(colIndex, newDirection);

    dispatch<ColumnSortEvent>(tableRef.current as HTMLElement, TableEvents.COLUMN_SORT, {
      columnIndex: colIndex,
      columnName: col.data,
      direction: newDirection,
    });
  };

  const handleColumnHeaderDoubleClick = (e: React.MouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    if (!columnActions) return;

    const actions = columnActions(columns[colIndex], colIndex);

    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      actions,
      type: 'column',
      index: colIndex,
    });
  };

  const handleColumnHeaderMouseDown = (
    e: React.MouseEvent,
    onDragStart: (row: number, col: number, type: 'cell' | 'row' | 'column') => void
  ) => {
    const header = (e.target as HTMLElement).closest('th');
    if (!header || header.classList.contains('hot-row-header')) return;

    const col = parseInt(header.getAttribute('data-col') || '', 10);
    if (isNaN(col)) return;

    onDragStart(0, col, 'column');
    e.preventDefault();
  };

  return {
    handleColumnSort,
    handleColumnHeaderDoubleClick,
    handleColumnHeaderMouseDown,
  };
}

// ============================================
// ROW HEADER HANDLERS
// ============================================
export function createRowHeaderHandlers(
  store: CellStore,
  tableRef: React.RefObject<HTMLDivElement | null>,
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>,
  rowActions?: (rowData: any, rowIndex: number) => ContextMenuAction[]
) {
  const handleRowHeaderDoubleClick = (e: React.MouseEvent, rowIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    if (!rowActions) return;

    const rowData = store.getRowData(rowIndex);
    const actions = rowActions(rowData, rowIndex);

    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      actions,
      type: 'row',
      index: rowIndex,
    });
  };

  return {
    handleRowHeaderDoubleClick,
  };
}

// ============================================
// CONTEXT MENU HANDLERS
// ============================================
export function createContextMenuHandlers(
  store: CellStore,
  columns: ColumnDef[],
  tableRef: React.RefObject<HTMLDivElement | null>,
  contextMenu: ContextMenuState | null,
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>,
  onRowAction?: (actionId: string, rowData: any, rowIndex: number) => void
) {
  const handleContextMenuAction = (actionId: string) => {
    if (!contextMenu) return;

    if (contextMenu.type === 'column') {
      dispatch<ColumnContextMenuEvent>(
        tableRef.current as HTMLElement,
        TableEvents.COLUMN_CONTEXT_MENU_ACTION,
        {
          columnIndex: contextMenu.index!,
          columnName: columns[contextMenu.index!].data,
          actionId,
        }
      );
    } else if (contextMenu.type === 'row') {
      const rowData = store.getRowData(contextMenu.index!);
      dispatch<RowContextMenuEvent>(
        tableRef.current as HTMLElement,
        TableEvents.ROW_CONTEXT_MENU_ACTION,
        {
          rowIndex: contextMenu.index!,
          rowData,
          actionId,
        }
      );
      // Also invoke onRowAction directly so the kebab (•••) menu shares the same
      // handler as keyboard shortcuts. The dispatched event above is kept for
      // backward-compat with consumers that listen via ROW_CONTEXT_MENU_ACTION.
      onRowAction?.(actionId, rowData, contextMenu.index!);
    } else if (contextMenu.type === 'cell') {
      const rowData = store.getRowData(contextMenu.index!);
      dispatch<CellContextMenuEvent>(
        tableRef.current as HTMLElement,
        TableEvents.CELL_CONTEXT_MENU_ACTION,
        {
          rowIndex: contextMenu.index!,
          colIndex: contextMenu.colIndex!,
          rowData,
          col: columns[contextMenu.colIndex!],
          actionId,
        }
      );
    }

    setContextMenu(null);
  };

  const handleContextMenuClose = () => {
    setContextMenu(null);
  };

  return {
    handleContextMenuAction,
    handleContextMenuClose,
  };
}

// ============================================
// RESIZE HANDLERS
// ============================================
export function createResizeHandlers(
  store: CellStore,
  onResizeEnd?: (colIndex: number) => void,
) {
  let resizingCol: number | null = null;
  let startX = 0;
  let startWidth = 0;

  const handleResizeStart = (e: React.MouseEvent, colIndex: number) => {
    e.stopPropagation();
    e.preventDefault();

    resizingCol = colIndex;
    startX = e.clientX;
    startWidth = store.getColumnWidth(colIndex);

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (resizingCol === null) return;

    const diff = e.clientX - startX;
    const newWidth = Math.max(50, startWidth + diff);

    store.setColumnWidth(resizingCol, newWidth);
  };

  const handleResizeEnd = () => {
    const finishedCol = resizingCol;
    resizingCol = null;
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
    if (finishedCol !== null) onResizeEnd?.(finishedCol);
  };

  return {
    handleResizeStart,
  };
}

// ============================================
// FILTER HANDLERS
// ============================================
export interface FilterHandlersDeps {
  tableRef: React.RefObject<HTMLElement | null>;
  columns: ColumnDef[];
  filterRows: FilterRow[];
  setFilterRows: React.Dispatch<React.SetStateAction<FilterRow[]>>;
  setFilterExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setInternalActiveFilterId: React.Dispatch<React.SetStateAction<string | null>>;
  savedFilters: SavedFilter[];
  activeFilterId: string | null;
}

export function createFilterHandlers({
  tableRef,
  columns,
  filterRows,
  setFilterRows,
  setFilterExpanded,
  setInternalActiveFilterId,
  savedFilters,
  activeFilterId,
}: FilterHandlersDeps) {
  const handleToggleFilter = () => {
    setFilterExpanded((prev) => {
      const newExpanded = !prev;
      if (newExpanded && filterRows.length === 0) {
        setFilterRows([
          {
            id: `filter-${Date.now()}`,
            field: columns[0]?.data || '',
            operator: 'is_any_of',
            values: [],
          },
        ]);
      }
      return newExpanded;
    });
  };

  const handleClearFilters = () => {
    setFilterRows([]);
    setInternalActiveFilterId(null);
    dispatch<FilterSelectEvent>(
      tableRef.current as HTMLElement,
      TableEvents.FILTER_SELECT,
      { id: null, filterRows: [] }
    );
  };

  const handleSaveFilter = (name: string, color?: FilterColor) => {
    const newFilter: SavedFilter = {
      id: `filter-${Date.now()}`,
      name,
      rows: filterRows,
      color,
    };
    dispatch<FilterSaveEvent>(
      tableRef.current as HTMLElement,
      TableEvents.FILTER_SAVE,
      { filter: newFilter }
    );
    setInternalActiveFilterId(newFilter.id);
  };

  const handleFilterSelect = (id: string | null) => {
    setInternalActiveFilterId(id);
    if (id === null) {
      setFilterRows([]);
      dispatch<FilterSelectEvent>(
        tableRef.current as HTMLElement,
        TableEvents.FILTER_SELECT,
        { id: null, filterRows: [] }
      );
    } else {
      const filter = savedFilters.find((f) => f.id === id);
      if (filter) {
        setFilterRows(filter.rows);
        dispatch<FilterSelectEvent>(
          tableRef.current as HTMLElement,
          TableEvents.FILTER_SELECT,
          { id, filterRows: filter.rows }
        );
      }
    }
  };

  const handleFilterRename = (id: string, newName: string) => {
    dispatch<FilterRenameEvent>(
      tableRef.current as HTMLElement,
      TableEvents.FILTER_RENAME,
      { id, newName }
    );
  };

  const handleFilterDelete = (id: string) => {
    dispatch<FilterDeleteEvent>(
      tableRef.current as HTMLElement,
      TableEvents.FILTER_DELETE,
      { id }
    );
    if (activeFilterId === id) {
      setInternalActiveFilterId(null);
      setFilterRows([]);
    }
  };

  return {
    handleToggleFilter,
    handleClearFilters,
    handleSaveFilter,
    handleFilterSelect,
    handleFilterRename,
    handleFilterDelete,
  };
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
// Re-export perspective handlers
export * from './perspectiveHandlers';

