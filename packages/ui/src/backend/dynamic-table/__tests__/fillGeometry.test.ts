import {
  buildFillLines,
  cellsInRect,
  computeFillPreview,
  isCellInRect,
  rectSize,
} from '../utils/fillGeometry';
import type { SelectionBounds } from '../types/index';

const rect = (startRow: number, endRow: number, startCol: number, endCol: number): SelectionBounds => ({
  startRow,
  endRow,
  startCol,
  endCol,
});

const opts = { modifier: false, defaultMode: 'series' as const };

describe('computeFillPreview — axis lock', () => {
  const source = rect(2, 2, 1, 1);

  it('locks vertical when the drag runs down', () => {
    const p = computeFillPreview(source, { row: 7, col: 1 }, opts);
    expect(p.axis).toBe('vertical');
    expect(p.backwards).toBe(false);
    expect(p.bounds).toEqual(rect(2, 7, 1, 1));
    expect(p.clearing).toBe(false);
  });

  it('locks vertical and flags backwards when the drag runs up', () => {
    const p = computeFillPreview(source, { row: 0, col: 1 }, opts);
    expect(p.axis).toBe('vertical');
    expect(p.backwards).toBe(true);
    expect(p.bounds).toEqual(rect(0, 2, 1, 1));
  });

  it('locks horizontal when the drag runs right', () => {
    const p = computeFillPreview(source, { row: 2, col: 5 }, opts);
    expect(p.axis).toBe('horizontal');
    expect(p.backwards).toBe(false);
    expect(p.bounds).toEqual(rect(2, 2, 1, 5));
  });

  it('locks horizontal and flags backwards when the drag runs left', () => {
    const p = computeFillPreview(source, { row: 2, col: 0 }, opts);
    expect(p.axis).toBe('horizontal');
    expect(p.backwards).toBe(true);
    expect(p.bounds).toEqual(rect(2, 2, 0, 1));
  });

  it('picks the DOMINANT axis on a diagonal drag and clamps the other', () => {
    // 6 rows down, 2 columns right → vertical wins, columns clamp to the source.
    const p = computeFillPreview(source, { row: 8, col: 3 }, opts);
    expect(p.axis).toBe('vertical');
    expect(p.bounds).toEqual(rect(2, 8, 1, 1));
  });

  it('picks horizontal when the sideways overshoot is larger', () => {
    const p = computeFillPreview(source, { row: 3, col: 9 }, opts);
    expect(p.axis).toBe('horizontal');
    expect(p.bounds).toEqual(rect(2, 2, 1, 9));
  });

  it('ties go vertical — a fill drag is overwhelmingly a drag DOWN', () => {
    const p = computeFillPreview(source, { row: 5, col: 4 }, opts);
    expect(p.axis).toBe('vertical');
  });

  it('a multi-column source keeps its full column span on a vertical fill', () => {
    const p = computeFillPreview(rect(0, 1, 2, 4), { row: 6, col: 3 }, opts);
    expect(p.axis).toBe('vertical');
    expect(p.bounds).toEqual(rect(0, 6, 2, 4));
  });
});

describe('computeFillPreview — back-drag clears', () => {
  it('clears the rows below the pointer on a tall source', () => {
    const p = computeFillPreview(rect(1, 6, 0, 0), { row: 3, col: 0 }, opts);
    expect(p.clearing).toBe(true);
    expect(p.axis).toBe('vertical');
    expect(p.bounds).toEqual(rect(1, 6, 0, 0));
    expect(p.cleared).toEqual(rect(4, 6, 0, 0));
  });

  it('clears the columns right of the pointer on a wide (1-row) source', () => {
    const p = computeFillPreview(rect(2, 2, 0, 5), { row: 2, col: 2 }, opts);
    expect(p.clearing).toBe(true);
    expect(p.axis).toBe('horizontal');
    expect(p.cleared).toEqual(rect(2, 2, 3, 5));
  });

  it('a 1-row source can only clear horizontally — no special case needed', () => {
    const p = computeFillPreview(rect(4, 4, 1, 3), { row: 4, col: 1 }, opts);
    expect(p.axis).toBe('horizontal');
    expect(p.cleared).toEqual(rect(4, 4, 2, 3));
  });

  it('the pointer on the source corner is a no-op, not a clear', () => {
    const p = computeFillPreview(rect(1, 4, 0, 2), { row: 4, col: 2 }, opts);
    expect(p.clearing).toBe(false);
    expect(p.cleared).toBeNull();
    expect(p.bounds).toEqual(rect(1, 4, 0, 2));
  });

  it('a 1x1 source can never clear', () => {
    const p = computeFillPreview(rect(3, 3, 3, 3), { row: 3, col: 3 }, opts);
    expect(p.clearing).toBe(false);
  });
});

describe('computeFillPreview — mode and the modifier', () => {
  it('uses the pattern default with no modifier', () => {
    expect(computeFillPreview(rect(0, 0, 0, 0), { row: 3, col: 0 }, opts).mode).toBe('series');
  });

  it('inverts the pattern default when the modifier is held', () => {
    const p = computeFillPreview(rect(0, 0, 0, 0), { row: 3, col: 0 }, { modifier: true, defaultMode: 'series' });
    expect(p.mode).toBe('copy');
  });

  it('inverts copy into series too — the asymmetry is per pattern, not per key', () => {
    const p = computeFillPreview(rect(0, 0, 0, 0), { row: 3, col: 0 }, { modifier: true, defaultMode: 'copy' });
    expect(p.mode).toBe('series');
  });
});

describe('buildFillLines — each line continues its own series', () => {
  it('vertical fill: one line per source COLUMN', () => {
    const preview = computeFillPreview(rect(0, 1, 2, 4), { row: 4, col: 3 }, opts);
    const lines = buildFillLines(preview);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.seedCol)).toEqual([2, 3, 4]);
    expect(lines[0].seedCells).toEqual([
      { row: 0, col: 2 },
      { row: 1, col: 2 },
    ]);
    expect(lines[0].targets).toEqual([
      { row: 2, col: 2 },
      { row: 3, col: 2 },
      { row: 4, col: 2 },
    ]);
    expect(lines[2].targets.every((c) => c.col === 4)).toBe(true);
  });

  it('horizontal fill: one line per source ROW', () => {
    const preview = computeFillPreview(rect(1, 3, 0, 1), { row: 2, col: 4 }, opts);
    const lines = buildFillLines(preview);
    expect(lines).toHaveLength(3);
    expect(lines[0].seedCells).toEqual([
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]);
    expect(lines[0].targets).toEqual([
      { row: 1, col: 2 },
      { row: 1, col: 3 },
      { row: 1, col: 4 },
    ]);
  });

  it('backwards targets are ordered ADJACENT-TO-SOURCE FIRST', () => {
    // That ordering is the contract `generateFill` returns values in, so the
    // caller never has to reverse an array — reversing one of the two is
    // exactly how an up-fill ends up mirrored.
    const preview = computeFillPreview(rect(5, 6, 0, 0), { row: 2, col: 0 }, opts);
    const [line] = buildFillLines(preview);
    expect(line.targets).toEqual([
      { row: 4, col: 0 },
      { row: 3, col: 0 },
      { row: 2, col: 0 },
    ]);
  });

  it('a clearing preview produces no targets', () => {
    const preview = computeFillPreview(rect(1, 5, 0, 0), { row: 3, col: 0 }, opts);
    expect(buildFillLines(preview).every((l) => l.targets.length === 0)).toBe(true);
  });
});

describe('rect helpers', () => {
  it('rectSize counts inclusively in both axes', () => {
    expect(rectSize(rect(0, 2, 0, 3))).toBe(12);
    expect(rectSize(rect(4, 4, 4, 4))).toBe(1);
  });

  it('isCellInRect is inclusive on every edge', () => {
    const r = rect(1, 3, 2, 4);
    expect(isCellInRect(1, 2, r)).toBe(true);
    expect(isCellInRect(3, 4, r)).toBe(true);
    expect(isCellInRect(0, 2, r)).toBe(false);
    expect(isCellInRect(2, 5, r)).toBe(false);
  });

  it('cellsInRect walks row-major', () => {
    expect(cellsInRect(rect(0, 1, 0, 1))).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]);
  });
});
