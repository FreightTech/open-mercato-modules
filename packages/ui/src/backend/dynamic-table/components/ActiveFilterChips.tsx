import React from 'react';
import { X } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { getOperatorsForType, needsValueInput, type FilterOperator } from '../types/filters';
import type { ColumnDef, FilterRow } from '../types/index';

/**
 * The live quick filters, named — one chip each, in the toolbar row that is
 * already there.
 *
 * WHY IT EXISTS: before this, "Clear all filters (3)" was the ONLY toolbar
 * evidence that the grid was narrowed, and it says how MANY rules are running,
 * never which. Answering "why am I not seeing that shipment?" meant opening the
 * Configure View drawer. The chips answer it in place, and each one removes its
 * own rule without touching the others — which "Clear all" cannot do.
 *
 * WHY IT ADDS NO ROW: the strip renders INSIDE `.hot-toolbar-actions`,
 * immediately before the clear-all button, and scrolls horizontally when the
 * rules outgrow it (`.hot-filter-chips` in `styles/SearchBar.css`). The grid's
 * height math is a density budget — a second row of chrome would spend rows per
 * screen, which is the thing these tables exist to maximise.
 *
 * ONE CHIP FORM. Every filter that reaches here is ad-hoc and TEMPORARY: quick
 * filters are never written to the saved view (A2/D6), so there is no
 * "saved filter" chip to distinguish. A second variant would be a state the
 * product cannot produce.
 */

export type ActiveFilterChipsProps = {
  /** The grid's live filter rows — the same array `Clear all` empties. */
  filters: FilterRow[];
  /**
   * Columns used only to name a field. Pass the BASE column set, not the
   * visible one: a filter on a column the user has since hidden is exactly the
   * filter that most needs naming.
   */
  columns: ColumnDef[];
  /** Remove one rule, by `FilterRow.id`. */
  onRemove: (filterId: string) => void;
};

/**
 * Operator → English fallback, flattened once from the same source the filter
 * editors read, so a chip can never disagree with the popover that wrote the
 * rule about what an operator is called.
 */
const OPERATOR_FALLBACKS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const type of ['text', 'numeric', 'boolean', 'date'] as const) {
    for (const op of getOperatorsForType(type)) out[op.value] = op.label;
  }
  return out;
})();

type Translate = ReturnType<typeof useT>;

/** What the chip says after the field name. Never longer than the chip. */
function ruleSummary(t: Translate, rule: FilterRow): string {
  const operatorLabel = t(
    `dynamicTable.filter.operator.${rule.operator}`,
    OPERATOR_FALLBACKS[rule.operator] ?? rule.operator,
  );
  // Value-less operators ("is empty", "overdue") ARE the summary.
  if (!needsValueInput(rule.operator as FilterOperator)) return operatorLabel;
  const values = (rule.values ?? []).map((v) => String(v ?? '')).filter(Boolean);
  // A rule the user opened but never filled still narrows nothing — say so
  // rather than showing an empty chip that looks like a rendering bug.
  if (values.length === 0) return t('dynamicTable.filter.anyValue', 'any');
  return values.join(', ');
}

export const ActiveFilterChips: React.FC<ActiveFilterChipsProps> = ({ filters, columns, onRemove }) => {
  const t = useT();
  if (!filters.length) return null;

  return (
    <div className="hot-filter-chips" role="list" data-filter-chips="">
      {filters.map((rule) => {
        const label = columns.find((c) => c.data === rule.field)?.title ?? rule.field;
        const summary = ruleSummary(t, rule);
        return (
          <span
            key={rule.id}
            className="hot-filter-chip"
            role="listitem"
            data-filter-chip={rule.field}
            title={`${label}: ${summary}`}
          >
            <span className="hot-filter-chip-label">{label}</span>
            <span className="hot-filter-chip-value">{summary}</span>
            {/* The trailing "×" lives INSIDE the chip — an M3 input chip, not a
                chip plus a second bordered button beside it. */}
            <button
              type="button"
              className="hot-filter-chip-remove"
              data-filter-chip-remove={rule.field}
              aria-label={t('dynamicTable.filter.removeFilter', 'Remove filter: {label}', { label })}
              onClick={() => onRemove(rule.id)}
            >
              <X size={11} strokeWidth={2.25} aria-hidden="true" />
            </button>
          </span>
        );
      })}
    </div>
  );
};

export default ActiveFilterChips;
