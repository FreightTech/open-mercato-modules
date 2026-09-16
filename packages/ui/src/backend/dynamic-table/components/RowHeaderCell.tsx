import React, { memo } from 'react';

export interface RowHeaderCellProps {
  row: number;
  isNewRow: boolean;
  isInRowRange: boolean;
  rowRangeEdges: { top?: boolean; bottom?: boolean };
  onCancel: () => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  /** v2: show a selection checkbox instead of the row number (bulk/grouped actions). */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

const RowHeaderCell: React.FC<RowHeaderCellProps> = memo(
  ({ row, isNewRow, isInRowRange, rowRangeEdges, onCancel, onDoubleClick, selectable, selected, onToggleSelect }) => {
    return (
      <td
        className="hot-row-header"
        data-row={row}
        data-row-header="true"
        data-in-row-range={isInRowRange}
        data-row-range-top={rowRangeEdges.top}
        data-row-range-bottom={rowRangeEdges.bottom}
        onDoubleClick={onDoubleClick}
        // v2 checkbox mode: clicking the header cell must NOT start a grid
        // row-range selection — only the checkbox toggles selection. Swallow
        // mousedown so it never reaches the container's selection handler.
        onMouseDown={selectable ? (e) => e.stopPropagation() : undefined}
        style={{
          width: 50,
          flexBasis: 50,
          flexShrink: 0,
          flexGrow: 0,
          position: 'sticky',
          left: 0,
          zIndex: 3,
        }}
      >
        {isNewRow ? (
          <button
            className="hot-row-cancel-btn-header"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            title="Cancel"
          >
            ✕
          </button>
        ) : selectable ? (
          <input
            type="checkbox"
            className="hot-row-select"
            checked={!!selected}
            onChange={() => onToggleSelect?.()}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            aria-label="Select row"
          />
        ) : (
          row + 1
        )}
      </td>
    );
  }
);

RowHeaderCell.displayName = 'RowHeaderCell';

export default RowHeaderCell;
