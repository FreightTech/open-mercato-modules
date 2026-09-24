/**
 * HORIZONTAL (COLUMN) VIRTUALIZATION — REACT WRAPPER
 * ==================================================
 *
 * A thin wrapper. All correctness lives in `../utils/columnWindow.ts`, which is
 * pure and unit-tested; this file only owns the three things that need React
 * and the DOM:
 *
 *   1. subscribing to scroll/resize (delegated to `@tanstack/react-virtual`,
 *      which already does the rAF batching, passive listeners, `scrollend`
 *      handling and `ResizeObserver` teardown correctly),
 *   2. rebuilding geometry when the user resizes a column,
 *   3. writing `scrollLeft` for scroll-into-view.
 *
 * WHY THE UNDERLYING VIRTUALIZER RUNS AT `overscan: 0`
 * ----------------------------------------------------
 * We apply overscan ourselves in `buildColumnWindow`, because our mounted set is
 * `window ∪ pinned ∪ forced` and the library has no concept of a force-mounted
 * item. Our window is a pure function of the library's base range, so it changes
 * exactly when the base range changes — running the library at `overscan: 0`
 * therefore costs no extra re-renders and gives us the earliest possible commit
 * (one full column before the viewport edge).
 *
 * WHY WE NEVER CALL `measureElement`
 * ----------------------------------
 * Column widths are already fully model-held: `store.getColumnWidth(i)` answers
 * for every `i` whether or not the column is mounted, resizing writes straight
 * to that map without touching the DOM, and widths persist by `col.data`.
 * Measuring the DOM instead would make geometry depend on what happens to be
 * mounted, which is the exact feedback loop that makes a virtualized grid
 * jitter. `estimateSize` reads the model and is authoritative.
 *
 * OPT-IN, NOT OPT-OUT
 * -------------------
 * `enabled` defaults to FALSE. 56 consumer files pass 231 renderer functions
 * into this grid and the renderer contract must not change; column
 * virtualization ships behind `uiConfig.enableColumnVirtualization` so the
 * stress fixture and the container table can adopt it first. When disabled this
 * hook still runs (hook order is fixed) but returns a full window — every column
 * mounted, no spacers, `virtualized: false` — which is byte-for-byte the render
 * the grid produces today.
 */
import * as React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  DEFAULT_COLUMN_OVERSCAN,
  buildColumnWindow,
  computeColumnGeometry,
  computeScrollLeftToReveal,
  createFullColumnWindow,
  getAriaColCount,
  getAriaColIndex,
  type ColumnGeometry,
  type ColumnRange,
  type ColumnScrollAlign,
  type ColumnWindow,
} from '../utils/columnWindow';

export interface UseColumnVirtualizerOptions {
  /**
   * Master switch. Default FALSE — see the module comment. Wire it to
   * `uiConfig.enableColumnVirtualization`.
   */
  enabled?: boolean;
  /** Length of the FULL, view-ordered column array (`cols.length`). */
  columnCount: number;
  /**
   * MUST be `store.getColumnWidth`, i.e. must answer for every index whether or
   * not the column is mounted. Never a DOM measurement.
   */
  getColumnWidth: (index: number) => number;
  /** The horizontally scrolling element — the same node the row virtualizer uses. */
  getScrollElement: () => HTMLElement | null;
  /**
   * Indices of columns pinned to the LEFT: `sticky === 'left'` plus the runtime
   * frozen set. Always mounted — `position: sticky` needs an element to exist.
   * Derive with `getPinnedColumnIndices(cols, frozenColumns)`.
   */
  pinnedLeftIndices?: readonly number[];
  /** Indices of columns pinned to the RIGHT (`sticky === 'right'`). Always mounted. */
  pinnedRightIndices?: readonly number[];
  /**
   * Extra always-mounted indices: the selection anchor, the selection focus and
   * the editing cell. Without these, moving the caret onto an off-window column
   * paints nothing and `setEditingCell` mounts no editor.
   */
  forcedIndices?: readonly number[];
  /** @default DEFAULT_COLUMN_OVERSCAN (3) — justification lives with the constant. */
  overscan?: number;
  /** Width of the row-header gutter (0 when `rowHeaders` is false). */
  leadingWidth?: number;
  /** Width of the sticky Actions column (0 when it is not rendered). */
  trailingWidth?: number;
  /**
   * Bumped whenever ANY column width changes. Column widths are user-resizable
   * and live in a mutable store map, so nothing else can tell React the prefix
   * sums went stale. Pass the store revision, or better a width-only revision so
   * a resize drag does not also re-render every row (Defect 6).
   */
  widthRevision?: number;
  /** Stable per-column key, normally `(i) => cols[i].data`. */
  getColumnKey?: (index: number) => string | number;
  /** Whether a row-header column is rendered — affects `aria-colcount`/`-colindex`. */
  hasRowHeader?: boolean;
  /** Whether the Actions column is rendered — affects `aria-colcount`. */
  hasActionsColumn?: boolean;
}

export interface ColumnVirtualizer extends ColumnWindow {
  /** `aria-colcount` for the grid element. Counts ALL columns, not the mounted ones. */
  ariaColCount: number;
  /** `aria-colindex` (1-based) for a data column index. */
  getAriaColIndex: (columnIndex: number) => number;
  /**
   * Scrolls `columnIndex` into view. No-op when it is pinned or already visible.
   * MUST be called in the same commit as a selection/edit move onto an
   * off-window column, BEFORE any focus attempt.
   */
  scrollToColumn: (
    columnIndex: number,
    options?: { align?: ColumnScrollAlign; behavior?: ScrollBehavior }
  ) => void;
  /** Invalidates the virtualizer's cached sizes. Called for you on `widthRevision`. */
  measure: () => void;
  /** Prefix-sum geometry — the model answer to "where is column i?". */
  geometry: ColumnGeometry;
}

/** Stable dependency key for an index list without depending on array identity. */
function useIndexListKey(list: readonly number[] | undefined): string {
  return React.useMemo(() => (list && list.length ? list.join(',') : ''), [list]);
}

/**
 * Hysteresis for the column window: keep the range the window was last built
 * from while the VISIBLE columns are still inside that window's overscan
 * margin; rebuild only when a visible column would fall outside it.
 *
 * Without this the window changed every time one column crossed the viewport
 * edge — nearly every frame of a horizontal pan — and a new window re-renders
 * EVERY mounted row. With it, a pan rebuilds once per `overscan` columns.
 * The mounted set is never larger than before (it is exactly visible +
 * overscan at each rebuild, and shrinks toward the pan direction in between),
 * and every visible column is always mounted, so no blank flash.
 * A/B in .ai/perf/EXPERIMENTS.md (#4).
 */
export function holdColumnRange(
  previous: ColumnRange | null,
  visible: ColumnRange,
  overscan: number,
): ColumnRange {
  if (
    previous &&
    visible.startIndex >= previous.startIndex - overscan &&
    visible.endIndex <= previous.endIndex + overscan
  ) {
    return previous;
  }
  return visible;
}

export function useColumnVirtualizer(
  options: UseColumnVirtualizerOptions
): ColumnVirtualizer {
  const {
    enabled = false,
    columnCount,
    getColumnWidth,
    getScrollElement,
    pinnedLeftIndices,
    pinnedRightIndices,
    forcedIndices,
    overscan = DEFAULT_COLUMN_OVERSCAN,
    leadingWidth = 0,
    trailingWidth = 0,
    widthRevision = 0,
    getColumnKey,
    hasRowHeader = false,
    hasActionsColumn = false,
  } = options;

  // Callbacks read through refs so the virtualizer options keep a stable
  // identity: `estimateSize` changing identity does NOT invalidate the library's
  // measurement memo (it is keyed on count/paddingStart/getItemKey/enabled), so
  // relying on identity here would be a silent staleness bug. `measure()` on
  // `widthRevision` is the real invalidation path.
  const getColumnWidthRef = React.useRef(getColumnWidth);
  getColumnWidthRef.current = getColumnWidth;
  const getColumnKeyRef = React.useRef(getColumnKey);
  getColumnKeyRef.current = getColumnKey;
  const getScrollElementRef = React.useRef(getScrollElement);
  getScrollElementRef.current = getScrollElement;

  const estimateSize = React.useCallback(
    (index: number) => getColumnWidthRef.current(index),
    []
  );
  const getItemKey = React.useCallback(
    (index: number) => getColumnKeyRef.current?.(index) ?? index,
    []
  );
  const getScrollElementStable = React.useCallback(() => getScrollElementRef.current(), []);

  const geometry = React.useMemo(
    () => computeColumnGeometry(columnCount, (i) => getColumnWidthRef.current(i), {
      leadingWidth,
      trailingWidth,
    }),
    // getColumnWidth is read through a ref, so `widthRevision` is what makes the
    // prefix sums recompute after a resize.
    [columnCount, leadingWidth, trailingWidth, widthRevision]
  );

  const virtualizer = useVirtualizer({
    count: columnCount,
    getScrollElement: getScrollElementStable,
    estimateSize,
    getItemKey,
    horizontal: true,
    // We own overscan (see module comment) — the library gives us the bare
    // intersecting range.
    overscan: 0,
    enabled,
  });

  // Widths are model-held and mutable, so a resize must invalidate the library's
  // size cache explicitly. `measure()` clears it and re-reads `estimateSize`.
  React.useEffect(() => {
    if (!enabled) return;
    virtualizer.measure();
  }, [enabled, widthRevision, columnCount, virtualizer]);

  const virtualItems = enabled ? virtualizer.getVirtualItems() : [];
  const visibleRange: ColumnRange | null =
    virtualItems.length > 0
      ? {
          startIndex: virtualItems[0].index,
          endIndex: virtualItems[virtualItems.length - 1].index,
        }
      : null;
  // See `holdColumnRange`. The ref is written during render on purpose: the
  // value is a pure function of (previous, visible, overscan), so a discarded
  // render that wrote it would have computed the same thing.
  // A held range from before the column set shrank is dropped, never clamped.
  const heldRangeRef = React.useRef<ColumnRange | null>(null);
  const held = heldRangeRef.current && heldRangeRef.current.endIndex < columnCount ? heldRangeRef.current : null;
  const baseRange: ColumnRange | null =
    visibleRange === null ? null : holdColumnRange(held, visibleRange, overscan);
  heldRangeRef.current = baseRange;

  const pinnedLeftKey = useIndexListKey(pinnedLeftIndices);
  const pinnedRightKey = useIndexListKey(pinnedRightIndices);
  // A forced column (the caret / the editor) only needs forcing when the
  // window would NOT mount it anyway. Keying the window on the raw list made
  // every ArrowRight — the caret moving inside an already-mounted range —
  // rebuild the window and so re-render every mounted row.
  const rawForcedKey = useIndexListKey(forcedIndices);
  const outsideForced = React.useMemo(
    () =>
      baseRange === null || !forcedIndices
        ? forcedIndices
        : forcedIndices.filter(
            (i) => i < baseRange.startIndex - overscan || i > baseRange.endIndex + overscan,
          ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawForcedKey, baseRange?.startIndex, baseRange?.endIndex, overscan],
  );
  const forcedKey = useIndexListKey(outsideForced);

  const columnWindow = React.useMemo<ColumnWindow>(() => {
    const getKey = getColumnKeyRef.current;
    // Disabled, or enabled but not measured yet (SSR, first paint, a zero-width
    // scroller). FAIL OPEN: mount everything. Correct-but-slow is the only
    // acceptable failure direction — the alternative paints an empty grid.
    if (!enabled || baseRange === null) {
      return createFullColumnWindow(geometry, {
        pinnedLeftIndices,
        pinnedRightIndices,
        getColumnKey: getKey,
      });
    }
    return buildColumnWindow({
      geometry,
      range: baseRange,
      overscan,
      pinnedLeftIndices,
      pinnedRightIndices,
      forcedIndices: outsideForced,
      getColumnKey: getKey,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    geometry,
    baseRange?.startIndex,
    baseRange?.endIndex,
    baseRange === null,
    overscan,
    pinnedLeftKey,
    pinnedRightKey,
    forcedKey,
  ]);

  const scrollToColumn = React.useCallback(
    (
      columnIndex: number,
      scrollOptions?: { align?: ColumnScrollAlign; behavior?: ScrollBehavior }
    ) => {
      const element = getScrollElementRef.current();
      if (!element) return;
      const target = computeScrollLeftToReveal(geometry, columnIndex, {
        scrollLeft: element.scrollLeft,
        viewportWidth: element.clientWidth,
        pinnedLeftWidth: columnWindow.pinnedLeftWidth,
        pinnedRightWidth: columnWindow.pinnedRightWidth,
        align: scrollOptions?.align,
        pinnedIndices: columnWindow.mountedIndices.length
          ? [...(pinnedLeftIndices ?? []), ...(pinnedRightIndices ?? [])]
          : undefined,
      });
      if (target === null) return;
      if (typeof element.scrollTo === 'function') {
        element.scrollTo({ left: target, behavior: scrollOptions?.behavior ?? 'auto' });
      } else {
        element.scrollLeft = target;
      }
    },
    [geometry, columnWindow, pinnedLeftIndices, pinnedRightIndices]
  );

  const measure = React.useCallback(() => virtualizer.measure(), [virtualizer]);

  const ariaColCount = React.useMemo(
    () => getAriaColCount(columnCount, { hasRowHeader, hasActionsColumn }),
    [columnCount, hasRowHeader, hasActionsColumn]
  );
  const ariaColIndexFor = React.useCallback(
    (columnIndex: number) => getAriaColIndex(columnIndex, { hasRowHeader }),
    [hasRowHeader]
  );

  return React.useMemo<ColumnVirtualizer>(
    () => ({
      ...columnWindow,
      ariaColCount,
      getAriaColIndex: ariaColIndexFor,
      scrollToColumn,
      measure,
      geometry,
    }),
    [columnWindow, ariaColCount, ariaColIndexFor, scrollToColumn, measure, geometry]
  );
}

export default useColumnVirtualizer;
