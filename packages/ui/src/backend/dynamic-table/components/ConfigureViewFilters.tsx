import React, { useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import { useT } from '@open-mercato/shared/lib/i18n/context';
import { ColumnDef, FilterRow, LoadFilterSuggestions } from '../types/index';
import {
  FilterOperator,
  getOperatorsForType,
  needsValueInput,
  needsMultipleValues,
  needsRangeValues,
  needsRelativeInput,
  isDateOperator,
  RELATIVE_DATE_UNITS,
} from '../types/filters';
import { FilterDatePicker } from './FilterDatePicker';
import FilterValueInput from './FilterValueInput';
import SelectMenu from './SelectMenu';
import { useFieldSuggestionLoader } from '../hooks/useSuggestionFetch';

interface ConfigureViewFiltersProps {
  columns: ColumnDef[];
  filters: FilterRow[];
  onFiltersChange: (filters: FilterRow[]) => void;
  loadFilterSuggestions?: LoadFilterSuggestions;
}

// Normalize a column's `source` (dropdown options) to a {value,label} list.
// Options may be plain strings or {value,label}/{id,name} objects. Returns null
// when the column has no option set (free-text/numeric/date columns).
const getColumnOptions = (col?: ColumnDef): { value: string; label: string }[] | null => {
  const src = (col as { source?: unknown })?.source;
  if (!Array.isArray(src) || src.length === 0) return null;
  return src.map((o) =>
    o && typeof o === 'object'
      ? {
          value: String((o as Record<string, unknown>).value ?? (o as Record<string, unknown>).id ?? ''),
          label: String(
            (o as Record<string, unknown>).label ??
              (o as Record<string, unknown>).name ??
              (o as Record<string, unknown>).value ??
              '',
          ),
        }
      : { value: String(o), label: String(o) },
  );
};

// Default operator for a column type. Option-backed columns (dropdown/multiselect)
// default to `is_any_of` so the value picker shows their options.
const defaultOperatorForColumn = (col?: ColumnDef): FilterOperator => {
  if (col?.type === 'date') return 'is_between';
  if (col?.type === 'boolean') return 'is_true';
  if (col?.type === 'numeric') return 'equals';
  if (col?.type === 'dropdown' || col?.type === 'multiselect' || getColumnOptions(col)) return 'is_any_of';
  return 'contains';
};

const ConfigureViewFilters: React.FC<ConfigureViewFiltersProps> = ({
  columns,
  filters,
  onFiltersChange,
  loadFilterSuggestions,
}) => {
  const t = useT();

  // One STABLE per-field loader, cached for as long as the host's
  // `loadFilterSuggestions` identity holds. `useSuggestionFetch` keys its fetch
  // effect on this function, so an inline arrow here would re-fire the request
  // on every render — a fetch loop, not a picker. Shared with the header quick
  // filter so both pickers hit the same cached function per field.
  const getLoader = useFieldSuggestionLoader(loadFilterSuggestions);

  const addFilterRow = useCallback(() => {
    // Pick a default operator matching the first column's type so the new
    // rule lands on a sensible operator (is_any_of for option columns, contains
    // for text, is_between for dates, equals for numbers, is_true for booleans).
    const firstCol = columns[0];
    const defaultOperator: FilterOperator = defaultOperatorForColumn(firstCol);
    const newRow: FilterRow = {
      id: `filter-${Date.now()}`,
      field: firstCol?.data || '',
      operator: defaultOperator,
      values: [],
    };
    onFiltersChange([...filters, newRow]);
  }, [columns, filters, onFiltersChange]);

  const removeFilterRow = useCallback((id: string) => {
    onFiltersChange(filters.filter(row => row.id !== id));
  }, [filters, onFiltersChange]);

  const updateFilterRow = useCallback((id: string, updates: Partial<FilterRow>) => {
    onFiltersChange(filters.map(row =>
      row.id === id ? { ...row, ...updates } : row
    ));
  }, [filters, onFiltersChange]);

  // When the operator changes, also reset values so the input shape matches
  // (single → range, range → single, presence → none).
  const handleOperatorChange = useCallback((id: string, operator: FilterOperator) => {
    updateFilterRow(id, { operator, values: [] });
  }, [updateFilterRow]);

  // When the user switches to a column with a different type, snap the
  // operator to a type-appropriate default so the input doesn't get stuck.
  const handleFieldChange = useCallback((id: string, field: string) => {
    const col = columns.find(c => c.data === field);
    const row = filters.find(r => r.id === id);
    const currentOps = getOperatorsForType(col?.type).map(o => o.value);
    const keepOperator = row && currentOps.includes(row.operator as FilterOperator);
    const fallback: FilterOperator = defaultOperatorForColumn(col);
    updateFilterRow(id, {
      field,
      operator: keepOperator ? row!.operator : fallback,
      values: keepOperator ? row!.values : [],
    });
  }, [columns, filters, updateFilterRow]);

  const handleValueChange = useCallback((id: string, value: string) => {
    updateFilterRow(id, { values: value ? [value] : [] });
  }, [updateFilterRow]);

  // For a 2-input range filter (is_between): set the [from, to] pair.
  const handleRangeValueChange = useCallback((id: string, index: 0 | 1, value: string) => {
    const row = filters.find(r => r.id === id);
    if (!row) return;
    const next = [row.values[0] ?? '', row.values[1] ?? ''] as string[];
    next[index] = value;
    // Drop the rule if both ends are empty so a half-typed filter doesn't
    // wipe the table.
    const allEmpty = next.every(v => !v || String(v).trim() === '');
    updateFilterRow(id, { values: allEmpty ? [] : next });
  }, [filters, updateFilterRow]);

  // For a relative date filter (is_in_next / is_in_last): store the
  // [count, unit] pair. index 0 = count, index 1 = unit. Unit defaults to
  // 'days' so picking a unit before typing a count (or vice versa) is preserved.
  const handleRelativeChange = useCallback((id: string, index: 0 | 1, value: string) => {
    const row = filters.find(r => r.id === id);
    if (!row) return;
    const count = index === 0 ? value : ((row.values[0] as string) ?? '');
    const unit = index === 1 ? value : ((row.values[1] as string) ?? 'days');
    updateFilterRow(id, { values: [count, unit || 'days'] });
  }, [filters, updateFilterRow]);

  const handleValueAdd = useCallback((id: string, value: string) => {
    const row = filters.find(r => r.id === id);
    if (row && value.trim()) {
      updateFilterRow(id, { values: [...row.values, value.trim()] });
    }
  }, [filters, updateFilterRow]);

  const handleValueRemove = useCallback((id: string, valueIndex: number) => {
    const row = filters.find(r => r.id === id);
    if (row) {
      updateFilterRow(id, { values: row.values.filter((_, i) => i !== valueIndex) });
    }
  }, [filters, updateFilterRow]);

  return (
    <div className="hot-config-filters">
      {filters.length > 0 && (
        <>
          <span className="hot-config-filters-label">{t('dynamicTable.filter.where', 'Where')}</span>
          {filters.map((row) => {
            const column = columns.find(c => c.data === row.field);
            const operators = getOperatorsForType(column?.type);
            const showValueInput = needsValueInput(row.operator as FilterOperator);
            const isMultiValue = needsMultipleValues(row.operator as FilterOperator);
            const isRange = needsRangeValues(row.operator as FilterOperator);
            const isDate = column?.type === 'date' && isDateOperator(row.operator as FilterOperator);
            const isRelative = needsRelativeInput(row.operator as FilterOperator);
            // Dropdown/enum columns carry their option set in `source`. When present,
            // render an option picker (labels shown, raw values stored) instead of a
            // free-text box — otherwise users type the badge label and it never
            // matches the raw value stored in the DB.
            const columnOptions = (!isRange && !isDate && !isRelative) ? getColumnOptions(column) : null;

            return (
              <div key={row.id} className="hot-config-filter-row">
                <SelectMenu
                  value={row.field}
                  onChange={(next) => handleFieldChange(row.id, next)}
                  options={columns.map((col) => ({ value: col.data, label: col.title || col.data }))}
                  className="hot-config-filter-select"
                  ariaLabel={t('dynamicTable.filter.field', 'Field')}
                  dataAttributes={{ 'data-filter-field': row.id }}
                />
                <SelectMenu
                  value={row.operator}
                  onChange={(next) => handleOperatorChange(row.id, next as FilterOperator)}
                  options={operators.map((op) => ({
                    value: op.value,
                    label: t(`dynamicTable.filter.operator.${op.value}`, op.label),
                  }))}
                  className="hot-config-filter-select hot-config-filter-operator"
                  ariaLabel={t('dynamicTable.filter.operator', 'Condition')}
                  dataAttributes={{ 'data-filter-operator': row.id }}
                />
                {showValueInput && (
                  <>
                    {columnOptions ? (
                      isMultiValue ? (
                        // Option-backed multi-select (is_any_of / is_not_any_of):
                        // pills render the option label, the dropdown adds the value.
                        <>
                          {row.values.map((value, idx) => (
                            <span key={idx} className="hot-config-filter-pill">
                              {columnOptions.find(o => o.value === String(value))?.label ?? String(value)}
                              <button onClick={() => handleValueRemove(row.id, idx)} className="hot-config-filter-pill-remove">×</button>
                            </span>
                          ))}
                          <SelectMenu
                            className="hot-config-filter-select"
                            value=""
                            placeholder={t('dynamicTable.filter.addValue', 'Add…')}
                            onChange={(next) => { if (next) handleValueAdd(row.id, next); }}
                            options={columnOptions.filter(
                              (o) => !row.values.map(String).includes(o.value),
                            )}
                            ariaLabel={t('dynamicTable.filter.addValue', 'Add…')}
                            dataAttributes={{ 'data-filter-value': row.id }}
                          />
                        </>
                      ) : (
                        // Single-value option select (contains/equals/…): shows the
                        // label, stores the raw value the DB filters on.
                        <SelectMenu
                          className="hot-config-filter-select"
                          value={(row.values[0] as string) || ''}
                          onChange={(next) => handleValueChange(row.id, next)}
                          options={columnOptions}
                          emptyOptionLabel={t('dynamicTable.filter.selectValue', 'Select…')}
                          placeholder={t('dynamicTable.filter.selectValue', 'Select…')}
                          ariaLabel={t('dynamicTable.filter.selectValue', 'Select…')}
                          dataAttributes={{ 'data-filter-value': row.id }}
                        />
                      )
                    ) : (
                    <>
                    {isMultiValue && row.values.map((value, idx) => (
                      <span key={idx} className="hot-config-filter-pill">
                        {String(value)}
                        <button onClick={() => handleValueRemove(row.id, idx)} className="hot-config-filter-pill-remove">×</button>
                      </span>
                    ))}
                    {isRelative ? (
                      // Relative date window: number of units + unit select.
                      // Stored as values = [count, unit]; resolved to a today-anchored
                      // range server-side. Reads as "Ważna do | następne | 7 | dni".
                      <>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          placeholder={t('dynamicTable.filter.count', 'count')}
                          className="hot-config-filter-input hot-config-filter-relative-count"
                          value={(row.values[0] as string) ?? ''}
                          onChange={(e) => handleRelativeChange(row.id, 0, e.target.value)}
                          aria-label={t('dynamicTable.filter.count', 'count')}
                        />
                        <SelectMenu
                          className="hot-config-filter-select"
                          value={(row.values[1] as string) || 'days'}
                          onChange={(next) => handleRelativeChange(row.id, 1, next)}
                          options={RELATIVE_DATE_UNITS.map((u) => ({
                            value: u,
                            label: t(`dynamicTable.filter.unit.${u}`, u),
                          }))}
                          ariaLabel={t('dynamicTable.filter.unit', 'Unit')}
                        />
                      </>
                    ) : isRange ? (
                      // Two side-by-side date pickers for `is_between` — styled
                      // calendar popover (matches the inline cell editor look)
                      // instead of the native `<input type="date">` widget.
                      <>
                        <FilterDatePicker
                          value={(row.values[0] as string) || ''}
                          onChange={(v) => handleRangeValueChange(row.id, 0, v)}
                          ariaLabel={t('dynamicTable.filter.from', 'From')}
                          placeholder={t('dynamicTable.filter.from', 'From')}
                        />
                        <span className="hot-config-filter-range-sep">→</span>
                        <FilterDatePicker
                          value={(row.values[1] as string) || ''}
                          onChange={(v) => handleRangeValueChange(row.id, 1, v)}
                          ariaLabel={t('dynamicTable.filter.to', 'To')}
                          placeholder={t('dynamicTable.filter.to', 'To')}
                        />
                      </>
                    ) : isDate ? (
                      // Single date picker for the before/after/equals/on-or-before/on-or-after operators.
                      <FilterDatePicker
                        value={(row.values[0] as string) || ''}
                        onChange={(v) => handleValueChange(row.id, v)}
                        ariaLabel={t('dynamicTable.filter.date', 'Date')}
                        placeholder={t('dynamicTable.filter.pickDate', 'Pick date')}
                      />
                    ) : (
                      // THE fix for "the Assignee filter is a text box that
                      // never matches". Free text still works — a partial
                      // `contains` is a legitimate filter — but when the host
                      // supplies a loader the same box becomes a real picker,
                      // for the multi-value operators too ("show only mine" is
                      // `is_any_of [me]`).
                      <FilterValueInput
                        key={`${row.id}:${row.field}`}
                        filterId={row.id}
                        initialValue={!isMultiValue ? ((row.values[0] as string) || '') : ''}
                        isMultiValue={isMultiValue}
                        onValueChange={handleValueChange}
                        onValueAdd={handleValueAdd}
                        loadSuggestions={getLoader(row.field)}
                        placeholder={
                          isMultiValue
                            ? t('dynamicTable.filter.addValue', 'Add…')
                            : t('dynamicTable.filter.enterValue', 'Enter value')
                        }
                        ariaLabel={t('dynamicTable.filter.enterValue', 'Enter value')}
                      />
                    )}
                    </>
                    )}
                  </>
                )}
                <button
                  onClick={() => removeFilterRow(row.id)}
                  className="hot-config-filter-remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </>
      )}
      <button onClick={addFilterRow} className="hot-config-add-btn">
        <Plus className="w-3.5 h-3.5" aria-hidden />
        {t('dynamicTable.filter.addCondition', 'Add condition')}
      </button>
    </div>
  );
};

export default ConfigureViewFilters;
