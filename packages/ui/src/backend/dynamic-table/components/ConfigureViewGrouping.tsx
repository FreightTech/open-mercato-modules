import React, { useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import SelectMenu from './SelectMenu';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { ColumnDef } from '../types/index';
import {
  GroupRule,
  generateGroupRuleId,
  AggregationRule,
  AggregationFn,
  generateAggregationRuleId,
  aggregationFnsForColumnType,
  defaultAggregationFnForColumnType,
} from '../types/grouping';
import { getSortDirectionLabels } from '../types/perspective';

interface ConfigureViewGroupingProps {
  columns: ColumnDef[];
  groupRules: GroupRule[];
  onGroupRulesChange: (rules: GroupRule[]) => void;
  aggregations?: AggregationRule[];
  onAggregationsChange?: (rules: AggregationRule[]) => void;
}

const ConfigureViewGrouping: React.FC<ConfigureViewGroupingProps> = ({
  columns,
  groupRules,
  onGroupRulesChange,
  aggregations = [],
  onAggregationsChange,
}) => {
  const t = useT();

  // --- Aggregations ---
  // Every column can be aggregated now: `count` / `countDistinct` work on text
  // (Excel's COUNTA), `min` / `max` on dates read as earliest / latest, and
  // `sum` / `avg` stay numeric-only. The function dropdown is filtered by the
  // selected column's type, so an impossible pair can't be produced.
  const aggregatableColumns = columns;
  const columnByField = React.useMemo(() => {
    const map = new Map<string, ColumnDef>();
    for (const c of columns) map.set(c.data, c);
    return map;
  }, [columns]);
  const aggFnLabel = useCallback(
    (fn: AggregationFn) => t(`dynamicTable.aggregation.fn.${fn}`, fn),
    [t],
  );
  const addAggregation = useCallback(() => {
    const used = aggregations.map((a) => a.field);
    const available = aggregatableColumns.find((c) => !used.includes(c.data));
    if (!available) return;
    onAggregationsChange?.([
      ...aggregations,
      {
        id: generateAggregationRuleId(available.data),
        field: available.data,
        fn: defaultAggregationFnForColumnType(available.type),
      },
    ]);
  }, [aggregations, aggregatableColumns, onAggregationsChange]);

  const removeAggregation = useCallback(
    (id: string) => onAggregationsChange?.(aggregations.filter((a) => a.id !== id)),
    [aggregations, onAggregationsChange],
  );

  const updateAggregation = useCallback(
    (id: string, updates: Partial<AggregationRule>) =>
      onAggregationsChange?.(
        aggregations.map((a) => {
          if (a.id !== id) return a;
          const next = { ...a, ...updates };
          // Keep the id derived from the field so rules stay unique per column.
          if (updates.field) {
            next.id = generateAggregationRuleId(updates.field);
            // A SUM carried onto a text column would be meaningless (and would
            // be dropped server-side), so snap the function to one the new
            // column actually supports.
            const nextType = columnByField.get(updates.field)?.type;
            if (!aggregationFnsForColumnType(nextType).includes(next.fn)) {
              next.fn = defaultAggregationFnForColumnType(nextType);
            }
          }
          return next;
        }),
      ),
    [aggregations, columnByField, onAggregationsChange],
  );

  const availableAggColumns = useCallback(
    (currentField: string) => {
      const used = aggregations.filter((a) => a.field !== currentField).map((a) => a.field);
      return aggregatableColumns.filter((c) => !used.includes(c.data));
    },
    [aggregations, aggregatableColumns],
  );
  const addGroupRule = useCallback(() => {
    const usedFields = groupRules.map(r => r.field);
    const availableColumn = columns.find(c => !usedFields.includes(c.data));
    const newRule: GroupRule = {
      id: generateGroupRuleId(),
      field: availableColumn?.data || columns[0]?.data || '',
      direction: 'asc',
    };
    onGroupRulesChange([...groupRules, newRule]);
  }, [columns, groupRules, onGroupRulesChange]);

  const removeGroupRule = useCallback((id: string) => {
    onGroupRulesChange(groupRules.filter(rule => rule.id !== id));
  }, [groupRules, onGroupRulesChange]);

  const updateGroupRule = useCallback((id: string, updates: Partial<GroupRule>) => {
    onGroupRulesChange(groupRules.map(rule =>
      rule.id === id ? { ...rule, ...updates } : rule
    ));
  }, [groupRules, onGroupRulesChange]);

  const clearAll = useCallback(() => {
    onGroupRulesChange([]);
  }, [onGroupRulesChange]);

  const getAvailableColumns = (currentRuleId: string) => {
    const usedFields = groupRules
      .filter(r => r.id !== currentRuleId)
      .map(r => r.field);
    return columns.filter(c => !usedFields.includes(c.data));
  };

  return (
    <div className="hot-config-sorting">
      {groupRules.length === 0 ? null : (
        <>
          <div className="hot-config-sorting-header">
            <span className="hot-config-sorting-header-label">{t('dynamicTable.configureView.groupBy', 'Group by')}</span>
            <button onClick={clearAll} className="hot-config-clear-btn">
              {t('dynamicTable.configureView.clearAll', 'Clear all')}
            </button>
          </div>
          {groupRules.map((rule, index) => {
            const availableColumns = getAvailableColumns(rule.id);
            const currentColumn = columns.find(c => c.data === rule.field);

            return (
              <div key={rule.id} className="hot-config-sort-row">
                <span className="hot-config-sort-index">{index + 1}</span>
                <SelectMenu
                  value={rule.field}
                  onChange={(next) => updateGroupRule(rule.id, { field: next })}
                  options={[
                    ...(currentColumn
                      ? [{ value: currentColumn.data, label: currentColumn.title || currentColumn.data }]
                      : []),
                    ...availableColumns
                      .filter((c) => c.data !== rule.field)
                      .map((col) => ({ value: col.data, label: col.title || col.data })),
                  ]}
                  className="hot-config-sort-select"
                  ariaLabel={t('dynamicTable.filter.field', 'Field')}
                />
                {(() => {
                  const labels = getSortDirectionLabels(currentColumn?.type);
                  return (
                    <SelectMenu
                      value={rule.direction}
                      onChange={(next) => updateGroupRule(rule.id, { direction: next as 'asc' | 'desc' })}
                      options={[
                        { value: 'asc', label: labels.asc },
                        { value: 'desc', label: labels.desc },
                      ]}
                      className="hot-config-sort-direction-select"
                      ariaLabel={t('dynamicTable.configureView.direction', 'Direction')}
                    />
                  );
                })()}
                <button
                  onClick={() => removeGroupRule(rule.id)}
                  className="hot-config-sort-remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </>
      )}
      <button
        onClick={addGroupRule}
        disabled={groupRules.length >= columns.length}
        className="hot-config-add-btn"
      >
        <Plus className="w-3.5 h-3.5" aria-hidden />
        {t('dynamicTable.configureView.addGroup', 'Add group')}
      </button>

      {/* Per-group aggregations. Only meaningful with a group rule (summary rows
          render under each group), so gate on that. Ungating this for an
          ungrouped footer total (TC-APP-420) is a deferred product decision —
          do not remove the `groupRules.length > 0` condition without it. */}
      {onAggregationsChange && groupRules.length > 0 && aggregatableColumns.length > 0 && (
        <div className="hot-config-aggregations">
          {aggregations.length > 0 && (
            <div className="hot-config-sorting-header">
              <span className="hot-config-sorting-header-label">
                {t('dynamicTable.configureView.sumBy', 'Sum by')}
              </span>
              <button onClick={() => onAggregationsChange([])} className="hot-config-clear-btn">
                {t('dynamicTable.configureView.clearAll', 'Clear all')}
              </button>
            </div>
          )}
          {aggregations.map((rule, index) => {
            const cols = availableAggColumns(rule.field);
            const currentColumn = columnByField.get(rule.field);
            const fnOptions = aggregationFnsForColumnType(currentColumn?.type);
            return (
              <div key={rule.id} className="hot-config-sort-row">
                <span className="hot-config-sort-index">{index + 1}</span>
                <SelectMenu
                  value={rule.field}
                  onChange={(next) => updateAggregation(rule.id, { field: next })}
                  options={[
                    ...(currentColumn
                      ? [{ value: currentColumn.data, label: currentColumn.title || currentColumn.data }]
                      : []),
                    ...cols
                      .filter((c) => c.data !== rule.field)
                      .map((col) => ({ value: col.data, label: col.title || col.data })),
                  ]}
                  className="hot-config-sort-select"
                  ariaLabel={t('dynamicTable.filter.field', 'Field')}
                />
                <SelectMenu
                  value={rule.fn}
                  onChange={(next) => updateAggregation(rule.id, { fn: next as AggregationFn })}
                  options={fnOptions.map((fn) => ({ value: fn, label: aggFnLabel(fn) }))}
                  className="hot-config-sort-direction-select"
                  ariaLabel={t('dynamicTable.configureView.aggregationFn', 'Function')}
                  dataAttributes={{ 'data-agg-fn-select': rule.field }}
                />
                <button
                  onClick={() => removeAggregation(rule.id)}
                  className="hot-config-sort-remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
          <button
            onClick={addAggregation}
            disabled={aggregations.length >= aggregatableColumns.length}
            className="hot-config-add-btn"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden />
            {t('dynamicTable.configureView.addSum', 'Add sum')}
          </button>
        </div>
      )}
    </div>
  );
};

export default ConfigureViewGrouping;
