import React, { memo, useRef, useEffect, useCallback } from 'react';
import { useCellStore, useCellState } from '../hooks/index';
import { getCellRenderer } from './renderers';
import { getCellEditor } from './editors';
import { ColumnDef } from '../types/index';
import { conditionalFormatClassName } from '../utils/conditionalFormat';
import type { CompiledConditionalFormats } from '../utils/conditionalFormat';

export interface CellProps {
  row: number;
  col: number;
  colConfig: ColumnDef;
  /**
   * 1-based `aria-colindex`, computed from the ABSOLUTE column index (plus the
   * row-header gutter), never from DOM position. Under column virtualization
   * the rendered cells are a subset, and a grid whose cells are a subset is
   * required to declare where each one really sits.
   */
  ariaColIndex?: number;
  stickyLeft?: number;
  stickyRight?: number;
  /** True for the rightmost pinned column — carries the float-edge shadow. */
  frozenRightEdge?: boolean;
  onCellSave: (row: number, col: number, newValue: any, clearEditing?: boolean) => void;
  onCellContextMenu?: (e: React.MouseEvent, row: number, col: number) => void;
  annotationColor?: string | null;
  commentCount?: number;
  /**
   * B9 — comments are switched on for this table, so the FOCUSED cell shows a
   * ghosted comment affordance even when it has no thread yet.
   *
   * The workshop finding was blunt: the only way in was `Shift`+click and the
   * product owner could not find his own feature ("Ja sam tego nie znalazłem").
   * Google Sheets' answer is adopted — the affordance appears on the ACTIVE
   * cell only, never on every hovered cell, because an icon on 2,000 cells is
   * noise rather than discoverability.
   */
  commentsEnabled?: boolean;
  /**
   * Colour-block adjacency, computed in the MODEL (see utils/colorAdjacency.ts)
   * and passed down — never discovered by scanning rendered cells, because a
   * neighbour that is scrolled out of the virtualization window is still a
   * neighbour. Drives the `data-cb-*` attributes the v2 theme reads to round
   * only the outer corners of a same-coloured block.
   */
  colorAbove?: boolean;
  colorBelow?: boolean;
  colorLeft?: boolean;
  colorRight?: boolean;
  /**
   * View-scoped highlighting rules, COMPILED ONCE per rule-set change by
   * `DynamicTable` and passed down. Never compile here: this runs per cell per
   * render, and compiling 20 rules 2,500 times a frame is the whole reason the
   * compile step exists.
   */
  compiledFormats?: CompiledConditionalFormats;
}

const Cell: React.FC<CellProps> = memo(({ row, col, colConfig, ariaColIndex, stickyLeft, stickyRight, frozenRightEdge, onCellSave, onCellContextMenu, annotationColor, commentCount, commentsEnabled, colorAbove, colorBelow, colorLeft, colorRight, compiledFormats }) => {
  const store = useCellStore();
  const state = useCellState(row, col);
  const inputRef = useRef<any>(null);
  const rowData = store.getRowData(row);

  // Get value from rowData using the column's data key (not numeric index)
  // This ensures correct values are displayed when columns are reordered
  const cellValue = rowData?.[colConfig.data];

  // Set by Escape, cleared when the next edit starts. `handleCancel` moves focus
  // back to the grid while the editor is STILL MOUNTED, so every editor's
  // `onBlur → onSave` fired right after Escape and committed the text the user
  // had just abandoned (found driving the FMS transport table). A cancelled
  // edit ignores that trailing save — one guard here covers every editor.
  const cancelledRef = useRef(false);
  const wasEditingRef = useRef(false);

  const handleSave = useCallback(
    (value?: any, clearEditing: boolean = true) => {
      if (cancelledRef.current) return;
      const newValue = value !== undefined ? value : cellValue;
      onCellSave(row, col, newValue, clearEditing);
    },
    [cellValue, row, col, onCellSave]
  );

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    store.clearEditing();
    store.focusTable();
  }, [store]);

  const handleChange = useCallback(
    (value: any) => {
      // For intermediate changes during editing, we don't update the store
      // The editor holds its own local state
    },
    []
  );

  // A new edit starts un-cancelled.
  if (state.isEditing && cancelledRef.current && !wasEditingRef.current) cancelledRef.current = false;
  wasEditingRef.current = state.isEditing;

  // Focus input when editing starts
  useEffect(() => {
    if (state.isEditing && inputRef.current) {
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          // Only set selection for input types that support it (not checkbox, radio, etc.)
          const supportsSelection =
            inputRef.current.type === undefined || // textarea
            ['text', 'password', 'search', 'tel', 'url', 'number'].includes(inputRef.current.type);
          if (supportsSelection && inputRef.current.setSelectionRange) {
            const length = inputRef.current.value?.length || 0;
            try {
              inputRef.current.setSelectionRange(length, length);
            } catch {
              // Some input types may still throw, ignore silently
            }
          }
        }
      }, 0);
    }
  }, [state.isEditing]);

  const minColWidth = colConfig.width || 100;
  const style: React.CSSProperties = {
    width: colConfig.width || 100,
    flexBasis: colConfig.width || 100,
    minWidth: minColWidth,
    flexShrink: 0,
    flexGrow: 0,
    position: 'relative',
  };

  if (stickyLeft !== undefined) {
    style.position = 'sticky';
    style.left = stickyLeft;
    style.zIndex = 2;
  } else if (stickyRight !== undefined) {
    style.position = 'sticky';
    style.right = stickyRight;
    style.zIndex = 2;
  }

  const renderer = getCellRenderer(colConfig);
  // `rowData` is briefly undefined when the dataset shrinks (a search narrows
  // the rows): a cell subscribed to a now-stale index re-renders before its row
  // unmounts. A column's own renderer is written for real rows — Documents'
  // name renderer reads `rowData.sectionCount` — and calling it with undefined
  // took the whole page down. The cell shell still renders (its data-row /
  // data-col keep pointer hit-testing intact for that one frame); only its
  // content is skipped.
  const hasRow = rowData != null;
  const renderedValue = hasRow ? renderer(cellValue, rowData, colConfig, row, col) : null;
  const hasCustomRenderer = typeof colConfig.renderer === 'function';
  // Precedence is deliberate: a code-level `cellClassName` declared by the
  // module WINS over a user's highlighting rule. The module knows something the
  // user does not (an overdue invoice, a failed sync), and a view-scoped colour
  // must not be able to hide it.
  const conditionalClassName =
    (hasRow &&
      (colConfig.cellClassName?.(cellValue, rowData, row, col) ||
        (compiledFormats
          ? conditionalFormatClassName(compiledFormats, colConfig.data, cellValue, rowData)
          : undefined))) ||
    '';
  const alignClass = colConfig.align ? `cell-align-${colConfig.align}` : '';
  const monoClass = colConfig.mono ? 'cell-mono' : '';
  // Dropdown / multiselect columns render as a bordered "select" control at
  // rest in v2 (Figma "Wybierz…" + chevron). Harmless in legacy — only the v2
  // theme styles `.cell-select`.
  const selectClass = (colConfig.type === 'dropdown' || colConfig.type === 'multiselect') ? 'cell-select' : '';

  // The fill-handle nub sits on the bottom-right corner of the selection —
  // whatever its size. `isFillOrigin` is computed in the STORE, which is the
  // only place that can see the whole selection AND the column defs: an N×M
  // source containing one read-only column must still offer a handle. The old
  // test lived here and keyed off "all four range edges true", which is a clever
  // way of writing "1×1" — precisely the line that hard-coded single-cell
  // sourcing. Whether the feature is enabled at all stays gated by the
  // container's `[data-fill-enabled]` attribute via CSS.
  const showFillHandle = state.isFillOrigin;

  // B9 — "the active cell", i.e. a selection of exactly this one cell. A plain
  // click produces a 1×1 `range`, never `type: 'cell'` (that variant is only
  // written by the keyboard paths), so `state.isSelected` alone would leave the
  // ghost affordance invisible for the mouse users the finding is about. All
  // four range edges on one cell IS one cell.
  // Deliberately not shown across a multi-cell range: one ghost per selection,
  // never twenty. The range route is the context menu and Shift+F2.
  const isSoleSelectedCell =
    state.isSelected ||
    (state.isInRange &&
      !!state.rangeEdges.top &&
      !!state.rangeEdges.bottom &&
      !!state.rangeEdges.left &&
      !!state.rangeEdges.right);

  return (
    <td
      className={`hot-cell ${colConfig.readOnly ? 'read-only' : ''} ${conditionalClassName} ${annotationColor ? `cell-color-${annotationColor}` : ''} ${alignClass} ${monoClass} ${selectClass}`.replace(/\s+/g, ' ').trim()}
      style={style}
      data-row={row}
      data-col={col}
      aria-colindex={ariaColIndex}
      data-cell-selected={state.isSelected}
      data-in-range={state.isInRange}
      data-range-top={state.rangeEdges.top}
      data-range-bottom={state.rangeEdges.bottom}
      data-range-left={state.rangeEdges.left}
      data-range-right={state.rangeEdges.right}
      data-fill-preview={state.isFillPreview || undefined}
      data-fill-top={state.fillEdges.top || undefined}
      data-fill-bottom={state.fillEdges.bottom || undefined}
      data-fill-left={state.fillEdges.left || undefined}
      data-fill-right={state.fillEdges.right || undefined}
      data-fill-target={state.isFillTarget || undefined}
      data-fill-clear={state.isFillClearing || undefined}
      data-save-state={state.saveState}
      data-sticky-left={stickyLeft !== undefined}
      data-sticky-right={stickyRight !== undefined}
      data-frozen-edge={frozenRightEdge || undefined}
      data-custom-renderer={hasCustomRenderer || undefined}
      data-has-comment={commentCount && commentCount > 0 ? 'true' : undefined}
      data-cb-above={colorAbove ? 'true' : undefined}
      data-cb-below={colorBelow ? 'true' : undefined}
      data-cb-left={colorLeft ? 'true' : undefined}
      data-cb-right={colorRight ? 'true' : undefined}
      onContextMenu={onCellContextMenu ? (e) => { e.preventDefault(); onCellContextMenu(e, row, col); } : undefined}
    >
      {state.isEditing
        ? getCellEditor(
          colConfig,
          cellValue,
          handleChange,
          handleSave,
          handleCancel,
          rowData,
          row,
          col,
          inputRef
        )
        : hasCustomRenderer
          ? renderedValue
          : <span className="cell-content" title={typeof cellValue === 'string' ? cellValue : undefined}>{renderedValue}</span>}
      {/* B9 — the ghost affordance. Same element, same geometry and the same
          click target as a real indicator, so a user who discovers it on the
          focused cell has already learned what the solid one does.

          Shown on the SELECTED cell and on the HOVERED one (ledger 8.1: hover
          painted a selection box and nothing else, which is where a user looks
          first). `state.isHovered` comes from the store, so this stays exactly
          one extra element on screen — putting it on every cell would add an
          inline SVG to all ~300 mounted cells, and this grid's whole density
          argument is that cells must get CHEAPER, not heavier.

          Never while editing: an open editor owns the cell. */}
      {commentsEnabled && !commentCount && (isSoleSelectedCell || state.isHovered) && !state.isEditing && (
        <span
          // The HOVER-only variant does not get the cell's reserved right
          // gutter (see the `:has()` rule in DynamicTable.v2.css). Reserving it
          // on hover would re-ellipsize the value under the pointer, so moving
          // across a row would make every cell's text twitch. It floats on its
          // own chip over the tail of the value instead.
          className={`cell-comment-indicator cell-comment-indicator-ghost${isSoleSelectedCell ? '' : ' cell-comment-indicator-hover'}`}
          data-no-row-click
          data-comment-add="true"
          title="Add a comment (Shift+F2)"
          aria-label="Add a comment"
        >
          <svg width="15" height="14" viewBox="0 0 15 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7.29167 5.95833H7.29833M9.95833 5.95833H9.965M4.625 5.95833H4.63167M13.9583 9.95833C13.9583 10.312 13.8179 10.6511 13.5678 10.9011C13.3178 11.1512 12.9786 11.2917 12.625 11.2917H3.84367C3.49007 11.2917 3.15099 11.4323 2.901 11.6823L1.433 13.1503C1.3668 13.2165 1.28247 13.2616 1.19066 13.2798C1.09885 13.2981 1.00369 13.2887 0.917205 13.2529C0.830722 13.2171 0.756802 13.1564 0.70479 13.0786C0.652779 13.0008 0.625012 12.9093 0.625 12.8157V1.95833C0.625 1.60471 0.765476 1.26557 1.01552 1.01552C1.26557 0.765476 1.60471 0.625 1.95833 0.625H12.625C12.9786 0.625 13.3178 0.765476 13.5678 1.01552C13.8179 1.26557 13.9583 1.60471 13.9583 1.95833V9.95833Z" />
          </svg>
        </span>
      )}
      {commentCount != null && commentCount > 0 && (
        <span className="cell-comment-indicator" data-no-row-click title={`${commentCount} comment${commentCount > 1 ? 's' : ''}`}>
          <svg width="15" height="14" viewBox="0 0 15 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7.29167 5.95833H7.29833M9.95833 5.95833H9.965M4.625 5.95833H4.63167M13.9583 9.95833C13.9583 10.312 13.8179 10.6511 13.5678 10.9011C13.3178 11.1512 12.9786 11.2917 12.625 11.2917H3.84367C3.49007 11.2917 3.15099 11.4323 2.901 11.6823L1.433 13.1503C1.3668 13.2165 1.28247 13.2616 1.19066 13.2798C1.09885 13.2981 1.00369 13.2887 0.917205 13.2529C0.830722 13.2171 0.756802 13.1564 0.70479 13.0786C0.652779 13.0008 0.625012 12.9093 0.625 12.8157V1.95833C0.625 1.60471 0.765476 1.26557 1.01552 1.01552C1.26557 0.765476 1.60471 0.625 1.95833 0.625H12.625C12.9786 0.625 13.3178 0.765476 13.5678 1.01552C13.8179 1.26557 13.9583 1.60471 13.9583 1.95833V9.95833Z" />
          </svg>
        </span>
      )}
      {/* MARCHING ANTS — the outline that says what is on the clipboard.
          A real element rather than a `::before`, because both of this cell's
          pseudo-elements are already spoken for: `::after` carries the range
          outline and `::before` carries the fill-preview rectangle AND the
          frozen-column divider. The ants PERSIST (until Escape or a paste),
          so borrowing `::before` would take the frozen divider away for as
          long as something is copied — a fill drag can accept that collision
          because it lasts a few hundred milliseconds; this cannot.
          One span, four edges: which edges paint is decided by the store
          (`clipboardEdges`), so only the OUTER border of the block is drawn. */}
      {state.isClipboardSource && (
        <span
          className="hot-clip-ants"
          data-clip-mode={state.clipboardMode ?? undefined}
          data-clip-top={state.clipboardEdges.top || undefined}
          data-clip-bottom={state.clipboardEdges.bottom || undefined}
          data-clip-left={state.clipboardEdges.left || undefined}
          data-clip-right={state.clipboardEdges.right || undefined}
          aria-hidden="true"
        />
      )}
      {showFillHandle && (
        <div className="fill-handle" data-fill-handle="true" data-no-row-click aria-hidden="true" />
      )}
    </td>
  );
});

Cell.displayName = 'Cell';

export default Cell;
