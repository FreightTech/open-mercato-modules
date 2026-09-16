import React, { memo } from 'react';
import { Sigma } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import type { ColumnDef } from '../types/index';
import type {
  AggregationRule,
  AggregateResult,
  AggregateBreakdownEntry,
  AggregateScope,
} from '../types/grouping';
import { formatAggregate, AGGREGATE_EMPTY_PLACEHOLDER } from '../utils/formatAggregate';
import type { ColumnWindow } from '../utils/columnWindow';
import { columnSpacerKey, columnSpacerStyle } from '../utils/columnSpacerStyle';

export interface FooterTotalsRowProps {
  columns: ColumnDef[];
  /** The view's aggregation rules — one per column, same list the group summaries use. */
  aggregations: AggregationRule[];
  /**
   * Server-computed aggregate over the filtered dataset. `null` while it is in
   * flight (or when the host has not wired `?aggregate=` yet), in which case
   * `pageValues` is shown labelled as page-scoped.
   */
  result?: AggregateResult | null;
  /**
   * Fallback values folded from the loaded page, keyed by column `data`. Shown
   * immediately so the footer is never blank; replaced the moment the dataset
   * figure lands.
   */
  pageValues?: Record<string, number | null>;
  /**
   * Page-scoped per-dimension slices, keyed by column `data` — the breakdown
   * counterpart of `pageValues`, used until the dataset breakdown lands.
   */
  pageBreakdowns?: Record<string, AggregateBreakdownEntry[]>;
  /** Rows on the loaded page — the honest denominator for a page-scoped total. */
  pageRowCount?: number;
  loading?: boolean;
  /** Set when the aggregate request failed; the footer says so rather than showing 0. */
  error?: boolean;
  /** Column width lookup by index (DynamicTable passes the cell store's getter). */
  getColumnWidth: (colIndex: number) => number;
  rowHeaders?: boolean;
  leftOffsets?: (number | undefined)[];
  rightOffsets?: (number | undefined)[];
  actionsColumnWidth?: number;
  showActionsColumn?: boolean;
  totalWidth?: number;
  locale?: string;
  /**
   * Mounted column window — the SAME instance the body rows consume, so the
   * totals line up column-for-column while scrolled. Omit for the
   * unvirtualized render.
   */
  columnWindow?: ColumnWindow;
}

/**
 * Pinned totals row.
 *
 * MUST be rendered OUTSIDE the virtualiser (it is sticky to the bottom of the
 * scroll container, like the header is to the top), which is why it takes
 * widths and sticky offsets as props rather than deriving them from a virtual
 * item.
 *
 * The scope label is not decoration and must not be dropped: a number that
 * covers one page of <= 100 rows, presented as if it covered the whole
 * filtered dataset, is the exact defect this component was built to end.
 */
const FooterTotalsRow: React.FC<FooterTotalsRowProps> = memo(({
  columns,
  aggregations,
  result,
  pageValues,
  pageBreakdowns,
  pageRowCount,
  loading = false,
  error = false,
  getColumnWidth,
  rowHeaders = false,
  leftOffsets = [],
  rightOffsets = [],
  actionsColumnWidth = 0,
  showActionsColumn = true,
  totalWidth,
  locale,
  columnWindow,
}) => {
  const t = useT();

  const scope: AggregateScope = result ? result.scope : 'page';
  const countInScope = result ? result.total : (pageRowCount ?? 0);
  const fnByField = new Map(aggregations.map((a) => [a.field, a.fn] as const));
  const dimensionedFields = new Set(aggregations.filter((a) => a.dimension).map((a) => a.field));

  // ── How much room the "Σ Total · scope" label actually has ──────────────
  //
  // Ledger 3.3. The label was a ZERO-WIDTH cell that overflowed rightwards over
  // "the leading (blank) columns" — but nothing checked that they were blank.
  // On a view whose FIRST column carries an aggregate the label painted straight
  // on top of that column's value: `.hot-footer-totals-label-cell` at width 0,
  // x=295, and `.hot-footer-totals-cell` at x=295 width=132, both drawing text
  // in the same 132px. The reader saw "19 TOTAL THIS PAGE ONLY (19 ROWS)" — a
  // number and its own caption stacked on each other.
  //
  // The lead is now MEASURED: sum the widths of the leading columns that render
  // nothing, and clamp the label to it. `overflow: hidden` + `text-overflow:
  // ellipsis` (in CSS) means the label can shorten but can never reach the first
  // value. The full string stays in `title`, so nothing is lost when it does.
  let labelMaxWidth = 0;
  for (let i = 0; i < columns.length; i += 1) {
    if (fnByField.has(columns[i].data)) break;
    labelMaxWidth += getColumnWidth(i);
  }
  // Every column is aggregated (or there are none): there is no lead to borrow,
  // so the label moves under its own rules — see `hasLabelLane` below.
  const hasLabelLane = labelMaxWidth > 0;

  const scopeLabel = error
    ? t('dynamicTable.aggregation.failed', 'Could not calculate totals')
    : loading && !result
      ? t('dynamicTable.aggregation.loading', 'Calculating…')
      : scope === 'dataset'
        ? t('dynamicTable.aggregation.scopeDataset', 'All {count} matching rows', { count: countInScope })
        : t('dynamicTable.aggregation.scopePage', 'This page only ({count} rows)', { count: countInScope });

  const valueFor = (field: string): number | null => {
    const fn = fnByField.get(field);
    if (!fn) return null;
    if (result) return result.values[`${field}:${fn}`] ?? null;
    return pageValues?.[field] ?? null;
  };

  // Read the breakdown from the SAME source the scalar came from. Mixing a
  // dataset-scope scalar with a page-scope breakdown (or the reverse) would put
  // two different row sets on one line under one scope caption.
  const breakdownFor = (field: string): AggregateBreakdownEntry[] | undefined => {
    const fn = fnByField.get(field);
    if (!fn) return undefined;
    if (result) return result.breakdowns?.[`${field}:${fn}`];
    return pageBreakdowns?.[field];
  };

  // One cell renderer, two callers — `colIndex` is always the ABSOLUTE index
  // into `columns`, whether it came from a plain map or a window segment.
  const renderFooterCell = (colIndex: number) => {
    const col = columns[colIndex];
    if (!col) return null;
    const width = getColumnWidth(colIndex);
    const stickyLeft = leftOffsets[colIndex];
    const stickyRight = rightOffsets[colIndex];
    const style: React.CSSProperties = {
      width,
      flexBasis: width,
      minWidth: width,
      flexShrink: 0,
      flexGrow: 0,
      position: 'relative',
    };
    if (stickyLeft !== undefined) {
      style.position = 'sticky';
      style.left = stickyLeft;
      style.zIndex = 2;
    } else if (stickyRight !== undefined) {
      style.position = 'sticky';
      style.right = stickyRight;
      style.zIndex = 2;
    }
    const fn = fnByField.get(col.data);
    const value = fn ? valueFor(col.data) : undefined;
    const breakdown = fn ? breakdownFor(col.data) : undefined;
    // A dimensioned rule whose source produced NO breakdown (a route that
    // ignores the dimension in `?aggregate=`) must not silently fall back to
    // the scalar: that scalar is the cross-currency sum this whole mechanism
    // exists to stop, and it would be captioned "All N matching rows", which
    // makes it look MORE authoritative, not less. Show the empty placeholder —
    // "not available" is recoverable, a false total is not.
    const suppressScalar = !!dimensionedFields.has(col.data) && !(breakdown && breakdown.length);
    return (
      <div
        key={col.data}
        role="cell"
        aria-colindex={colIndex + 1 + (rowHeaders ? 1 : 0)}
        data-footer-cell={col.data}
        className={`hot-cell hot-footer-totals-cell${col.align ? ` cell-align-${col.align}` : ''}${col.mono ? ' cell-mono' : ''}`}
        style={style}
      >
        {fn && !error ? (
          <span className="cell-content hot-footer-totals-value text-body-medium-sm">
            {suppressScalar
              ? AGGREGATE_EMPTY_PLACEHOLDER
              : formatAggregate(value, col, locale, fn, breakdown)}
          </span>
        ) : null}
      </div>
    );
  };

  const totalLabel = t('dynamicTable.aggregation.footerLabel', 'Total');
  const label = (
    <div className="hot-footer-totals-label text-body-medium-sm" title={`${totalLabel} · ${scopeLabel}`}>
      <Sigma className="hot-footer-totals-sigma" style={{ width: 14, height: 14 }} />
      <span data-footer-label>{totalLabel}</span>
      <span data-footer-scope-label className="hot-footer-totals-scope text-body-regular-xs">
        {scopeLabel}
      </span>
    </div>
  );

  const rowWidth = totalWidth === undefined ? undefined : `${totalWidth}px`;

  return (
    <div
      data-footer-totals
      data-footer-scope={scope}
      data-footer-state={error ? 'error' : loading ? 'loading' : 'ready'}
      data-footer-layout={hasLabelLane ? 'inline' : 'stacked'}
      className="hot-footer-totals"
      style={{
        position: 'sticky',
        bottom: 0,
        zIndex: 5,
        width: rowWidth,
        background: 'var(--m3-surface-container)',
        borderTop: '1px solid var(--m3-outline-faint)',
      }}
    >
      {/* NO LEAD TO BORROW: every column from the first one carries a value, so
          there is no blank run for the label to overflow into. It gets its own
          caption line instead of being painted on top of a number. `sticky
          left` keeps it readable while the grid is scrolled horizontally — the
          scope statement is normative and may not scroll away from its own
          counts. */}
      {!hasLabelLane && (
        <div className="hot-footer-totals-caption" style={{ position: 'sticky', left: 0, width: 'fit-content' }}>
          {label}
        </div>
      )}
      <div
        className="hot-footer-totals-row"
        role="row"
        style={{ display: 'flex', width: rowWidth }}
      >
        {rowHeaders && (
          <div
            className="hot-row-header hot-footer-totals-rowheader"
            style={{ width: 50, flexBasis: 50, flexShrink: 0, flexGrow: 0, position: 'sticky', left: 0, zIndex: 3 }}
          />
        )}
        {/* Zero-width label that overflows to the right over the leading blank
            columns, matching the group-summary row's treatment — but CLAMPED to
            the width those columns actually give it (see `labelMaxWidth`), so it
            can never reach the first value. */}
        {hasLabelLane && (
          <div
            className="hot-footer-totals-label-cell"
            style={{ position: 'relative', zIndex: 2, width: 0, maxWidth: 0 }}
          >
            <div className="hot-footer-totals-label-clip" style={{ maxWidth: labelMaxWidth }}>
              {label}
            </div>
          </div>
        )}
        {columnWindow?.virtualized
          ? columnWindow.segments.map((seg) =>
              seg.type === 'spacer' ? (
                <div
                  key={columnSpacerKey(seg.fromIndex, seg.toIndex)}
                  className="hot-cell-spacer"
                  aria-hidden="true"
                  style={columnSpacerStyle(seg.width)}
                />
              ) : (
                renderFooterCell(seg.column.index)
              ))
          : columns.map((_, colIndex) => renderFooterCell(colIndex))}

        {showActionsColumn && (
          <div
            className="hot-cell hot-actions-cell hot-footer-totals-actions"
            style={{ width: actionsColumnWidth, flexBasis: actionsColumnWidth, flexShrink: 0, flexGrow: 0, position: 'sticky', right: 0, zIndex: 2 }}
          />
        )}
      </div>
    </div>
  );
});

FooterTotalsRow.displayName = 'FooterTotalsRow';

export default FooterTotalsRow;
