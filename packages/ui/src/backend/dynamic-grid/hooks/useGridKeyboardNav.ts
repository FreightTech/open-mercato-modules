import { useCallback, useMemo } from 'react';
import type { CellStore } from '../../dynamic-table/store/index';
import type { GridRowDef } from '../types';

export function useGridKeyboardNav(
  store: CellStore,
  rows: GridRowDef[],
) {
  const editableCells = useMemo(() => {
    const cells: Array<{ row: number; col: number }> = [];
    rows.forEach((rowDef, rowIndex) => {
      rowDef.cells.forEach((cellDef, colIndex) => {
        if (!cellDef.readOnly) {
          cells.push({ row: rowIndex, col: colIndex });
        }
      });
    });
    return cells;
  }, [rows]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const editing = store.getEditingCell();
      const selection = store.getSelection();
      const hasSelection = selection.type === 'cell' && selection.anchor;

      // Tab / Shift+Tab: move between editable cells
      if (e.key === 'Tab') {
        const direction = e.shiftKey ? -1 : 1;
        let currentIndex = -1;

        const anchor = editing || selection.anchor;
        if (anchor) {
          currentIndex = editableCells.findIndex(
            (c) => c.row === anchor.row && c.col === anchor.col,
          );
        }

        const nextIndex = currentIndex + direction;
        if (nextIndex >= 0 && nextIndex < editableCells.length) {
          e.preventDefault();
          const next = editableCells[nextIndex];
          if (editing) store.clearEditing();
          store.setSelection({
            type: 'cell',
            anchor: { row: next.row, col: next.col },
            focus: { row: next.row, col: next.col },
          });
          store.setEditingCell(next.row, next.col);
        } else if (editing) {
          // At boundary — allow natural Tab to leave the grid
          store.clearEditing();
          store.setSelection({ type: null, anchor: null, focus: null });
        }
        return;
      }

      // Enter: start editing or move down
      if (e.key === 'Enter' && !e.shiftKey) {
        if (editing) {
          e.preventDefault();
          // Move to same column, next row
          const nextRow = editing.row + 1;
          store.clearEditing();
          if (nextRow < rows.length) {
            const nextCol = Math.min(editing.col, rows[nextRow].cells.length - 1);
            store.setSelection({
              type: 'cell',
              anchor: { row: nextRow, col: nextCol },
              focus: { row: nextRow, col: nextCol },
            });
            if (!rows[nextRow].cells[nextCol]?.readOnly) {
              store.setEditingCell(nextRow, nextCol);
            }
          } else {
            store.setSelection({ type: null, anchor: null, focus: null });
            store.focusTable();
          }
        } else if (hasSelection && selection.anchor) {
          e.preventDefault();
          const { row, col } = selection.anchor;
          if (!rows[row]?.cells[col]?.readOnly) {
            store.setEditingCell(row, col);
          }
        }
        return;
      }

      // Escape: cancel editing or clear selection
      if (e.key === 'Escape') {
        if (editing) {
          e.preventDefault();
          store.clearEditing();
          store.focusTable();
        } else if (hasSelection) {
          e.preventDefault();
          store.setSelection({ type: null, anchor: null, focus: null });
        }
        return;
      }

      // Arrow keys (only when not editing)
      if (!editing && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        if (!hasSelection || !selection.anchor) {
          store.setSelection({
            type: 'cell',
            anchor: { row: 0, col: 0 },
            focus: { row: 0, col: 0 },
          });
          return;
        }

        let nextRow = selection.anchor.row;
        let nextCol = selection.anchor.col;

        if (e.key === 'ArrowUp') nextRow = Math.max(0, nextRow - 1);
        if (e.key === 'ArrowDown') nextRow = Math.min(rows.length - 1, nextRow + 1);
        if (e.key === 'ArrowLeft') nextCol = Math.max(0, nextCol - 1);
        if (e.key === 'ArrowRight')
          nextCol = Math.min(rows[nextRow].cells.length - 1, nextCol + 1);

        store.setSelection({
          type: 'cell',
          anchor: { row: nextRow, col: nextCol },
          focus: { row: nextRow, col: nextCol },
        });
      }
    },
    [store, rows, editableCells],
  );

  return handleKeyDown;
}
