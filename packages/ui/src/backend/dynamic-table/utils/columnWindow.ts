/**
 * COLUMN VIRTUALIZATION — PURE ARITHMETIC
 * =======================================
 *
 * No React, no DOM, no store. Everything that decides *which columns are
 * mounted and where the gaps go* lives here so it can be unit-tested without a
 * browser. `hooks/useColumnVirtualizer.ts` is a thin wrapper that feeds this
 * module a scroll range from `@tanstack/react-virtual` and hands the result to
 * the render tree.
 *
 * WHY THIS EXISTS
 * ---------------
 * The grid virtualizes rows only. Render cost is
 * `(visible rows + overscan) × ALL columns`, so a 60-column table pays for 60
 * columns per mounted row no matter how few are on screen. Information density
 * is a product requirement — the fix is to make cells CHEAPER, never FEWER —
 * so we stop rendering the columns nobody can see instead of showing less.
 *
 * THE CONTRACT THIS MODULE UPHOLDS (from the range-operation audit)
 * ----------------------------------------------------------------
 * A column may be unmounted while still selected, still exported, still written
 * to, still navigated onto. Consequently:
 *
 *  1. Everything here speaks in COLUMN ARRAY INDICES into the full, view-ordered
 *     `cols` array. A window never renumbers columns. `data-col` stays absolute.
 *  2. Geometry comes from the model (`store.getColumnWidth(i)`, which answers
 *     for every `i`, mounted or not) — never from `clientWidth` / `scrollWidth`
 *     / `getBoundingClientRect` at scroll time.
 *  3. Pinned (sticky-left / sticky-right / menu-frozen) columns are mounted
 *     unconditionally: `position: sticky` only works on an element that exists.
 *  4. The selection anchor, the selection focus and the editing cell are
 *     force-mountable via `forcedIndices` — `setEditingCell` on an unmounted
 *     column would mount no editor at all.
 *  5. Spacers replace the columns we skipped, so every mounted column keeps its
 *     exact natural x position. A pinned column that is force-mounted is NOT
 *     also counted inside a spacer, so the pinned block can never double-count
 *     against the scroll offset.
 *
 * COORDINATE SPACE
 * ----------------
 * All offsets are in the scroller's content space: x = 0 is the left edge of
 * the `<table>`, `leadingWidth` is the row-header gutter, column 0 therefore
 * starts at `leadingWidth`, and `trailingWidth` is the sticky Actions column.
 * This is the same space as the scroll container's `scrollLeft`.
 */

/** A half-open range of column array indices; `endIndex` is INCLUSIVE. */
export interface ColumnRange {
  startIndex: number;
  /** Inclusive. `-1` (with `startIndex: 0`) means "no columns". */
  endIndex: number;
}

/**
 * Prefix-sum geometry over the FULL column array. `starts` has
 * `columnCount + 1` entries: `starts[i]` is column `i`'s left edge and
 * `starts[columnCount]` is the right edge of the last column.
 */
export interface ColumnGeometry {
  columnCount: number;
  starts: number[];
  /** Row-header gutter (or 0). `starts[0] === leadingWidth`. */
  leadingWidth: number;
  /** Sticky Actions column (or 0). Included in `totalWidth`. */
  trailingWidth: number;
  /** leadingWidth + Σ column widths + trailingWidth. */
  totalWidth: number;
}

/** One mounted column, shaped like a `VirtualItem` so it reads familiarly. */
export interface VirtualColumn {
  /** Index into the FULL column array. Never a window-relative index. */
  index: number;
  /** Absolute left edge in scroller content space. */
  start: number;
  /** Absolute right edge. */
  end: number;
  /** Column width. */
  size: number;
  /** Stable key (`col.data` when the caller supplies `getColumnKey`). */
  key: string | number;
}

/**
 * The render plan. A row renders these left-to-right and gets pixel-identical
 * geometry to an unvirtualized row.
 */
export type ColumnRenderSegment =
  | {
      type: 'spacer';
      /** Summed width of the skipped columns. */
      width: number;
      /** First skipped column index (inclusive). */
      fromIndex: number;
      /** Last skipped column index (inclusive). */
      toIndex: number;
    }
  | { type: 'column'; column: VirtualColumn };

export interface ColumnWindow {
  /** False when virtualization is off or bypassed — every column is mounted. */
  virtualized: boolean;
  /** First mounted column index (0 when nothing is mounted). */
  startIndex: number;
  /** Last mounted column index, INCLUSIVE (-1 when nothing is mounted). */
  endIndex: number;
  /** Length of the FULL column array — the denominator for aria-colcount. */
  columnCount: number;
  /** Every mounted index, ascending, unique: window ∪ pinned ∪ forced. */
  mountedIndices: number[];
  /** Mounted columns with absolute geometry, ascending by index. */
  virtualColumns: VirtualColumn[];
  /** Spacers + columns, in render order. Widths always sum to `totalWidth`. */
  segments: ColumnRenderSegment[];
  /** Width of the unmounted columns BEFORE the first mounted one. */
  paddingLeft: number;
  /** Width of the unmounted columns AFTER the last mounted one. */
  paddingRight: number;
  /** Full-table width — unchanged by virtualization. */
  totalWidth: number;
  leadingWidth: number;
  trailingWidth: number;
  /** leadingWidth + Σ widths of sticky/frozen LEFT columns (the left occluder). */
  pinnedLeftWidth: number;
  /** trailingWidth + Σ widths of sticky RIGHT columns (the right occluder). */
  pinnedRightWidth: number;
  /** O(1). Range operations ask this before touching the DOM. */
  isColumnMounted: (index: number) => boolean;
}

/**
 * DEFAULT HORIZONTAL OVERSCAN — deliberately 3, not the row virtualizer's 10.
 *
 * Overscan is a pixel budget dressed up as an item count, and the two axes have
 * very different pixel-per-item ratios:
 *
 *   • Rows are 32px (density 'xs') to 44px ('md'). The row virtualizer's
 *     overscan of 10 therefore pre-renders ~320–440px above and below.
 *   • Columns default to 100px and are commonly 120–200px. Three columns is
 *     ~300–600px on each side — the SAME pixel buffer for a third of the items.
 *
 * The cost asymmetry runs the other way, which is why we do not simply copy 10:
 * one extra overscanned column costs (mounted rows ≈ 40) extra cells, whereas
 * one extra overscanned row costs (mounted columns ≈ 20) extra cells. A
 * horizontal overscan of 10 on a 60-column grid would mount roughly as many
 * cells as not virtualizing at all on a normal monitor.
 *
 * The trade is against blank flashes on fast horizontal scroll. Horizontal
 * scrolling here is shift+wheel, a trackpad two-finger pan, or a drag on the
 * scrollbar — all materially slower in items/second than a vertical fling, and
 * `overscan: 0` on the underlying virtualizer means the React commit happens the
 * moment the base range changes, one full column ahead of the viewport edge.
 * Three columns buys ~2–4 frames of headroom at typical pan speeds.
 *
 * DO NOT raise this to "fix" a blank flash. A blank flash is a commit-latency
 * bug (a re-render blocked by unmemoized work — see Defect 5); inflating the
 * mounted set to hide it spends exactly the density budget this work exists to
 * buy back.
 */
export const DEFAULT_COLUMN_OVERSCAN = 3;

/** An empty range, spelled once so callers can compare against it meaningfully. */
export const EMPTY_COLUMN_RANGE: ColumnRange = { startIndex: 0, endIndex: -1 };

function clampIndex(value: number, columnCount: number): number {
  if (columnCount <= 0) return 0;
  if (value < 0) return 0;
  if (value > columnCount - 1) return columnCount - 1;
  return value;
}

/**
 * Builds the prefix-sum table. O(n) over the FULL column array — deliberately
 * not over the window, because a window cannot know where it starts without it.
 *
 * `getColumnWidth` is expected to be `store.getColumnWidth`, which answers for
 * any index whether or not the column is mounted. Widths are user-resizable, so
 * the caller must rebuild this whenever a width changes (see the hook's
 * `widthRevision`).
 */
export function computeColumnGeometry(
  columnCount: number,
  getColumnWidth: (index: number) => number,
  options: { leadingWidth?: number; trailingWidth?: number } = {}
): ColumnGeometry {
  const leadingWidth = options.leadingWidth ?? 0;
  const trailingWidth = options.trailingWidth ?? 0;
  const count = Math.max(0, columnCount);
  const starts = new Array<number>(count + 1);
  let x = leadingWidth;
  starts[0] = x;
  for (let i = 0; i < count; i++) {
    const width = getColumnWidth(i);
    x += Number.isFinite(width) && width > 0 ? width : 0;
    starts[i + 1] = x;
  }
  return {
    columnCount: count,
    starts,
    leadingWidth,
    trailingWidth,
    totalWidth: x + trailingWidth,
  };
}

/** Width of a single column, straight off the geometry. */
export function getGeometryColumnWidth(geometry: ColumnGeometry, index: number): number {
  if (index < 0 || index >= geometry.columnCount) return 0;
  return geometry.starts[index + 1] - geometry.starts[index];
}

/** Summed width of an inclusive index range. `to < from` yields 0. */
export function getRangeWidth(geometry: ColumnGeometry, from: number, to: number): number {
  if (geometry.columnCount === 0 || to < from) return 0;
  const lo = clampIndex(from, geometry.columnCount);
  const hi = clampIndex(to, geometry.columnCount);
  if (hi < lo) return 0;
  return geometry.starts[hi + 1] - geometry.starts[lo];
}

/**
 * Binary search: the index of the column containing `x` (the last column whose
 * left edge is <= x). Clamped into range, so an `x` left of the first column
 * returns 0 and an `x` past the end returns `columnCount - 1`.
 */
export function findColumnIndexAtOffset(geometry: ColumnGeometry, x: number): number {
  const { columnCount, starts } = geometry;
  if (columnCount === 0) return -1;
  if (x <= starts[0]) return 0;
  if (x >= starts[columnCount]) return columnCount - 1;
  let lo = 0;
  let hi = columnCount - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The columns whose boxes intersect `[scrollLeft, scrollLeft + viewportWidth)`,
 * with no overscan. This is the reference implementation of the base range: the
 * hook normally takes the same range from `@tanstack/react-virtual` (which owns
 * the scroll/resize plumbing), and falls back to this when it needs a window
 * without a live virtualizer — headless callers, SSR, and tests.
 *
 * FAIL-OPEN: a non-positive `viewportWidth` means "we have not measured yet".
 * Returning the full range there mounts everything — correct but slow — which
 * is the only acceptable direction to fail. Returning an empty range would
 * paint an empty grid.
 */
export function computeVisibleRange(
  geometry: ColumnGeometry,
  scrollLeft: number,
  viewportWidth: number
): ColumnRange {
  const { columnCount, starts } = geometry;
  if (columnCount === 0) return EMPTY_COLUMN_RANGE;
  if (!(viewportWidth > 0)) return { startIndex: 0, endIndex: columnCount - 1 };

  const left = Math.max(scrollLeft, starts[0]);
  const right = scrollLeft + viewportWidth;

  const startIndex = findColumnIndexAtOffset(geometry, left);
  let endIndex = startIndex;
  while (endIndex + 1 < columnCount && starts[endIndex + 1] < right) endIndex++;
  return { startIndex, endIndex };
}

/** Grows a range by `overscan` columns on each side, clamped to the array. */
export function expandColumnRange(
  range: ColumnRange,
  overscan: number,
  columnCount: number
): ColumnRange {
  if (columnCount <= 0 || range.endIndex < range.startIndex) return EMPTY_COLUMN_RANGE;
  const pad = Math.max(0, Math.floor(overscan));
  return {
    startIndex: Math.max(0, range.startIndex - pad),
    endIndex: Math.min(columnCount - 1, range.endIndex + pad),
  };
}

/**
 * Derives the pinned column indices from the grid's two independent pinning
 * sources, both keyed by column DATA KEY so they survive a reorder:
 *
 *   • static  — `ColumnDef.sticky === 'left' | 'right'`
 *   • runtime — the `frozenColumns: Set<string>` toggled from the header menu
 *               and persisted per-perspective
 *
 * A frozen column is pinned LEFT unless it is already statically sticky-right;
 * that mirrors `effectiveLeftOffsets` in DynamicTable, which folds the runtime
 * frozen set on top of the static left offsets.
 */
export function getPinnedColumnIndices(
  columns: readonly { data: string; sticky?: 'left' | 'right' }[],
  frozenColumns?: ReadonlySet<string> | null
): { left: number[]; right: number[] } {
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.sticky === 'right') {
      right.push(i);
    } else if (col.sticky === 'left' || frozenColumns?.has(col.data)) {
      left.push(i);
    }
  }
  return { left, right };
}

/**
 * The mounted set: `window ∪ pinned-left ∪ pinned-right ∪ forced`, ascending and
 * de-duplicated. `forced` carries the selection anchor, the selection focus and
 * the editing cell — moving the selection onto a column and then failing to
 * mount it is how you get an invisible cursor and a missing editor.
 *
 * Out-of-range indices are dropped rather than throwing: `forced` comes from
 * selection state that can outlive a column being hidden by a perspective.
 */
export function mergePinnedColumns(
  range: ColumnRange,
  options: {
    columnCount: number;
    pinnedLeftIndices?: readonly number[];
    pinnedRightIndices?: readonly number[];
    forcedIndices?: readonly number[];
  }
): number[] {
  const { columnCount } = options;
  if (columnCount <= 0) return [];
  const mounted = new Set<number>();
  if (range.endIndex >= range.startIndex) {
    const from = Math.max(0, range.startIndex);
    const to = Math.min(columnCount - 1, range.endIndex);
    for (let i = from; i <= to; i++) mounted.add(i);
  }
  const add = (list?: readonly number[]) => {
    if (!list) return;
    for (const index of list) {
      if (Number.isInteger(index) && index >= 0 && index < columnCount) mounted.add(index);
    }
  };
  add(options.pinnedLeftIndices);
  add(options.pinnedRightIndices);
  add(options.forcedIndices);
  return Array.from(mounted).sort((a, b) => a - b);
}

/**
 * Turns a mounted index list into the left-to-right render plan.
 *
 * Gaps become spacers — INCLUDING interior gaps. That is what lets a pinned
 * column that sits far to the left stay mounted without being double-counted:
 * it occupies its own real box at its own natural x, and only the columns
 * actually skipped are folded into a spacer. Widths always sum to
 * `totalWidth - leadingWidth - trailingWidth`.
 */
export function buildColumnRenderPlan(
  mountedIndices: readonly number[],
  geometry: ColumnGeometry,
  getColumnKey?: (index: number) => string | number
): { segments: ColumnRenderSegment[]; virtualColumns: VirtualColumn[] } {
  const segments: ColumnRenderSegment[] = [];
  const virtualColumns: VirtualColumn[] = [];
  let cursor = 0;

  for (const index of mountedIndices) {
    if (index > cursor) {
      segments.push({
        type: 'spacer',
        width: getRangeWidth(geometry, cursor, index - 1),
        fromIndex: cursor,
        toIndex: index - 1,
      });
    }
    const column: VirtualColumn = {
      index,
      start: geometry.starts[index],
      end: geometry.starts[index + 1],
      size: geometry.starts[index + 1] - geometry.starts[index],
      key: getColumnKey ? getColumnKey(index) : index,
    };
    virtualColumns.push(column);
    segments.push({ type: 'column', column });
    cursor = index + 1;
  }

  if (cursor < geometry.columnCount) {
    segments.push({
      type: 'spacer',
      width: getRangeWidth(geometry, cursor, geometry.columnCount - 1),
      fromIndex: cursor,
      toIndex: geometry.columnCount - 1,
    });
  }

  return { segments, virtualColumns };
}

export interface BuildColumnWindowInput {
  geometry: ColumnGeometry;
  /**
   * Base (un-overscanned) range. Supply it from the underlying virtualizer;
   * omit it and `scrollLeft` / `viewportWidth` are used instead.
   */
  range?: ColumnRange | null;
  scrollLeft?: number;
  viewportWidth?: number;
  overscan?: number;
  pinnedLeftIndices?: readonly number[];
  pinnedRightIndices?: readonly number[];
  forcedIndices?: readonly number[];
  getColumnKey?: (index: number) => string | number;
}

function summedWidth(geometry: ColumnGeometry, indices?: readonly number[]): number {
  if (!indices || indices.length === 0) return 0;
  let total = 0;
  for (const index of indices) total += getGeometryColumnWidth(geometry, index);
  return total;
}

function finalizeWindow(
  geometry: ColumnGeometry,
  mountedIndices: number[],
  virtualized: boolean,
  pinnedLeftIndices: readonly number[] | undefined,
  pinnedRightIndices: readonly number[] | undefined,
  getColumnKey?: (index: number) => string | number
): ColumnWindow {
  const { segments, virtualColumns } = buildColumnRenderPlan(
    mountedIndices,
    geometry,
    getColumnKey
  );
  const mountedSet = new Set(mountedIndices);
  const first = mountedIndices[0];
  const last = mountedIndices[mountedIndices.length - 1];

  return {
    virtualized,
    startIndex: mountedIndices.length ? first : 0,
    endIndex: mountedIndices.length ? last : -1,
    columnCount: geometry.columnCount,
    mountedIndices,
    virtualColumns,
    segments,
    paddingLeft: mountedIndices.length ? getRangeWidth(geometry, 0, first - 1) : 0,
    paddingRight: mountedIndices.length
      ? getRangeWidth(geometry, last + 1, geometry.columnCount - 1)
      : getRangeWidth(geometry, 0, geometry.columnCount - 1),
    totalWidth: geometry.totalWidth,
    leadingWidth: geometry.leadingWidth,
    trailingWidth: geometry.trailingWidth,
    pinnedLeftWidth: geometry.leadingWidth + summedWidth(geometry, pinnedLeftIndices),
    pinnedRightWidth: geometry.trailingWidth + summedWidth(geometry, pinnedRightIndices),
    isColumnMounted: (index: number) => mountedSet.has(index),
  };
}

/**
 * Every column mounted, no spacers. Used when virtualization is switched off,
 * and as the fail-open result when geometry has not been measured yet.
 */
export function createFullColumnWindow(
  geometry: ColumnGeometry,
  options: {
    pinnedLeftIndices?: readonly number[];
    pinnedRightIndices?: readonly number[];
    getColumnKey?: (index: number) => string | number;
  } = {}
): ColumnWindow {
  const mounted: number[] = new Array(geometry.columnCount);
  for (let i = 0; i < geometry.columnCount; i++) mounted[i] = i;
  return finalizeWindow(
    geometry,
    mounted,
    false,
    options.pinnedLeftIndices,
    options.pinnedRightIndices,
    options.getColumnKey
  );
}

/** The one entry point: range → overscan → pinned merge → render plan. */
export function buildColumnWindow(input: BuildColumnWindowInput): ColumnWindow {
  const {
    geometry,
    pinnedLeftIndices,
    pinnedRightIndices,
    forcedIndices,
    getColumnKey,
  } = input;

  if (geometry.columnCount === 0) {
    return finalizeWindow(geometry, [], true, pinnedLeftIndices, pinnedRightIndices, getColumnKey);
  }

  const baseRange =
    input.range ??
    computeVisibleRange(geometry, input.scrollLeft ?? 0, input.viewportWidth ?? 0);

  const overscanned = expandColumnRange(
    baseRange,
    input.overscan ?? DEFAULT_COLUMN_OVERSCAN,
    geometry.columnCount
  );

  const mountedIndices = mergePinnedColumns(overscanned, {
    columnCount: geometry.columnCount,
    pinnedLeftIndices,
    pinnedRightIndices,
    forcedIndices,
  });

  return finalizeWindow(
    geometry,
    mountedIndices,
    true,
    pinnedLeftIndices,
    pinnedRightIndices,
    getColumnKey
  );
}

// ============================================================================
// INDEX MAPPING — "visual" (position among rendered cells) ↔ column array index
// ============================================================================
//
// The grid addresses cells as (rowIndex, colIndex) into the FULL column array,
// and `data-col` must keep carrying that absolute index or every pointer
// hit-test in handlers/index.ts silently retargets. These two helpers exist for
// the narrow cases that genuinely need the rendered position — DOM sibling
// walks, focus order, screen-reader ordering — and nothing else should use them.

/** Position of `columnIndex` among the mounted columns, or -1 if unmounted. */
export function columnIndexToVisualIndex(window: ColumnWindow, columnIndex: number): number {
  // mountedIndices is ascending, so binary search rather than indexOf.
  const list = window.mountedIndices;
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] === columnIndex) return mid;
    if (list[mid] < columnIndex) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Column array index rendered at mounted position `visualIndex`, or -1. */
export function visualIndexToColumnIndex(window: ColumnWindow, visualIndex: number): number {
  if (visualIndex < 0 || visualIndex >= window.mountedIndices.length) return -1;
  return window.mountedIndices[visualIndex];
}

/** Convenience predicate for range operations that only hold a window. */
export function isColumnMounted(window: ColumnWindow, columnIndex: number): boolean {
  return window.isColumnMounted(columnIndex);
}

// ============================================================================
// ACCESSIBILITY
// ============================================================================
//
// Unmounted columns break grid semantics if `aria-colcount` / `aria-colindex`
// are inferred from the DOM: a screen reader would announce "column 4 of 12"
// while the user is on column 37 of 60. Both are therefore computed from the
// FULL column list, exactly like `data-col`. A grid whose rendered cells are a
// subset MUST set `aria-colcount` on the grid and `aria-colindex` on every cell
// and header — omitting `aria-colindex` is only legal when the DOM is complete.

/** 1-based total, counting the row-header and Actions columns when present. */
export function getAriaColCount(
  columnCount: number,
  options: { hasRowHeader?: boolean; hasActionsColumn?: boolean } = {}
): number {
  return (
    columnCount + (options.hasRowHeader ? 1 : 0) + (options.hasActionsColumn ? 1 : 0)
  );
}

/** 1-based aria index of a data column; the row header occupies index 1. */
export function getAriaColIndex(
  columnIndex: number,
  options: { hasRowHeader?: boolean } = {}
): number {
  return columnIndex + 1 + (options.hasRowHeader ? 1 : 0);
}

// ============================================================================
// SCROLL-INTO-VIEW
// ============================================================================

export type ColumnScrollAlign = 'auto' | 'start' | 'end' | 'center';

/**
 * The `scrollLeft` that brings `columnIndex` into view, or `null` when no scroll
 * is needed (already visible under `'auto'`, or the column is pinned and can
 * never be scrolled away from).
 *
 * The pinned block occludes the viewport's left and right edges, so a column is
 * only "visible" between `pinnedLeftWidth` and `viewportWidth - pinnedRightWidth`
 * — scrolling a cell to `scrollLeft` exactly would park it underneath a frozen
 * column and it would look like nothing happened.
 *
 * This exists because there is currently NO horizontal scroll-into-view anywhere
 * in the grid. Keyboard navigation and `setEditingCell` move the selection by
 * index, which under column virtualization can land on a column that is not
 * mounted — the caller must scroll in the same commit, before any focus attempt.
 */
export function computeScrollLeftToReveal(
  geometry: ColumnGeometry,
  columnIndex: number,
  options: {
    scrollLeft: number;
    viewportWidth: number;
    /** Left occluder — `ColumnWindow.pinnedLeftWidth`. */
    pinnedLeftWidth?: number;
    /** Right occluder — `ColumnWindow.pinnedRightWidth`. */
    pinnedRightWidth?: number;
    align?: ColumnScrollAlign;
    /** Indices that are pinned and therefore always visible. */
    pinnedIndices?: readonly number[];
  }
): number | null {
  const { columnCount } = geometry;
  if (columnIndex < 0 || columnIndex >= columnCount) return null;
  if (options.pinnedIndices?.includes(columnIndex)) return null;

  const viewportWidth = options.viewportWidth;
  if (!(viewportWidth > 0)) return null;

  const gutterLeft = options.pinnedLeftWidth ?? geometry.leadingWidth;
  const gutterRight = options.pinnedRightWidth ?? geometry.trailingWidth;
  const align = options.align ?? 'auto';

  const columnStart = geometry.starts[columnIndex];
  const columnEnd = geometry.starts[columnIndex + 1];

  const maxScroll = Math.max(0, geometry.totalWidth - viewportWidth);
  const clamp = (value: number) => Math.min(Math.max(value, 0), maxScroll);

  const alignStart = () => clamp(columnStart - gutterLeft);
  const alignEnd = () => clamp(columnEnd + gutterRight - viewportWidth);

  if (align === 'start') return alignStart();
  if (align === 'end') return alignEnd();
  if (align === 'center') {
    const usable = viewportWidth - gutterLeft - gutterRight;
    return clamp(columnStart - gutterLeft - Math.max(0, (usable - (columnEnd - columnStart)) / 2));
  }

  // 'auto': only move if the column is actually occluded. A column wider than
  // the usable viewport aligns to its start, so at least its leading edge and
  // its content anchor are visible.
  const visibleStart = options.scrollLeft + gutterLeft;
  const visibleEnd = options.scrollLeft + viewportWidth - gutterRight;
  if (columnStart < visibleStart) return alignStart();
  if (columnEnd > visibleEnd) {
    if (columnEnd - columnStart > visibleEnd - visibleStart) return alignStart();
    return alignEnd();
  }
  return null;
}
