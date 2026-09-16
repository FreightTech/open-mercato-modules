// utils/fillGeometry.ts
//
// Where a fill drag is pointing. PURE: no DOM, no store, no React.
//
// This is the single most important testability move in the rectangle-fill
// work: axis lock and back-drag are the two rules users notice, and neither can
// be proven inside a `mousemove` callback. Both live here instead, so a jest
// test can assert "a diagonal drag picks the dominant axis" without a browser.
//
// Excel's fill is SINGLE-AXIS. The axis is chosen by the larger overshoot from
// the source block's edge; the other axis is clamped to the source's extent.
// Dragging back INSIDE the source clears the part you dragged back over.

import type { FillAxis, FillPreview, SelectionBounds } from '../types/index';
import type { FillMode } from './fillPatterns';
import { invertFillMode } from './fillPatterns';

export interface FillPointer {
  row: number;
  col: number;
}

export interface ComputeFillPreviewOptions {
  /** `Ctrl`/`Alt` held. Inverts the pattern's default copy <-> series. */
  modifier: boolean;
  /** The mode the detected pattern would use with no modifier held. */
  defaultMode: FillMode;
}

/** Inclusive cell count of a rectangle. */
export function rectSize(bounds: SelectionBounds): number {
  return (
    (bounds.endRow - bounds.startRow + 1) * (bounds.endCol - bounds.startCol + 1)
  );
}

export function isCellInRect(row: number, col: number, bounds: SelectionBounds): boolean {
  return (
    row >= bounds.startRow &&
    row <= bounds.endRow &&
    col >= bounds.startCol &&
    col <= bounds.endCol
  );
}

/** How far outside `[lo, hi]` a coordinate sits. 0 when inside. */
function overshoot(value: number, lo: number, hi: number): number {
  if (value < lo) return lo - value;
  if (value > hi) return value - hi;
  return 0;
}

/**
 * The whole fill gesture, as data.
 *
 * Extending (pointer outside the source):
 *   axis      = the larger overshoot wins; a tie goes VERTICAL, because a fill
 *               drag is overwhelmingly a "drag down" and a 1px sideways wobble
 *               must not flip it;
 *   backwards = the pointer is above / left of the source;
 *   bounds    = source stretched along `axis` to the pointer, the other axis
 *               clamped to the source's own extent.
 *
 * Clearing (pointer inside the source): Excel empties everything past the
 * pointer along the shrink axis. A 1-row source has `shrinkRows === 0` and falls
 * to the horizontal branch on its own — there is no special case for it.
 */
export function computeFillPreview(
  source: SelectionBounds,
  pointer: FillPointer,
  opts: ComputeFillPreviewOptions,
): FillPreview {
  const mode = opts.modifier ? invertFillMode(opts.defaultMode) : opts.defaultMode;

  const dRow = overshoot(pointer.row, source.startRow, source.endRow);
  const dCol = overshoot(pointer.col, source.startCol, source.endCol);

  if (dRow > 0 || dCol > 0) {
    const axis: FillAxis = dRow >= dCol ? 'vertical' : 'horizontal';
    const backwards =
      axis === 'vertical' ? pointer.row < source.startRow : pointer.col < source.startCol;
    const bounds: SelectionBounds =
      axis === 'vertical'
        ? {
            startRow: Math.min(source.startRow, pointer.row),
            endRow: Math.max(source.endRow, pointer.row),
            startCol: source.startCol,
            endCol: source.endCol,
          }
        : {
            startRow: source.startRow,
            endRow: source.endRow,
            startCol: Math.min(source.startCol, pointer.col),
            endCol: Math.max(source.endCol, pointer.col),
          };
    return { source, bounds, axis, backwards, clearing: false, cleared: null, mode };
  }

  // Pointer is inside the source → back-drag. Everything BEYOND the pointer
  // along the dominant shrink axis is about to be emptied.
  const shrinkRows = source.endRow - pointer.row;
  const shrinkCols = source.endCol - pointer.col;
  const axis: FillAxis = shrinkRows >= shrinkCols ? 'vertical' : 'horizontal';
  const cleared: SelectionBounds =
    axis === 'vertical'
      ? { ...source, startRow: pointer.row + 1 }
      : { ...source, startCol: pointer.col + 1 };
  const clearing =
    axis === 'vertical' ? cleared.startRow <= cleared.endRow : cleared.startCol <= cleared.endCol;

  return {
    source,
    bounds: source,
    axis,
    backwards: false,
    clearing,
    cleared: clearing ? cleared : null,
    mode,
  };
}

/**
 * The cells a fill will WRITE, grouped into the independent series lines Excel
 * fills them with.
 *
 * Vertical fill: one line per source COLUMN, seeded by that column's rows in
 * row order. Horizontal fill: one line per source ROW, seeded by that row's
 * columns in column order. That is the rule that makes a multi-column drag
 * continue each column's own series instead of smearing one series sideways.
 *
 * Every line's `targets` are ordered ADJACENT-TO-SOURCE FIRST, which is exactly
 * the order `generateFill` returns values in — so the caller zips the two
 * without ever reversing an array.
 */
export interface FillLine {
  /** Cells of the SOURCE block for this line, in fill order. */
  seedCells: Array<{ row: number; col: number }>;
  /** Cells to write, nearest the source first. */
  targets: Array<{ row: number; col: number }>;
  /** The column whose `type` / `source` / `fillSeries` governs this line. */
  seedCol: number;
}

export function buildFillLines(preview: FillPreview): FillLine[] {
  const { source, bounds, axis, backwards } = preview;
  const lines: FillLine[] = [];

  if (axis === 'vertical') {
    for (let col = source.startCol; col <= source.endCol; col++) {
      const seedCells: Array<{ row: number; col: number }> = [];
      for (let row = source.startRow; row <= source.endRow; row++) seedCells.push({ row, col });
      const targets: Array<{ row: number; col: number }> = [];
      if (backwards) {
        for (let row = source.startRow - 1; row >= bounds.startRow; row--) targets.push({ row, col });
      } else {
        for (let row = source.endRow + 1; row <= bounds.endRow; row++) targets.push({ row, col });
      }
      lines.push({ seedCells, targets, seedCol: col });
    }
    return lines;
  }

  for (let row = source.startRow; row <= source.endRow; row++) {
    const seedCells: Array<{ row: number; col: number }> = [];
    for (let col = source.startCol; col <= source.endCol; col++) seedCells.push({ row, col });
    const targets: Array<{ row: number; col: number }> = [];
    if (backwards) {
      for (let col = source.startCol - 1; col >= bounds.startCol; col--) targets.push({ row, col });
    } else {
      for (let col = source.endCol + 1; col <= bounds.endCol; col++) targets.push({ row, col });
    }
    // Horizontal fill crosses columns, so no single column governs the line.
    // The SEED's own column supplies the pattern rules; the TARGET column
    // decides whether the value is acceptable (see coerceCellValue).
    lines.push({ seedCells, targets, seedCol: source.startCol });
  }
  return lines;
}

/** Every cell of a rectangle, row-major. Shared by the preview repaint and the commit. */
export function cellsInRect(bounds: SelectionBounds): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = [];
  for (let row = bounds.startRow; row <= bounds.endRow; row++) {
    for (let col = bounds.startCol; col <= bounds.endCol; col++) cells.push({ row, col });
  }
  return cells;
}
