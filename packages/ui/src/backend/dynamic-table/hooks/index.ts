// hooks.ts

import React, { useCallback, useContext, useSyncExternalStore, createContext, useMemo } from 'react';
import { CellStore } from '../store/index';
import { CellState, ColumnDef, DragState, SelectionBounds, SelectionState, LoadFilterSuggestions, KeyboardShortcutsConfig, OnRowAction, RowActionShortcut } from '../types/index';
import { apiCall } from '../../utils/apiCall';
import { selectionToTsv } from '../utils/clipboard';

// ============================================
// CONTEXT
// ============================================
export const CellStoreContext = createContext<CellStore | null>(null);

export const useCellStore = (): CellStore => {
  const store = useContext(CellStoreContext);
  if (!store) {
    throw new Error('useCellStore must be used within CellStoreContext.Provider');
  }
  return store;
};

// ============================================
// STORE REVISION HOOK (triggers re-render on row add/remove)
// ============================================
export function useStoreRevision(): number {
  const store = useCellStore();

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribeToStore(onStoreChange),
    [store]
  );

  const getSnapshot = useCallback(() => store.getStoreRevision(), [store]);
  const getServerSnapshot = useCallback(() => 0, []); // Return default value for SSR

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ============================================
// CELL STATE HOOK
// ============================================
export function useCellState(row: number, col: number): CellState {
  const store = useCellStore();

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(row, col, onStoreChange),
    [store, row, col]
  );

  const getSnapshot = useCallback(() => store.getRevision(row, col), [store, row, col]);
  const getServerSnapshot = useCallback(() => 0, []); // Return default value for SSR

  // This triggers re-render when revision changes
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Return fresh state on each render
  return store.getCellState(row, col);
}

// ============================================
// SELECTION REVISION HOOK (triggers re-render on selection change)
// ============================================
export function useSelectionRevision(): number {
  const store = useCellStore();

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribeToSelection(onStoreChange),
    [store]
  );

  const getSnapshot = useCallback(() => store.getSelectionRevision(), [store]);
  const getServerSnapshot = useCallback(() => 0, []); // Return default value for SSR

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ============================================
// SELECTION HOOK (for components that need selection without cell subscription)
// ============================================
export function useSelection(): SelectionState {
  const store = useCellStore();
  // Subscribe to selection changes so component re-renders
  useSelectionRevision();
  return store.getSelection();
}

// ============================================
// ROW RANGE HOOK (per-row slice of the selection)
// ============================================
export type RowRangeState = 'none' | 'in' | 'top' | 'bottom' | 'top-bottom';

/**
 * Whether `row` is inside a row-range selection, and on which edge — as a
 * PRIMITIVE, so `useSyncExternalStore` bails out for every row whose answer
 * did not change. Subscribing rows to the whole selection (`useSelection`)
 * re-rendered every mounted row on every arrow key.
 */
export function useRowRangeState(row: number): RowRangeState {
  const store = useCellStore();
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribeToSelection(onStoreChange),
    [store]
  );
  const getSnapshot = useCallback((): RowRangeState => {
    const selection = store.getSelection();
    if (selection.type !== 'rowRange' || !selection.anchor || !selection.focus) return 'none';
    const lo = Math.min(selection.anchor.row, selection.focus.row);
    const hi = Math.max(selection.anchor.row, selection.focus.row);
    if (row < lo || row > hi) return 'none';
    if (row === lo && row === hi) return 'top-bottom';
    return row === lo ? 'top' : row === hi ? 'bottom' : 'in';
  }, [store, row]);
  const getServerSnapshot = useCallback((): RowRangeState => 'none', []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ============================================
// DRAG HANDLING HOOK
// ============================================
export function useDragHandling(
  store: CellStore,
  colCount: number
): {
  dragState: React.MutableRefObject<DragState>;
  handleDragStart: (row: number, col: number, type: 'cell' | 'row' | 'column') => void;
  handleDragMove: (row: number, col: number) => void;
  handleDragEnd: () => void;
} {
  const dragState = { current: { isDragging: false, type: null, start: null } as DragState };

  const handleDragStart = useCallback(
    (row: number, col: number, type: 'cell' | 'row' | 'column') => {
      dragState.current = {
        isDragging: true,
        type,
        start: { row, col },
      };

      if (type === 'row') {
        store.setSelection({
          type: 'rowRange',
          anchor: { row, col: 0 },
          focus: { row, col: colCount - 1 },
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
    },
    [store, colCount]
  );

  const handleDragMove = useCallback(
    (row: number, col: number) => {
      if (!dragState.current.isDragging || !dragState.current.start) return;

      const selection = store.getSelection();
      if (!selection.anchor) return;

      if (dragState.current.type === 'row') {
        store.setSelection({
          ...selection,
          focus: { row, col: colCount - 1 },
        });
      } else if (dragState.current.type === 'column') {
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
    },
    [store, colCount]
  );

  const handleDragEnd = useCallback(() => {
    dragState.current = { isDragging: false, type: null, start: null };
  }, []);

  return {
    dragState,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
  };
}

// ============================================
// CELL EDITABILITY HELPER
// ============================================

/**
 * Determines if a cell is editable based on column configuration.
 * Used by keyboard navigation to skip read-only cells.
 */
function isEditableCell(column: ColumnDef | undefined): boolean {
  if (!column) return false;
  if (column.readOnly === true) return false;
  return true;
}

/**
 * Will an editor actually MOUNT for this column?
 *
 * This is the precondition for `setEditingCell`, and it is deliberately not the
 * same question as `isEditableCell`: `getCellEditor` (components/editors.tsx)
 * lets a custom `col.editor` win over `readOnly`, and returns `null` for a
 * read-only column without one.
 *
 * Opening an edit session that mounts no editor is a SOFT LOCK, not a cosmetic
 * bug: `Cell` renders the editor branch and so paints nothing (the cell goes
 * blank), while the store now reports an editing cell — which makes every arrow
 * key fall through the `!editing` guard below and do nothing. The user is stuck
 * on an invisible cell with no way out but Escape. Ledger row 1.27.
 */
export function columnMountsEditor(column: ColumnDef | undefined): boolean {
  if (!column) return false;
  if (typeof column.editor === 'function') return true;
  return column.readOnly !== true;
}

// ============================================
// ARROW-KEY GEOMETRY
// ============================================

export type CellCoord = { row: number; col: number };

const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** Unit step for an arrow key. */
function arrowDelta(key: string): { dRow: number; dCol: number } {
  switch (key) {
    case 'ArrowUp': return { dRow: -1, dCol: 0 };
    case 'ArrowDown': return { dRow: 1, dCol: 0 };
    case 'ArrowLeft': return { dRow: 0, dCol: -1 };
    default: return { dRow: 0, dCol: 1 };
  }
}

function isBlankValue(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * Excel's `Ctrl`+Arrow target: the edge of the current data block.
 *
 * - Neighbour has data → land on the LAST cell before the next blank.
 * - Neighbour is blank → skip the blank run and land on the FIRST cell with data.
 * - Either way, stop at the table edge.
 *
 * Pure index arithmetic over `store.getCellValue(row, col)` — which is a
 * projection off the row objects, so this answers for columns that are not
 * mounted (column virtualization is live on `/backend/invoicing`). It never
 * queries the DOM, per the range-operation contract.
 */
export function findDataEdge(
  store: Pick<CellStore, 'getCellValue' | 'getRowCount'>,
  from: CellCoord,
  colCount: number,
  key: string,
): CellCoord {
  const { dRow, dCol } = arrowDelta(key);
  const rowCount = store.getRowCount();
  const inside = (r: number, c: number) => r >= 0 && r < rowCount && c >= 0 && c < colCount;
  const blank = (r: number, c: number) => isBlankValue(store.getCellValue(r, c));

  let { row, col } = from;
  if (!inside(row + dRow, col + dCol)) return { row, col };

  const crossingBlankRun = blank(row + dRow, col + dCol);
  row += dRow;
  col += dCol;

  while (inside(row + dRow, col + dCol)) {
    if (crossingBlankRun ? !blank(row, col) : blank(row + dRow, col + dCol)) break;
    row += dRow;
    col += dCol;
  }
  return { row, col };
}

/** One clamped step from `from` in the arrow's direction. */
function stepOne(from: CellCoord, rowCount: number, colCount: number, key: string): CellCoord {
  const { dRow, dCol } = arrowDelta(key);
  return {
    row: Math.min(rowCount - 1, Math.max(0, from.row + dRow)),
    col: Math.min(colCount - 1, Math.max(0, from.col + dCol)),
  };
}

// ============================================
// KEYBOARD NAVIGATION HOOK
// ============================================
export function useKeyboardNavigation(
  store: CellStore,
  colCount: number,
  columns: ColumnDef[],
  autoEditOnTab: boolean = true,
  // Note: onSave parameter kept for backwards compatibility but editors now save before navigation
  _onSave?: (row: number, col: number, value: any) => void,
  siblingTableRefs?: {
    prev?: React.RefObject<HTMLDivElement | null>;
    next?: React.RefObject<HTMLDivElement | null>;
  }
) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Note: This handler should be attached to the table element (not document)
      // so it only receives events from within the table

      const editing = store.getEditingCell();
      const bounds = store.getSelectionBounds();

      // Enter navigation - when editing, move down (Excel-like behavior)
      // Note: Editors save the value before the event bubbles here
      if (e.key === 'Enter' && !e.shiftKey && editing) {
        e.preventDefault();

        const currentRow = editing.row;
        const currentCol = editing.col;

        // Move to next row (down), same column
        const nextRow = currentRow + 1;

        if (nextRow < store.getRowCount()) {
          store.clearEditing();
          store.setSelection({
            type: 'range',
            anchor: { row: nextRow, col: currentCol },
            focus: { row: nextRow, col: currentCol },
          });
          store.setEditingCell(nextRow, currentCol);
        } else {
          // At the last row, clear editing and restore focus to the table
          // container so subsequent Tab/Arrow keys still reach this handler.
          store.clearEditing();
          store.focusTable();
        }
        return;
      }

      // Enter to start editing (when not already editing)
      // Note: Shift+Enter is reserved for row-action shortcuts (e.g., open detail view)
      if (e.key === 'Enter' && !e.shiftKey && !editing && bounds) {
        if (bounds.startRow === bounds.endRow && bounds.startCol === bounds.endCol) {
          e.preventDefault();
          // A column that mounts no editor is a NO-OP, never an edit session.
          // Without this guard the store reports an editing cell that renders
          // nothing, the cell goes blank and every arrow key below is swallowed
          // by the `!editing` guard — the grid soft-locks. Ledger row 1.27.
          // The user-facing "this column is read-only" hint is raised one rung
          // up, in `DynamicTable`, which owns `flash` and the translations.
          if (!columnMountsEditor(columns[bounds.startCol])) return;
          store.setEditingCell(bounds.startRow, bounds.startCol);
          return;
        }
      }

      // Escape: two-step behavior
      // 1st Escape while editing: exit edit mode without saving, keep cell selected
      // 2nd Escape (cell selected, not editing): clear selection, keep table focused
      // 3rd Escape (no selection, no editing): do nothing — let the event bubble
      //     to parent handlers (e.g., drawer close)
      if (e.key === 'Escape') {
        if (editing) {
          e.preventDefault();
          store.clearEditing();
        } else if (bounds) {
          e.preventDefault();
          store.setSelection({ type: null, anchor: null, focus: null });
        }
        // If neither editing nor selection, don't preventDefault —
        // let the event propagate so the parent (drawer) can handle it.
        return;
      }

      // Tab navigation - move to next/prev editable cell, skipping read-only columns
      // Wraps across rows. When no editable cell remains in the table,
      // clears state and lets native Tab move focus to the next focusable element.
      // Note: Editors save the value before the event bubbles here
      if (e.key === 'Tab') {
        const direction = e.shiftKey ? -1 : 1;
        let currentRow: number;
        let currentCol: number;

        if (editing) {
          currentRow = editing.row;
          currentCol = editing.col;
        } else if (bounds && bounds.startRow === bounds.endRow && bounds.startCol === bounds.endCol) {
          currentRow = bounds.startRow;
          currentCol = bounds.startCol;
        } else {
          // No selection yet — seed position so the search loop finds the
          // first editable cell (forward Tab) or last editable cell (Shift+Tab).
          // For forward: start at (0, -1) so +1 direction lands on col 0, row 0.
          // For backward: start at (lastRow, colCount) so -1 lands on last col, last row.
          const rowCount = store.getRowCount();
          if (rowCount === 0) return;
          currentRow = direction === 1 ? 0 : rowCount - 1;
          currentCol = direction === 1 ? -1 : colCount;
        }

        const rowCount = store.getRowCount();
        const totalCells = rowCount * colCount;
        let nextCol = currentCol + direction;
        let nextRow = currentRow;
        let checked = 0;

        // Wrap column and row boundaries
        if (nextCol >= colCount) {
          nextCol = 0;
          nextRow++;
        } else if (nextCol < 0) {
          nextCol = colCount - 1;
          nextRow--;
        }

        // Search for the next editable cell, wrapping across rows
        while (checked < totalCells) {
          if (nextRow < 0 || nextRow >= rowCount) break;

          if (isEditableCell(columns[nextCol])) {
            e.preventDefault();
            store.clearEditing();
            store.setSelection({
              type: 'range',
              anchor: { row: nextRow, col: nextCol },
              focus: { row: nextRow, col: nextCol },
            });
            if (autoEditOnTab) {
              store.setEditingCell(nextRow, nextCol);
            }
            return;
          }

          // Move to next candidate
          nextCol += direction;
          if (nextCol >= colCount) {
            nextCol = 0;
            nextRow++;
          } else if (nextCol < 0) {
            nextCol = colCount - 1;
            nextRow--;
          }
          checked++;
        }

        // No editable cell found forward/backward in this table.
        // Before trapping Tab, check if a sibling table exists in the
        // Tab direction so the user can navigate across stacked tables.
        const siblingRef = direction === 1
          ? siblingTableRefs?.next?.current
          : siblingTableRefs?.prev?.current;

        if (siblingRef) {
          e.preventDefault();
          store.clearEditing();
          store.setSelection({ type: null, anchor: null, focus: null });
          siblingRef.setAttribute('data-focus-direction', direction === 1 ? 'down' : 'up');
          siblingRef.setAttribute('data-focus-trigger', 'tab');
          siblingRef.focus();
          return;
        }

        // No sibling table — fall back to existing behaviour:
        // trap Tab for non-empty tables, let native Tab escape for empty ones.
        if (store.getRowCount() > 0) {
          e.preventDefault();
          if (!bounds) {
            const targetRow = direction === 1 ? 0 : store.getRowCount() - 1;
            store.setSelection({
              type: 'range',
              anchor: { row: targetRow, col: 0 },
              focus: { row: targetRow, col: 0 },
            });
          }
          return;
        }
        if (editing) {
          store.clearEditing();
        }
        store.setSelection({ type: null, anchor: null, focus: null });
        return;
      }

      // Arrow navigation (only when not editing)
      // Arrows move to the adjacent cell (including read-only cells).
      // Read-only skipping only applies to Tab navigation.
      // ArrowUp at first row / ArrowDown at last row can move to sibling tables.
      //
      // Modifiers, Excel-exact:
      //   Arrow             move one cell and RESET the anchor
      //   Shift+Arrow       EXTEND the range from the stable anchor
      //   Ctrl/Cmd+Arrow    move to the edge of the data block
      //   Ctrl/Cmd+Shift+Arrow   extend to the edge of the data block
      if (!editing && ARROW_KEYS.includes(e.key)) {
        e.preventDefault();

        const rowCount = store.getRowCount();
        if (rowCount === 0) return;

        const selection = store.getSelection();
        const jumpToEdge = e.ctrlKey || e.metaKey;

        // Seeded when there is nothing to move or extend from. ArrowDown/Right
        // seed the first cell, ArrowUp/Left the last — including for Shift,
        // whose first press then has an anchor for the second to grow from.
        const seedSelection = () => {
          const isForward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
          const targetRow = isForward ? 0 : rowCount - 1;
          const targetCol = isForward ? 0 : colCount - 1;
          store.setSelection({
            type: 'range',
            anchor: { row: targetRow, col: targetCol },
            focus: { row: targetRow, col: targetCol },
          });
        };

        // ---- Shift+Arrow: grow or shrink against the anchor ----
        // The anchor NEVER moves here; only the focus does, so pressing
        // Shift+Down four times then Shift+Up twice leaves a 3-row range —
        // extension is reversible, which "move the whole selection" is not.
        if (e.shiftKey) {
          const { anchor, focus } = selection;
          if (!anchor || !focus) {
            seedSelection();
            return;
          }
          const next = jumpToEdge
            ? findDataEdge(store, focus, colCount, e.key)
            : stepOne(focus, rowCount, colCount, e.key);
          if (next.row === focus.row && next.col === focus.col) return;
          store.setSelection({
            // Row/column-header selections keep their shape while extending:
            // `calcBounds` pins the other axis for those types, so a rowRange
            // extended by Shift+Down stays a set of whole rows.
            type: selection.type === 'rowRange' || selection.type === 'colRange'
              ? selection.type
              : 'range',
            anchor,
            focus: next,
          });
          return;
        }

        if (!bounds) {
          seedSelection();
          return;
        }

        // The cursor is the FOCUS, not the top-left: after Shift+Down×3 a plain
        // ArrowDown must continue from where the extension ended, not jump back
        // to the anchor. For whole-row/column selections the pinned axis has no
        // meaningful focus, so it collapses onto the bounds' start instead.
        const currentRow = Math.min(rowCount - 1, Math.max(0,
          selection.type === 'colRange' ? bounds.startRow : (selection.focus?.row ?? bounds.startRow)));
        const currentCol = Math.min(colCount - 1, Math.max(0,
          selection.type === 'rowRange' ? bounds.startCol : (selection.focus?.col ?? bounds.startCol)));
        const isRange = bounds.startRow !== bounds.endRow || bounds.startCol !== bounds.endCol;
        let nextRow = currentRow;
        let nextCol = currentCol;

        if (jumpToEdge) {
          const edge = findDataEdge(store, { row: currentRow, col: currentCol }, colCount, e.key);
          nextRow = edge.row;
          nextCol = edge.col;
        } else if (e.key === 'ArrowLeft') {
          nextCol = Math.max(0, currentCol - 1);
        } else if (e.key === 'ArrowRight') {
          nextCol = Math.min(colCount - 1, currentCol + 1);
        } else if (e.key === 'ArrowUp') {
          if (currentRow === 0 && siblingTableRefs?.prev?.current) {
            // At first row — move to previous sibling table (select last row)
            store.setSelection({ type: null, anchor: null, focus: null });
            const target = siblingTableRefs.prev.current;
            target.setAttribute('data-focus-direction', 'up');
            target.focus();
            return;
          }
          nextRow = Math.max(0, currentRow - 1);
        } else {
          if (currentRow === rowCount - 1 && siblingTableRefs?.next?.current) {
            // At last row — move to next sibling table (select first row)
            store.setSelection({ type: null, anchor: null, focus: null });
            const target = siblingTableRefs.next.current;
            target.setAttribute('data-focus-direction', 'down');
            target.focus();
            return;
          }
          nextRow = Math.min(rowCount - 1, currentRow + 1);
        }

        // Write when the position changed OR when a range has to collapse —
        // a plain arrow always ends with exactly one cell selected.
        if (isRange || nextRow !== currentRow || nextCol !== currentCol) {
          store.setSelection({
            type: 'range',
            anchor: { row: nextRow, col: nextCol },
            focus: { row: nextRow, col: nextCol },
          });
        }
      }
    },
    [store, colCount, columns, autoEditOnTab, siblingTableRefs]
  );

  return handleKeyDown;
}

// ============================================
// COPY HANDLER HOOK
// ============================================
export interface CopyHandlerOptions {
  /**
   * Fallback text to copy when there is NO cell-range selection — e.g. when only
   * checkbox row-selection is active. Return `null`/`''` to copy nothing.
   */
  getFallbackText?: () => string | null;
  /**
   * Called after a successful copy (cell-range OR fallback) — e.g. to flash.
   *
   * Receives the copied RECTANGLE, or `null` when the copy came from the
   * checkbox-row fallback and therefore has no cell range. The marching-ants
   * marker needs it: it can only be drawn around a rectangle, and it must not
   * be invented for a row selection that has none.
   */
  onCopy?: (bounds: SelectionBounds | null) => void;
}

export function useCopyHandler(
  store: CellStore,
  tableRef?: React.RefObject<HTMLDivElement | null>,
  options?: CopyHandlerOptions
) {
  const { getFallbackText, onCopy } = options ?? {};
  const handleCopy = useCallback(
    (e: ClipboardEvent) => {
      // Only intercept copy if the event target is inside this table
      // This allows text selection in drawers/dialogs to work normally
      if (tableRef?.current && e.target instanceof Node) {
        if (!tableRef.current.contains(e.target)) {
          return;
        }
      }

      let text: string | null = null;
      const cells = store.getCellsInSelection();
      const bounds = store.getSelectionBounds();
      const copiedRect = cells.length > 0 && bounds ? bounds : null;

      if (cells.length > 0 && bounds) {
        // Cell-range selection → TSV block, through THE shared serializer so
        // Ctrl+C and Ctrl+X can never disagree about what was on the clipboard.
        text = selectionToTsv(cells, bounds);
      } else {
        // No cell-range → fall back to checkbox row-selection (if provided).
        text = getFallbackText?.() ?? null;
      }

      if (text == null || text === '') return;

      if (e.clipboardData) {
        e.clipboardData.setData('text/plain', text);
        e.preventDefault();
        onCopy?.(copiedRect);
      }
    },
    [store, tableRef, getFallbackText, onCopy]
  );

  return handleCopy;
}

// ============================================
// STICKY OFFSETS HOOK
// ============================================
/**
 * Rendered width of the row-header (checkbox) column. The header/body cells
 * declare an inline `width: 50`, but the v2 theme's
 * `.hot-container .hot-row-header { max-width: 32px }` clamps the actual box to
 * 32px — so sticky-left offsets (frozen columns, pinned columns) MUST start at
 * 32, not 50. Mismatching this leaves an 18px gap to the left of the first
 * pinned column.
 */
/**
 * Rendered width of the row-header (checkbox) gutter — `RowHeaderCell` and the
 * header's corner cell are both 50px. Every piece of geometry that has to agree
 * with the painted gutter reads this: sticky/frozen column offsets, the column
 * virtualizer's leading width, and the row width. It used to be 32 while the
 * cells painted 50, so frozen columns slid 18px under the checkboxes and a
 * keyboard reveal stopped 18px short of the right edge.
 */
export const ROW_HEADER_WIDTH = 50;

export function useStickyOffsets(
  columns: { sticky?: 'left' | 'right'; width?: number }[],
  store: CellStore,
  rowHeaders: boolean
): StickyOffsets {
  // Widths live in the store, so a resize is observed through the store
  // revision rather than by recomputing on every render. Memoising matters:
  // these two arrays are passed straight into every `VirtualRow`, and a fresh
  // array identity per render defeats the row's `React.memo` on its own —
  // before any handler prop gets a chance to (anchor Defect 5).
  const widthRevision = store.getStoreRevision();
  return useMemo(
    () => computeStickyOffsets(columns, store, rowHeaders),
    // `widthRevision` is the store-width dependency; it is read, not called.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, store, rowHeaders, widthRevision],
  );
}

export interface StickyOffsets {
  leftOffsets: (number | undefined)[];
  rightOffsets: (number | undefined)[];
}

/**
 * Pure sticky-offset arithmetic. Widths come from the STORE (not from the
 * column objects handed in), which is what makes a manual resize move the
 * pinned columns with it. Walks EVERY column — offsets for a pinned column are
 * relative to all its predecessors, so this must never be narrowed to a
 * virtualization window.
 */
export function computeStickyOffsets(
  columns: { sticky?: 'left' | 'right'; width?: number }[],
  store: CellStore,
  rowHeaders: boolean,
): StickyOffsets {
  const leftOffsets: (number | undefined)[] = [];
  const rightOffsets: (number | undefined)[] = [];

  let leftOffset = rowHeaders ? ROW_HEADER_WIDTH : 0;
  let rightOffset = 0;

  // Calculate left sticky offsets
  columns.forEach((col, index) => {
    const colWidth = store.getColumnWidth(index);

    if (col.sticky === 'left') {
      leftOffsets[index] = leftOffset;
      leftOffset += colWidth;
    } else {
      leftOffsets[index] = undefined;
    }
  });

  // Calculate right sticky offsets (need to go backwards)
  const rightStickyCols: { index: number; width: number }[] = [];
  columns.forEach((col, index) => {
    if (col.sticky === 'right') {
      rightStickyCols.push({ index, width: store.getColumnWidth(index) });
    }
  });

  rightStickyCols.reverse().forEach(({ index, width }) => {
    rightOffsets[index] = rightOffset;
    rightOffset += width;
  });

  // Fill undefined for non-sticky columns
  columns.forEach((col, index) => {
    if (col.sticky !== 'right') {
      rightOffsets[index] = undefined;
    }
  });

  return { leftOffsets, rightOffsets };
}

// ============================================
// ROW ACTION SHORTCUTS HOOK
// ============================================

/**
 * Checks if a keyboard event matches a shortcut definition.
 */
function matchesShortcut(event: KeyboardEvent, shortcut: RowActionShortcut): boolean {
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) return false;

  const needsCtrlOrCmd = shortcut.ctrlOrCmd ?? false;
  const hasCtrlOrCmd = event.ctrlKey || event.metaKey;
  if (needsCtrlOrCmd !== hasCtrlOrCmd) return false;

  const needsShift = shortcut.shift ?? false;
  if (needsShift !== event.shiftKey) return false;

  const needsAlt = shortcut.alt ?? false;
  if (needsAlt !== event.altKey) return false;

  return true;
}

/**
 * Hook that returns a keydown handler for row-level keyboard shortcuts.
 * Shortcuts only fire when:
 * - A single cell is selected (not a range)
 * - Not currently editing a cell
 * - Not holding unexpected modifiers
 *
 * @returns A handler that should be called from the table's keydown handler.
 *          Returns true if a shortcut matched (caller should stop further processing).
 */
export function useRowActionShortcuts(
  store: CellStore,
  shortcuts?: KeyboardShortcutsConfig,
  onRowAction?: OnRowAction
) {
  const handleShortcut = useCallback(
    (event: KeyboardEvent): boolean => {
      if (!shortcuts?.rowActions?.length || !onRowAction) return false;

      // Only fire when not editing
      if (store.getEditingCell()) return false;

      // Only fire with a single-cell selection
      const bounds = store.getSelectionBounds();
      if (!bounds) return false;
      if (bounds.startRow !== bounds.endRow || bounds.startCol !== bounds.endCol) return false;

      const rowIndex = bounds.startRow;

      for (const shortcut of shortcuts.rowActions) {
        if (matchesShortcut(event, shortcut)) {
          event.preventDefault();
          const rowData = store.getRowData(rowIndex);
          onRowAction(shortcut.id, rowData, rowIndex);
          return true;
        }
      }

      return false;
    },
    [store, shortcuts, onRowAction]
  );

  return handleShortcut;
}

// ============================================
// FILTER SUGGESTIONS HOOK
// ============================================

export interface UseFilterSuggestionsOptions {
  /**
   * The entity type to fetch suggestions for.
   * Must be a valid entity ID (e.g., 'catalog:products', 'customers:people')
   */
  entityType: string;
  /**
   * Whether the hook is enabled. When false, returns undefined.
   * Useful for conditionally enabling server-side suggestions.
   * @default true
   */
  enabled?: boolean;
}

/**
 * Hook that returns a LoadFilterSuggestions function for use with DynamicTable.
 * Fetches filter suggestions from the server API for large datasets.
 *
 * @example
 * ```tsx
 * function ProductsTable() {
 *   const loadFilterSuggestions = useFilterSuggestions({
 *     entityType: 'catalog:products'
 *   });
 *
 *   return (
 *     <DynamicTable
 *       // ... other props
 *       loadFilterSuggestions={loadFilterSuggestions}
 *     />
 *   );
 * }
 * ```
 */
export function useFilterSuggestions(
  options: UseFilterSuggestionsOptions
): LoadFilterSuggestions | undefined {
  const { entityType, enabled = true } = options;

  const loadSuggestions = useMemo<LoadFilterSuggestions | undefined>(() => {
    if (!enabled || !entityType) return undefined;

    return async (field: string, query: string): Promise<string[]> => {
      try {
        const params = new URLSearchParams({
          entityId: entityType,
          field,
          query: query || '',
        });

        const result = await apiCall<{ items: string[] }>(
          `/api/entities/filter-suggestions?${params.toString()}`,
          { credentials: 'include' }
        );

        if (!result.ok || !result.result) {
          return [];
        }

        return result.result.items ?? [];
      } catch (error) {
        console.error('[useFilterSuggestions] Failed to fetch suggestions:', error);
        return [];
      }
    };
  }, [entityType, enabled]);

  return loadSuggestions;
}
