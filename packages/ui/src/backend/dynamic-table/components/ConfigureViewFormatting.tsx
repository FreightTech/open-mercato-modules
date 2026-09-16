import React, { useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import type { ColumnDef } from '../types/index';
import SelectMenu from './SelectMenu';
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
}) => {
  const t = useT();

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
          if (updates.field) {
            // An operator that doesn't apply to the new column type would
            // compile to nothing and silently stop painting — snap it instead.
            const col = columns.find((c) => c.data === updates.field);
            const allowed = operatorsForColumn(col);
            if (!allowed.includes(next.operator)) next.operator = allowed[0] ?? 'eq';
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

            {operatorNeedsValue(rule.operator) && (
              <input
                type={col?.type === 'numeric' ? 'number' : col?.type === 'date' ? 'date' : 'text'}
                value={rule.value === null || rule.value === undefined ? '' : String(rule.value)}
                onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                className="hot-config-filter-input"
                data-cf-value
                placeholder={t('dynamicTable.conditionalFormat.valuePlaceholder', 'Value')}
              />
            )}

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
