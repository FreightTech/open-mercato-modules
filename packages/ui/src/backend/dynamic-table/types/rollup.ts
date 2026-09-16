// types/rollup.ts
//
// Rollup ("summarised") columns — the ONE-TO-MANY sibling of a linked (lookup)
// column.
//
//   LookupColumnRef:  the FK lives on the HOST row      (many-to-one)
//                     "this folder's contractor's tax id"
//
//   RollupColumnRef:  the FK lives on the CHILD row     (one-to-many)
//                     "the SUM of this folder's cost lines"
//
// Everything here is a plain type: `packages/ui` never learns what a
// `folder_line` is. The contract with a host module is one opaque string key
// on the row — `rollup__<source>__<field>__<fn>` — exactly as it is for lookups.
//
// EXPORT SITE. These names are declared here and re-exported by `types/index`
// (which the package barrel `export *`s). `utils/rollupColumns.ts` imports them
// type-only and does NOT re-export: two `export *` sources for one name make ES
// drop it silently, which is how `FormulaColumnRef` was nearly lost.

/**
 * Aggregate applied to the linked child records. Deliberately NOT the same type
 * as grouping's `AggregationFn`: that one aggregates rows *within a group on
 * this page*, this one aggregates *records in another table*. Coupling them
 * would let one union widen and silently offer functions the server-side
 * resolver cannot emit.
 */
export type RollupFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

export const ROLLUP_FNS: readonly RollupFn[] = ['count', 'sum', 'avg', 'min', 'max'] as const;

export function isRollupFn(value: unknown): value is RollupFn {
  return typeof value === 'string' && (ROLLUP_FNS as readonly string[]).includes(value);
}

/**
 * The child column `count` aggregates. `COUNT(child.id)` is exactly "number of
 * linked records" because id is NOT NULL, and it keeps a `'*'` sentinel out of
 * column keys, perspective JSON, URL params and test selectors.
 *
 * MUST match `ROLLUP_COUNT_FIELD` on the server side of whichever module
 * answers the list route — it is half of the wire key.
 */
export const ROLLUP_COUNT_FIELD = 'id';

/**
 * A read-only column summarising the records that point AT this row.
 * View-scoped: it lives in the perspective (persisted through the
 * `filters._rollups` passthrough), never in a database table.
 */
export interface RollupColumnRef {
  /** Registered rollup source key (a one-to-many relationship), e.g. `'lines'`. */
  source: string;
  /** Child column aggregated; {@link ROLLUP_COUNT_FIELD} when `fn` is `'count'`. */
  field: string;
  fn: RollupFn;
  /** Column header, captured when the column is added (`Source · Fn of Field`). */
  label: string;
}

/** A child field a rollup source will let you aggregate. */
export interface RollupSourceFieldOption {
  /** Child column, e.g. `'estimated_cost'`. */
  key: string;
  /** Already translated by the host loader. */
  label: string;
  type: 'numeric' | 'integer' | 'date';
  /** Which aggregates make sense here. `count` is never listed — it is always
   *  available and needs no field. */
  fns: Array<Exclude<RollupFn, 'count'>>;
}

/**
 * A one-to-many relationship a table can summarise. Supplied by the host
 * (which knows its `tableId`) via {@link LoadRollupSources}, so `packages/ui`
 * never imports the host's rollup registry.
 */
export interface RollupSourceOption {
  key: string;
  /** Translated relationship label, e.g. `'Cost lines'`. */
  label: string;
  /** Noun for the count column, e.g. `'Lines'`. Count is always offered. */
  countLabel: string;
  /** Aggregatable child fields. Empty = a count-only source, which is legitimate. */
  fields: RollupSourceFieldOption[];
  /** Host-declared: can the list route ORDER BY this rollup? */
  sortable?: boolean;
  /** Host-declared: can the list route FILTER on this rollup? */
  filterable?: boolean;
  /** False when the host row grain repeats the same total, so a subtotal would
   *  double-count. Carried through for the grouping/footer surfaces. */
  aggregatable?: boolean;
}

/**
 * Loads the rollup sources available for this table. When provided, the
 * Configure View drawer shows a "Summarised columns" section. Called lazily
 * when that section is opened.
 *
 * Symmetric with `LoadLookupSources` on purpose — a host wires the two the same
 * way.
 */
export type LoadRollupSources = () => Promise<RollupSourceOption[]>;

/**
 * Hard cap on rollup columns in one view. Each distinct SOURCE costs one
 * `GROUP BY` on every request of every user of that view, so this is a cost
 * ceiling, not a taste judgement. Matches the server-side `MAX_ROLLUPS`; going
 * above it would have requests silently truncated instead of refused.
 */
export const MAX_ROLLUP_COLUMNS = 20;
