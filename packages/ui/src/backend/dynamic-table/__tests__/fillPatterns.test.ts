import {
  detectFillPattern,
  fillDetectors,
  generateFill,
  invertFillMode,
  type FillSeed,
} from '../utils/fillPatterns';
import type { ColumnDef } from '../types/index';

const textCol: ColumnDef = { data: 'ref' };
const numCol: ColumnDef = { data: 'amount', type: 'numeric' };
const dateCol: ColumnDef = { data: 'etd', type: 'date' };
const dropdownCol: ColumnDef = { data: 'status', type: 'dropdown', source: ['draft', 'sent', 'paid'] };

function seed(values: unknown[], column: ColumnDef = textCol): FillSeed {
  return { values, column };
}

/** The forward extension a drag down/right produces. */
function forward(s: FillSeed, count: number, mode: 'series' | 'copy' = 'series') {
  return generateFill(s, count, 1, mode);
}
/** The backward extension a drag up/left produces, adjacent cell first. */
function backward(s: FillSeed, count: number, mode: 'series' | 'copy' = 'series') {
  return generateFill(s, count, -1, mode);
}

describe('copy — the terminal pattern', () => {
  it('repeats a single unrecognised value — the behaviour shipped today', () => {
    const s = seed(['Gdynia']);
    expect(detectFillPattern(s).kind).toBe('copy');
    expect(forward(s, 3)).toEqual(['Gdynia', 'Gdynia', 'Gdynia']);
  });

  it('tiles a multi-cell block cyclically', () => {
    const s = seed(['A', 'B']);
    expect(forward(s, 4)).toEqual(['A', 'B', 'A', 'B']);
  });

  it('tiles backwards with the LAST seed value adjacent to the source', () => {
    const s = seed(['A', 'B']);
    expect(backward(s, 4)).toEqual(['B', 'A', 'B', 'A']);
  });

  it('fills blanks with blanks rather than inventing a series', () => {
    const s = seed(['', ''], numCol);
    expect(detectFillPattern(s).kind).toBe('copy');
    expect(forward(s, 2)).toEqual(['', '']);
  });
});

describe('numericStep', () => {
  it('copies a single number by default — Excel does not step until Ctrl is held', () => {
    const s = seed([5], numCol);
    const pattern = detectFillPattern(s);
    expect(pattern.kind).toBe('numeric');
    expect(pattern.defaultMode).toBe('copy');
    expect(forward(s, 3, 'copy')).toEqual([5, 5, 5]);
  });

  it('steps a single number by 1 when the mode is inverted to series', () => {
    const s = seed([5], numCol);
    expect(forward(s, 3, 'series')).toEqual([6, 7, 8]);
    expect(backward(s, 2, 'series')).toEqual([4, 3]);
  });

  it('establishes the step from two cells', () => {
    const s = seed([10, 20], numCol);
    expect(detectFillPattern(s).defaultMode).toBe('series');
    expect(forward(s, 3)).toEqual([30, 40, 50]);
    expect(backward(s, 2)).toEqual([0, -10]);
  });

  it('extrapolates a decimal step without float drift', () => {
    expect(forward(seed([0.5, 1], numCol), 3)).toEqual([1.5, 2, 2.5]);
    expect(forward(seed([1.1, 1.2], numCol), 3)).toEqual([1.3, 1.4, 1.5]);
  });

  it('falls through to copy on a non-constant delta — no regression guessing', () => {
    const s = seed([1, 2, 4], numCol);
    expect(detectFillPattern(s).kind).toBe('copy');
    expect(forward(s, 3)).toEqual([1, 2, 4]);
  });

  it('reads the Polish decimal comma and space thousands separator', () => {
    const s = seed(['1 000,5', '1 001,5'], numCol);
    expect(detectFillPattern(s).kind).toBe('numeric');
    expect(forward(s, 2)).toEqual([1002.5, 1003.5]);
  });

  it('leaves zero-padded identifiers to suffixStep', () => {
    expect(detectFillPattern(seed(['007'])).kind).toBe('suffix');
  });

  it('does not fire on a mixed numeric/text seed', () => {
    expect(detectFillPattern(seed([1, 'x'], numCol)).kind).toBe('copy');
  });
});

describe('dateStep', () => {
  it('steps a single date by one day, and defaults to series — Excel\'s asymmetry with numbers', () => {
    const s = seed(['2026-08-03'], dateCol);
    const pattern = detectFillPattern(s);
    expect(pattern.kind).toBe('date');
    expect(pattern.defaultMode).toBe('series');
    expect(forward(s, 2)).toEqual(['2026-08-04', '2026-08-05']);
    expect(backward(s, 1)).toEqual(['2026-08-02']);
  });

  it('steps by a constant number of days', () => {
    const s = seed(['2026-08-01', '2026-08-08'], dateCol);
    expect(forward(s, 2)).toEqual(['2026-08-15', '2026-08-22']);
    expect(backward(s, 1)).toEqual(['2026-07-25']);
  });

  it('crosses a month boundary correctly', () => {
    expect(forward(seed(['2026-01-30', '2026-01-31'], dateCol), 2)).toEqual(['2026-02-01', '2026-02-02']);
  });

  it('detects a whole-month step and clamps the day of month', () => {
    const s = seed(['2025-12-31', '2026-01-31'], dateCol);
    expect(forward(s, 2)).toEqual(['2026-02-28', '2026-03-31']);
  });

  it('detects a whole-year step as a twelve-month step', () => {
    const s = seed(['2024-03-15', '2025-03-15'], dateCol);
    expect(forward(s, 2)).toEqual(['2026-03-15', '2027-03-15']);
  });

  it('accepts a Date instance and an ISO timestamp', () => {
    expect(forward(seed([new Date(2026, 7, 1), new Date(2026, 7, 2)], dateCol), 1)).toEqual(['2026-08-03']);
    expect(forward(seed(['2026-08-01T10:00:00Z', '2026-08-02T10:00:00Z'], dateCol), 1)).toEqual(['2026-08-03']);
  });

  it('NEVER date-parses a column that is not type:date — "3-5" stays text', () => {
    const s = seed(['3-5'], textCol);
    expect(detectFillPattern(s).kind).not.toBe('date');
    expect(forward(s, 1)).toEqual(['3-6']);
  });

  it('falls through to copy when the deltas are inconsistent', () => {
    expect(detectFillPattern(seed(['2026-08-01', '2026-08-05', '2026-08-06'], dateCol)).kind).toBe('copy');
  });
});

describe('weekdayStep', () => {
  it('skips the weekend: Fri, Mon, Tue continues to Wed', () => {
    // 2026-08-07 is a Friday; 2026-08-10 the following Monday.
    const s = seed(['2026-08-07', '2026-08-10', '2026-08-11'], dateCol);
    const pattern = detectFillPattern(s);
    expect(pattern.kind).toBe('weekday');
    expect(forward(s, 3)).toEqual(['2026-08-12', '2026-08-13', '2026-08-14']);
  });

  it('jumps the weekend when a forward fill runs off a Friday', () => {
    const s = seed(['2026-08-05', '2026-08-06'], dateCol); // Wed, Thu
    expect(forward(s, 3)).toEqual(['2026-08-07', '2026-08-10', '2026-08-11']);
  });

  it('runs backwards over the weekend too', () => {
    const s = seed(['2026-08-10', '2026-08-11'], dateCol); // Mon, Tue
    expect(backward(s, 2)).toEqual(['2026-08-07', '2026-08-06']);
  });

  it('is declined when a seed value lands on a weekend, leaving dateStep to answer', () => {
    const s = seed(['2026-08-08', '2026-08-09'], dateCol); // Sat, Sun
    expect(detectFillPattern(s).kind).toBe('date');
    expect(forward(s, 1)).toEqual(['2026-08-10']);
  });

  // Ledger row 1.16. Two seeds ten CALENDAR days apart that both happen to land
  // on a weekday are not a weekday series — as weekdays they are eight apart,
  // and reading them that way produced 23.02 / 05.03 / 17.03 where Excel gives
  // 21.02 / 03.03 / 13.03. Only a step of ONE weekday is unambiguous.
  it('leaves a wide day step to dateStep even when both seeds are weekdays', () => {
    // 2027-02-01 Mon, 2027-02-11 Thu — 10 calendar days, 8 weekdays.
    const s = seed(['2027-02-01', '2027-02-11'], dateCol);
    expect(detectFillPattern(s).kind).toBe('date');
    expect(forward(s, 3)).toEqual(['2027-02-21', '2027-03-03', '2027-03-13']);
  });

  it('leaves a two-weekday step to dateStep as well', () => {
    // 2026-08-10 Mon, 2026-08-12 Wed — 2 calendar days AND 2 weekdays.
    const s = seed(['2026-08-10', '2026-08-12'], dateCol);
    expect(detectFillPattern(s).kind).toBe('date');
    expect(forward(s, 2)).toEqual(['2026-08-14', '2026-08-16']);
  });

  it('runs before dateStep — Fri, Mon would die as an inconsistent day step', () => {
    const fri = seed(['2026-08-07', '2026-08-10'], dateCol);
    expect(fillDetectors).toHaveLength(4);
    expect(detectFillPattern(fri).kind).toBe('weekday');
    expect(forward(fri, 2)).toEqual(['2026-08-11', '2026-08-12']);
  });
});

describe('suffixStep', () => {
  it('steps a single reference and keeps the zero padding', () => {
    const s = seed(['REF-001']);
    expect(detectFillPattern(s).kind).toBe('suffix');
    expect(forward(s, 3)).toEqual(['REF-002', 'REF-003', 'REF-004']);
  });

  it('widens the padding on overflow', () => {
    expect(forward(seed(['REF-999']), 2)).toEqual(['REF-1000', 'REF-1001']);
  });

  it('establishes a step of more than one from two cells', () => {
    expect(forward(seed(['INV-10', 'INV-20']), 2)).toEqual(['INV-30', 'INV-40']);
  });

  it('keeps a trailing non-digit part', () => {
    expect(forward(seed(['LOT-01/A']), 2)).toEqual(['LOT-02/A', 'LOT-03/A']);
  });

  it('runs backwards', () => {
    expect(backward(seed(['REF-005']), 2)).toEqual(['REF-004', 'REF-003']);
  });

  it('declines when the prefix differs', () => {
    expect(detectFillPattern(seed(['REF-001', 'ORD-002'])).kind).toBe('copy');
  });

  it('declines when the trailing part differs', () => {
    expect(detectFillPattern(seed(['LOT-1/A', 'LOT-2/B'])).kind).toBe('copy');
  });
});

describe('hard gates', () => {
  it('never cycles a dropdown source — a presentation order is not a sequence', () => {
    const s = seed(['draft'], dropdownCol);
    expect(detectFillPattern(s).kind).toBe('copy');
    expect(forward(s, 2)).toEqual(['draft', 'draft']);
  });

  it('never steps a multiselect or a boolean', () => {
    expect(detectFillPattern(seed([1], { data: 'x', type: 'multiselect' })).kind).toBe('copy');
    expect(detectFillPattern(seed([1], { data: 'x', type: 'boolean' })).kind).toBe('copy');
  });

  it('honours a per-column fillSeries:copy opt-out on an otherwise perfect series', () => {
    const column = { data: 'invoiceNo', fillSeries: 'copy' } as ColumnDef;
    const s = seed(['FV-001', 'FV-002'], column);
    expect(detectFillPattern(s).kind).toBe('copy');
    expect(forward(s, 2)).toEqual(['FV-001', 'FV-002']);
  });
});

describe('generateFill', () => {
  it('returns nothing for a non-positive count', () => {
    expect(generateFill(seed(['A']), 0, 1, 'copy')).toEqual([]);
    expect(generateFill(seed(['A']), -3, 1, 'copy')).toEqual([]);
  });

  it('copy mode tiles even when a series was detectable', () => {
    const s = seed([1, 2], numCol);
    expect(forward(s, 4, 'copy')).toEqual([1, 2, 1, 2]);
    expect(forward(s, 4, 'series')).toEqual([3, 4, 5, 6]);
  });

  it('reproduces the seed exactly at its own indices', () => {
    const pattern = detectFillPattern(seed([10, 20, 30], numCol));
    expect([pattern.at(0), pattern.at(1), pattern.at(2)]).toEqual([10, 20, 30]);
  });
});

describe('invertFillMode', () => {
  it('swaps copy and series', () => {
    expect(invertFillMode('series')).toBe('copy');
    expect(invertFillMode('copy')).toBe('series');
  });
});
