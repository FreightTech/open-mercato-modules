// types/grouping.ts

import type { ColumnDataType } from './perspective';

export interface GroupRule {
  id: string;
  field: string;
  direction: 'asc' | 'desc';
}

/**
 * Aggregation function applied to a column within each group (and, once the
 * footer is wired, over the filtered dataset).
 *
 * Semantics deliberately mirror SQL / Excel so the client-side fold and the
 * server-side `GROUP BY`-less aggregate agree on the same numbers:
 *
 * - `sum`            — `SUM(col)`; non-numeric cells are ignored, empty set → 0
 * - `avg`            — `AVG(col)`; non-numeric ignored, empty set → null
 * - `min` / `max`    — `MIN(col)` / `MAX(col)`; empty set → null. Date columns
 *                      compare chronologically and yield epoch milliseconds.
 * - `count`          — `COUNT(col)`: non-empty cells (NOT the row count)
 * - `countDistinct`  — `COUNT(DISTINCT col)`
 */
export type AggregationFn = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'countDistinct';

/**
 * THE single source of truth for the supported functions.
 *
 * There used to be three independent `['sum']` literals — this type, the
 * `perspectiveTransforms` whitelist (which SILENTLY DROPPED any rule it did not
 * recognise, so a saved view could lose its rules on reload) and the Configure
 * View picker. They must widen in lockstep, so they now all read this constant.
 */
export const AGGREGATION_FNS: readonly AggregationFn[] = [
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'countDistinct',
] as const;

export function isAggregationFn(value: unknown): value is AggregationFn {
  return typeof value === 'string' && (AGGREGATION_FNS as readonly string[]).includes(value);
}

/**
 * Which functions make sense for a column of this type.
 *
 * `count` / `countDistinct` are valid on *every* column (Excel's COUNTA works
 * on text); `sum` / `avg` need numbers; `min` / `max` additionally work on
 * dates, which is how "earliest / latest" is expressed.
 */
export function aggregationFnsForColumnType(type?: ColumnDataType): AggregationFn[] {
  if (type === 'numeric') return ['sum', 'avg', 'min', 'max', 'count', 'countDistinct'];
  if (type === 'date') return ['min', 'max', 'count', 'countDistinct'];
  return ['count', 'countDistinct'];
}

/** The first function that is valid for a column type — used when a rule's column changes. */
export function defaultAggregationFnForColumnType(type?: ColumnDataType): AggregationFn {
  return aggregationFnsForColumnType(type)[0] ?? 'count';
}

export interface AggregationRule {
  /** Stable id — one rule per column, so `agg-<field>`. */
  id: string;
  /** Column `data` key. */
  field: string;
  fn: AggregationFn;
  /**
   * OPTIONAL partition column (`data` key). When set, the aggregate is not one
   * number but ONE NUMBER PER DISTINCT VALUE of this column, and the UI renders
   * the breakdown instead of a single figure.
   *
   * This exists because a scalar `sum` over a column whose rows are not
   * commensurable is not merely imprecise — it is FALSE, and it looks fine.
   * `SUM(grossAmount)` over 6 150 PLN + 1 000 EUR + 8 600 USD rendered
   * `15 750,00`, unlabelled, as the only summary figure on the screen an
   * accountant closes the month from (HEDGE-147).
   *
   * The honest fix is a per-dimension breakdown rather than a conversion to a
   * base currency: a breakdown needs no exchange rate, so unlike a converted
   * total it CANNOT be wrong. (A converted total would additionally have to
   * show rate + date + source to be readable at all — HEDGE-39/43/81 — and
   * would have to source a rate that most rows simply do not carry.)
   *
   * Omitted on every pre-existing rule, so behaviour is unchanged wherever it
   * is not set.
   */
  dimension?: string;
}

/**
 * One slice of a dimensioned aggregate: the partition value and its figure.
 *
 * `key` is the raw cell value of the dimension column, stringified (`'PLN'`),
 * or `''` when the row had none — the renderer decides how to label that.
 */
export interface AggregateBreakdownEntry {
  key: string;
  value: number | null;
}

/**
 * What set of rows an aggregate actually describes.
 *
 * This is not decoration. Client-side grouping folds over ONE server page
 * (`pageSize <= 100`), so a subtotal presented as "the group total" is wrong
 * whenever the dataset spans more than one page. Every aggregate therefore
 * carries its scope and the UI is required to render it.
 */
export type AggregateScope = 'dataset' | 'page';

/**
 * Transport shape for a server-computed aggregate (`?aggregate=` response).
 * Not persisted.
 */
export interface AggregateResult {
  /** MANDATORY. An unlabelled number is the defect this exists to prevent. */
  scope: AggregateScope;
  /** Row count in scope. */
  total: number;
  /** `${field}:${fn}` -> value. `null` means "no value in scope" (e.g. MIN of nothing). */
  values: Record<string, number | null>;
  /**
   * `${field}:${fn}` -> per-dimension slices, present only for rules that
   * carry a `dimension`. Optional, so a route that has not adopted it (and
   * every already-published response) stays valid.
   */
  breakdowns?: Record<string, AggregateBreakdownEntry[]>;
}

export interface GroupHeaderVisualRow {
  type: 'groupHeader';
  groupKey: string;
  field: string;
  value: string;
  count: number;
  depth: number;
  collapsed: boolean;
  /** Data indices of every row in this group (incl. nested descendants),
   * regardless of collapse state — drives the group select-all checkbox. */
  memberDataIndices: number[];
}

export interface DataVisualRow {
  type: 'dataRow';
  dataIndex: number;
}

/** Subtotal row rendered after a group's rows (one per group level). */
export interface GroupSummaryVisualRow {
  type: 'groupSummary';
  /** Ties the summary to its group header. */
  groupKey: string;
  /** Nesting depth — parity with the group header for left-indent. */
  depth: number;
  /** field -> aggregated value. Only aggregated fields are present.
   *  `null` = the function had nothing to work with (e.g. MIN over no numbers). */
  values: Record<string, number | null>;
  /** field -> the function that produced `values[field]`, so the renderer can
   *  format a count as an integer and a date MIN as a date. */
  fns: Record<string, AggregationFn>;
  /** field -> per-dimension slices, for the fields whose rule set a
   *  `dimension`. When present the renderer shows these INSTEAD of
   *  `values[field]`, because for those fields the scalar is not meaningful. */
  breakdowns?: Record<string, AggregateBreakdownEntry[]>;
  /**
   * What these numbers actually cover. `'page'` whenever the loaded rows are
   * only part of the filtered dataset (or when coverage is unknown) — the UI
   * MUST say so rather than presenting a page fold as a group total.
   */
  scope: AggregateScope;
  /** How many rows on the loaded page fed this subtotal. */
  rowsCovered: number;
}

export type VisualRow = GroupHeaderVisualRow | DataVisualRow | GroupSummaryVisualRow;

export function generateGroupRuleId(): string {
  return `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/** One aggregation rule per column, so a field-derived id keeps it unique. */
export function generateAggregationRuleId(field: string): string {
  return `agg-${field}`;
}
