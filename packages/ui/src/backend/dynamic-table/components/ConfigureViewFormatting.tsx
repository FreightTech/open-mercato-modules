import React, { useCallback, useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import type { ColumnDef, LoadFilterSuggestions } from '../types/index';
import SelectMenu from './SelectMenu';
import FilterValueInput from './FilterValueInput';
import { FilterDatePicker } from './FilterDatePicker';
import { useFieldSuggestionLoader } from '../hooks/useSuggestionFetch';
import { getColumnOptions } from '../utils/columnOptions';
import { readCellValue } from '../utils/cellPath';
import {
  CONDITIONAL_FORMAT_STYLES,
  MAX_CONDITIONAL_FORMAT_RULES,
  generateConditionalFormatRuleId,
  operatorNeedsCompareField,
  operatorNeedsValue,
  type ConditionalFormatOperator,
  type ConditionalFormatRule,
  type ConditionalFormatStyle,
} from '../utils/conditionalFormat';

export interface ConfigureViewFormattingProps {
  columns: ColumnDef[];
  rules: ConditionalFormatRule[];
  onRulesChange: (rules: ConditionalFormatRule[]) => void;
  /**
   * The same loader the filter editor uses. With it, a text column's value box
   * suggests the column's values instead of being typed blind.
   */
  loadFilterSuggestions?: LoadFilterSuggestions;
  /**
   * The rows the grid has loaded. A rule paints these rows, so their values are
   * offered whenever the server has no suggestions for the column (GT,
   * 2026-10-08: a value seen in the table, like "Basic", could not be picked).
   */
  loadedRows?: Record<string, unknown>[];
}

/** At most this many distinct loaded values are offered per column. */
const MAX_LOADED_VALUES = 200;

/**
 * The distinct values a column SHOWS in the loaded rows — `exportValue` text
 * when the column has one (a relation shows a name, not its id), the raw value
 * otherwise. Rule matching compares against both, so either kind paints.
 */
function loadedValuesFor(col: ColumnDef | undefined, rows: Record<string, unknown>[] | undefined): string[] {
  if (!col || !rows?.length) return [];
  const seen = new Set<string>();
  for (const row of rows) {
    const raw = readCellValue(row, col.data);
    let shown: unknown = raw;
    if (col.exportValue) {
      try {
        shown = col.exportValue(raw, row);
      } catch {
        shown = raw;
      }
    }
    if (shown === null || shown === undefined || typeof shown === 'object') continue;
    const text = String(shown).trim();
    if (text) seen.add(text);
    if (seen.size >= MAX_LOADED_VALUES) break;
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

/** Operators worth offering for a column of this type. */
function operatorsForColumn(col?: ColumnDef): ConditionalFormatOperator[] {
  if (col?.type === 'numeric') {
    return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty'];
  }
  if (col?.type === 'date') {
    return ['lt', 'gt', 'isEmpty', 'isNotEmpty', 'beforeField', 'afterField'];
  }
  if (col?.type === 'boolean') return ['eq', 'neq', 'isEmpty', 'isNotEmpty'];
  return ['eq', 'neq', 'contains', 'isEmpty', 'isNotEmpty'];
}

/**
 * "Highlighting" — the user-facing editor for view-scoped conditional
 * formatting. Deliberately built as a clone of the filter-rule editor's row
 * layout (`hot-config-filter-*`): the drawer already teaches this interaction,
 * so this is composition, not new UX.
 */
const ConfigureViewFormatting: React.FC<ConfigureViewFormattingProps> = ({
  columns,
  rules,
  onRulesChange,
  loadFilterSuggestions,
  loadedRows,
}) => {
  const t = useT();
  // Stable per-field loader — see ConfigureViewFilters for why it must be cached.
  const getLoader = useFieldSuggestionLoader(loadFilterSuggestions);
  // Loaded values per field, for the fields the rules use.
  const loadedValues = useMemo(() => {
    const byField = new Map<string, string[]>();
    for (const rule of rules) {
      if (byField.has(rule.field)) continue;
      byField.set(rule.field, loadedValuesFor(columns.find((c) => c.data === rule.field), loadedRows));
    }
    return byField;
  }, [rules, columns, loadedRows]);

  const opLabel = useCallback(
    (op: ConditionalFormatOperator) => t(`dynamicTable.conditionalFormat.operator.${op}`, op),
    [t],
  );
  const styleLabel = useCallback(
    (style: ConditionalFormatStyle) => t(`dynamicTable.conditionalFormat.style.${style}`, style),
    [t],
  );

  const addRule = useCallback(() => {
    if (rules.length >= MAX_CONDITIONAL_FORMAT_RULES) return;
    const first = columns[0];
    if (!first) return;
    onRulesChange([
      ...rules,
      {
        id: generateConditionalFormatRuleId(),
        field: first.data,
        operator: operatorsForColumn(first)[0] ?? 'eq',
        value: '',
        style: 'yellow',
      },
    ]);
  }, [columns, rules, onRulesChange]);

  const removeRule = useCallback(
    (id: string) => onRulesChange(rules.filter((r) => r.id !== id)),
    [rules, onRulesChange],
  );

  const updateRule = useCallback(
    (id: string, updates: Partial<ConditionalFormatRule>) =>
      onRulesChange(
        rules.map((r) => {
          if (r.id !== id) return r;
          const next: ConditionalFormatRule = { ...r, ...updates };
          if (updates.field && updates.field !== r.field) {
            // An operator that doesn't apply to the new column type would
            // compile to nothing and silently stop painting — snap it instead.
            const col = columns.find((c) => c.data === updates.field);
            const allowed = operatorsForColumn(col);
            if (!allowed.includes(next.operator)) next.operator = allowed[0] ?? 'eq';
            // The old value belongs to the old column (an option of another
            // list, a date in a text column) — start the new one empty.
            if (operatorNeedsValue(next.operator)) next.value = '';
          }
          if (updates.operator) {
            if (!operatorNeedsValue(next.operator)) next.value = undefined;
            if (!operatorNeedsCompareField(next.operator)) next.compareField = undefined;
            else if (!next.compareField) {
              next.compareField = columns.find((c) => c.data !== next.field)?.data;
            }
          }
          return next;
        }),
      ),
    [columns, rules, onRulesChange],
  );

  /**
   * The value box — the same pickers the filter editor offers for the same
   * column, so a value seen in the filter can be picked here too:
   *  - an option column (`source`) → its options (label shown, raw value kept);
   *  - a yes/no column → Yes / No;
   *  - a date → the filter's date picker;
   *  - a number → a number box;
   *  - text → a box that suggests the column's values via the filter loader —
   *    or, when the server has none, the values in the loaded rows — and still
   *    accepts free text (`contains` on part of a word is legitimate).
   */
  const renderValueInput = (
    rule: ConditionalFormatRule,
    col: ColumnDef | undefined,
    setValue: (value: string) => void,
  ) => {
    const current = rule.value === null || rule.value === undefined ? '' : String(rule.value);
    const valueLabel = t('dynamicTable.conditionalFormat.valuePlaceholder', 'Value');
    const options = getColumnOptions(col);
    if (options) {
      return (
        <SelectMenu
          value={current}
          onChange={setValue}
          options={options}
          placeholder={t('dynamicTable.filter.selectValue', 'Select…')}
          className="hot-config-filter-select"
          ariaLabel={valueLabel}
          dataAttributes={{ 'data-cf-value': true }}
        />
      );
    }
    if (col?.type === 'boolean') {
      return (
        <SelectMenu
          value={current}
          onChange={setValue}
          options={[
            { value: 'true', label: t('dynamicTable.conditionalFormat.true', 'Yes') },
            { value: 'false', label: t('dynamicTable.conditionalFormat.false', 'No') },
          ]}
          placeholder={t('dynamicTable.filter.selectValue', 'Select…')}
          className="hot-config-filter-select"
          ariaLabel={valueLabel}
          dataAttributes={{ 'data-cf-value': true }}
        />
      );
    }
    if (col?.type === 'date') {
      return (
        <span data-cf-value className="hot-config-cf-value">
          <FilterDatePicker
            value={current}
            onChange={setValue}
            ariaLabel={valueLabel}
            placeholder={t('dynamicTable.filter.pickDate', 'Pick date')}
          />
        </span>
      );
    }
    if (col?.type === 'numeric') {
      return (
        <input
          type="number"
          value={current}
          onChange={(e) => setValue(e.target.value)}
          className="hot-config-filter-input"
          data-cf-value
          aria-label={valueLabel}
          placeholder={valueLabel}
        />
      );
    }
    return (
      <span data-cf-value className="hot-config-cf-value">
        <FilterValueInput
          key={`${rule.id}:${rule.field}`}
          filterId={rule.id}
          initialValue={current}
          isMultiValue={false}
          onValueChange={(_id, value) => setValue(value)}
          onValueAdd={(_id, value) => setValue(value)}
          loadSuggestions={getLoader(rule.field)}
          staticSuggestions={loadedValues.get(rule.field)}
          placeholder={valueLabel}
          ariaLabel={valueLabel}
        />
      </span>
    );
  };

  return (
    <div className="hot-config-filters" data-conditional-format-editor>
      {rules.length > 0 && (
        <div className="hot-config-sorting-header">
          <span className="hot-config-sorting-header-label">
            {t('dynamicTable.conditionalFormat.title', 'Highlighting')}
          </span>
          <button onClick={() => onRulesChange([])} className="hot-config-clear-btn">
            {t('dynamicTable.configureView.clearAll', 'Clear all')}
          </button>
        </div>
      )}

      {rules.map((rule) => {
        const col = columns.find((c) => c.data === rule.field);
        const operators = operatorsForColumn(col);
        return (
          <div key={rule.id} className="hot-config-filter-row" data-cf-rule={rule.id}>
            <SelectMenu
              value={rule.field}
              onChange={(next) => updateRule(rule.id, { field: next })}
              options={columns.map((c) => ({ value: c.data, label: c.title || c.data }))}
              className="hot-config-filter-select"
              ariaLabel={t('dynamicTable.filter.field', 'Field')}
              dataAttributes={{ 'data-cf-field': true }}
            />

            <SelectMenu
              value={rule.operator}
              onChange={(next) =>
                updateRule(rule.id, { operator: next as ConditionalFormatOperator })
              }
              options={operators.map((op) => ({ value: op, label: opLabel(op) }))}
              className="hot-config-filter-select hot-config-filter-operator"
              ariaLabel={t('dynamicTable.filter.operator', 'Condition')}
              dataAttributes={{ 'data-cf-operator': true }}
            />

            {operatorNeedsValue(rule.operator) &&
              renderValueInput(rule, col, (value) => updateRule(rule.id, { value }))}

            {operatorNeedsCompareField(rule.operator) && (
              <SelectMenu
                value={rule.compareField ?? ''}
                onChange={(next) => updateRule(rule.id, { compareField: next })}
                options={columns
                  .filter((c) => c.data !== rule.field)
                  .map((c) => ({ value: c.data, label: c.title || c.data }))}
                emptyOptionLabel={t('dynamicTable.conditionalFormat.compareToField', 'Compare to another column')}
                placeholder={t('dynamicTable.conditionalFormat.compareToField', 'Compare to another column')}
                className="hot-config-filter-select"
                ariaLabel={t('dynamicTable.conditionalFormat.compareToField', 'Compare to another column')}
                dataAttributes={{ 'data-cf-compare-field': true }}
              />
            )}

            <SelectMenu
              value={rule.style}
              onChange={(next) => updateRule(rule.id, { style: next as ConditionalFormatStyle })}
              options={CONDITIONAL_FORMAT_STYLES.map((st) => ({ value: st, label: styleLabel(st) }))}
              className="hot-config-filter-select hot-config-cf-style"
              ariaLabel={t('dynamicTable.conditionalFormat.style', 'Colour')}
              dataAttributes={{ 'data-cf-style': true }}
            />

            <button onClick={() => removeRule(rule.id)} className="hot-config-filter-remove">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}

      <button
        onClick={addRule}
        disabled={columns.length === 0 || rules.length >= MAX_CONDITIONAL_FORMAT_RULES}
        className="hot-config-add-btn"
        data-cf-add
      >
        <Plus className="w-3.5 h-3.5" aria-hidden />
        {t('dynamicTable.conditionalFormat.addRule', 'Add rule')}
      </button>

      {rules.length >= MAX_CONDITIONAL_FORMAT_RULES && (
        <p className="hot-config-filters-label">
          {t('dynamicTable.conditionalFormat.limitReached', 'Rule limit reached ({max})', {
            max: MAX_CONDITIONAL_FORMAT_RULES,
          })}
        </p>
      )}
    </div>
  );
};

export default ConfigureViewFormatting;
