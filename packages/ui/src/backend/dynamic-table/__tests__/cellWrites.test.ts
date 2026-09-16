import {
  applyCellWrites,
  createCellWriter,
  isCellValueUnchanged,
  CELL_BATCH_SAVE_EVENT,
  CELL_BATCH_SAVE_RESULT_EVENT,
  type CellValueCoercer,
  type CellWrite,
  type CellWriteDeps,
} from '../handlers/cellWrites';
import type { ColumnDef } from '../types/index';

const columns: ColumnDef[] = [
  { data: 'ref', title: 'Ref' },
  { data: 'amount', title: 'Amount', type: 'numeric' },
  { data: 'status', title: 'Status', readOnly: true },
  { data: 'invoiceNo', title: 'Invoice no', disableFill: true },
];

type Harness = ReturnType<typeof makeHarness>;

function makeHarness(rows: any[] = [
  { id: 'r1', ref: 'A', amount: 1, status: 'draft', invoiceNo: 'FV/1' },
  { id: 'r2', ref: 'B', amount: 2, status: 'draft', invoiceNo: 'FV/2' },
  { id: 'r3', ref: 'C', amount: 3, status: 'draft', invoiceNo: 'FV/3' },
]) {
  const journal: string[] = [];
  const saves: Array<{ row: number; col: number; value: unknown; clearEditing?: boolean }> = [];

  const store = {
    getRowData: (row: number) => rows[row],
    getRowCount: () => rows.length,
    beginUndoGroup: () => { journal.push('begin'); },
    endUndoGroup: () => { journal.push('end'); },
  };

  const handleCellSave = (row: number, col: number, value: unknown, clearEditing?: boolean) => {
    journal.push(`save:${row}:${col}`);
    saves.push({ row, col, value, clearEditing });
    // Mirror the real handler's optimistic store update.
    rows[row][columns[col].data] = value;
  };

  return { rows, journal, saves, store, handleCellSave };
}

function deps(h: Harness, extra: Partial<CellWriteDeps> = {}): CellWriteDeps {
  return { store: h.store, columns, handleCellSave: h.handleCellSave, ...extra };
}

describe('applyCellWrites — undo grouping', () => {
  it('wraps the ENTIRE batch in exactly one undo group', () => {
    const h = makeHarness();
    const writes: CellWrite[] = [
      { row: 0, col: 0, value: 'X' },
      { row: 1, col: 0, value: 'Y' },
      { row: 2, col: 1, value: 99 },
    ];

    applyCellWrites(deps(h), writes, { origin: 'paste' });

    expect(h.journal).toEqual(['begin', 'save:0:0', 'save:1:0', 'save:2:1', 'end']);
    expect(h.journal.filter((e) => e === 'begin')).toHaveLength(1);
  });

  it('opens no undo group at all when every cell is a no-op', () => {
    const h = makeHarness();
    const report = applyCellWrites(deps(h), [
      { row: 0, col: 0, value: 'A' },
      { row: 1, col: 0, value: 'B' },
    ], { origin: 'fill' });

    expect(h.journal).toEqual([]);
    expect(h.saves).toHaveLength(0);
    expect(report.written).toBe(0);
    expect(report.unchanged).toBe(2);
  });

  it('opens no undo group when every cell is rejected', () => {
    const h = makeHarness();
    applyCellWrites(deps(h), [{ row: 0, col: 2, value: 'sent' }], { origin: 'paste' });
    expect(h.journal).toEqual([]);
  });

  it('closes the group even if a save throws', () => {
    const h = makeHarness();
    const exploding = () => { throw new Error('save blew up'); };
    expect(() =>
      applyCellWrites(deps(h, { handleCellSave: exploding }), [{ row: 0, col: 0, value: 'X' }], { origin: 'paste' }),
    ).toThrow('save blew up');
    expect(h.journal).toEqual(['begin', 'end']);
  });

  it('saves with clearEditing=false so the editor is not disturbed mid-batch', () => {
    const h = makeHarness();
    applyCellWrites(deps(h), [{ row: 0, col: 0, value: 'X' }], { origin: 'paste' });
    expect(h.saves[0].clearEditing).toBe(false);
  });
});

describe('applyCellWrites — per-cell results', () => {
  it('reports written / read-only / not-coercible counts instead of swallowing them', () => {
    const h = makeHarness();
    const coerce: CellValueCoercer = (value, column) =>
      column.type === 'numeric' && Number.isNaN(Number(value))
        ? { ok: false, reason: 'notCoercible' }
        : { ok: true, value };

    const report = applyCellWrites(deps(h, { coerce }), [
      { row: 0, col: 0, value: 'X' },        // written
      { row: 1, col: 0, value: 'Y' },        // written
      { row: 0, col: 2, value: 'sent' },     // readOnly
      { row: 1, col: 2, value: 'sent' },     // readOnly
      { row: 0, col: 1, value: 'not a num' }, // notCoercible
    ], { origin: 'paste' });

    expect(report.requested).toBe(5);
    expect(report.written).toBe(2);
    expect(report.rejected).toHaveLength(3);
    expect(report.rejectedByReason.readOnly).toBe(2);
    expect(report.rejectedByReason.notCoercible).toBe(1);
    expect(report.results.map((r) => r.status)).toEqual([
      'written', 'written', 'rejected', 'rejected', 'rejected',
    ]);
  });

  it('carries the old and coerced new value on each written result', () => {
    const h = makeHarness();
    const coerce: CellValueCoercer = (value) => ({ ok: true, value: String(value).trim() });
    const report = applyCellWrites(deps(h, { coerce }), [{ row: 0, col: 0, value: '  X  ' }], { origin: 'paste' });

    expect(report.results[0]).toMatchObject({ row: 0, col: 0, prop: 'ref', oldValue: 'A', newValue: 'X' });
    expect(h.saves[0].value).toBe('X');
  });

  it('rejects rows and columns that are not on the loaded page', () => {
    const h = makeHarness();
    const report = applyCellWrites(deps(h), [
      { row: 99, col: 0, value: 'X' },
      { row: 0, col: 42, value: 'X' },
      { row: -1, col: 0, value: 'X' },
    ], { origin: 'paste' });

    expect(report.rejectedByReason.outOfRange).toBe(3);
    expect(h.saves).toHaveLength(0);
  });

  it('reports a dropdown value that is not in the column source', () => {
    const h = makeHarness();
    const coerce: CellValueCoercer = () => ({ ok: false, reason: 'notInSource' });
    const report = applyCellWrites(deps(h, { coerce }), [{ row: 0, col: 0, value: 'nope' }], { origin: 'paste' });
    expect(report.rejectedByReason.notInSource).toBe(1);
  });

  it('refuses to empty a required column instead of round-tripping a 400', () => {
    const requiredColumns = [{ data: 'ref', required: true } as ColumnDef];
    const h = makeHarness();
    const report = applyCellWrites(
      { store: h.store, columns: requiredColumns, handleCellSave: h.handleCellSave },
      [{ row: 0, col: 0, value: '' }],
      { origin: 'clear' },
    );
    expect(report.rejectedByReason.required).toBe(1);
    expect(h.saves).toHaveLength(0);
  });
});

describe('applyCellWrites — column gates', () => {
  it('treats disableFill as read-only for a fill, but not for a paste', () => {
    const h = makeHarness();
    const filled = applyCellWrites(deps(h), [{ row: 0, col: 3, value: 'FV/9' }], { origin: 'fill' });
    expect(filled.rejectedByReason.readOnly).toBe(1);

    const pasted = applyCellWrites(deps(h), [{ row: 0, col: 3, value: 'FV/9' }], { origin: 'paste' });
    expect(pasted.written).toBe(1);
  });

  it('honours an explicit respectDisableFill override', () => {
    const h = makeHarness();
    const report = applyCellWrites(
      deps(h),
      [{ row: 0, col: 3, value: 'FV/9' }],
      { origin: 'paste', respectDisableFill: true },
    );
    expect(report.rejectedByReason.readOnly).toBe(1);
  });
});

describe('applyCellWrites — duplicate cells', () => {
  it('collapses repeated writes to one cell, last one wins, one save', () => {
    const h = makeHarness();
    const report = applyCellWrites(deps(h), [
      { row: 0, col: 0, value: 'first' },
      { row: 1, col: 0, value: 'other' },
      { row: 0, col: 0, value: 'last' },
    ], { origin: 'replace' });

    expect(h.saves.filter((s) => s.row === 0 && s.col === 0)).toEqual([
      { row: 0, col: 0, value: 'last', clearEditing: false },
    ]);
    expect(report.requested).toBe(3);
    expect(report.results).toHaveLength(2);
  });

  it('compares a duplicated cell against its PRE-batch value', () => {
    const h = makeHarness();
    const report = applyCellWrites(deps(h), [
      { row: 0, col: 0, value: 'A' },
      { row: 0, col: 0, value: 'A' },
    ], { origin: 'paste' });
    expect(report.unchanged).toBe(1);
    expect(report.written).toBe(0);
  });
});

describe('applyCellWrites — events', () => {
  it('dispatches one batch event and one result event, not one per cell', () => {
    const h = makeHarness();
    const element = document.createElement('div');
    const batches: any[] = [];
    const results: any[] = [];
    element.addEventListener(CELL_BATCH_SAVE_EVENT, (e) => batches.push((e as CustomEvent).detail));
    element.addEventListener(CELL_BATCH_SAVE_RESULT_EVENT, (e) => results.push((e as CustomEvent).detail));

    applyCellWrites(deps(h, { element }), [
      { row: 0, col: 0, value: 'X' },
      { row: 1, col: 0, value: 'Y' },
      { row: 0, col: 2, value: 'sent' },
    ], { origin: 'cut' });

    expect(batches).toHaveLength(1);
    expect(results).toHaveLength(1);
    expect(batches[0].origin).toBe('cut');
    expect(batches[0].writes).toHaveLength(2);
    expect(batches[0].writes[0]).toMatchObject({ rowIndex: 0, colIndex: 0, prop: 'ref', oldValue: 'A', newValue: 'X', id: 'r1' });
    expect(results[0]).toEqual({ applied: 2, rejected: [{ rowIndex: 0, colIndex: 2, reason: 'readOnly' }] });
  });

  it('stays silent when no element is supplied', () => {
    const h = makeHarness();
    expect(() => applyCellWrites(deps(h), [{ row: 0, col: 0, value: 'X' }], { origin: 'paste' })).not.toThrow();
  });
});

describe('createCellWriter', () => {
  it('binds the deps and takes the origin as a bare string', () => {
    const h = makeHarness();
    const write = createCellWriter(deps(h));
    const report = write([{ row: 0, col: 0, value: 'X' }], 'fill');
    expect(report.origin).toBe('fill');
    expect(report.written).toBe(1);
  });

  it('still accepts a full options object', () => {
    const h = makeHarness();
    const write = createCellWriter(deps(h));
    const report = write([{ row: 0, col: 3, value: 'FV/9' }], { origin: 'paste', respectDisableFill: true });
    expect(report.rejectedByReason.readOnly).toBe(1);
  });
});

describe('isCellValueUnchanged', () => {
  it('matches the save path: null, undefined and empty string are the same emptiness', () => {
    expect(isCellValueUnchanged(null, '')).toBe(true);
    expect(isCellValueUnchanged(undefined, null)).toBe(true);
    expect(isCellValueUnchanged(1, '1')).toBe(true);
    expect(isCellValueUnchanged('a', 'b')).toBe(false);
  });

  it('compares arrays structurally', () => {
    expect(isCellValueUnchanged(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(isCellValueUnchanged(['a'], ['a', 'b'])).toBe(false);
  });
});
