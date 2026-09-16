import * as React from 'react';
import type { ColumnDef } from '../types/index';
import type { AggregationFn, AggregateBreakdownEntry } from '../types/grouping';

/** Rendered when a function had nothing to work with (MIN over no numbers, …). */
export const AGGREGATE_EMPTY_PLACEHOLDER = '—';

/** Label for a breakdown slice whose dimension cell was empty. */
export const AGGREGATE_UNLABELLED_DIMENSION = '(none)';

/**
 * Coerce a raw aggregate value to a finite number, or `null` when there is
 * genuinely no value.
 *
 * **This is the boundary that used to be wrong.** `formatAggregate` was typed
 * `value: number` and did `Number.isFinite(value) ? value : 0` — but server
 * aggregates arrive over JSON as *strings*: Postgres returns `COUNT` as `int8`
 * (`"7"`) and `SUM` over `numeric` as `"18400.0000"`. Both are non-finite as
 * far as `Number.isFinite` is concerned, so every server-side total rendered
 * as `0,00`. Coerce here, once, and everything downstream sees a number.
 */
export function coerceAggregateValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  return 0;
}

/** Counts are whole things; money and averages carry two decimals. */
function fractionDigitsFor(fn: AggregationFn): { min: number; max: number } {
  if (fn === 'count' || fn === 'countDistinct') return { min: 0, max: 0 };
  return { min: 2, max: 2 };
}

/** The bare number, with no dimension label. Shared by both paths. */
function formatAggregateNumber(num: number, locale: string | undefined, fn: AggregationFn): string {
  const digits = fractionDigitsFor(fn);
  return new Intl.NumberFormat(locale || 'pl-PL', {
    minimumFractionDigits: digits.min,
    maximumFractionDigits: digits.max,
  }).format(num);
}

/**
 * Render a dimensioned aggregate as ONE LABELLED LINE PER SLICE.
 *
 * Slices are sorted by descending magnitude so the figure that dominates the
 * total reads first, with empty-dimension rows last.
 *
 * Every line carries its dimension key. That is the whole point: a summary line
 * without one is the defect (HEDGE-147). A single-slice breakdown therefore
 * still prints its label — `6 150,00 PLN`, not `6 150,00` — because "there
 * happens to be one currency in this group right now" is not something the
 * reader can tell from an unlabelled number.
 */
export function formatAggregateBreakdown(
  entries: AggregateBreakdownEntry[],
  column: ColumnDef,
  locale?: string,
  fn: AggregationFn = 'sum',
): React.ReactNode {
  const rendered = entries
    .map((entry) => {
      const num = coerceAggregateValue(entry.value);
      return {
        key: entry.key,
        label: entry.key || AGGREGATE_UNLABELLED_DIMENSION,
        text: num === null ? AGGREGATE_EMPTY_PLACEHOLDER : formatAggregateNumber(num, locale, fn),
        magnitude: num === null ? -Infinity : Math.abs(num),
      };
    })
    .sort((a, b) => b.magnitude - a.magnitude);

  return React.createElement(
    'span',
    {
      className: 'hot-aggregate-breakdown',
      // The stacked lines can outgrow a 140px money column; the flat string is
      // always available on hover and to assistive tech.
      title: rendered.map((r) => `${r.text} ${r.label}`).join(' · '),
      'data-aggregate-breakdown': String(rendered.length),
    },
    rendered.map((r) =>
      React.createElement(
        'span',
        { key: r.key, className: 'hot-aggregate-breakdown-line' },
        React.createElement('span', { className: 'hot-aggregate-breakdown-value' }, r.text),
        ' ',
        React.createElement('span', { className: 'hot-aggregate-breakdown-key' }, r.label),
      ),
    ),
  );
}

/**
 * Format an aggregated value for a group-summary or footer-totals row.
 *
 * Uses a dedicated locale number formatter so the summary reads as its own
 * special row rather than mimicking the per-row cell renderer (which often
 * carries currency badges / row-specific chrome). A column may override this
 * with `summaryRenderer` when it needs bespoke formatting.
 *
 * `fn` governs presentation: a `count` renders as an integer, and `min`/`max`
 * on a date column render as a date (the value is epoch milliseconds).
 */
export function formatAggregate(
  value: unknown,
  column: ColumnDef,
  locale?: string,
  fn: AggregationFn = 'sum',
  breakdown?: AggregateBreakdownEntry[] | null,
): React.ReactNode {
  // A dimensioned rule wins over everything below, INCLUDING the scalar and the
  // column's own `summaryRenderer`. For such a rule the scalar is precisely the
  // number that must not be shown: `SUM(grossAmount)` across PLN + EUR + USD is
  // arithmetic on incommensurable quantities, and it renders as a plausible
  // month-end figure (HEDGE-147). One labelled line per slice instead.
  if (breakdown && breakdown.length > 0) {
    return formatAggregateBreakdown(breakdown, column, locale, fn);
  }

  const num = coerceAggregateValue(value);
  if (column.summaryRenderer) return column.summaryRenderer(num ?? 0, column);
  if (num === null) return AGGREGATE_EMPTY_PLACEHOLDER;

  // MIN/MAX over a date column are epoch milliseconds — show them as dates,
  // not as a 13-digit number.
  if (column.type === 'date' && (fn === 'min' || fn === 'max')) {
    const d = new Date(num);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString(locale || 'pl-PL');
  }

  return formatAggregateNumber(num, locale, fn);
}
