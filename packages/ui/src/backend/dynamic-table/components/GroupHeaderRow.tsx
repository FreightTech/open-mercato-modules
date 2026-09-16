import React, { memo } from 'react';
import type { VirtualItem } from '@tanstack/react-virtual';
import type { GroupHeaderVisualRow } from '../types/grouping';
import type { ColumnDef } from '../types/index';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface GroupHeaderRowProps {
  visualRow: GroupHeaderVisualRow;
  virtualItem: VirtualItem;
  totalWidth: number;
  columns: ColumnDef[];
  onToggle: (groupKey: string) => void;
  /** v2: show a checkbox that selects/deselects every row in the group. */
  selectable?: boolean;
  /** All rows in the group are selected. */
  selected?: boolean;
  /** Some — but not all — rows in the group are selected. */
  someSelected?: boolean;
  onToggleSelect?: () => void;
  /**
   * Rename a group's heading — the field, the raw value, and what the table
   * would otherwise print.
   *
   * Exists because the ONLY thing the grouping engine can say about a group with
   * no value is its own sentinel, `(Empty)`, which names the table's internals
   * rather than the data. Grouped by case, that pile is "No case" — the
   * documents nobody has filed — and a host that knows the domain should be
   * able to say so. Return `undefined` to keep the default.
   */
  formatGroupValue?: (ctx: { field: string; value: string; count: number }) => string | undefined;
}

const GroupHeaderRow: React.FC<GroupHeaderRowProps> = memo(({
  visualRow,
  virtualItem,
  totalWidth,
  columns,
  onToggle,
  selectable,
  selected,
  someSelected,
  onToggleSelect,
  formatGroupValue,
}) => {
  const fieldLabel = columns.find(c => c.data === visualRow.field)?.title || visualRow.field;

  return (
    <tr
      data-group-header
      data-group-key={visualRow.groupKey}
      className="hot-group-header-row"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        // Match VirtualRow's width logic so the group band lines up with the
        // data rows.
        width: `${totalWidth}px`,
        height: `${virtualItem.size}px`,
        transform: `translateY(${virtualItem.start}px)`,
      }}
    >
      {selectable && (
        <td
          className="hot-row-header hot-group-header-select-cell"
          // Stop clicks here from bubbling to the content cell (collapse toggle).
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            width: 50,
            flexBasis: 50,
            flexShrink: 0,
            flexGrow: 0,
            position: 'sticky',
            left: 0,
            zIndex: 3,
          }}
        >
          <input
            type="checkbox"
            className="hot-row-select hot-row-select-all"
            checked={!!selected}
            ref={(el) => { if (el) el.indeterminate = !selected && !!someSelected; }}
            onChange={() => onToggleSelect?.()}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Select all rows in group"
          />
        </td>
      )}
      {/* Zero-width sticky cell that pins the group label to the left edge so it
         stays visible while the table scrolls horizontally. It contributes ~0 to
         the row width (the label overflows to the right over the band fill), so
         the band still lines up with the data rows. Offset by the 50px select
         cell (itself sticky at left:0) when present so it doesn't slide under it. */}
      <td
        className="hot-group-header-label-cell"
        style={{ position: 'sticky', left: selectable ? 50 : 0, zIndex: 2 }}
        onClick={() => onToggle(visualRow.groupKey)}
      >
        <div
          className="hot-group-header-content"
          style={{ paddingLeft: `${(selectable ? 0 : 12) + visualRow.depth * 20}px` }}
        >
          {visualRow.collapsed ? (
            <ChevronRight className="hot-group-header-chevron" />
          ) : (
            <ChevronDown className="hot-group-header-chevron" />
          )}
          <span className="hot-group-header-field">{fieldLabel}</span>
          <span className="hot-group-header-value">
            {formatGroupValue?.({
              field: visualRow.field,
              value: visualRow.value,
              count: visualRow.count,
            }) ?? visualRow.value}
          </span>
          <span className="hot-group-header-count">{visualRow.count}</span>
        </div>
      </td>
      {/* Band fill — spans the remaining table width so the group band stays flush
         with the data rows even when scrolled. `totalWidth` budgets 50px for the
         row-header column (CSS clamps it to 32px), so subtract that allotment
         when the select cell is present. */}
      <td
        className="hot-group-header-cell"
        style={{ width: `${totalWidth - (selectable ? 50 : 0)}px` }}
        onClick={() => onToggle(visualRow.groupKey)}
      />
    </tr>
  );
});

GroupHeaderRow.displayName = 'GroupHeaderRow';

export default GroupHeaderRow;
