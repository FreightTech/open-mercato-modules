import type React from 'react';

export interface GridCellDef {
  /** The field name on the data object */
  field: string;
  /** Label displayed above the value */
  label: string;
  /** Cell type — drives which editor/renderer is used */
  type?: 'text' | 'numeric' | 'date' | 'dropdown' | 'boolean' | 'multiselect';
  /** If true, cell is display-only */
  readOnly?: boolean;
  /** If true, label shows destructive color when value is empty/null */
  required?: boolean;
  /** Dropdown options (for type: 'dropdown' or 'multiselect') */
  source?: any[];
  /** How many grid columns this cell spans. Default: 1 */
  colSpan?: number;
  /** Custom renderer — overrides built-in renderer */
  renderer?: (value: any, data: Record<string, any>, cellDef: GridCellDef) => React.ReactNode;
  /** Custom editor — overrides built-in editor */
  editor?: (
    value: any,
    onChange: (v: any) => void,
    onSave: (newValue?: any, clearEditing?: boolean) => void,
    onCancel: () => void,
    data: Record<string, any>,
    cellDef: GridCellDef,
  ) => React.ReactNode;
  /** Conditional CSS class for the cell */
  cellClassName?: (value: any, data: Record<string, any>) => string | undefined;
}

export interface GridRowDef {
  /** Cells in this row */
  cells: GridCellDef[];
  /** Optional row-level class name */
  className?: string;
}

export interface DynamicGridProps {
  /** The single entity data object */
  data: Record<string, any>;
  /** Grid layout definition — rows of cell definitions */
  rows: GridRowDef[];
  /** Ref for the grid container element (for event bubbling) */
  gridRef: React.RefObject<HTMLDivElement | null>;
  /** Unique entity ID field (default: 'id') */
  idField?: string;
  /** Number of columns in the CSS grid. Default: auto from max cells per row */
  columns?: number;
  /** Class name for the outer wrapper */
  className?: string;
  /** Enable keyboard navigation between editable cells (default: true) */
  enableKeyboardNav?: boolean;
}
