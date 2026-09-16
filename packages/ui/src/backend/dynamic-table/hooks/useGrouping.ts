import { useState, useMemo, useCallback } from 'react';
import type { ColumnDef } from '../types/index';
import type {
  GroupRule,
  AggregationRule,
  AggregationFn,
  AggregateBreakdownEntry,
  AggregateScope,
  VisualRow,
} from '../types/grouping';

export interface UseGroupingOptions {
  /**
   * Total number of rows in the FILTERED DATASET, as reported by the server.
   *
   * Grouping folds over `data`, which is one server page (`pageSize <= 100`).
   * Without this the hook cannot know whether the page it holds is the whole
   * dataset, so every subtotal is labelled `'page'` — the conservative, honest
   * answer. Pass the list's `total` and a single-page result is correctly
   * labelled `'dataset'`.
   */
  totalRows?: number;
}

export interface UseGroupingResult {
  visualRows: VisualRow[] | null;
  collapsedGroups: Set<string>;
  toggleGroup: (groupKey: string) => void;
  toggleAllGroups: (collapsed: boolean) => void;
  dataIndexToVisualIndex: (dataIndex: number) => number;
  /**
   * The key of the group a data row belongs to, or `null` when grouping is off.
   *
   * Exists because `dataIndexToVisualIndex` returns the raw `dataIndex` when the
   * row is not visible — a sensible fallback for scrolling, and silently WRONG
   * for a row hidden inside a collapsed group. A caller that wants to reveal a
   * row (the in-grid finder does) calls `toggleGroup(groupKeyOfDataIndex(i))`
   * first, so matches inside collapsed groups are found, counted, and expanded
   * on navigation rather than scrolled to the wrong place.
   */
  groupKeyOfDataIndex: (dataIndex: number) => string | null;
  /**
   * What every subtotal emitted by this hook covers. `'page'` unless the caller
   * proved via `totalRows` that the loaded page is the entire filtered dataset.
   * The UI must render this; an unlabelled subtotal is the defect.
   */
  aggregateScope: AggregateScope;
}

/** Parse a cell value to a number, or `null` when it isn't one. */
function parseNumeric(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Parse a cell value to epoch milliseconds, or `null`. */
function parseDateValue(v: unknown): number | null {
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Non-empty for COUNT / COUNT(DISTINCT) purposes — mirrors SQL NULL semantics. */
function isPresent(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

/**
 * Apply one aggregation function over a group's member rows.
 *
 * Semantics track SQL (and Excel) so the client fold and the server aggregate
 * cannot disagree: text is ignored by the numeric functions rather than
 * counted as zero, and an empty input yields `null` for everything except
 * `sum` (0) and the counts (0).
 */
function applyAggregation(
  data: any[],
  indices: number[],
  field: string,
  fn: AggregationFn,
  column?: ColumnDef,
): number | null {
  if (fn === 'count') {
    let n = 0;
    for (const idx of indices) if (isPresent(data[idx]?.[field])) n += 1;
    return n;
  }

  if (fn === 'countDistinct') {
    const seen = new Set<string>();
    for (const idx of indices) {
      const v = data[idx]?.[field];
      if (isPresent(v)) seen.add(String(v));
    }
    return seen.size;
  }

  // MIN/MAX on a date column compare chronologically and return epoch ms.
  const asDate = column?.type === 'date' && (fn === 'min' || fn === 'max');
  const parse = asDate ? parseDateValue : parseNumeric;

  const nums: number[] = [];
  for (const idx of indices) {
    const n = parse(data[idx]?.[field]);
    if (n !== null) nums.push(n);
  }

  switch (fn) {
    case 'sum': {
      // Empty set sums to 0 — an empty column reads as "nothing", not "unknown".
      let acc = 0;
      for (const n of nums) acc += n;
      return acc;
    }
    case 'avg': {
      if (nums.length === 0) return null;
      let acc = 0;
      for (const n of nums) acc += n;
      return acc / nums.length;
    }
    case 'min':
      return nums.length === 0 ? null : Math.min(...nums);
    case 'max':
      return nums.length === 0 ? null : Math.max(...nums);
    default:
      return null;
  }
}

/**
 * Partition `indices` by the value of `dimension`, then aggregate each slice
 * with the SAME `applyAggregation` the scalar path uses.
 *
 * Slices come back in first-seen row order rather than sorted, so the breakdown
 * reads in the order the grid already presents.
 */
function applyAggregationByDimension(
  data: any[],
  indices: number[],
  field: string,
  fn: AggregationFn,
  dimension: string,
  column?: ColumnDef,
): AggregateBreakdownEntry[] {
  const buckets = new Map<string, number[]>();
  for (const idx of indices) {
    const raw = data[idx]?.[dimension];
    const key = raw === null || raw === undefined ? '' : String(raw);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(idx);
    else buckets.set(key, [idx]);
  }
  const out: AggregateBreakdownEntry[] = [];
  for (const [key, memberIndices] of buckets) {
    out.push({ key, value: applyAggregation(data, memberIndices, field, fn, column) });
  }
  return out;
}

/**
 * Fold the configured aggregations over a set of row indices.
 *
 * EXPORTED because the footer-totals row needs the identical fold for its
 * page-scoped fallback (shown until the server's dataset figure lands). Two
 * folds would disagree the first time one of them was widened — which is
 * exactly the bug `AGGREGATION_FNS` was introduced to end one level up.
 *
 * A rule carrying a `dimension` additionally yields a per-dimension breakdown.
 * The scalar is still computed and returned for that field so that nothing
 * downstream sees a hole, but the renderers prefer the breakdown — for a
 * dimensioned rule the scalar is the very number that is not safe to show
 * (HEDGE-147).
 */
export function computeAggregates(
  data: any[],
  indices: number[],
  aggregations: AggregationRule[],
  columnsByField: Map<string, ColumnDef>,
): {
  values: Record<string, number | null>;
  fns: Record<string, AggregationFn>;
  breakdowns: Record<string, AggregateBreakdownEntry[]>;
} {
  const values: Record<string, number | null> = {};
  const fns: Record<string, AggregationFn> = {};
  const breakdowns: Record<string, AggregateBreakdownEntry[]> = {};
  for (const rule of aggregations) {
    const column = columnsByField.get(rule.field);
    values[rule.field] = applyAggregation(data, indices, rule.field, rule.fn, column);
    fns[rule.field] = rule.fn;
    if (rule.dimension) {
      breakdowns[rule.field] = applyAggregationByDimension(
        data,
        indices,
        rule.field,
        rule.fn,
        rule.dimension,
        column,
      );
    }
  }
  return { values, fns, breakdowns };
}

/**
 * The label a group of rows with NO value gets.
 *
 * Exported because a renderer that wants to say something domain-specific about
 * the empty group ("No case", "Unassigned") has to be able to RECOGNISE it, and
 * a hard-coded string compared against a hard-coded string in another package is
 * the kind of coupling that breaks silently the day one of them is translated.
 */
export const EMPTY_GROUP_VALUE = '(Empty)';

function getGroupValue(row: any, field: string): string {
  const value = row[field];
  if (value === null || value === undefined || value === '') {
    return EMPTY_GROUP_VALUE;
  }
  return String(value);
}

function buildGroupKey(depth: number, field: string, value: string, parentKey: string): string {
  return parentKey ? `${parentKey}|${field}:${value}` : `${field}:${value}`;
}

export function useGrouping(
  data: any[],
  groupRules: GroupRule[],
  columns: ColumnDef[],
  aggregations: AggregationRule[] = [],
  options: UseGroupingOptions = {},
): UseGroupingResult {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const { totalRows } = options;

  // The loaded page is the whole dataset only when the server told us how many
  // rows match and that number is already in `data`. Unknown coverage is
  // reported as `'page'`: understating what a number covers is safe, and
  // overstating it is exactly the bug this replaces.
  const aggregateScope: AggregateScope =
    typeof totalRows === 'number' && Number.isFinite(totalRows) && totalRows <= data.length
      ? 'dataset'
      : 'page';

  const columnsByField = useMemo(() => {
    const map = new Map<string, ColumnDef>();
    for (const col of columns) map.set(col.data, col);
    return map;
  }, [columns]);

  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const toggleAllGroups = useCallback((collapsed: boolean) => {
    if (!collapsed) {
      setCollapsedGroups(new Set());
    } else {
      // Collapse all — we'll compute the keys in the visualRows memo
      setCollapsedGroups(prev => {
        const allKeys = new Set(prev);
        // Mark a sentinel so the memo knows to collect all group keys
        allKeys.add('__collapse_all__');
        return allKeys;
      });
    }
  }, []);

  const visualRows = useMemo(() => {
    if (groupRules.length === 0) return null;

    const result: VisualRow[] = [];
    const allGroupKeys: string[] = [];

    // Build groups recursively
    function buildGroups(
      indices: number[],
      rules: GroupRule[],
      depth: number,
      parentKey: string,
    ) {
      if (rules.length === 0) {
        // Leaf level — emit data rows
        for (const idx of indices) {
          result.push({ type: 'dataRow', dataIndex: idx });
        }
        return;
      }

      const [currentRule, ...remainingRules] = rules;
      const field = currentRule.field;

      // Group by field value
      const groups = new Map<string, number[]>();
      for (const idx of indices) {
        const value = getGroupValue(data[idx], field);
        if (!groups.has(value)) {
          groups.set(value, []);
        }
        groups.get(value)!.push(idx);
      }

      // Sort group keys
      const sortedKeys = [...groups.keys()].sort((a, b) => {
        // "(Empty)" always last
        if (a === EMPTY_GROUP_VALUE) return 1;
        if (b === EMPTY_GROUP_VALUE) return -1;
        const cmp = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        return currentRule.direction === 'desc' ? -cmp : cmp;
      });

      for (const value of sortedKeys) {
        const groupIndices = groups.get(value)!;
        const groupKey = buildGroupKey(depth, field, value, parentKey);
        allGroupKeys.push(groupKey);

        const isCollapsed = collapsedGroups.has(groupKey);

        result.push({
          type: 'groupHeader',
          groupKey,
          field,
          value,
          count: groupIndices.length,
          depth,
          collapsed: isCollapsed,
          memberDataIndices: groupIndices,
        });

        if (!isCollapsed) {
          // Subtotal row at every level — sits directly under the group header,
          // above the group's rows / nested groups.
          if (aggregations.length > 0) {
            const { values, fns, breakdowns } = computeAggregates(
              data,
              groupIndices,
              aggregations,
              columnsByField,
            );
            result.push({
              type: 'groupSummary',
              groupKey,
              depth,
              values,
              fns,
              breakdowns,
              scope: aggregateScope,
              rowsCovered: groupIndices.length,
            });
          }

          buildGroups(groupIndices, remainingRules, depth + 1, groupKey);
        }
      }
    }

    // Create array of all data indices
    const allIndices = Array.from({ length: data.length }, (_, i) => i);
    buildGroups(allIndices, groupRules, 0, '');

    // Handle "collapse all" sentinel
    if (collapsedGroups.has('__collapse_all__')) {
      setCollapsedGroups(new Set(allGroupKeys));
    }

    return result;
  }, [data, groupRules, collapsedGroups, aggregations, columnsByField, aggregateScope]);

  const dataIndexToVisualIndex = useCallback((dataIndex: number): number => {
    if (!visualRows) return dataIndex;
    for (let i = 0; i < visualRows.length; i++) {
      const vr = visualRows[i];
      if (vr.type === 'dataRow' && vr.dataIndex === dataIndex) {
        return i;
      }
    }
    return dataIndex;
  }, [visualRows]);

  // Built from `memberDataIndices`, which every group header already carries —
  // the lookup is derived, never a second source of truth about membership.
  const groupKeyByDataIndex = useMemo(() => {
    if (!visualRows) return null;
    const map = new Map<number, string>();
    for (const vr of visualRows) {
      if (vr.type !== 'groupHeader') continue;
      for (const dataIndex of vr.memberDataIndices) map.set(dataIndex, vr.groupKey);
    }
    return map;
  }, [visualRows]);

  const groupKeyOfDataIndex = useCallback(
    (dataIndex: number): string | null => groupKeyByDataIndex?.get(dataIndex) ?? null,
    [groupKeyByDataIndex],
  );

  return {
    visualRows,
    collapsedGroups,
    toggleGroup,
    toggleAllGroups,
    dataIndexToVisualIndex,
    groupKeyOfDataIndex,
    aggregateScope,
  };
}
