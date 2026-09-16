// handlers/cellWrites.ts
//
// THE shared multi-cell write primitive.
//
// Paste, cut, clear-contents, fill, find-&-replace and import all write more
// than one cell at a time. Every one of them goes through `applyCellWrites`.
// A second write path is how the grid ends up with two undo behaviours, two
// rejection tables and two sets of events — so there is exactly one.
//
// Contract:
//   * every accepted write goes through the EXISTING `createCellHandlers`
//     `handleCellSave` path, so per-cell `CELL_EDIT_SAVE`, the optimistic store
//     update and the undo recording are all unchanged;
//   * the whole batch is wrapped in ONE `beginUndoGroup()`/`endUndoGroup()`
//     pair, so a 30x4 paste is a single Ctrl+Z;
//   * per-cell results are RETURNED, never swallowed — a caller can report
//     "39 of 120 written, 3 read-only, 2 not coercible".

import type { ColumnDef } from '../types/index';
import type { CellStore } from '../store/index';
import { dispatch } from '../events/events';

// ============================================
// EVENT NAMES
// ============================================
// Defined HERE — in the module that emits them — and imported by
// `types/index.ts` as the values of `TableEvents.CELL_BATCH_SAVE` /
// `CELL_BATCH_SAVE_RESULT`. One spelling of each string in the codebase.
// Do not re-type these literals anywhere else.

/** Emitted once per multi-cell write, alongside the per-cell `CELL_EDIT_SAVE`s. */
export const CELL_BATCH_SAVE_EVENT = 'table:cell:batch:save';
/** Emitted once per multi-cell write with the applied/rejected tally. */
export const CELL_BATCH_SAVE_RESULT_EVENT = 'table:cell:batch:save:result';

// ============================================
// TYPES
// ============================================

/** Which interaction produced the batch. Drives reporting copy, not behaviour. */
export type CellWriteOrigin = 'paste' | 'cut' | 'clear' | 'fill' | 'replace' | 'import';

/**
 * Why a cell was refused. Kept deliberately small: the caller renders one
 * counted line per reason, so every reason must be explainable in a few words.
 */
export type CellWriteRejectReason =
  /** `readOnly` column, a lookup column, or (fill only) `disableFill`. */
  | 'readOnly'
  /** The value cannot become this column's type (numeric, date, relation, ...). */
  | 'notCoercible'
  /** A `dropdown`/`multiselect` value that is not one of `col.source`. */
  | 'notInSource'
  /** Emptying a column the module declares as required would 400. */
  | 'required'
  /** Row or column index is not on the loaded page (e.g. a clamped paste). */
  | 'outOfRange';

/** Coercion outcome — mirrors `utils/coerceCellValue.ts` (Wave 3). */
export type CoerceReason = 'readOnly' | 'notCoercible' | 'notInSource';
export type CoerceResult = { ok: true; value: unknown } | { ok: false; reason: CoerceReason };
/**
 * Turns a raw incoming value into something the column can store.
 * Injected rather than imported so this module stays free of the coercion
 * table: there must be exactly one of those, and it lives in
 * `utils/coerceCellValue.ts`. Omitted → values pass through untouched, which is
 * today's fill behaviour (same column in, same column out).
 */
export type CellValueCoercer = (value: unknown, column: ColumnDef) => CoerceResult;

/** One requested cell mutation, addressed by loaded-page row + view column. */
export interface CellWrite {
  row: number;
  col: number;
  value: unknown;
}

/** What happened to one requested cell. */
export interface CellWriteResult {
  row: number;
  col: number;
  /** The column's field key, or `null` when the column index was out of range. */
  prop: string | null;
  status: 'written' | 'unchanged' | 'rejected';
  /** Present only when `status === 'rejected'`. */
  reason?: CellWriteRejectReason;
  oldValue?: unknown;
  /** The coerced value, i.e. what was actually handed to the save path. */
  newValue?: unknown;
}

export type CellWriteRejectionCounts = Record<CellWriteRejectReason, number>;

/** The full, non-swallowed outcome of one multi-cell write. */
export interface CellWriteReport {
  origin: CellWriteOrigin;
  /** Writes handed in, before duplicate-cell collapsing. */
  requested: number;
  /** Cells whose value actually changed and were saved. */
  written: number;
  /** Cells already holding the requested value — cheap no-ops, not failures. */
  unchanged: number;
  /** One entry per refused cell, in request order. */
  rejected: CellWriteResult[];
  /** Rejection tally by reason, for a one-line report. */
  rejectedByReason: CellWriteRejectionCounts;
  /** Every cell's outcome, after duplicate-cell collapsing, in request order. */
  results: CellWriteResult[];
}

/** The store surface this primitive needs — nothing more, so it is fakeable. */
export type CellWriteStore = Pick<
  CellStore,
  'getRowData' | 'getRowCount' | 'beginUndoGroup' | 'endUndoGroup'
>;

export interface CellWriteDeps {
  store: CellWriteStore;
  /**
   * The VIEW column order — `write.col` indexes this array.
   *
   * MUST be every visible column, in view order. NEVER a virtualization
   * window: a write to an unmounted column is a normal write, not an
   * out-of-range one. Bind a window here and a paste that straddles the
   * viewport edge silently reports half its cells as `outOfRange`.
   */
  columns: ColumnDef[];
  /** `createCellHandlers(...).handleCellSave`. Pass it as-is. */
  handleCellSave: (row: number, col: number, value: unknown, clearEditing?: boolean) => void;
  /** See `CellValueCoercer`. Defaults to pass-through. */
  coerce?: CellValueCoercer;
  /** The grid container, for the batch events. Omit to stay silent. */
  element?: HTMLElement | null;
  /** Field key holding the row's stable id, for the batch event payload. */
  idColumnName?: string;
}

export interface ApplyCellWritesOptions {
  origin: CellWriteOrigin;
  /**
   * Treat `ColumnDef.disableFill` as read-only. `disableFill` is fill-specific
   * (it excludes identity columns from the handle while leaving them normally
   * editable), so it must NOT block a paste or a replace.
   * Defaults to `origin === 'fill'`.
   */
  respectDisableFill?: boolean;
}

// ============================================
// HELPERS
// ============================================

function emptyRejectionCounts(): CellWriteRejectionCounts {
  return {
    readOnly: 0,
    notCoercible: 0,
    notInSource: 0,
    required: 0,
    outOfRange: 0,
  };
}

/**
 * The same unchanged test `handleCellSave` applies before it does anything.
 * Duplicated here (not re-derived) so the report can distinguish "written" from
 * "already had that value" — `handleCellSave` returns void and cannot tell us.
 */
export function isCellValueUnchanged(oldValue: unknown, newValue: unknown): boolean {
  if (Array.isArray(oldValue) || Array.isArray(newValue)) {
    return JSON.stringify(oldValue) === JSON.stringify(newValue);
  }
  return String(oldValue ?? '') === String(newValue ?? '');
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

const passThroughCoercer: CellValueCoercer = (value) => ({ ok: true, value });

/**
 * Collapse repeated writes to the same cell, last one wins, request order
 * preserved. Overlapping rectangles (a fill dragged back over a paste target,
 * a replace-all hitting one cell twice) must not produce two undo records for
 * one cell.
 */
function dedupeWrites(writes: readonly CellWrite[]): CellWrite[] {
  const byCell = new Map<string, number>();
  const out: CellWrite[] = [];
  for (const write of writes) {
    const key = `${write.row}:${write.col}`;
    const at = byCell.get(key);
    if (at === undefined) {
      byCell.set(key, out.length);
      out.push(write);
    } else {
      out[at] = write;
    }
  }
  return out;
}

// ============================================
// THE PRIMITIVE
// ============================================

/**
 * Apply many cell writes as ONE undoable, reported batch.
 *
 * Rejected cells never reach `handleCellSave`, so they are never persisted and
 * never recorded for undo — an undo must not "restore" a value that was never
 * written.
 *
 * Unchanged cells cost nothing: `handleCellSave` returns early before both the
 * event and the undo record, so a batch that overwrites identical values pushes
 * no undo entry at all. That is correct — Ctrl+Z must not consume an entry for
 * a no-op.
 */
export function applyCellWrites(
  deps: CellWriteDeps,
  writes: readonly CellWrite[],
  options: ApplyCellWritesOptions,
): CellWriteReport {
  const {
    store,
    columns,
    handleCellSave,
    coerce = passThroughCoercer,
    element = null,
    idColumnName = 'id',
  } = deps;
  const { origin } = options;
  const respectDisableFill = options.respectDisableFill ?? origin === 'fill';

  const requested = writes.length;
  const deduped = dedupeWrites(writes);
  const rowCount = store.getRowCount();

  const results: CellWriteResult[] = [];
  const accepted: Array<{
    row: number;
    col: number;
    column: ColumnDef;
    value: unknown;
    oldValue: unknown;
    rowData: any;
    result: CellWriteResult;
  }> = [];

  for (const write of deduped) {
    const { row, col } = write;
    const column = columns[col];

    if (!column || col < 0 || row < 0 || row >= rowCount) {
      results.push({ row, col, prop: column?.data ?? null, status: 'rejected', reason: 'outOfRange' });
      continue;
    }

    const prop = column.data;

    if (column.readOnly || (respectDisableFill && column.disableFill)) {
      results.push({ row, col, prop, status: 'rejected', reason: 'readOnly' });
      continue;
    }

    const coerced = coerce(write.value, column);
    if (!coerced.ok) {
      // `readOnly` from the coercer collapses onto the same reason the column
      // check produces — one reason per user-visible cause, not per code path.
      results.push({ row, col, prop, status: 'rejected', reason: coerced.reason });
      continue;
    }
    const value = coerced.value;

    if (column.required === true && isEmptyValue(value)) {
      results.push({ row, col, prop, status: 'rejected', reason: 'required' });
      continue;
    }

    // Old values are read for the WHOLE batch before anything is written, so a
    // batch that touches the same row twice still reports pre-batch values.
    const rowData = store.getRowData(row);
    const oldValue = rowData ? rowData[prop] : undefined;

    if (isCellValueUnchanged(oldValue, value)) {
      results.push({ row, col, prop, status: 'unchanged', oldValue, newValue: value });
      continue;
    }

    const result: CellWriteResult = { row, col, prop, status: 'written', oldValue, newValue: value };
    results.push(result);
    accepted.push({ row, col, column, value, oldValue, rowData, result });
  }

  // ONE group around the ENTIRE batch. Opening a group per row or per column
  // would produce one undo entry per row/column — an n-column fill would need
  // n Ctrl+Z's. Nothing below this line may open another group.
  if (accepted.length > 0) {
    store.beginUndoGroup();
    try {
      for (const item of accepted) {
        handleCellSave(item.row, item.col, item.value, false);
      }
    } finally {
      store.endUndoGroup();
    }
  }

  const rejected = results.filter((r) => r.status === 'rejected');
  const rejectedByReason = emptyRejectionCounts();
  for (const r of rejected) {
    if (r.reason) rejectedByReason[r.reason] += 1;
  }

  const report: CellWriteReport = {
    origin,
    requested,
    written: accepted.length,
    unchanged: results.filter((r) => r.status === 'unchanged').length,
    rejected,
    rejectedByReason,
    results,
  };

  if (element) {
    // Additive to the per-cell `CELL_EDIT_SAVE`s `handleCellSave` already fired:
    // consumers that ignore these two events keep working unchanged.
    dispatch(element, CELL_BATCH_SAVE_EVENT, {
      origin,
      writes: accepted.map((item) => ({
        rowIndex: item.row,
        colIndex: item.col,
        prop: item.column.data,
        oldValue: item.oldValue,
        newValue: item.value,
        rowData: item.rowData,
        id: item.rowData?.[idColumnName],
      })),
    });
    dispatch(element, CELL_BATCH_SAVE_RESULT_EVENT, {
      applied: report.written,
      rejected: rejected.map((r) => ({ rowIndex: r.row, colIndex: r.col, reason: r.reason })),
    });
  }

  return report;
}

/**
 * Bind the dependencies once and get the call shape every caller uses:
 * `write(writes, 'paste')`. Keeps `DynamicTable.tsx` free of the deps object
 * while there is still only ONE implementation underneath.
 */
export function createCellWriter(deps: CellWriteDeps) {
  return function write(
    writes: readonly CellWrite[],
    origin: CellWriteOrigin | ApplyCellWritesOptions,
  ): CellWriteReport {
    const options = typeof origin === 'string' ? { origin } : origin;
    return applyCellWrites(deps, writes, options);
  };
}
