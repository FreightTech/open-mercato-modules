import React, { memo } from 'react';
import type { VirtualItem } from '@tanstack/react-virtual';
import { Sigma } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { useCellStore } from '../hooks/index';
import type { ColumnDef } from '../types/index';
import type { AggregationRule, GroupSummaryVisualRow } from '../types/grouping';
import { formatAggregate } from '../utils/formatAggregate';
import type { ColumnWindow } from '../utils/columnWindow';
import { columnSpacerKey, columnSpacerStyle } from '../utils/columnSpacerStyle';

interface GroupSummaryRowProps {
  visualRow: GroupSummaryVisualRow;
  virtualItem: VirtualItem;
  columns: ColumnDef[];
  rowHeaders: boolean;
  leftOffsets: (number | undefined)[];
  rightOffsets: (number | undefined)[];
  actionsColumnWidth: number;
  showActionsColumn?: boolean;
  totalWidth: number;
  aggregations: AggregationRule[];
  label: string;
  locale?: string;
  /** Bumps when column widths change so the memo re-renders. */
  storeRevision: number;
  /**
   * Mounted column window — the SAME instance the data rows consume, so a
   * subtotal stays under its column while scrolled. Omit for the unvirtualized
   * render.
   */
  columnWindow?: ColumnWindow;
}

const GroupSummaryRow: React.FC<GroupSummaryRowProps> = memo(({
  visualRow,
  virtualItem,
  columns,
  rowHeaders,
  leftOffsets,
  rightOffsets,
  actionsColumnWidth,
  showActionsColumn = true,
  totalWidth,
  aggregations,
  label,
  locale,
  storeRevision: _storeRevision,
  columnWindow,
}) => {
  const store = useCellStore();
  const t = useT();
  const aggregatedFields = new Set(aggregations.map((a) => a.field));
  // A subtotal folded from ONE server page, presented as if it were the group's
  // total, is the defect this note exists to end. Shipping the widened
  // functions without it would simply re-create it in six new flavours.
  const scopeNote =
    visualRow.scope === 'page'
      ? t('dynamicTable.aggregation.groupScopeNote', '(this page only)')
      : null;

  // One cell renderer, two callers — `colIndex` is always the ABSOLUTE
  // index into `columns`.
  const renderSummaryCell = (colIndex: number) => {
    const col = columns[colIndex];
    if (!col) return null;

    const width = store.getColumnWidth(colIndex);
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
    const showValue = aggregatedFields.has(col.data);
    return (
      <td
        key={col.data}
        aria-colindex={colIndex + 1 + (rowHeaders ? 1 : 0)}
        className={`hot-cell hot-group-summary-cell${col.align ? ` cell-align-${col.align}` : ''}${col.mono ? ' cell-mono' : ''}`}
        style={style}
        data-group-summary-cell={col.data}
        data-sticky-left={stickyLeft !== undefined}
        data-sticky-right={stickyRight !== undefined}
      >
        {showValue ? (
          <span className="cell-content hot-group-summary-value">
            {/* No `?? 0`: a null MIN must read as an em dash, not 0,00.
                The fn is REQUIRED — without it a `count` of 3 renders 3,00.
                The breakdown, when the rule carried a `dimension`, REPLACES the
                scalar — see `formatAggregate`. */}
            {formatAggregate(
              visualRow.values[col.data],
              col,
              locale,
              visualRow.fns[col.data] ?? 'sum',
              visualRow.breakdowns?.[col.data],
            )}
          </span>
        ) : null}
      </td>
    );
  };

  return (
    <tr
      data-group-summary
      data-group-key={visualRow.groupKey}
      data-group-scope={visualRow.scope}
      data-group-rows-covered={visualRow.rowsCovered}
      className="hot-group-summary-row"
      style={{
        display: 'flex',
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${totalWidth}px`,
        height: `${virtualItem.size}px`,
        transform: `translateY(${virtualItem.start}px)`,
      }}
    >
      {rowHeaders && (
        <td
          className="hot-row-header hot-group-summary-rowheader"
          style={{ width: 50, flexBasis: 50, flexShrink: 0, flexGrow: 0, position: 'sticky', left: 0, zIndex: 3 }}
        />
      )}
      {/* Zero-width "Σ Suma" label — overflows to the right over the (blank) lead
         columns and scrolls with the row (not sticky). `relative` + z-index keeps
         it painted above the following cells so v2's white fill can't cover it. */}
      <td
        className="hot-group-summary-label-cell"
        style={{ position: 'relative', zIndex: 2 }}
      >
        <div className="hot-group-summary-label" style={{ paddingLeft: `${12 + visualRow.depth * 20}px` }}>
          <Sigma className="hot-group-summary-sigma" />
          <span>{label}</span>
          {scopeNote ? (
            <span className="hot-group-summary-scope text-body-regular-xs" data-group-scope-label>
              {scopeNote}
            </span>
          ) : null}
        </div>
      </td>
      {columnWindow?.virtualized
        ? columnWindow.segments.map((seg) =>
            seg.type === 'spacer' ? (
              <td
                key={columnSpacerKey(seg.fromIndex, seg.toIndex)}
                className="hot-cell-spacer"
                aria-hidden="true"
                style={columnSpacerStyle(seg.width)}
              />
            ) : (
              renderSummaryCell(seg.column.index)
            ))
        : columns.map((_, colIndex) => renderSummaryCell(colIndex))}

      {showActionsColumn && (
        <td
          className="hot-cell hot-actions-cell hot-group-summary-actions"
          style={{ width: actionsColumnWidth, flexBasis: actionsColumnWidth, flexShrink: 0, flexGrow: 0, position: 'sticky', right: 0, zIndex: 2 }}
        />
      )}
    </tr>
  );
});

GroupSummaryRow.displayName = 'GroupSummaryRow';

export default GroupSummaryRow;
