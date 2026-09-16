import React, { memo } from 'react';
import type { ColumnDef } from '../../dynamic-table/types/index';
import type { GridRowDef } from '../types';
import GridCell from './GridCell';

export interface GridRowProps {
  rowIndex: number;
  rowDef: GridRowDef;
  columnDefs: ColumnDef[];
  gridColumns: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  idField: string;
}

const GridRow: React.FC<GridRowProps> = memo(
  ({ rowIndex, rowDef, columnDefs, gridColumns, gridRef, idField }) => {
    return (
      <div
        className={['grid gap-0', rowDef.className].filter(Boolean).join(' ')}
        style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
      >
        {rowDef.cells.map((cellDef, colIndex) => (
          <GridCell
            key={cellDef.field}
            gridRow={rowIndex}
            gridCol={colIndex}
            cellDef={cellDef}
            columnDef={columnDefs[colIndex]}
            gridRef={gridRef}
            idField={idField}
          />
        ))}
      </div>
    );
  },
);

GridRow.displayName = 'GridRow';

export default GridRow;
