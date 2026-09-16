import React, { useMemo, useEffect, useCallback, useRef } from 'react';
import { createCellStore } from '../dynamic-table/store/index';
import { CellStoreContext } from '../dynamic-table/hooks/index';
import { useEventHandlers } from '../dynamic-table/events/events';
import { TableEvents } from '../dynamic-table/types/index';
import type {
  CellSaveStartEvent,
  CellSaveSuccessEvent,
  CellSaveErrorEvent,
} from '../dynamic-table/types/index';
import { gridCellDefToColumnDef, buildStoreData } from './adapters';
import { useGridKeyboardNav } from './hooks/useGridKeyboardNav';
import type { DynamicGridProps } from './types';
import GridRow from './components/GridRow';

const DynamicGrid: React.FC<DynamicGridProps> = ({
  data,
  rows,
  gridRef,
  idField = 'id',
  columns,
  className,
  enableKeyboardNav = true,
}) => {
  const gridColumns = columns ?? Math.max(...rows.map((r) => r.cells.length));

  // Build per-row ColumnDef arrays for GridCell to use
  const columnDefsByRow = useMemo(
    () => rows.map((row) => row.cells.map(gridCellDefToColumnDef)),
    [rows],
  );

  // Build a flat columns array for store initialization (use the widest row)
  const storeColumns = useMemo(() => {
    const widestRowIndex = rows.reduce(
      (maxIdx, row, idx, arr) => (row.cells.length > arr[maxIdx].cells.length ? idx : maxIdx),
      0,
    );
    return columnDefsByRow[widestRowIndex] ?? [];
  }, [rows, columnDefsByRow]);

  // Build store data: each row gets a copy of the full entity
  const storeData = useMemo(() => buildStoreData(data, rows), [data, rows]);

  // Create cell store once
  const storeRef = useRef(createCellStore(storeData, storeColumns));
  const store = storeRef.current;

  // Set the table ref so store.focusTable() works
  useEffect(() => {
    store.setTableRef(gridRef);
  }, [store, gridRef]);

  // Sync data changes into the store
  useEffect(() => {
    store.setData(storeData);
  }, [store, storeData]);

  // Sync column changes into the store
  useEffect(() => {
    store.setColumns(storeColumns);
  }, [store, storeColumns]);

  // Internal save state event handlers
  const saveTimeouts = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearSaveTimeout = useCallback((key: string) => {
    const existing = saveTimeouts.current.get(key);
    if (existing) {
      clearTimeout(existing);
      saveTimeouts.current.delete(key);
    }
  }, []);

  useEventHandlers(
    {
      [TableEvents.CELL_SAVE_START]: (payload: CellSaveStartEvent) => {
        const key = `${payload.rowIndex}:${payload.colIndex}`;
        clearSaveTimeout(key);
        store.setSaveState(payload.rowIndex, payload.colIndex, 'saving');
      },
      [TableEvents.CELL_SAVE_SUCCESS]: (payload: CellSaveSuccessEvent) => {
        const key = `${payload.rowIndex}:${payload.colIndex}`;
        clearSaveTimeout(key);
        store.setSaveState(payload.rowIndex, payload.colIndex, 'success');
        saveTimeouts.current.set(
          key,
          setTimeout(() => {
            store.setSaveState(payload.rowIndex, payload.colIndex, null);
            saveTimeouts.current.delete(key);
          }, 2000),
        );
      },
      [TableEvents.CELL_SAVE_ERROR]: (payload: CellSaveErrorEvent) => {
        const key = `${payload.rowIndex}:${payload.colIndex}`;
        clearSaveTimeout(key);
        store.setSaveState(payload.rowIndex, payload.colIndex, 'error');
        saveTimeouts.current.set(
          key,
          setTimeout(() => {
            store.setSaveState(payload.rowIndex, payload.colIndex, null);
            saveTimeouts.current.delete(key);
          }, 3000),
        );
      },
    },
    gridRef,
    { stopPropagation: false },
  );

  // Cleanup timeouts on unmount
  useEffect(() => {
    const timeouts = saveTimeouts.current;
    return () => {
      timeouts.forEach((timeout) => clearTimeout(timeout));
      timeouts.clear();
    };
  }, []);

  // Keyboard navigation
  const handleKeyDown = useGridKeyboardNav(store, rows);

  // Clear selection/editing when focus leaves the grid
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      // If focus moves to another element inside the grid, ignore
      if (gridRef.current?.contains(e.relatedTarget as Node)) return;
      store.clearEditing();
      store.setSelection({ type: null, anchor: null, focus: null });
    },
    [store, gridRef],
  );

  return (
    <CellStoreContext.Provider value={store}>
      <div
        ref={gridRef}
        className={['dynamic-grid outline-none', className].filter(Boolean).join(' ')}
        tabIndex={enableKeyboardNav ? 0 : undefined}
        onKeyDown={enableKeyboardNav ? handleKeyDown : undefined}
        onBlur={handleBlur}
      >
        {rows.map((rowDef, rowIndex) => (
          <GridRow
            key={rowIndex}
            rowIndex={rowIndex}
            rowDef={rowDef}
            columnDefs={columnDefsByRow[rowIndex]}
            gridColumns={gridColumns}
            gridRef={gridRef}
            idField={idField}
          />
        ))}
      </div>
    </CellStoreContext.Provider>
  );
};

DynamicGrid.displayName = 'DynamicGrid';

export default DynamicGrid;
