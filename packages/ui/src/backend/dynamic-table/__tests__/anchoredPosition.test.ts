import { computeAnchoredPosition } from '../utils/anchoredPosition';

/**
 * Pins the placement contract shared by ColumnFilterPopover, SelectMenu and
 * PerspectiveTabMenu.
 *
 * The headline case is the one measured on the real transport list: a column
 * header near the TOP of a short viewport used to flip its popover upward and
 * land at `top: -156`, hiding the search box, "Select all" and the first two
 * options above the window edge.
 */

const VIEWPORT = { width: 1920, height: 1080 };
/** A column header on the transport list: 24px tall, sticky near the top. */
const HEADER = { top: 213, bottom: 237, left: 567, right: 700 };

describe('computeAnchoredPosition', () => {
  it('opens below when there is room', () => {
    const p = computeAnchoredPosition(HEADER, VIEWPORT, { width: 268, preferredHeight: 360 });
    expect(p.flipAbove).toBe(false);
    expect(p.top).toBe(HEADER.bottom + 4);
    expect(p.maxHeight).toBe(360);
  });

  it('REGRESSION: never flips a top-anchored panel off the top of a short viewport', () => {
    // 560px tall — the viewport the bug was reproduced at. The old code flipped
    // here because `rect.bottom + 360 > 560`, then translateY(-100%) pushed the
    // panel to -156.
    const p = computeAnchoredPosition(HEADER, { width: 1920, height: 560 }, {
      width: 268,
      preferredHeight: 360,
      minHeight: 200,
    });

    expect(p.flipAbove).toBe(false); // above has only 205px; below has 315px
    // The panel shrinks instead of moving, and still ends inside the viewport.
    expect(p.maxHeight).toBeLessThan(360);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(560);
    expect(p.top).toBeGreaterThan(0);
  });

  it('flips above only when above is genuinely roomier, and then fits', () => {
    // A trigger low on the page: 900px down a 1080px viewport.
    const low = { top: 900, bottom: 924, left: 400, right: 560 };
    const p = computeAnchoredPosition(low, VIEWPORT, { width: 268, preferredHeight: 360 });

    expect(p.flipAbove).toBe(true);
    expect(p.top).toBe(low.top - 4);
    // The caller applies translateY(-100%); capping maxHeight at the space
    // above is what makes that safe. Rendered top = top - maxHeight >= 0.
    expect(p.top - p.maxHeight).toBeGreaterThanOrEqual(0);
  });

  it('clamps a right-edge anchor back inside the viewport', () => {
    // The Configure View drawer sits against the right edge; its selects do too.
    const nearRight = { top: 300, bottom: 328, left: 1850, right: 1910 };
    const p = computeAnchoredPosition(nearRight, VIEWPORT, { width: 268, preferredHeight: 280 });

    expect(p.left + 268).toBeLessThanOrEqual(VIEWPORT.width);
    expect(p.left).toBe(1920 - 268 - 8);
  });

  it('pins to the left margin rather than hanging off the right', () => {
    const p = computeAnchoredPosition(HEADER, { width: 200, height: 1080 }, {
      width: 268, // wider than the viewport itself
      preferredHeight: 280,
    });
    expect(p.left).toBe(8);
  });

  it('honours align:end for right-aligned panels', () => {
    const p = computeAnchoredPosition(HEADER, VIEWPORT, {
      width: 268,
      preferredHeight: 280,
      align: 'end',
    });
    expect(p.left).toBe(HEADER.right - 268);
  });

  it('never collapses below minHeight, even with no room either way', () => {
    const p = computeAnchoredPosition(
      { top: 100, bottom: 130, left: 10, right: 100 },
      { width: 1920, height: 160 },
      { width: 268, preferredHeight: 360, minHeight: 120 },
    );
    expect(p.maxHeight).toBe(120);
  });
});
