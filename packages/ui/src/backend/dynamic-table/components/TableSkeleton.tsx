'use client';

import React from 'react';

interface TableSkeletonProps {
  /** Number of skeleton body rows to display */
  rows?: number;
  /** Number of skeleton columns (ignored when `columnWidths` is provided) */
  columns?: number;
  /** Whether to show the leading select (checkbox) column */
  rowHeaders?: boolean;
  /** Whether to show the column-header bar */
  colHeaders?: boolean;
  /** Height of the skeleton container */
  height?: string | number;
  /** Width of the skeleton container */
  width?: string | number;
  /** Table name (kept for API compatibility; no longer rendered) */
  tableName?: string;
  /**
   * Real column widths from the table being loaded. Used as flex weights so the
   * skeleton mirrors the table's column proportions and stretches to fill the
   * container (no narrow grid, no layout jump when data arrives).
   */
  columnWidths?: number[];
  /** Render the toolbar (search + actions) and perspective-tab row above the grid */
  toolbar?: boolean;
  /** Render the trailing row-actions (•••) column */
  actions?: boolean;
}

// Uniform placeholder widths for a calm, regular grid — except the first data
// column (the primary/name column), which gets a wider bar to read as the
// table's main column.
const CONTENT_BAR_W = 56;
const HEADER_BAR_W = 56;
const FIRST_COL_BAR_W = 150;

/** A shimmering placeholder bar (every bar in the skeleton animates). */
const Bar: React.FC<{
  w?: number | string;
  h?: number;
  round?: number;
  style?: React.CSSProperties;
}> = ({ w = '60%', h = 12, round = 6, style }) => (
  <div className="dt-skel-bar" style={{ width: w, height: h, borderRadius: round, ...style }} />
);

const TableSkeleton: React.FC<TableSkeletonProps> = ({
  rows = 10,
  columns = 8,
  rowHeaders = true,
  colHeaders = true,
  height = 'auto',
  width = '100%',
  columnWidths = [],
  toolbar = true,
  actions = true,
}) => {
  const widths = columnWidths.length ? columnWidths : Array.from({ length: columns }, () => 140);

  // One grid row — the select cell, the weighted data cells, and the actions
  // cell. `flexGrow: weight` + `flexBasis: 0` distributes the full width in the
  // same proportions as the real columns. `cellContent(i)` fills each data cell.
  const gridCells = (cellContent: (colIndex: number) => React.ReactNode) => (
    <>
      {rowHeaders && (
        <div className="dt-skel-cell dt-skel-cell--fixed" style={{ flexBasis: 44 }}>
          <Bar w={16} h={16} round={4} />
        </div>
      )}
      {widths.map((w, i) => (
        <div key={i} className="dt-skel-cell" style={{ flexGrow: w, flexBasis: 0 }}>
          {cellContent(i)}
        </div>
      ))}
      {actions && (
        <div className="dt-skel-cell dt-skel-cell--fixed dt-skel-cell--center" style={{ flexBasis: 56 }}>
          <Bar w={16} h={4} round={4} />
        </div>
      )}
    </>
  );

  return (
    <div className="table-skeleton dt-skel" style={{ width, height }} aria-hidden>
      {toolbar && (
        <>
          <div className="dt-skel-toolbar">
            <Bar w={260} h={36} round={10} />
            <Bar w={36} h={36} round={10} />
          </div>
          {/* Perspective tabs (left) and pagination (right) each collapse to a
              single bar — keeps the shimmer count low. */}
          <div className="dt-skel-tabs">
            <Bar w={188} h={28} round={8} />
            <Bar w={120} h={28} round={8} />
          </div>
        </>
      )}

      {colHeaders && (
        <div className="dt-skel-header">
          {gridCells((i) => (
            <Bar w={i === 0 ? FIRST_COL_BAR_W : HEADER_BAR_W} h={10} round={4} />
          ))}
        </div>
      )}

      <div className="dt-skel-body">
        {Array.from({ length: rows }, (_, r) => (
          <div className="dt-skel-row" key={r}>
            {gridCells((i) => (
              <Bar w={i === 0 ? FIRST_COL_BAR_W : CONTENT_BAR_W} h={12} round={6} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default TableSkeleton;
