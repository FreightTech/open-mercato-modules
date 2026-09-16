import React, { useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import SelectMenu from './SelectMenu';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { ColumnDef } from '../types/index';
import { SortRule, generateSortRuleId, getSortDirectionLabels } from '../types/perspective';

interface ConfigureViewSortingProps {
  columns: ColumnDef[];
  sortRules: SortRule[];
  onSortRulesChange: (rules: SortRule[]) => void;
}

const ConfigureViewSorting: React.FC<ConfigureViewSortingProps> = ({
  columns,
  sortRules,
  onSortRulesChange,
}) => {
  const t = useT();
  const addSortRule = useCallback(() => {
    const usedFields = sortRules.map(r => r.field);
    const availableColumn = columns.find(c => !usedFields.includes(c.data));
    const newRule: SortRule = {
      id: generateSortRuleId(),
      field: availableColumn?.data || columns[0]?.data || '',
      direction: 'asc',
    };
    onSortRulesChange([...sortRules, newRule]);
  }, [columns, sortRules, onSortRulesChange]);

  const removeSortRule = useCallback((id: string) => {
    onSortRulesChange(sortRules.filter(rule => rule.id !== id));
  }, [sortRules, onSortRulesChange]);

  const updateSortRule = useCallback((id: string, updates: Partial<SortRule>) => {
    onSortRulesChange(sortRules.map(rule =>
      rule.id === id ? { ...rule, ...updates } : rule
    ));
  }, [sortRules, onSortRulesChange]);

  const clearAll = useCallback(() => {
    onSortRulesChange([]);
  }, [onSortRulesChange]);

  const getAvailableColumns = (currentRuleId: string) => {
    const usedFields = sortRules
      .filter(r => r.id !== currentRuleId)
      .map(r => r.field);
    return columns.filter(c => !usedFields.includes(c.data));
  };

  return (
    <div className="hot-config-sorting">
      {sortRules.length === 0 ? null : (
        <>
          <div className="hot-config-sorting-header">
            <span className="hot-config-sorting-header-label">{t('dynamicTable.configureView.sortBy', 'Sort by')}</span>
            <button onClick={clearAll} className="hot-config-clear-btn">
              {t('dynamicTable.configureView.clearAll', 'Clear all')}
            </button>
          </div>
          {sortRules.map((rule, index) => {
            const availableColumns = getAvailableColumns(rule.id);
            const currentColumn = columns.find(c => c.data === rule.field);

            return (
              <div key={rule.id} className="hot-config-sort-row">
                <span className="hot-config-sort-index">{index + 1}</span>
                <SelectMenu
                  value={rule.field}
                  onChange={(next) => updateSortRule(rule.id, { field: next })}
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
                      onChange={(next) => updateSortRule(rule.id, { direction: next as 'asc' | 'desc' })}
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
                  onClick={() => removeSortRule(rule.id)}
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
        onClick={addSortRule}
        disabled={sortRules.length >= columns.length}
        className="hot-config-add-btn"
      >
        <Plus className="w-3.5 h-3.5" aria-hidden />
        {t('dynamicTable.configureView.addSort', 'Add sort')}
      </button>
    </div>
  );
};

export default ConfigureViewSorting;
