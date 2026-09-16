// store.ts

import type React from 'react';
import {
  CellId,
  SelectionState,
  SelectionBounds,
  CellState,
  SaveStateType,
  CellSubscriber,
  ColumnDef,
  RangeEdges,
  FillPreview,
  ClipboardMarker,
  UndoCellChange,
  UndoEntry,
} from '../types/index';

export interface CellStore {
  // --- Reads (imperative, no subscription) ---
  /**
   * THE single cell-value read. A pure projection of the row object:
   * `getRowData(row)?.[currentColumns[col].data]` — exactly what `Cell.tsx`
   * renders. There is deliberately no second value map: a column-indexed cache
   * cannot survive a perspective reorder or a show/hide (`setColumns` re-keys
   * widths but could never re-key a stale value map correctly), which is how
   * copy and export used to disagree with the screen. Never reintroduce one.
   */
  getCellValue(row: number, col: number): any;
  getRowData(row: number): any;
  getRowCount(): number;
  getSelection(): SelectionState;
  getSelectionBounds(): SelectionBounds | null;
  getFillPreview(): FillPreview | null;
  /**
   * In-grid Find & Replace state. Lives HERE, not in React state: `Cell` is
   * memo'd and subscribes per cell, so routing match state through a parent
   * would repaint every mounted row on every keystroke.
   */
  /** The marching-ants rectangle, or `null` when nothing is marked. */
  getClipboardMarker(): ClipboardMarker | null;
  getEditingCell(): { row: number; col: number } | null;
  getSaveState(row: number, col: number): SaveStateType;
  isNewRow(row: number): boolean;
  hasNewRows(): boolean;
  /**
   * The column's PAINTED width: its declared width plus any fill-to-container
   * surplus assigned by `setColumnStretch`. Every render site (cells, headers,
   * spacers, the column virtualizer's geometry) reads this one number, which is
   * what keeps a virtualization spacer honest while the table fills its
   * container.
   */
  getColumnWidth(col: number): number;
  /**
   * The column's DECLARED width — what the column definition asked for, or what
   * the user last dragged it to. Never includes the fill surplus.
   *
   * Read by everything that must not feed the fill back into itself:
   * persistence (a stretched width must never be saved as a user preference),
   * badge auto-fit (it grows the declared width), and the fill computation itself.
   */
  getBaseColumnWidth(col: number): number;
  getColumnWidths(): Map<number, number>;
  /**
   * Assign the surplus that fills the container, in resolved PIXELS, keyed by
   * column index. Replaces the previous assignment wholesale; an empty map
   * clears it. No-ops (and notifies nobody) when nothing actually moved, which
   * is what stops the measure → apply → measure loop.
   */
  setColumnStretch(next: Map<number, number>): void;
  getStoreRevision(): number;
  getSelectionRevision(): number;

  // Derived for cell rendering
  getCellState(row: number, col: number): CellState;

  // For copy/paste operations
  getCellsInSelection(): { row: number; col: number; value: any }[];
  /**
   * Every cell of an arbitrary rectangle, row-major. `getCellsInSelection()`
   * delegates to this; fill reads its source block through it, and paste needs
   * the identical walk. Addressing is by INDEX into the full column array — a
   * column that is scrolled out of the virtualization window is still a column.
   */
  getCellsInRect(bounds: SelectionBounds): { row: number; col: number; value: any }[];

  // --- Writes (trigger revisions) ---
  setCellValue(row: number, col: number, value: any): void;
  setRowData(row: number, data: any): void;
  setSelection(selection: SelectionState): void;
  setFillPreview(preview: FillPreview | null): void;
  /** Replace the finder's state, repainting only the cells whose match status changed. */
  /**
   * Mark (or unmark) what is on the clipboard — Excel's marching ants.
   * Repaints the UNION of the old and the new rectangle, nothing else.
   */
  setClipboardMarker(marker: ClipboardMarker | null): void;
  setEditingCell(row: number, col: number): void;
  clearEditing(): void;
  /**
   * The cell under the pointer, or `null` on leaving the grid. Repaints only
   * the cell left and the cell entered — never the row, never the table.
   */
  setHoveredCell(cell: { row: number; col: number } | null): void;
  setSaveState(row: number, col: number, state: SaveStateType): void;
  setColumnWidth(col: number, width: number): void;

  // Bulk data operations
  setData(data: any[]): void;
  setColumns(columns: ColumnDef[]): void;
  reinitColumnWidths(): void;
  addRow(rowData: any, atIndex?: number): void;
  removeRow(rowIndex: number): void;
  markRowAsNew(rowIndex: number, isNew: boolean): void;
  markRowAsSaved(rowIndex: number, savedData: any): void;

  // --- Subscriptions ---
  subscribe(row: number, col: number, callback: CellSubscriber): () => void;
  subscribeToStore(callback: CellSubscriber): () => void;
  subscribeToSelection(callback: CellSubscriber): () => void;
  /**
   * Fires when the EDITING CELL moves (opened, moved, closed) — and nothing
   * else. Deliberately separate from the selection channel: `setEditingCell`
   * bumps only the two affected cells' revisions, so a selection subscriber
   * cannot see it, and widening `setEditingCell` to bump the selection revision
   * would re-render every mounted row on every edit start.
   *
   * Column virtualization is the reason this exists: the edited column is
   * force-mounted, so the grid has to learn that it moved.
   */
  subscribeToEditing(callback: CellSubscriber): () => void;
  getRevision(row: number, col: number): number;

  // --- Table container focus management ---
  setTableRef(ref: React.RefObject<HTMLDivElement | null>): void;
  focusTable(): void;
  blurTable(): void;

  // --- Undo / redo ---
  /** Record one cell mutation. No-op while suppressed (during replay). */
  recordCellChange(change: UndoCellChange): void;
  /** Open a group so subsequent recorded changes coalesce into one entry. */
  beginUndoGroup(): void;
  /** Close the open group, pushing it as a single entry if it has changes. */
  endUndoGroup(): void;
  popUndo(): UndoEntry | null;
  popRedo(): UndoEntry | null;
  pushUndo(entry: UndoEntry): void;
  pushRedo(entry: UndoEntry): void;
  canUndo(): boolean;
  canRedo(): boolean;
  setUndoSuppressed(suppressed: boolean): void;
  /** Resolve a stable row id to its current row index, or -1 if not present. */
  findRowIndexById(idColumnName: string, id: any): number;

  // --- Internal ---
  bumpRevision(row: number, col: number): void;
  bumpRevisions(cells: Array<{ row: number; col: number }>): void;
  bumpRowRevisions(row: number, colCount: number): void;
  bumpStoreRevision(): void;
}

export function createCellStore(initialData: any[], columns: ColumnDef[]): CellStore {
  // Internal state.
  // `rowDataMap` is the ONE value source. Everything else here is metadata
  // (revisions, save states, widths, new-row flags) keyed by position.
  const rowDataMap = new Map<number, any>();
  const revisions = new Map<CellId, number>();
  const subscribers = new Map<CellId, Set<CellSubscriber>>();
  const saveStates = new Map<CellId, SaveStateType>();
  const newRowFlags = new Set<number>();
  const columnWidths = new Map<number, number>();
  // Fill-to-container surplus, in pixels, per column index. Held SEPARATELY
  // from the declared widths so a user's own drag, a persisted width and a
  // badge auto-fit are never overwritten by the fill — and so the fill can be
  // recomputed from scratch on every container resize instead of accumulating.
  const columnStretch = new Map<number, number>();
  const storeSubscribers = new Set<CellSubscriber>();

  // Mutable columns reference - updated when column order/visibility changes
  let currentColumns = columns;

  let selection: SelectionState = { type: null, anchor: null, focus: null };
  let fillPreview: FillPreview | null = null;
  // Excel's marching ants. Deliberately NOT derived from the selection: it has
  // to outlive the cursor moving away, which is the entire point of it.
  let clipboardMarker: ClipboardMarker | null = null;
  let editingCell: { row: number; col: number } | null = null;
  // Pointer position in CELL space. See `setHoveredCell` for why this is not
  // React state.
  let hoveredCell: { row: number; col: number } | null = null;

  // Undo / redo: stacks of entries (one inline edit, or one whole fill).
  const UNDO_LIMIT = 100;
  const undoStack: UndoEntry[] = [];
  const redoStack: UndoEntry[] = [];
  let undoGroup: UndoCellChange[] | null = null;
  let suppressUndo = false;
  let rowCount = initialData.length;
  let storeRevision = 0;
  let selectionRevision = 0;
  const selectionSubscribers = new Set<CellSubscriber>();
  const editingSubscribers = new Set<CellSubscriber>();
  let tableRef: React.RefObject<HTMLDivElement | null> | null = null;

  // Cache, invalidated on selection change
  let boundsCache: SelectionBounds | null = null;

  const getCellId = (row: number, col: number): CellId => `${row}:${col}`;

  const calcBounds = (): SelectionBounds | null => {
    if (!selection.anchor || !selection.focus) return null;

    if (selection.type === 'rowRange') {
      return {
        startRow: Math.min(selection.anchor.row, selection.focus.row),
        endRow: Math.max(selection.anchor.row, selection.focus.row),
        startCol: 0,
        endCol: currentColumns.length - 1,
      };
    }

    if (selection.type === 'colRange') {
      return {
        startRow: 0,
        endRow: rowCount - 1,
        startCol: Math.min(selection.anchor.col, selection.focus.col),
        endCol: Math.max(selection.anchor.col, selection.focus.col),
      };
    }

    return {
      startRow: Math.min(selection.anchor.row, selection.focus.row),
      endRow: Math.max(selection.anchor.row, selection.focus.row),
      startCol: Math.min(selection.anchor.col, selection.focus.col),
      endCol: Math.max(selection.anchor.col, selection.focus.col),
    };
  };

  const notify = (row: number, col: number) => {
    const id = getCellId(row, col);
    const subs = subscribers.get(id);
    if (subs) {
      subs.forEach((cb) => cb());
    }
  };

  const bumpRevision = (row: number, col: number) => {
    const id = getCellId(row, col);
    revisions.set(id, (revisions.get(id) ?? 0) + 1);
    notify(row, col);
  };

  const bumpRevisions = (cells: Array<{ row: number; col: number }>) => {
    // First bump all revisions
    cells.forEach(({ row, col }) => {
      const id = getCellId(row, col);
      revisions.set(id, (revisions.get(id) ?? 0) + 1);
    });
    // Then notify all (batch notifications)
    cells.forEach(({ row, col }) => notify(row, col));
  };

  const bumpRowRevisions = (row: number, colCount: number) => {
    const cells: Array<{ row: number; col: number }> = [];
    for (let col = 0; col < colCount; col++) {
      cells.push({ row, col });
    }
    bumpRevisions(cells);
  };

  const notifyStoreSubscribers = () => {
    storeSubscribers.forEach((cb) => cb());
  };

  const notifySelectionSubscribers = () => {
    selectionSubscribers.forEach((cb) => cb());
  };

  const notifyEditingSubscribers = () => {
    editingSubscribers.forEach((cb) => cb());
  };

  const bumpStoreRevision = () => {
    storeRevision++;
    notifyStoreSubscribers();
  };

  const bumpSelectionRevision = () => {
    selectionRevision++;
    notifySelectionSubscribers();
  };

  const isCellInBounds = (row: number, col: number, bounds: SelectionBounds): boolean => {
    return (
      row >= bounds.startRow &&
      row <= bounds.endRow &&
      col >= bounds.startCol &&
      col <= bounds.endCol
    );
  };

  const getRangeEdges = (row: number, col: number, bounds: SelectionBounds): RangeEdges => ({
    top: row === bounds.startRow,
    bottom: row === bounds.endRow,
    left: col === bounds.startCol,
    right: col === bounds.endCol,
  });

  /**
   * Does this block contain AT LEAST ONE column a fill may write?
   *
   * "At least one", never "all": a five-column selection that happens to include
   * a read-only lookup column must still offer the handle. That column's writes
   * are rejected by `applyCellWrites` and reported; the other four fill.
   */
  const someColumnFillable = (bounds: SelectionBounds): boolean => {
    for (let c = bounds.startCol; c <= bounds.endCol; c++) {
      const col = currentColumns[c];
      if (col && !col.readOnly && !col.disableFill) return true;
    }
    return false;
  };

  /**
   * Repaint the UNION of two rectangles, deduped. Used by both `setSelection`
   * and `setFillPreview` — cells leaving the old rect must lose their outline in
   * the same frame cells joining the new one gain it, or the grid shows two
   * outlines for a frame.
   */
  const repaintUnion = (a: SelectionBounds | null, b: SelectionBounds | null) => {
    const affected: Array<{ row: number; col: number }> = [];
    const add = (bounds: SelectionBounds | null) => {
      if (!bounds) return;
      for (let r = bounds.startRow; r <= bounds.endRow; r++) {
        for (let c = bounds.startCol; c <= bounds.endCol; c++) affected.push({ row: r, col: c });
      }
    };
    add(a);
    add(b);
    const seen = new Set<CellId>();
    const unique = affected.filter(({ row, col }) => {
      const id = getCellId(row, col);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    bumpRevisions(unique);
  };

  // Initialize data
  const initializeData = (data: any[]) => {
    rowDataMap.clear();
    rowCount = data.length;

    data.forEach((row, rowIndex) => {
      rowDataMap.set(rowIndex, row);
    });
  };

  // Initialize with provided data
  initializeData(initialData);

  // Initialize column widths from column definitions
  currentColumns.forEach((col, idx) => {
    if (col.width) {
      columnWidths.set(idx, col.width);
    }
  });

  const store: CellStore = {
    // --- Reads ---
    getCellValue(row: number, col: number): any {
      // Projection, never a cache. `col` indexes the CURRENT view-order column
      // array, so a reorder/hide is picked up on the very next read — which is
      // why copy, export and the screen can no longer disagree.
      const colDef = currentColumns[col];
      if (!colDef) return undefined;
      return rowDataMap.get(row)?.[colDef.data];
    },

    getRowData(row: number): any {
      return rowDataMap.get(row);
    },

    getRowCount(): number {
      return rowCount;
    },

    getSelection(): SelectionState {
      return selection;
    },

    getSelectionBounds(): SelectionBounds | null {
      if (!boundsCache) {
        boundsCache = calcBounds();
      }
      return boundsCache;
    },

    getFillPreview(): FillPreview | null {
      return fillPreview;
    },


    getClipboardMarker(): ClipboardMarker | null {
      return clipboardMarker;
    },

    getEditingCell(): { row: number; col: number } | null {
      return editingCell;
    },

    getSaveState(row: number, col: number): SaveStateType {
      return saveStates.get(getCellId(row, col)) ?? null;
    },

    isNewRow(row: number): boolean {
      return newRowFlags.has(row);
    },

    hasNewRows(): boolean {
      return newRowFlags.size > 0;
    },

    getColumnWidth(col: number): number {
      return (
        (columnWidths.get(col) ?? currentColumns[col]?.width ?? 100) +
        (columnStretch.get(col) ?? 0)
      );
    },

    getBaseColumnWidth(col: number): number {
      return columnWidths.get(col) ?? currentColumns[col]?.width ?? 100;
    },

    getColumnWidths(): Map<number, number> {
      return new Map(columnWidths);
    },

    setColumnStretch(next: Map<number, number>): void {
      // Normalize first: a zero surplus is the ABSENCE of one, so `{a: 0}` and
      // `{}` must compare equal — otherwise every measure would look like a
      // change and re-render the grid on a loop.
      const normalized = new Map<number, number>();
      next.forEach((extra, col) => { if (extra > 0) normalized.set(col, extra); });
      let changed = normalized.size !== columnStretch.size;
      if (!changed) {
        for (const [col, extra] of normalized) {
          if (columnStretch.get(col) !== extra) { changed = true; break; }
        }
      }
      if (!changed) return;
      columnStretch.clear();
      normalized.forEach((extra, col) => columnStretch.set(col, extra));
      bumpStoreRevision();
    },

    getStoreRevision(): number {
      return storeRevision;
    },

    getSelectionRevision(): number {
      return selectionRevision;
    },

    getCellState(row: number, col: number): CellState {
      const bounds = this.getSelectionBounds();
      const isInRange = bounds ? isCellInBounds(row, col, bounds) : false;

      const isSelected =
        selection.type === 'cell' &&
        selection.anchor?.row === row &&
        selection.anchor?.col === col;

      // The fill preview is a RECTANGLE (Excel fills in four directions), so
      // containment is the same `isCellInBounds` test the selection uses and the
      // edges come from the same `getRangeEdges` helper. `fillEdges` was already
      // typed four-sided; it simply used to be told `left: true, right: true`,
      // which is only correct for a one-column strip.
      const isFillPreview = !!fillPreview && isCellInBounds(row, col, fillPreview.bounds);
      // The extension only — the cells that will actually be WRITTEN on release.
      const isFillTarget =
        isFillPreview && !!fillPreview && !isCellInBounds(row, col, fillPreview.source);
      const isFillClearing =
        !!fillPreview && !!fillPreview.cleared && isCellInBounds(row, col, fillPreview.cleared);

      // The drag nub. Computed HERE, not in `Cell.tsx`: it needs the whole
      // selection AND the column defs, both of which are already in this
      // closure. Asking "is ANY column in the selection fillable" is what lets a
      // multi-column source that CONTAINS a read-only column still offer a
      // handle — that column's writes are rejected, the rest go through.
      const isFillOrigin =
        !!bounds &&
        row === bounds.endRow &&
        col === bounds.endCol &&
        !editingCell &&
        someColumnFillable(bounds);

      const cellId = getCellId(row, col);
      // Marching ants. Same containment test and same edge helper as the
      // selection outline, so only the OUTER border of the marked block is
      // painted rather than a box around every cell in it.
      const isClipboardSource =
        !!clipboardMarker && isCellInBounds(row, col, clipboardMarker.bounds);

      return {
        value: this.getCellValue(row, col),
        isSelected,
        isInRange,
        rangeEdges: isInRange && bounds ? getRangeEdges(row, col, bounds) : {},
        isEditing: editingCell?.row === row && editingCell?.col === col,
        saveState: this.getSaveState(row, col),
        isNewRow: this.isNewRow(row),
        isFillPreview,
        isFillTarget,
        isFillClearing,
        isFillOrigin,
        fillEdges: isFillPreview && fillPreview ? getRangeEdges(row, col, fillPreview.bounds) : {},
        isClipboardSource,
        clipboardEdges:
          isClipboardSource && clipboardMarker
            ? getRangeEdges(row, col, clipboardMarker.bounds)
            : {},
        clipboardMode: isClipboardSource && clipboardMarker ? clipboardMarker.mode : null,
        isHovered: hoveredCell?.row === row && hoveredCell?.col === col,
      };
    },

    getCellsInSelection(): { row: number; col: number; value: any }[] {
      const bounds = this.getSelectionBounds();
      if (!bounds) return [];
      return this.getCellsInRect(bounds);
    },

    getCellsInRect(bounds: SelectionBounds): { row: number; col: number; value: any }[] {
      const cells: { row: number; col: number; value: any }[] = [];
      for (let r = bounds.startRow; r <= bounds.endRow; r++) {
        for (let c = bounds.startCol; c <= bounds.endCol; c++) {
          cells.push({ row: r, col: c, value: this.getCellValue(r, c) });
        }
      }
      return cells;
    },

    // --- Writes ---
    setCellValue(row: number, col: number, value: any): void {
      // Writes the ONE value source in place. The row object is shared with the
      // consumer's `data` array by design (optimistic update), so the renderer,
      // copy and export all observe the new value on the next read.
      const rowData = rowDataMap.get(row);
      if (rowData && currentColumns[col]) {
        rowData[currentColumns[col].data] = value;
      }

      bumpRevision(row, col);
    },

    setRowData(row: number, data: any): void {
      rowDataMap.set(row, data);
      bumpRowRevisions(row, currentColumns.length);
    },

    setSelection(newSelection: SelectionState): void {
      const oldBounds = this.getSelectionBounds();
      selection = newSelection;
      boundsCache = null; // invalidate cache
      const newBounds = this.getSelectionBounds();

      // Collect all affected cells
      const affected: Array<{ row: number; col: number }> = [];

      const addBoundsCells = (bounds: SelectionBounds | null) => {
        if (!bounds) return;
        for (let r = bounds.startRow; r <= bounds.endRow; r++) {
          for (let c = bounds.startCol; c <= bounds.endCol; c++) {
            affected.push({ row: r, col: c });
          }
        }
      };

      addBoundsCells(oldBounds);
      addBoundsCells(newBounds);

      // Dedupe
      const seen = new Set<CellId>();
      const unique = affected.filter(({ row, col }) => {
        const id = getCellId(row, col);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      bumpRevisions(unique);
      bumpSelectionRevision();
    },

    setFillPreview(preview: FillPreview | null): void {
      const prev = fillPreview;
      fillPreview = preview;
      // Repaint the union of the old and new fill RECTANGLES so cells leaving
      // the preview lose their dashed outline in the same frame cells joining it
      // gain one. Over a 100x20 grid that is ~2,000 notifies per mousemove — the
      // same order a full-grid drag-select already costs today.
      repaintUnion(prev ? prev.bounds : null, preview ? preview.bounds : null);
    },


    setClipboardMarker(marker: ClipboardMarker | null): void {
      const prev = clipboardMarker;
      if (!prev && !marker) return;
      clipboardMarker = marker;
      // Same union repaint the selection and the fill preview use: cells
      // leaving the old rectangle must lose their ants in the SAME frame cells
      // joining the new one gain them, or the grid briefly shows two.
      repaintUnion(prev?.bounds ?? null, marker?.bounds ?? null);
    },

    // --- Undo / redo ---
    recordCellChange(change: UndoCellChange): void {
      if (suppressUndo) return;
      if (undoGroup) {
        undoGroup.push(change);
      } else {
        undoStack.push({ changes: [change] });
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        redoStack.length = 0;
      }
    },

    beginUndoGroup(): void {
      undoGroup = [];
    },

    endUndoGroup(): void {
      const group = undoGroup;
      undoGroup = null;
      if (group && group.length > 0) {
        undoStack.push({ changes: group });
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        redoStack.length = 0;
      }
    },

    popUndo(): UndoEntry | null {
      return undoStack.pop() ?? null;
    },

    popRedo(): UndoEntry | null {
      return redoStack.pop() ?? null;
    },

    pushUndo(entry: UndoEntry): void {
      undoStack.push(entry);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    },

    pushRedo(entry: UndoEntry): void {
      redoStack.push(entry);
    },

    canUndo(): boolean {
      return undoStack.length > 0;
    },

    canRedo(): boolean {
      return redoStack.length > 0;
    },

    setUndoSuppressed(suppressed: boolean): void {
      suppressUndo = suppressed;
    },

    findRowIndexById(idColumnName: string, id: any): number {
      if (id == null) return -1;
      for (const [index, rowData] of rowDataMap) {
        if (rowData?.[idColumnName] === id) return index;
      }
      return -1;
    },

    setEditingCell(row: number, col: number): void {
      const prev = editingCell;
      editingCell = { row, col };

      if (prev) {
        bumpRevision(prev.row, prev.col);
      }
      bumpRevision(row, col);
      if (!prev || prev.row !== row || prev.col !== col) notifyEditingSubscribers();
    },

    setHoveredCell(cell: { row: number; col: number } | null): void {
      const prev = hoveredCell;
      if (prev && cell && prev.row === cell.row && prev.col === cell.col) return;
      if (!prev && !cell) return;
      hoveredCell = cell;
      if (prev) bumpRevision(prev.row, prev.col);
      if (cell) bumpRevision(cell.row, cell.col);
    },

    clearEditing(): void {
      if (editingCell) {
        const { row, col } = editingCell;
        editingCell = null;
        bumpRevision(row, col);
        notifyEditingSubscribers();
      }
    },

    setSaveState(row: number, col: number, state: SaveStateType): void {
      const id = getCellId(row, col);
      if (state === null) {
        saveStates.delete(id);
      } else {
        saveStates.set(id, state);
      }
      bumpRevision(row, col);
    },

    setColumnWidth(col: number, width: number): void {
      columnWidths.set(col, width);
      // An explicit width REPLACES the fill surplus for that column. Without
      // this a resize drag would jump by the surplus on its first pixel: the
      // drag starts from the painted width and would then have the surplus
      // added on top of it again. The next measure re-distributes whatever is
      // still free across the columns that are still flexible.
      columnStretch.delete(col);
      // Bump store revision to trigger re-render of headers and total width
      bumpStoreRevision();
    },

    setData(data: any[]): void {
      // The marching ants are addressed by ROW INDEX. A refetch that returns
      // the same rows in the same order leaves them pointing at the same cells,
      // which is the common case (paste/copy do not change the sort) and is why
      // the marker survives it. A different row COUNT proves the indices moved,
      // and a marker that has silently slid onto other people's data is worse
      // than no marker — so it is dropped rather than guessed at.
      if (clipboardMarker && data.length !== rowCount) {
        const stale = clipboardMarker;
        clipboardMarker = null;
        repaintUnion(stale.bounds, null);
      }
      initializeData(data);
      newRowFlags.clear();

      // Bump all subscribed cells
      subscribers.forEach((_, id) => {
        const [row, col] = id.split(':').map(Number);
        bumpRevision(row, col);
      });

      bumpStoreRevision();
    },

    setColumns(newColumns: ColumnDef[]): void {
      // Column indices have just moved (reorder / show-hide), so the ants'
      // COLUMN bounds no longer name the columns they were drawn around.
      if (clipboardMarker) {
        const stale = clipboardMarker;
        clipboardMarker = null;
        repaintUnion(stale.bounds, null);
      }
      // Preserve the user's current widths across a column change (reorder /
      // show-hide) by remapping them via the stable `data` key rather than the
      // positional index. Without this, every perspective reorder would snap
      // manually-sized columns back to their defaults.
      const widthsByData = new Map<string, number>();
      currentColumns.forEach((col, idx) => {
        const w = columnWidths.get(idx);
        if (w != null) widthsByData.set(col.data, w);
      });
      currentColumns = newColumns;
      columnWidths.clear();
      // The surplus is index-keyed and the indices have just moved. Dropped
      // rather than remapped: the column SET changed, so the distribution is
      // wrong anyway and the next measure recomputes it from scratch.
      columnStretch.clear();
      newColumns.forEach((col, idx) => {
        const carried = widthsByData.get(col.data);
        if (carried != null) columnWidths.set(idx, carried);
        else if (col.width) columnWidths.set(idx, col.width);
      });
      // Clear save states when columns change to avoid showing states on wrong cells
      saveStates.clear();
      bumpStoreRevision();
    },

    reinitColumnWidths(): void {
      // Drop all width overrides back to the column definitions. Used when the
      // persistence scope changes under us (e.g. a different account loads on the
      // same browser) so one user's layout never lingers into another's.
      columnWidths.clear();
      columnStretch.clear();
      currentColumns.forEach((col, idx) => {
        if (col.width) columnWidths.set(idx, col.width);
      });
      bumpStoreRevision();
    },

    addRow(rowData: any, atIndex: number = 0): void {
      // Shift all existing data down
      const newRowDataMap = new Map<number, any>();
      const newRevisions = new Map<CellId, number>();
      const newSaveStates = new Map<CellId, SaveStateType>();
      const newNewRowFlags = new Set<number>();

      // Shift rows after insertion point
      rowDataMap.forEach((data, idx) => {
        const newIdx = idx >= atIndex ? idx + 1 : idx;
        newRowDataMap.set(newIdx, data);
      });

      // Shift revisions
      revisions.forEach((rev, id) => {
        const [r, c] = id.split(':').map(Number);
        const newR = r >= atIndex ? r + 1 : r;
        newRevisions.set(getCellId(newR, c), rev);
      });

      // Shift save states
      saveStates.forEach((state, id) => {
        const [r, c] = id.split(':').map(Number);
        const newR = r >= atIndex ? r + 1 : r;
        newSaveStates.set(getCellId(newR, c), state);
      });

      // Shift new row flags
      newRowFlags.forEach((idx) => {
        newNewRowFlags.add(idx >= atIndex ? idx + 1 : idx);
      });

      // Clear and repopulate
      rowDataMap.clear();
      revisions.clear();
      saveStates.clear();
      newRowFlags.clear();

      newRowDataMap.forEach((data, idx) => rowDataMap.set(idx, data));
      newRevisions.forEach((rev, id) => revisions.set(id, rev));
      newSaveStates.forEach((state, id) => saveStates.set(id, state));
      newNewRowFlags.forEach((idx) => newRowFlags.add(idx));

      // Add new row. Seed every column key that the caller left out with '' —
      // the row object IS the value source now, so a missing key would render
      // (and copy, and export) as `undefined` instead of an empty cell.
      currentColumns.forEach((col) => {
        if (rowData[col.data] == null) rowData[col.data] = '';
      });
      rowDataMap.set(atIndex, rowData);

      rowCount++;

      // Mark as new row
      newRowFlags.add(atIndex);

      // Bump all subscribed cells
      subscribers.forEach((_, id) => {
        const [row, col] = id.split(':').map(Number);
        bumpRevision(row, col);
      });

      bumpStoreRevision();
    },

    removeRow(rowIndex: number): void {
      // Shift all data up
      const newRowDataMap = new Map<number, any>();
      const newRevisions = new Map<CellId, number>();
      const newSaveStates = new Map<CellId, SaveStateType>();
      const newNewRowFlags = new Set<number>();

      rowDataMap.forEach((data, idx) => {
        if (idx < rowIndex) {
          newRowDataMap.set(idx, data);
        } else if (idx > rowIndex) {
          newRowDataMap.set(idx - 1, data);
        }
      });

      revisions.forEach((rev, id) => {
        const [r, c] = id.split(':').map(Number);
        if (r < rowIndex) {
          newRevisions.set(getCellId(r, c), rev);
        } else if (r > rowIndex) {
          newRevisions.set(getCellId(r - 1, c), rev);
        }
      });

      saveStates.forEach((state, id) => {
        const [r, c] = id.split(':').map(Number);
        if (r < rowIndex) {
          newSaveStates.set(getCellId(r, c), state);
        } else if (r > rowIndex) {
          newSaveStates.set(getCellId(r - 1, c), state);
        }
      });

      newRowFlags.forEach((idx) => {
        if (idx < rowIndex) {
          newNewRowFlags.add(idx);
        } else if (idx > rowIndex) {
          newNewRowFlags.add(idx - 1);
        }
      });

      // Clear and repopulate
      rowDataMap.clear();
      revisions.clear();
      saveStates.clear();
      newRowFlags.clear();

      newRowDataMap.forEach((data, idx) => rowDataMap.set(idx, data));
      newRevisions.forEach((rev, id) => revisions.set(id, rev));
      newSaveStates.forEach((state, id) => saveStates.set(id, state));
      newNewRowFlags.forEach((idx) => newRowFlags.add(idx));

      rowCount--;

      // Bump all subscribed cells
      subscribers.forEach((_, id) => {
        const [row, col] = id.split(':').map(Number);
        bumpRevision(row, col);
      });

      bumpStoreRevision();
    },

    markRowAsNew(rowIndex: number, isNew: boolean): void {
      if (isNew) {
        newRowFlags.add(rowIndex);
      } else {
        newRowFlags.delete(rowIndex);
      }
      bumpRowRevisions(rowIndex, currentColumns.length);
      bumpStoreRevision();
    },

    markRowAsSaved(rowIndex: number, savedData: any): void {
      newRowFlags.delete(rowIndex);
      rowDataMap.set(rowIndex, savedData);
      bumpRowRevisions(rowIndex, currentColumns.length);
      bumpStoreRevision();
    },

    // --- Subscriptions ---
    subscribe(row: number, col: number, callback: CellSubscriber): () => void {
      const id = getCellId(row, col);
      if (!subscribers.has(id)) {
        subscribers.set(id, new Set());
      }
      subscribers.get(id)!.add(callback);

      return () => {
        const subs = subscribers.get(id);
        if (subs) {
          subs.delete(callback);
          if (subs.size === 0) {
            subscribers.delete(id);
          }
        }
      };
    },

    subscribeToStore(callback: CellSubscriber): () => void {
      storeSubscribers.add(callback);
      return () => {
        storeSubscribers.delete(callback);
      };
    },

    subscribeToSelection(callback: CellSubscriber): () => void {
      selectionSubscribers.add(callback);
      return () => {
        selectionSubscribers.delete(callback);
      };
    },

    subscribeToEditing(callback: CellSubscriber): () => void {
      editingSubscribers.add(callback);
      return () => {
        editingSubscribers.delete(callback);
      };
    },

    getRevision(row: number, col: number): number {
      return revisions.get(getCellId(row, col)) ?? 0;
    },

    // --- Table container focus management ---
    setTableRef(ref: React.RefObject<HTMLDivElement | null>): void {
      tableRef = ref;
    },

    focusTable(): void {
      tableRef?.current?.focus();
    },

    blurTable(): void {
      tableRef?.current?.blur();
    },

    bumpRevision,
    bumpRevisions,
    bumpRowRevisions,
    bumpStoreRevision,
  };

  return store;
}
