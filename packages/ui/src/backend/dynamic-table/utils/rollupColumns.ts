// utils/rollupColumns.ts
//
// Client half of rollup ("summarised") columns. The server attaches the value
// to each row under an opaque key; this module builds the `ColumnDef` that
// reads it, and serialises the active view's rollups into the `rollups` query
// param the host route parses.
//
// Sibling of `utils/lookupColumns.tsx` (many-to-one) and
// `utils/formulaColumns.tsx` (computed in the browser). All three are told
// apart by key prefix alone, on client and server both.

import type { ColumnDef } from '../types/index';
import type { RollupColumnRef, RollupFn } from '../types/rollup';
import { ROLLUP_COUNT_FIELD, isRollupFn } from '../types/rollup';
import { formatAggregate } from './formatAggregate';

const KEY_PREFIX = 'rollup__';

/**
 * Row field / column data key for a rollup column.
 *
 * MUST stay byte-identical to `rollupColumnDataKey` on the server side (today:
 * `packages/projects/src/modules/folders/lib/rollups/resolver.ts`). The server
 * writes that key onto the row; a `ColumnDef.data` that differs by one
 * character renders an empty column with no error anywhere.
 */
export function rollupColumnDataKey(r: { source: string; field: string; fn: RollupFn }): string {
  return `${KEY_PREFIX}${r.source}__${r.field}__${r.fn}`;
}

/** True when a column data key belongs to a rollup column. */
export function isRollupColumnKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX);
}

/** Inverse of {@link rollupColumnDataKey}; undefined when the key is not one. */
export function parseRollupColumnKey(
  key: string,
): { source: string; field: string; fn: RollupFn } | undefined {
  if (!isRollupColumnKey(key)) return undefined;
  const parts = key.slice(KEY_PREFIX.length).split('__');
  if (parts.length !== 3) return undefined;
  const [source, field, fn] = parts;
  if (!source || !field || !isRollupFn(fn)) return undefined;
  return { source, field, fn };
}

/**
 * Serialise a view's rollup columns into the `rollups` query param value
 * (`source:field:fn,source:field:fn`). Empty when the view has none — and an
 * empty param is what makes the feature free: the host route then behaves
 * byte-identically to before rollups existed.
 *
 * De-duplicated, because two refs that differ only in `label` are one aggregate
 * to the server and asking twice buys a second `GROUP BY` for nothing.
 */
export function rollupColumnsToParam(refs: readonly RollupColumnRef[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of refs) {
    const triple = `${r.source}:${r.field}:${r.fn}`;
    if (seen.has(triple)) continue;
    seen.add(triple);
    out.push(triple);
  }
  return out.join(',');
}

/**
 * Defensively parse the `_rollups` smuggled inside the perspective's `filters`
 * passthrough. Drops anything malformed so a legacy or hand-edited view can
 * never crash the table — the same contract as `parseLookupColumns` and
 * `parseFormulaColumns`.
 *
 * A ref whose `fn` this client does not know is DROPPED rather than half-kept:
 * that is the forward-compatibility rule the aggregations parser already
 * follows, and it degrades to one missing column instead of a thrown render.
 */
export function parseRollupColumns(raw: unknown): RollupColumnRef[] {
  if (!Array.isArray(raw)) return [];
  const out: RollupColumnRef[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { source, field, fn, label } = entry as Record<string, unknown>;
    if (typeof source !== 'string' || !source) continue;
    if (typeof field !== 'string' || !field) continue;
    if (!isRollupFn(fn)) continue;
    // COUNT is only ever over the child's id — the server enforces the same
    // rule, so a ref that disagrees would render a permanently empty column.
    if (fn === 'count' && field !== ROLLUP_COUNT_FIELD) continue;
    const key = rollupColumnDataKey({ source, field, fn });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source,
      field,
      fn,
      label: typeof label === 'string' && label ? label : key,
    });
  }
  return out;
}

/** Default column width. Counts are short; money needs room for `1 234 567,89`. */
function widthFor(fn: RollupFn): number {
  return fn === 'count' ? 90 : 140;
}

export interface BuildRollupColumnDefsOptions {
  /** Locale for number formatting. Same formatter as group subtotals. */
  locale?: string;
}

/**
 * Build read-only `ColumnDef`s for a perspective's rollup columns.
 *
 * Presentation is fixed rather than configurable, and every part of it is
 * load-bearing:
 *
 * - `type: 'numeric'` — grouping's `AggregationRule` refuses to total a column
 *   that is not numeric, and `getSortDirectionLabels` would otherwise offer
 *   "A → Z" for a column of amounts.
 * - `align: 'right'` + `mono` — a column of numbers is read by scanning the
 *   decimal point; the house rule for every amount column in this product.
 * - `readOnly` + `disableFill` — a rollup is computed from OTHER rows. There is
 *   nothing on this row to write it back to, so every write path refuses it
 *   rather than silently discarding the edit.
 * - `formatAggregate` — **the same formatter the group-subtotal and
 *   footer-total rows use**, so a rollup cell and a `SUM` subtotal of that same
 *   column can never disagree about decimals. It also coerces the STRINGS raw
 *   SQL returns (`COUNT` → `"7"`, `SUM numeric` → `"18400.0000"`); the old
 *   `Number.isFinite(value) ? value : 0` path rendered every one of those as
 *   `0,00`.
 * - a genuinely absent value renders `—` rather than `0`, which keeps "no
 *   children" (the server sends `0`) visually distinct from "this rollup did
 *   not resolve" (key absent).
 *
 * `exportValue` returns the raw number so a spreadsheet gets `18400`, not the
 * locale-formatted `18 400,00`.
 */
export function buildRollupColumnDefs(
  refs: readonly RollupColumnRef[],
  options: BuildRollupColumnDefsOptions = {},
): ColumnDef[] {
  return refs.map((ref) => {
    const col: ColumnDef = {
      data: rollupColumnDataKey(ref),
      title: ref.label,
      headerTooltip: ref.label,
      width: widthFor(ref.fn),
      type: 'numeric',
      align: 'right',
      mono: true,
      readOnly: true,
      disableFill: true,
      exportValue: (value: unknown) => (value == null ? '' : (value as string | number)),
    };
    col.renderer = (value: unknown) => formatAggregate(value, col, options.locale, ref.fn);
    return col;
  });
}
