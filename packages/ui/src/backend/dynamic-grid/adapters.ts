import type { ColumnDef } from '../dynamic-table/types/index';
import type { GridCellDef, GridRowDef } from './types';

/**
 * Converts a GridCellDef to a DynamicTable ColumnDef so we can reuse
 * getCellEditor / getCellRenderer from the DynamicTable component.
 */
export function gridCellDefToColumnDef(cellDef: GridCellDef): ColumnDef {
  return {
    data: cellDef.field,
    title: cellDef.label,
    type: cellDef.type,
    readOnly: cellDef.readOnly,
    source: cellDef.source,
    renderer: cellDef.renderer
      ? (value: any, rowData: any) => cellDef.renderer!(value, rowData, cellDef)
      : undefined,
    editor: cellDef.editor
      ? (
          value: any,
          onChange: (v: any) => void,
          onSave: () => void,
          onCancel: () => void,
          rowData: any,
        ) => cellDef.editor!(value, onChange, onSave, onCancel, rowData, cellDef)
      : undefined,
    cellClassName: cellDef.cellClassName
      ? (value: any, rowData: any) => cellDef.cellClassName!(value, rowData)
      : undefined,
  };
}

/**
 * Builds per-row data arrays for the CellStore from a single entity.
 * Each row gets the full entity data so any cell can read any field.
 */
export function buildStoreData(data: Record<string, any>, rows: GridRowDef[]): any[] {
  return rows.map(() => ({ ...data }));
}

/**
 * Builds a flat ColumnDef array from the row with the most cells.
 * Used to initialize the CellStore (it needs a columns array).
 */
export function buildStoreColumns(rows: GridRowDef[]): ColumnDef[] {
  const maxCols = Math.max(...rows.map((r) => r.cells.length));
  const defs: ColumnDef[] = [];
  for (let i = 0; i < maxCols; i++) {
    for (const row of rows) {
      if (row.cells[i]) {
        defs.push(gridCellDefToColumnDef(row.cells[i]));
        break;
      }
    }
  }
  return defs;
}
