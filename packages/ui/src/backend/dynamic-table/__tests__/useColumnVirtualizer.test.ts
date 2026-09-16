import { act, renderHook } from '@testing-library/react';
import { useColumnVirtualizer } from '../hooks/useColumnVirtualizer';
import type { UseColumnVirtualizerOptions } from '../hooks/useColumnVirtualizer';

/**
 * The React wrapper around the column-window arithmetic.
 *
 * The arithmetic itself is covered exhaustively in `columnWindow.test.ts`; what
 * is tested here is only what the wrapper owns:
 *
 *  • DEFAULT OFF. Column virtualization changes rendering for 56 consumer files,
 *    so an un-opted-in table must get a window that is indistinguishable from
 *    today's render: every column mounted, no spacers.
 *  • FAIL OPEN. No scroll element, no measurement, SSR — mount everything.
 *  • Pinned and edited columns are mounted regardless of scroll position.
 *  • Geometry follows the model (`store.getColumnWidth`), never the DOM, and a
 *    user resize (signalled by `widthRevision`) rebuilds it.
 *  • Horizontal scroll-into-view — which does not exist anywhere else in the
 *    grid today, and without which keyboard nav can move the caret onto a column
 *    that will never be mounted.
 */

const COLUMN_WIDTH = 100;
const VIEWPORT_WIDTH = 800;

/** A scroller jsdom will report real dimensions for. */
function createScroller(width = VIEWPORT_WIDTH): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  // @tanstack/react-virtual reads offsetWidth for the rect and scrollLeft for
  // the offset; jsdom lays nothing out, so both must be declared.
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 600 });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: width });
  el.scrollLeft = 0;
  el.scrollTo = jest.fn((options: any) => {
    el.scrollLeft = typeof options === 'number' ? options : options.left;
  }) as unknown as typeof el.scrollTo;
  return el;
}

function mount(options: Partial<UseColumnVirtualizerOptions> & { columnCount?: number } = {}) {
  const scroller = options.getScrollElement ? null : createScroller();
  const initial: UseColumnVirtualizerOptions = {
    columnCount: 40,
    getColumnWidth: () => COLUMN_WIDTH,
    getScrollElement: () => scroller,
    getColumnKey: (i) => `col_${i}`,
    ...options,
  } as UseColumnVirtualizerOptions;

  const view = renderHook((props: UseColumnVirtualizerOptions) => useColumnVirtualizer(props), {
    initialProps: initial,
  });
  return { ...view, scroller: scroller as HTMLDivElement, initial };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useColumnVirtualizer — opt-in', () => {
  it('is OFF by default and mounts every column, exactly like today', () => {
    const { result } = mount();

    expect(result.current.virtualized).toBe(false);
    expect(result.current.mountedIndices).toHaveLength(40);
    expect(result.current.paddingLeft).toBe(0);
    expect(result.current.paddingRight).toBe(0);
    expect(result.current.segments.every((s) => s.type === 'column')).toBe(true);
  });

  it('still reports full-table geometry when switched off', () => {
    const { result } = mount({ leadingWidth: 32, trailingWidth: 80 });

    expect(result.current.totalWidth).toBe(32 + 40 * COLUMN_WIDTH + 80);
    expect(result.current.isColumnMounted(39)).toBe(true);
  });

  it('narrows the mounted set once enabled', () => {
    const { result } = mount({ enabled: true, overscan: 0 });

    expect(result.current.virtualized).toBe(true);
    // 800px viewport / 100px columns ≈ 8 columns, not 40.
    expect(result.current.mountedIndices.length).toBeLessThan(15);
    expect(result.current.isColumnMounted(0)).toBe(true);
    expect(result.current.isColumnMounted(39)).toBe(false);
  });

  it('reserves the exact width of the columns it did not mount', () => {
    const { result } = mount({ enabled: true, overscan: 0 });

    const rendered = result.current.segments.reduce(
      (sum, seg) => sum + (seg.type === 'spacer' ? seg.width : seg.column.size),
      0
    );
    expect(rendered).toBe(40 * COLUMN_WIDTH);
    expect(result.current.paddingRight).toBeGreaterThan(0);
  });

  it('grows the mounted set by the overscan', () => {
    const tight = mount({ enabled: true, overscan: 0 });
    const padded = mount({ enabled: true, overscan: 5 });

    expect(padded.result.current.mountedIndices.length).toBeGreaterThan(
      tight.result.current.mountedIndices.length
    );
  });
});

describe('useColumnVirtualizer — fail open', () => {
  it('mounts everything when there is no scroll element yet', () => {
    const { result } = mount({ enabled: true, getScrollElement: () => null });

    expect(result.current.mountedIndices).toHaveLength(40);
    expect(result.current.virtualized).toBe(false);
  });

  it('mounts everything when the scroller has no measured width', () => {
    const el = createScroller(0);
    const { result } = mount({ enabled: true, getScrollElement: () => el });

    expect(result.current.mountedIndices).toHaveLength(40);
  });

  it('handles a table with no columns', () => {
    const { result } = mount({ enabled: true, columnCount: 0 });

    expect(result.current.mountedIndices).toEqual([]);
    expect(result.current.endIndex).toBe(-1);
    expect(result.current.totalWidth).toBe(0);
  });
});

describe('useColumnVirtualizer — force-mounted columns', () => {
  it('always mounts pinned columns, however far off-window they are', () => {
    const { result } = mount({
      enabled: true,
      overscan: 0,
      pinnedLeftIndices: [0, 1],
      pinnedRightIndices: [39],
    });

    expect(result.current.isColumnMounted(0)).toBe(true);
    expect(result.current.isColumnMounted(1)).toBe(true);
    // position: sticky only works on an element that exists.
    expect(result.current.isColumnMounted(39)).toBe(true);
  });

  it('always mounts the editing cell and the selection anchor/focus', () => {
    const { result } = mount({ enabled: true, overscan: 0, forcedIndices: [30] });

    expect(result.current.isColumnMounted(30)).toBe(true);
  });

  it('re-derives the window when the forced set changes', () => {
    const { result, rerender, initial } = mount({ enabled: true, overscan: 0, forcedIndices: [] });

    expect(result.current.isColumnMounted(25)).toBe(false);
    act(() => rerender({ ...initial, enabled: true, overscan: 0, forcedIndices: [25] }));
    expect(result.current.isColumnMounted(25)).toBe(true);
  });

  it('reports the pinned gutter widths for callers that need to clear them', () => {
    const { result } = mount({
      enabled: true,
      leadingWidth: 32,
      trailingWidth: 80,
      pinnedLeftIndices: [0, 1],
      pinnedRightIndices: [39],
    });

    expect(result.current.pinnedLeftWidth).toBe(32 + 200);
    expect(result.current.pinnedRightWidth).toBe(80 + 100);
  });
});

describe('useColumnVirtualizer — model-held widths', () => {
  it('reads widths from the model, never from the DOM', () => {
    const widths = [50, 300, 100];
    const { result } = mount({ columnCount: 3, getColumnWidth: (i) => widths[i] });

    expect(result.current.geometry.starts).toEqual([0, 50, 350, 450]);
  });

  it('rebuilds geometry when a user resize bumps widthRevision', () => {
    const widths = [100, 100, 100];
    const { result, rerender, initial } = mount({
      columnCount: 3,
      getColumnWidth: (i) => widths[i],
      widthRevision: 0,
    });

    expect(result.current.totalWidth).toBe(300);

    // A drag on the resize handle writes straight to the store's width map —
    // nothing else can tell React the prefix sums went stale.
    widths[1] = 400;
    act(() =>
      rerender({
        ...initial,
        columnCount: 3,
        getColumnWidth: (i: number) => widths[i],
        widthRevision: 1,
      })
    );

    expect(result.current.totalWidth).toBe(600);
    expect(result.current.geometry.starts).toEqual([0, 100, 500, 600]);
  });
});

describe('useColumnVirtualizer — accessibility', () => {
  it('counts every column, not the mounted subset', () => {
    const { result } = mount({
      enabled: true,
      hasRowHeader: true,
      hasActionsColumn: true,
    });

    expect(result.current.columnCount).toBe(40);
    expect(result.current.ariaColCount).toBe(42);
  });

  it('announces a column’s true position even when its neighbours are unmounted', () => {
    const { result } = mount({ enabled: true, hasRowHeader: true, forcedIndices: [36] });

    expect(result.current.getAriaColIndex(36)).toBe(38);
  });
});

describe('useColumnVirtualizer — scrollToColumn', () => {
  it('scrolls an off-window column into view', () => {
    const { result, scroller } = mount({ enabled: true, overscan: 0 });

    act(() => result.current.scrollToColumn(30));

    expect(scroller.scrollTo).toHaveBeenCalled();
    expect(scroller.scrollLeft).toBeGreaterThan(0);
  });

  it('clears the frozen block rather than parking the column underneath it', () => {
    const { result, scroller } = mount({
      enabled: true,
      leadingWidth: 32,
      pinnedLeftIndices: [0, 1],
    });
    scroller.scrollLeft = 2000;

    act(() => result.current.scrollToColumn(5));

    // Column 5 starts at 532; the pinned gutter is 32 + 200 = 232 wide.
    expect(scroller.scrollLeft).toBe(300);
  });

  it('does nothing for a column that is already visible', () => {
    const { result, scroller } = mount({ enabled: true });
    // The virtualizer itself calls scrollTo while it settles on mount; only the
    // calls our scrollToColumn makes are under test here.
    (scroller.scrollTo as unknown as jest.Mock).mockClear();

    act(() => result.current.scrollToColumn(2));

    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });

  it('does nothing for a pinned column', () => {
    const { result, scroller } = mount({ enabled: true, pinnedLeftIndices: [0, 1] });
    scroller.scrollLeft = 2000;
    (scroller.scrollTo as unknown as jest.Mock).mockClear();

    act(() => result.current.scrollToColumn(1));

    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });

  it('works when virtualization is switched off, because keyboard nav still needs it', () => {
    const { result, scroller } = mount({ enabled: false });

    act(() => result.current.scrollToColumn(35));

    expect(scroller.scrollLeft).toBeGreaterThan(0);
  });

  it('is a safe no-op without a scroll element', () => {
    const { result } = mount({ enabled: true, getScrollElement: () => null });

    expect(() => act(() => result.current.scrollToColumn(10))).not.toThrow();
  });
});
