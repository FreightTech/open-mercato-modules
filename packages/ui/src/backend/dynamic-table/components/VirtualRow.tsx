import React, { memo, useRef } from 'react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { MoreHorizontal } from 'lucide-react';
import { VirtualItem } from '@tanstack/react-virtual';
import { useCellStore, useRowRangeState } from '../hooks/index';
import { ColumnDef } from '../types/index';
import { AnnotationMap } from '../hooks/useAnnotations';
import Cell from './Cell';
import RowHeaderCell from './RowHeaderCell';
import { computeColorAdjacency, NO_COLOR_ADJACENCY } from '../utils/colorAdjacency';
import type { CompiledConditionalFormats } from '../utils/conditionalFormat';
import type { ColumnWindow } from '../utils/columnWindow';
import { columnSpacerKey, columnSpacerStyle } from '../utils/columnSpacerStyle';

export interface VirtualRowProps {
  rowIndex: number;
  columns: ColumnDef[];
  virtualRow: VirtualItem;
  rowHeaders: boolean;
  leftOffsets: (number | undefined)[];
  rightOffsets: (number | undefined)[];
  /** Data key of the rightmost pinned column — gets the float-edge shadow. */
  lastFrozenColumnKey?: string | null;
  actionsColumnWidth: number;
  showActionsColumn?: boolean;
  totalWidth: number;
  storeRevision: number;
  onSaveNewRow: (rowIndex: number) => void;
  onCancelNewRow: (rowIndex: number) => void;
  onRowHeaderDoubleClick: (e: React.MouseEvent, rowIndex: number) => void;
  onCellSave: (row: number, col: number, newValue: any, clearEditing?: boolean) => void;
  onCellContextMenu?: (e: React.MouseEvent, row: number, col: number) => void;
  actionsRenderer?: (rowData: any, rowIndex: number) => React.ReactNode;
  /** v2: render a kebab (•••) menu button in the Actions column. */
  showRowActionsMenu?: boolean;
  /** Resolves the row's actions — used to hide the kebab when a row has none. */
  rowActions?: (rowData: any, rowIndex: number) => any[];
  /** Opens the row actions menu (anchored to the kebab button). */
  onRowActionsMenu?: (e: React.MouseEvent, rowIndex: number) => void;
  /** ID of the row to highlight (for external sync) */
  highlightedRowId?: string | null;
  /** Column name containing the row ID (default: 'id') */
  idColumnName?: string;
  /**
   * Column holding the unique-per-row selection identity. Defaults to
   * `idColumnName`; set separately when `idColumnName` is a repeating entity
   * key so checkbox selection keys on a stable unique value.
   */
  rowKeyColumn?: string;
  /** Annotation data map for cell colors and comment counts */
  annotations?: AnnotationMap;
  /**
   * B9 — comments are on for this table. Forwarded to `Cell`, which renders a
   * ghosted comment affordance on the FOCUSED cell so the feature is findable
   * without already knowing the `Shift`+click shortcut.
   */
  commentsEnabled?: boolean;
  /**
   * B8a — the annotation map key for one cell, or `null` when that cell has no
   * annotation target. Supplied by the grid (never rebuilt here) so a row of
   * unit-legs scopes a leg column to the LEG and a container column to the
   * CONTAINER, instead of keying both by the row's id column and painting one
   * container comment on every leg of that container.
   */
  annotationKeyAt?: (rowData: any, column: ColumnDef) => string | null;
  /** v2: render a selection checkbox in the row header (bulk/grouped actions). */
  selectable?: boolean;
  selectedRowIds?: Set<string>;
  onToggleRowSelect?: (rowId: string) => void;
  /** Compiled view-scoped highlighting rules (see `Cell`). Stable per rule set. */
  compiledFormats?: CompiledConditionalFormats;
  /**
   * Mounted column window. Omit it — or pass an unvirtualized window — and the
   * row renders EVERY column exactly as before.
   *
   * `columns` stays the FULL, view-ordered array in both cases: the window only
   * decides what is mounted, never what exists. `colIndex` is therefore always
   * an absolute index into `columns`, which is what keeps `data-col` honest for
   * every pointer hit-test in `handlers/index.ts`.
   */
  columnWindow?: ColumnWindow;
}

const VirtualRow: React.FC<VirtualRowProps> = memo(
  ({
    rowIndex,
    columns,
    virtualRow,
    rowHeaders,
    leftOffsets,
    rightOffsets,
    lastFrozenColumnKey,
    actionsColumnWidth,
    showActionsColumn = true,
    totalWidth,
    storeRevision: _storeRevision, // Used to invalidate memo when column widths change
    onSaveNewRow,
    onCancelNewRow,
    onRowHeaderDoubleClick,
    onCellSave,
    onCellContextMenu,
    actionsRenderer,
    showRowActionsMenu,
    rowActions,
    onRowActionsMenu,
    highlightedRowId,
    idColumnName = 'id',
    rowKeyColumn,
    annotations,
    commentsEnabled,
    annotationKeyAt,
    selectable,
    selectedRowIds,
    onToggleRowSelect,
    compiledFormats,
    columnWindow,
  }) => {
    const t = useT();
    const rowActionsLabel = t('dynamicTable.rowActions', 'Row actions');
    const selectRowLabel = t('dynamicTable.selection.row', 'Select row');
    const store = useCellStore();
    // Only this row's slice of the selection — see useRowRangeState.
    const rowRange = useRowRangeState(rowIndex);
    // Guards the Save button's mouse path against firing twice — see the button.
    const suppressSaveClickRef = useRef(false);
    const isNewRow = store.isNewRow(rowIndex);
    const rowData = store.getRowData(rowIndex);

    // `Cell` is memoised, but it takes the column definition WITH the store's
    // current width folded in — building that object inline handed every cell a
    // fresh prop on every row render, so `Cell`'s memo never held either. Rows
    // still re-render when their row-range slice changes, a column window moves
    // or a new row scrolls in; without this each of those re-rendered every
    // cell of the row. Widths change only via the store revision.
    const cellColConfigs = React.useMemo(
      () => columns.map((col, colIndex) => ({ ...col, width: store.getColumnWidth(colIndex) })),
      [columns, store, _storeRevision],
    );

    // Determine if this row should be highlighted (external sync)
    const rowId = rowData?.[idColumnName];
    const isHighlighted = highlightedRowId != null && rowId === highlightedRowId;
    // v2 checkbox selection — keyed on a unique-per-row value (may differ from
    // `idColumnName` when that's a repeating entity key).
    const selectionId = rowData?.[rowKeyColumn ?? idColumnName];
    const isRowSelected = selectionId != null && !!selectedRowIds?.has(String(selectionId));

    // Row-level selection state (for row headers)
    const isInRowRange = rowRange !== 'none';
    const rowRangeEdges = React.useMemo(
      () => ({
        top: rowRange === 'top' || rowRange === 'top-bottom',
        bottom: rowRange === 'bottom' || rowRange === 'top-bottom',
      }),
      [rowRange],
    );

    // One cell renderer, two callers. `colIndex` is ALWAYS the absolute index
    // into `columns`, whether it arrived from a plain map or from a window
    // segment, so nothing downstream can tell the difference.
    const renderCell = (colIndex: number) => {
      const col = columns[colIndex];
      if (!col) return null;
      const cellAnnotationKey =
        annotations && rowData ? (annotationKeyAt?.(rowData, col) ?? (rowId ? `${rowId}:${col.data}` : null)) : null;
      const annotation = cellAnnotationKey ? annotations?.get(cellAnnotationKey) : undefined;
      // Colour-block adjacency is computed from the annotation map, NOT by
      // scanning the rendered cells — an unmounted neighbour is still a
      // neighbour (see utils/colorAdjacency.ts).
      const colorAdjacency = annotation?.color
        ? computeColorAdjacency(
            annotation.color,
            rowIndex,
            colIndex,
            columns,
            annotations,
            (r, column) => {
              const neighbourRow = store.getRowData(r);
              if (!neighbourRow) return null;
              const key = annotationKeyAt?.(neighbourRow, column);
              if (key !== undefined && key !== null) return key;
              if (annotationKeyAt) return null;
              const neighbourId = neighbourRow[idColumnName];
              return neighbourId == null ? null : `${neighbourId}:${column.data}`;
            },
          )
        : NO_COLOR_ADJACENCY;
      return (
        <Cell
          key={col.data}
          row={rowIndex}
          col={colIndex}
          colConfig={cellColConfigs[colIndex]}
          ariaColIndex={colIndex + 1 + (rowHeaders ? 1 : 0)}
          stickyLeft={leftOffsets[colIndex]}
          stickyRight={rightOffsets[colIndex]}
          frozenRightEdge={lastFrozenColumnKey != null && col.data === lastFrozenColumnKey}
          onCellSave={onCellSave}
          onCellContextMenu={onCellContextMenu}
          annotationColor={annotation?.color}
          commentCount={annotation?.commentCount}
          commentsEnabled={commentsEnabled}
          // Four primitives, not one object: `Cell` is memoised and a fresh
          // object per render would defeat it for exactly the cells that
          // are most expensive to repaint.
          colorAbove={colorAdjacency.above}
          colorBelow={colorAdjacency.below}
          colorLeft={colorAdjacency.left}
          colorRight={colorAdjacency.right}
          compiledFormats={compiledFormats}
        />
      );
    };

    return (
      <tr
        data-row={rowIndex}
        data-is-new={isNewRow}
        data-row-even={rowIndex % 2 === 1 ? 'true' : undefined}
        data-row-highlighted={isHighlighted ? 'true' : undefined}
        data-row-checked={isRowSelected ? 'true' : undefined}
        style={{
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${totalWidth}px`,
          height: `${virtualRow.size}px`,
          transform: `translateY(${virtualRow.start}px)`,
        }}
      >
        {rowHeaders && (
          <RowHeaderCell
            row={rowIndex}
            selectLabel={selectRowLabel}
            isNewRow={isNewRow}
            isInRowRange={!!isInRowRange}
            rowRangeEdges={rowRangeEdges}
            onCancel={() => onCancelNewRow(rowIndex)}
            onDoubleClick={(e) => onRowHeaderDoubleClick(e, rowIndex)}
            selectable={selectable && !isNewRow}
            selected={isRowSelected}
            onToggleSelect={() => selectionId != null && onToggleRowSelect?.(String(selectionId))}
          />
        )}

        {columnWindow?.virtualized
          ? columnWindow.segments.map((seg) =>
              seg.type === 'spacer' ? (
                // No data-row / data-col, no pointer events, aria-hidden — see
                // the hard rules in utils/columnSpacerStyle.ts.
                <td
                  key={columnSpacerKey(seg.fromIndex, seg.toIndex)}
                  className="hot-cell-spacer"
                  aria-hidden="true"
                  style={columnSpacerStyle(seg.width)}
                />
              ) : (
                renderCell(seg.column.index)
              ))
          : columns.map((_, colIndex) => renderCell(colIndex))}

        {/* Actions column */}
        {showActionsColumn && (
          <td
            className="hot-cell hot-actions-cell"
            style={{
              width: actionsColumnWidth,
              flexBasis: actionsColumnWidth,
              flexShrink: 0,
              flexGrow: 0,
              position: 'sticky',
              right: 0,
              zIndex: 2,
            }}
            data-row={rowIndex}
            data-col={columns.length}
            data-actions-cell="true"
            data-sticky-right={true}
          >
            {isNewRow ? (
              <button
                className="hot-row-save-btn"
                /* SAVES ON MOUSEDOWN, not on click — ledger 4.10.
                 *
                 * Driven in a browser, the FIRST click on Save did nothing at
                 * all and only a second one persisted the row: mousedown blurs
                 * the draft's open editor, the commit re-renders this row, and
                 * the `click` that Chrome would have synthesised on mouseup
                 * never reached the button. From the user's side that is "Save
                 * silently does nothing", and the row they typed is lost the
                 * moment they navigate away.
                 *
                 * `preventDefault` keeps focus in the editor so nothing else
                 * races the commit; `handleSaveNewRow` blurs it explicitly and
                 * in the right order. `stopPropagation` is the same guard the
                 * row-actions kebab already carries.
                 *
                 * `onClick` is kept for keyboard activation (Enter/Space on a
                 * focused button dispatches click with no mousedown) and is
                 * suppressed for the mouse path so one gesture is one save. */
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  suppressSaveClickRef.current = true;
                  onSaveNewRow(rowIndex);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (suppressSaveClickRef.current) {
                    suppressSaveClickRef.current = false;
                    return;
                  }
                  onSaveNewRow(rowIndex);
                }}
                title="Save"
              >
                Save
              </button>
            ) : rowData == null ? null : actionsRenderer ? (
              actionsRenderer(rowData, rowIndex)
            ) : showRowActionsMenu && (!rowActions || rowActions(rowData, rowIndex).length > 0) ? (
              <button
                type="button"
                className="hot-row-actions-btn"
                title={rowActionsLabel}
                aria-label={rowActionsLabel}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => onRowActionsMenu?.(e, rowIndex)}
              >
                <MoreHorizontal size={16} />
              </button>
            ) : null}
          </td>
        )}
      </tr>
    );
  }
);

VirtualRow.displayName = 'VirtualRow';

export default VirtualRow;
