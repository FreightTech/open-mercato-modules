import { holdColumnRange } from '../hooks/useColumnVirtualizer';

/**
 * Column-window hysteresis (perf, .ai/perf/EXPERIMENTS.md #4). The held range
 * must survive small pans — that is what spares a re-render of every mounted
 * row — and must be dropped the moment a visible column would fall outside
 * the mounted window, which is what keeps blank frames at zero.
 */
describe('holdColumnRange', () => {
  const OVERSCAN = 3;

  it('adopts the visible range when nothing is held', () => {
    expect(holdColumnRange(null, { startIndex: 4, endIndex: 12 }, OVERSCAN)).toEqual({ startIndex: 4, endIndex: 12 });
  });

  it('keeps the held range (same identity) while the visible range stays inside its overscan margin', () => {
    const held = { startIndex: 10, endIndex: 20 };
    expect(holdColumnRange(held, { startIndex: 13, endIndex: 23 }, OVERSCAN)).toBe(held);
    expect(holdColumnRange(held, { startIndex: 7, endIndex: 17 }, OVERSCAN)).toBe(held);
  });

  it('rebuilds once a visible column would leave the mounted window, either side', () => {
    const held = { startIndex: 10, endIndex: 20 };
    expect(holdColumnRange(held, { startIndex: 14, endIndex: 24 }, OVERSCAN)).toEqual({ startIndex: 14, endIndex: 24 });
    expect(holdColumnRange(held, { startIndex: 6, endIndex: 16 }, OVERSCAN)).toEqual({ startIndex: 6, endIndex: 16 });
  });

  it('never holds with zero overscan — no column may be visible yet unmounted', () => {
    const held = { startIndex: 10, endIndex: 20 };
    expect(holdColumnRange(held, { startIndex: 11, endIndex: 21 }, 0)).toEqual({ startIndex: 11, endIndex: 21 });
  });
});
