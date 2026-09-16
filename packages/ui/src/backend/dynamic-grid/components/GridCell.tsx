import React, { memo, useRef, useEffect, useCallback } from 'react';
import { useCellStore, useCellState } from '../../dynamic-table/hooks/index';
import { getCellRenderer } from '../../dynamic-table/components/renderers';
import { getCellEditor } from '../../dynamic-table/components/editors';
import { dispatch } from '../../dynamic-table/events/events';
import { TableEvents } from '../../dynamic-table/types/index';
import type { ColumnDef, CellEditSaveEvent } from '../../dynamic-table/types/index';
import type { GridCellDef } from '../types';

export interface GridCellProps {
  gridRow: number;
  gridCol: number;
  cellDef: GridCellDef;
  columnDef: ColumnDef;
  gridRef: React.RefObject<HTMLDivElement | null>;
  idField: string;
}

/**
 * Strip DynamicTable editor visual styles so the editor is an invisible
 * typing surface over the value text. The grid cell itself shows selection state.
 */
function neutralizeEditorStyles(container: HTMLElement | null) {
  if (!container) return;
  const editors = container.querySelectorAll<HTMLElement>('.hot-cell-editor, .hot-boolean-editor-wrapper');
  editors.forEach((el) => {
    el.style.background = 'transparent';
    el.style.boxShadow = 'none';
    el.style.padding = '0';
    el.style.fontSize = 'inherit';
    el.style.color = 'inherit';
  });
}

const GridCell: React.FC<GridCellProps> = memo(
  ({ gridRow, gridCol, cellDef, columnDef, gridRef, idField }) => {
    const store = useCellStore();
    const state = useCellState(gridRow, gridCol);
    const inputRef = useRef<any>(null);
    const valueRef = useRef<HTMLDivElement>(null);
    const rowData = store.getRowData(gridRow);
    const cellValue = rowData?.[cellDef.field];

    const isEmpty = cellValue == null || cellValue === '';

    const handleSave = useCallback(
      (value?: any, clearEditing: boolean = true) => {
        const newValue = value !== undefined ? value : cellValue;
        const oldValue = rowData?.[cellDef.field];

        if (String(oldValue ?? '') === String(newValue ?? '')) {
          if (clearEditing) {
            store.clearEditing();
            store.focusTable();
          }
          return;
        }

        store.setCellValue(gridRow, gridCol, newValue);
        if (clearEditing) {
          store.clearEditing();
          store.focusTable();
        }

        if (gridRef.current) {
          dispatch<CellEditSaveEvent>(gridRef.current, TableEvents.CELL_EDIT_SAVE, {
            rowIndex: gridRow,
            colIndex: gridCol,
            oldValue,
            newValue,
            prop: cellDef.field,
            rowData,
            id: rowData?.[idField],
          });
        }
      },
      [cellValue, rowData, cellDef.field, gridRow, gridCol, store, gridRef, idField],
    );

    const handleCancel = useCallback(() => {
      store.clearEditing();
      store.focusTable();
    }, [store]);

    const handleChange = useCallback(() => {
      // Editor holds its own local state — no store update during editing
    }, []);

    // Focus input and neutralize editor visuals when editing starts
    useEffect(() => {
      if (!state.isEditing) return;

      // Strip DynamicTable editor visual styles
      neutralizeEditorStyles(valueRef.current);

      // Use rAF to run after React commits the controlled value to the DOM,
      // then set cursor to end of text
      requestAnimationFrame(() => {
        if (!inputRef.current) return;
        inputRef.current.focus();
        const el = inputRef.current;
        const supportsSelection =
          el.type === undefined ||
          ['text', 'password', 'search', 'tel', 'url', 'number'].includes(el.type);
        if (supportsSelection && el.setSelectionRange) {
          const length = el.value?.length || 0;
          try {
            el.setSelectionRange(length, length);
          } catch {
            // Some input types may throw, ignore
          }
        }
      });
    }, [state.isEditing]);

    const handleClick = useCallback(() => {
      store.setSelection({
        type: 'cell',
        anchor: { row: gridRow, col: gridCol },
        focus: { row: gridRow, col: gridCol },
      });
    }, [store, gridRow, gridCol]);

    const handleDoubleClick = useCallback(() => {
      if (!cellDef.readOnly) {
        store.setEditingCell(gridRow, gridCol);
      }
    }, [store, gridRow, gridCol, cellDef.readOnly]);

    const renderer = getCellRenderer(columnDef);
    const renderedValue = renderer(cellValue, rowData, columnDef, gridRow, gridCol);
    const conditionalClassName = cellDef.cellClassName?.(cellValue, rowData ?? {}) || '';

    const saveStateBg =
      state.saveState === 'saving'
        ? 'bg-blue-50/50 dark:bg-blue-950/30'
        : state.saveState === 'success'
          ? 'bg-green-50/50 dark:bg-green-950/30'
          : state.saveState === 'error'
            ? 'bg-red-50/50 dark:bg-red-950/30'
            : '';

    return (
      <div
        className={[
          'dynamic-grid-cell',
          'border border-border px-3 py-2 rounded-sm transition-colors duration-150',
          cellDef.readOnly ? 'bg-muted/30' : 'cursor-pointer',
          state.isSelected ? 'ring-2 ring-primary ring-inset' : '',
          saveStateBg,
          conditionalClassName,
        ]
          .filter(Boolean)
          .join(' ')}
        style={cellDef.colSpan ? { gridColumn: `span ${cellDef.colSpan}` } : undefined}
        data-grid-row={gridRow}
        data-grid-col={gridCol}
        data-save-state={state.saveState}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <div
          className={[
            'text-[10px] uppercase tracking-wider mb-1 select-none',
            cellDef.required && isEmpty
              ? 'text-destructive font-medium'
              : 'text-muted-foreground',
          ].join(' ')}
        >
          {cellDef.label}
        </div>
        <div ref={valueRef} className="relative text-sm min-h-[1.25rem]">
          <span className="whitespace-pre-wrap">{renderedValue}</span>
          {state.isEditing &&
            getCellEditor(
              columnDef,
              cellValue,
              handleChange,
              handleSave,
              handleCancel,
              rowData,
              gridRow,
              gridCol,
              inputRef,
            )}
        </div>
      </div>
    );
  },
);

GridCell.displayName = 'GridCell';

export default GridCell;
