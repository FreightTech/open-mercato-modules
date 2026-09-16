import {
  DEFAULT_COLUMN_OVERSCAN,
  EMPTY_COLUMN_RANGE,
  buildColumnRenderPlan,
  buildColumnWindow,
  columnIndexToVisualIndex,
  computeColumnGeometry,
  computeScrollLeftToReveal,
  computeVisibleRange,
  createFullColumnWindow,
  expandColumnRange,
  findColumnIndexAtOffset,
  getAriaColCount,
  getAriaColIndex,
  getGeometryColumnWidth,
  getPinnedColumnIndices,
  getRangeWidth,
  isColumnMounted,
  mergePinnedColumns,
  visualIndexToColumnIndex,
  type ColumnGeometry,
  type ColumnWindow,
} from '../utils/columnWindow';

/**
 * Column virtualization arithmetic.
 *
 * These are the tests that actually protect the grid: the hook is a wrapper, but
 * every way a virtualized grid corrupts itself — a pinned column double-counted
 * against the scroll offset, a spacer that doesn't sum to the columns it stands
 * in for, a selected column left unmounted, an aria index computed from the
 * mounted subset — is arithmetic, and all of it lives here.
 *
 * Information density is a product requirement, so the mounted set must stay as
 * small as honesty allows while never dropping a column that is pinned, edited,
 * selected or being written to.
 */

/** Uniform 100px columns unless a width list says otherwise. */
function geo(
  widths: number[],
  options: { leadingWidth?: number; trailingWidth?: number } = {}
): ColumnGeometry {
  return computeColumnGeometry(widths.length, (i) => widths[i], options);
}

const uniform = (count: number, width = 100) => new Array(count).fill(width);

/** Widths actually occupied by the render plan, spacers included. */
function planWidth(win: ColumnWindow): number {
  return win.segments.reduce(
    (sum, seg) => sum + (seg.type === 'spacer' ? seg.width : seg.column.size),
    0
  );
}

describe('computeColumnGeometry', () => {
  it('lays columns out as prefix sums starting after the row-header gutter', () => {
    const g = geo([100, 150, 50], { leadingWidth: 32 });

    expect(g.starts).toEqual([32, 132, 282, 332]);
    expect(g.columnCount).toBe(3);
    expect(g.leadingWidth).toBe(32);
  });

  it('includes the leading gutter and the trailing actions column in totalWidth', () => {
    const g = geo([100, 100], { leadingWidth: 32, trailingWidth: 80 });

    expect(g.totalWidth).toBe(32 + 200 + 80);
  });

  it('survives a zero-column table', () => {
    const g = geo([]);

    expect(g.starts).toEqual([0]);
    expect(g.totalWidth).toBe(0);
  });

  it('treats a missing or nonsense width as zero rather than producing NaN offsets', () => {
    // getColumnWidth is the store's, which defaults to 100 — but a geometry full
    // of NaN would silently break every downstream binary search, so clamp here.
    const g = computeColumnGeometry(3, (i) => (i === 1 ? (undefined as unknown as number) : 100));

    expect(g.starts).toEqual([0, 100, 100, 200]);
    expect(Number.isFinite(g.totalWidth)).toBe(true);
  });
});

describe('getGeometryColumnWidth / getRangeWidth', () => {
  const g = geo([100, 150, 50, 200]);

  it('reads a single column width back out of the prefix sums', () => {
    expect(getGeometryColumnWidth(g, 1)).toBe(150);
  });

  it('returns 0 outside the column array instead of throwing', () => {
    expect(getGeometryColumnWidth(g, -1)).toBe(0);
    expect(getGeometryColumnWidth(g, 99)).toBe(0);
  });

  it('sums an inclusive range', () => {
    expect(getRangeWidth(g, 1, 2)).toBe(200);
    expect(getRangeWidth(g, 0, 3)).toBe(500);
  });

  it('returns 0 for an empty (inverted) range — this is what makes a zero-width spacer', () => {
    expect(getRangeWidth(g, 2, 1)).toBe(0);
  });
});

describe('findColumnIndexAtOffset', () => {
  const g = geo(uniform(10), { leadingWidth: 32 });

  it('finds the column containing an offset', () => {
    expect(findColumnIndexAtOffset(g, 32)).toBe(0);
    expect(findColumnIndexAtOffset(g, 131)).toBe(0);
    expect(findColumnIndexAtOffset(g, 132)).toBe(1);
    expect(findColumnIndexAtOffset(g, 532)).toBe(5);
  });

  it('clamps rather than returning -1 outside the content box', () => {
    expect(findColumnIndexAtOffset(g, -500)).toBe(0);
    expect(findColumnIndexAtOffset(g, 99999)).toBe(9);
  });

  it('returns -1 only when there are no columns at all', () => {
    expect(findColumnIndexAtOffset(geo([]), 0)).toBe(-1);
  });
});

describe('computeVisibleRange', () => {
  const g = geo(uniform(20));

  it('covers every column the viewport touches, including partly-visible ones', () => {
    // Viewport [0, 250) touches columns 0, 1 and the left half of 2.
    expect(computeVisibleRange(g, 0, 250)).toEqual({ startIndex: 0, endIndex: 2 });
  });

  it('starts at the column under the left edge, not the next whole one', () => {
    expect(computeVisibleRange(g, 250, 200)).toEqual({ startIndex: 2, endIndex: 4 });
  });

  it('does not run off the end of the column array', () => {
    expect(computeVisibleRange(g, 1900, 400)).toEqual({ startIndex: 19, endIndex: 19 });
  });

  it('FAILS OPEN to the full range when the viewport has not been measured', () => {
    // Zero width means "no rect yet" (SSR, first paint, display:none). Mounting
    // everything is slow; mounting nothing paints an empty grid.
    expect(computeVisibleRange(g, 0, 0)).toEqual({ startIndex: 0, endIndex: 19 });
    expect(computeVisibleRange(g, 0, Number.NaN)).toEqual({ startIndex: 0, endIndex: 19 });
  });

  it('returns the empty range for a table with no columns', () => {
    expect(computeVisibleRange(geo([]), 0, 800)).toEqual(EMPTY_COLUMN_RANGE);
  });

  it('accounts for the row-header gutter shifting every column right', () => {
    const withGutter = geo(uniform(20), { leadingWidth: 32 });

    // Same scrollLeft as the gutterless case, but column 0 now starts at 32.
    expect(computeVisibleRange(withGutter, 250, 200)).toEqual({ startIndex: 2, endIndex: 4 });
  });
});

describe('expandColumnRange', () => {
  it('grows the range by the overscan on both sides', () => {
    expect(expandColumnRange({ startIndex: 10, endIndex: 14 }, 3, 40)).toEqual({
      startIndex: 7,
      endIndex: 17,
    });
  });

  it('clamps to the column array at both ends', () => {
    expect(expandColumnRange({ startIndex: 1, endIndex: 8 }, 5, 10)).toEqual({
      startIndex: 0,
      endIndex: 9,
    });
  });

  it('is a no-op at overscan 0', () => {
    expect(expandColumnRange({ startIndex: 4, endIndex: 6 }, 0, 20)).toEqual({
      startIndex: 4,
      endIndex: 6,
    });
  });

  it('keeps an empty range empty', () => {
    expect(expandColumnRange(EMPTY_COLUMN_RANGE, 3, 10)).toEqual(EMPTY_COLUMN_RANGE);
    expect(expandColumnRange({ startIndex: 0, endIndex: 0 }, 3, 0)).toEqual(EMPTY_COLUMN_RANGE);
  });

  it('defaults to a horizontal overscan smaller than the row virtualizer’s 10', () => {
    // Documented trade-off: one extra overscanned COLUMN costs ~40 cells (one per
    // mounted row), one extra overscanned ROW costs ~20. See the constant.
    expect(DEFAULT_COLUMN_OVERSCAN).toBe(3);
    expect(DEFAULT_COLUMN_OVERSCAN).toBeLessThan(10);
  });
});

describe('getPinnedColumnIndices', () => {
  const columns = [
    { data: 'a' },
    { data: 'b', sticky: 'left' as const },
    { data: 'c' },
    { data: 'd', sticky: 'right' as const },
    { data: 'e' },
  ];

  it('reads the static sticky flags', () => {
    expect(getPinnedColumnIndices(columns)).toEqual({ left: [1], right: [3] });
  });

  it('folds the runtime frozen set (keyed by data key) on top of the static ones', () => {
    expect(getPinnedColumnIndices(columns, new Set(['c', 'e']))).toEqual({
      left: [1, 2, 4],
      right: [3],
    });
  });

  it('does not drag a sticky-right column to the left just because it is frozen', () => {
    expect(getPinnedColumnIndices(columns, new Set(['d']))).toEqual({ left: [1], right: [3] });
  });

  it('never lists a statically-sticky column twice when it is also frozen', () => {
    expect(getPinnedColumnIndices(columns, new Set(['b']))).toEqual({ left: [1], right: [3] });
  });

  it('is index-based on the CURRENT order, so a perspective reorder re-derives cleanly', () => {
    const reordered = [columns[2], columns[1], columns[0], columns[4], columns[3]];

    expect(getPinnedColumnIndices(reordered, new Set(['c']))).toEqual({ left: [0, 1], right: [4] });
  });
});

describe('mergePinnedColumns', () => {
  const opts = { columnCount: 40 };

  it('returns the plain window when nothing is pinned', () => {
    expect(mergePinnedColumns({ startIndex: 5, endIndex: 8 }, opts)).toEqual([5, 6, 7, 8]);
  });

  it('force-mounts pinned columns that are nowhere near the window', () => {
    const mounted = mergePinnedColumns(
      { startIndex: 20, endIndex: 22 },
      { ...opts, pinnedLeftIndices: [0, 1], pinnedRightIndices: [39] }
    );

    expect(mounted).toEqual([0, 1, 20, 21, 22, 39]);
  });

  it('force-mounts the selection anchor, focus and editing cell', () => {
    const mounted = mergePinnedColumns(
      { startIndex: 20, endIndex: 21 },
      { ...opts, forcedIndices: [3, 35] }
    );

    expect(mounted).toEqual([3, 20, 21, 35]);
  });

  it('de-duplicates a pinned column that is also inside the window', () => {
    const mounted = mergePinnedColumns(
      { startIndex: 0, endIndex: 3 },
      { ...opts, pinnedLeftIndices: [0, 1], forcedIndices: [2] }
    );

    expect(mounted).toEqual([0, 1, 2, 3]);
  });

  it('drops out-of-range forced indices instead of throwing', () => {
    // Selection state outlives a column being hidden by a perspective change.
    const mounted = mergePinnedColumns(
      { startIndex: 0, endIndex: 1 },
      { columnCount: 3, forcedIndices: [-1, 7, 1.5] }
    );

    expect(mounted).toEqual([0, 1]);
  });

  it('still mounts pinned columns when the window itself is empty', () => {
    expect(
      mergePinnedColumns(EMPTY_COLUMN_RANGE, { ...opts, pinnedLeftIndices: [0] })
    ).toEqual([0]);
  });

  it('returns nothing for a table with no columns', () => {
    expect(mergePinnedColumns({ startIndex: 0, endIndex: 5 }, { columnCount: 0 })).toEqual([]);
  });
});

describe('buildColumnRenderPlan', () => {
  const g = geo(uniform(10));

  it('emits leading, interior and trailing spacers around the mounted columns', () => {
    const { segments } = buildColumnRenderPlan([0, 5, 6], g);

    expect(segments).toEqual([
      { type: 'column', column: expect.objectContaining({ index: 0 }) },
      { type: 'spacer', width: 400, fromIndex: 1, toIndex: 4 },
      { type: 'column', column: expect.objectContaining({ index: 5 }) },
      { type: 'column', column: expect.objectContaining({ index: 6 }) },
      { type: 'spacer', width: 300, fromIndex: 7, toIndex: 9 },
    ]);
  });

  it('gives every mounted column its exact natural offset', () => {
    const { virtualColumns } = buildColumnRenderPlan([0, 7], geo(uniform(10), { leadingWidth: 32 }));

    expect(virtualColumns).toEqual([
      expect.objectContaining({ index: 0, start: 32, end: 132, size: 100 }),
      expect.objectContaining({ index: 7, start: 732, end: 832, size: 100 }),
    ]);
  });

  it('keys columns by their data key so React reuses the right cell across a scroll', () => {
    const { virtualColumns } = buildColumnRenderPlan([2, 3], g, (i) => `col_${i}`);

    expect(virtualColumns.map((c) => c.key)).toEqual(['col_2', 'col_3']);
  });

  it('emits one full-width spacer when nothing is mounted', () => {
    const { segments } = buildColumnRenderPlan([], g);

    expect(segments).toEqual([{ type: 'spacer', width: 1000, fromIndex: 0, toIndex: 9 }]);
  });
});

describe('buildColumnWindow', () => {
  const g = geo(uniform(40), { leadingWidth: 32, trailingWidth: 80 });

  it('mounts the overscanned window and reports it explicitly', () => {
    const win = buildColumnWindow({
      geometry: g,
      range: { startIndex: 10, endIndex: 14 },
      overscan: 3,
    });

    expect(win.virtualized).toBe(true);
    expect(win.startIndex).toBe(7);
    expect(win.endIndex).toBe(17);
    expect(win.mountedIndices).toHaveLength(11);
    expect(win.isColumnMounted(7)).toBe(true);
    expect(win.isColumnMounted(6)).toBe(false);
    expect(isColumnMounted(win, 17)).toBe(true);
  });

  it('pads with the exact width of the columns it skipped', () => {
    const win = buildColumnWindow({
      geometry: g,
      range: { startIndex: 10, endIndex: 14 },
      overscan: 3,
    });

    expect(win.paddingLeft).toBe(700); // columns 0..6
    expect(win.paddingRight).toBe(2200); // columns 18..39
  });

  it('keeps the table exactly as wide as it is unvirtualized', () => {
    const win = buildColumnWindow({ geometry: g, range: { startIndex: 10, endIndex: 14 } });

    expect(win.totalWidth).toBe(32 + 4000 + 80);
    // Spacers + mounted columns must reconstruct the column band precisely, or
    // the header row and the body rows drift apart as you scroll.
    expect(planWidth(win)).toBe(4000);
  });

  it('NEVER double-counts a force-mounted pinned column inside a spacer', () => {
    // The pinned block occupies real boxes in the flow; if the leading spacer
    // also covered them the whole grid would shift right by the pinned width.
    const win = buildColumnWindow({
      geometry: g,
      range: { startIndex: 20, endIndex: 24 },
      overscan: 0,
      pinnedLeftIndices: [0, 1],
      pinnedRightIndices: [39],
    });

    expect(win.mountedIndices).toEqual([0, 1, 20, 21, 22, 23, 24, 39]);
    expect(planWidth(win)).toBe(4000);
    // The gap between the pinned block and the window is a spacer over 2..19 only.
    expect(win.segments).toContainEqual({
      type: 'spacer',
      width: 1800,
      fromIndex: 2,
      toIndex: 19,
    });
    // ...and paddingLeft is 0, because column 0 IS mounted.
    expect(win.paddingLeft).toBe(0);
  });

  it('reports the pinned gutters, gutter widths included', () => {
    const win = buildColumnWindow({
      geometry: g,
      range: { startIndex: 20, endIndex: 21 },
      pinnedLeftIndices: [0, 1],
      pinnedRightIndices: [39],
    });

    expect(win.pinnedLeftWidth).toBe(32 + 200);
    expect(win.pinnedRightWidth).toBe(80 + 100);
  });

  it('mounts the editing cell even when it is far off-window', () => {
    // setEditingCell on an unmounted column mounts no editor at all — the focus
    // effect in Cell.tsx never runs.
    const win = buildColumnWindow({
      geometry: g,
      range: { startIndex: 0, endIndex: 4 },
      overscan: 0,
      forcedIndices: [31],
    });

    expect(win.isColumnMounted(31)).toBe(true);
    expect(win.endIndex).toBe(31);
  });

  it('derives the range from scroll geometry when no range is supplied', () => {
    const win = buildColumnWindow({
      geometry: geo(uniform(40)),
      scrollLeft: 1000,
      viewportWidth: 300,
      overscan: 1,
    });

    // Viewport covers columns 10..12; overscan 1 → 9..13.
    expect(win.startIndex).toBe(9);
    expect(win.endIndex).toBe(13);
  });

  it('mounts everything when the viewport is unmeasured and no range is supplied', () => {
    const win = buildColumnWindow({ geometry: geo(uniform(12)), scrollLeft: 0, viewportWidth: 0 });

    expect(win.mountedIndices).toHaveLength(12);
    expect(win.paddingLeft).toBe(0);
    expect(win.paddingRight).toBe(0);
  });

  it('handles a table with no columns without producing NaN padding', () => {
    const win = buildColumnWindow({ geometry: geo([]), range: EMPTY_COLUMN_RANGE });

    expect(win.mountedIndices).toEqual([]);
    expect(win.startIndex).toBe(0);
    expect(win.endIndex).toBe(-1);
    expect(win.paddingLeft).toBe(0);
    expect(win.paddingRight).toBe(0);
  });

  it('keeps column indices ABSOLUTE — a window never renumbers columns', () => {
    // data-col carries these straight into every pointer hit-test in
    // handlers/index.ts; a window-relative index would silently retarget writes.
    const win = buildColumnWindow({
      geometry: g,
      range: { startIndex: 30, endIndex: 32 },
      overscan: 0,
    });

    expect(win.virtualColumns.map((c) => c.index)).toEqual([30, 31, 32]);
  });
});

describe('createFullColumnWindow', () => {
  const g = geo(uniform(6), { leadingWidth: 32 });

  it('mounts every column with no spacers at all', () => {
    const win = createFullColumnWindow(g);

    expect(win.virtualized).toBe(false);
    expect(win.mountedIndices).toEqual([0, 1, 2, 3, 4, 5]);
    expect(win.segments.every((s) => s.type === 'column')).toBe(true);
    expect(win.paddingLeft).toBe(0);
    expect(win.paddingRight).toBe(0);
  });

  it('is what an opted-out table renders — identical geometry to today', () => {
    const win = createFullColumnWindow(g);

    expect(planWidth(win)).toBe(600);
    expect(win.totalWidth).toBe(632);
  });

  it('still reports the pinned gutters so scroll-into-view keeps working', () => {
    const win = createFullColumnWindow(g, { pinnedLeftIndices: [0] });

    expect(win.pinnedLeftWidth).toBe(132);
  });
});

describe('index mapping', () => {
  const win = buildColumnWindow({
    geometry: geo(uniform(20)),
    range: { startIndex: 10, endIndex: 12 },
    overscan: 0,
    pinnedLeftIndices: [0],
  });

  it('maps a column array index to its rendered position', () => {
    expect(columnIndexToVisualIndex(win, 0)).toBe(0);
    expect(columnIndexToVisualIndex(win, 10)).toBe(1);
    expect(columnIndexToVisualIndex(win, 12)).toBe(3);
  });

  it('returns -1 for a column that is not mounted', () => {
    expect(columnIndexToVisualIndex(win, 5)).toBe(-1);
    expect(columnIndexToVisualIndex(win, 19)).toBe(-1);
  });

  it('maps a rendered position back to its column array index', () => {
    expect(visualIndexToColumnIndex(win, 0)).toBe(0);
    expect(visualIndexToColumnIndex(win, 2)).toBe(11);
  });

  it('returns -1 outside the mounted list', () => {
    expect(visualIndexToColumnIndex(win, -1)).toBe(-1);
    expect(visualIndexToColumnIndex(win, 4)).toBe(-1);
  });

  it('round-trips every mounted column', () => {
    for (const index of win.mountedIndices) {
      expect(visualIndexToColumnIndex(win, columnIndexToVisualIndex(win, index))).toBe(index);
    }
  });
});

describe('accessibility indices', () => {
  it('counts ALL columns, not the mounted subset', () => {
    expect(getAriaColCount(60)).toBe(60);
    expect(getAriaColCount(60, { hasRowHeader: true })).toBe(61);
    expect(getAriaColCount(60, { hasRowHeader: true, hasActionsColumn: true })).toBe(62);
  });

  it('numbers data columns from 1, after the row header', () => {
    expect(getAriaColIndex(0)).toBe(1);
    expect(getAriaColIndex(0, { hasRowHeader: true })).toBe(2);
    expect(getAriaColIndex(36, { hasRowHeader: true })).toBe(38);
  });

  it('announces the true position of an off-window column', () => {
    // The whole point: rendering columns 30..36 must still announce
    // "column 37 of 60", not "column 7 of 7".
    const win = buildColumnWindow({
      geometry: geo(uniform(60)),
      range: { startIndex: 30, endIndex: 36 },
      overscan: 0,
    });

    expect(getAriaColCount(win.columnCount, { hasRowHeader: true })).toBe(61);
    expect(getAriaColIndex(36, { hasRowHeader: true })).toBe(38);
  });
});

describe('computeScrollLeftToReveal', () => {
  const g = geo(uniform(40), { leadingWidth: 32, trailingWidth: 80 });
  const viewportWidth = 800;

  it('does nothing when the column is already fully visible', () => {
    expect(
      computeScrollLeftToReveal(g, 3, { scrollLeft: 0, viewportWidth })
    ).toBeNull();
  });

  it('does nothing for a pinned column — it can never be scrolled away from', () => {
    expect(
      computeScrollLeftToReveal(g, 1, {
        scrollLeft: 2000,
        viewportWidth,
        pinnedIndices: [0, 1],
      })
    ).toBeNull();
  });

  it('scrolls left so the column clears the frozen block, not just the viewport edge', () => {
    // Column 5 starts at 532. Naively scrolling to 532 would park it underneath
    // the 232px pinned gutter and look like nothing happened.
    const target = computeScrollLeftToReveal(g, 5, {
      scrollLeft: 2000,
      viewportWidth,
      pinnedLeftWidth: 232,
      pinnedRightWidth: 80,
    });

    expect(target).toBe(300);
  });

  it('scrolls right so the column clears the sticky actions column', () => {
    // Column 20 ends at 2132; it must sit left of (scrollLeft + 800 - 80).
    const target = computeScrollLeftToReveal(g, 20, {
      scrollLeft: 0,
      viewportWidth,
      pinnedLeftWidth: 232,
      pinnedRightWidth: 80,
    });

    expect(target).toBe(2132 + 80 - 800);
  });

  it('never scrolls past either end of the content', () => {
    expect(
      computeScrollLeftToReveal(g, 0, { scrollLeft: 3000, viewportWidth, align: 'start' })
    ).toBe(0);
    expect(
      computeScrollLeftToReveal(g, 39, { scrollLeft: 0, viewportWidth, align: 'end' })
    ).toBe(g.totalWidth - viewportWidth);
  });

  it('aligns a column wider than the usable viewport to its start', () => {
    const wide = geo([100, 2000, 100], { leadingWidth: 32 });

    expect(
      computeScrollLeftToReveal(wide, 1, {
        scrollLeft: 0,
        viewportWidth: 400,
        pinnedLeftWidth: 32,
      })
    ).toBe(100);
  });

  it('honours explicit start / end / center alignment', () => {
    expect(computeScrollLeftToReveal(g, 10, { scrollLeft: 0, viewportWidth, align: 'start' })).toBe(
      1032 - 32
    );
    expect(computeScrollLeftToReveal(g, 10, { scrollLeft: 0, viewportWidth, align: 'end' })).toBe(
      1132 + 80 - 800
    );
    expect(
      computeScrollLeftToReveal(g, 10, {
        scrollLeft: 0,
        viewportWidth,
        pinnedLeftWidth: 32,
        pinnedRightWidth: 80,
        align: 'center',
      })
    ).toBe(1032 - 32 - (800 - 32 - 80 - 100) / 2);
  });

  it('refuses to guess before the viewport is measured', () => {
    expect(computeScrollLeftToReveal(g, 10, { scrollLeft: 0, viewportWidth: 0 })).toBeNull();
  });

  it('returns null for an index outside the column array', () => {
    expect(computeScrollLeftToReveal(g, -1, { scrollLeft: 0, viewportWidth })).toBeNull();
    expect(computeScrollLeftToReveal(g, 40, { scrollLeft: 0, viewportWidth })).toBeNull();
  });
});
