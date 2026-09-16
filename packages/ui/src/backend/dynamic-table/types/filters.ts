// types/filters.ts

export type FilterOperator =
  | 'is_any_of'
  | 'is_not_any_of'
  | 'contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'is_true'
  | 'is_false'
  | 'is_before'
  | 'is_after'
  | 'is_on_or_before'
  | 'is_on_or_after'
  | 'is_between'
  | 'is_in_next'
  | 'is_in_last'
  | 'is_overdue'
  | 'is_today'
  | 'is_tomorrow'
  | 'is_this_week'
  | 'is_next_week';

export const getOperatorsForType = (type?: 'text' | 'numeric' | 'boolean'| "date" | "dropdown" | "multiselect"): { value: FilterOperator; label: string }[] => {
  const common = [
    { value: 'is_any_of' as FilterOperator, label: 'is any of' },
    { value: 'is_not_any_of' as FilterOperator, label: 'is not any of' },
    { value: 'is_empty' as FilterOperator, label: 'is empty' },
    { value: 'is_not_empty' as FilterOperator, label: 'is not empty' },
  ];

  if (type === 'numeric') {
    return [
      ...common,
      { value: 'equals' as FilterOperator, label: 'equals' },
      { value: 'not_equals' as FilterOperator, label: 'not equals' },
      { value: 'greater_than' as FilterOperator, label: 'greater than' },
      { value: 'less_than' as FilterOperator, label: 'less than' },
    ];
  }

  if (type === 'boolean') {
    return [
      { value: 'is_true' as FilterOperator, label: 'is true' },
      { value: 'is_false' as FilterOperator, label: 'is false' },
    ];
  }

  if (type === 'date') {
    return [
      // Now-relative presets first — the most-used for "due today / this week".
      { value: 'is_today' as FilterOperator, label: 'today' },
      { value: 'is_tomorrow' as FilterOperator, label: 'tomorrow' },
      { value: 'is_this_week' as FilterOperator, label: 'this week' },
      { value: 'is_next_week' as FilterOperator, label: 'next week' },
      { value: 'is_overdue' as FilterOperator, label: 'overdue' },
      { value: 'is_between' as FilterOperator, label: 'is between' },
      { value: 'is_before' as FilterOperator, label: 'is before' },
      { value: 'is_after' as FilterOperator, label: 'is after' },
      { value: 'is_on_or_before' as FilterOperator, label: 'is on or before' },
      { value: 'is_on_or_after' as FilterOperator, label: 'is on or after' },
      { value: 'is_in_next' as FilterOperator, label: 'next' },
      { value: 'is_in_last' as FilterOperator, label: 'last' },
      { value: 'equals' as FilterOperator, label: 'equals' },
      { value: 'is_empty' as FilterOperator, label: 'is empty' },
      { value: 'is_not_empty' as FilterOperator, label: 'is not empty' },
    ];
  }

  return [
    ...common,
    { value: 'contains' as FilterOperator, label: 'contains' },
  ];
};

// Now-relative preset operators — value-less; resolved to a today-anchored
// window server-side (see filterParser). Like is_empty, they render no value
// editor.
export const PRESET_DATE_OPERATORS: FilterOperator[] = [
  'is_overdue', 'is_today', 'is_tomorrow', 'is_this_week', 'is_next_week',
];

export const needsValueInput = (operator: FilterOperator): boolean => {
  return !['is_empty', 'is_not_empty', 'is_true', 'is_false', ...PRESET_DATE_OPERATORS].includes(operator);
};

export const needsMultipleValues = (operator: FilterOperator): boolean => {
  return ['is_any_of', 'is_not_any_of'].includes(operator);
};

// `is_between` takes two scalar values (from + to), shown as two date inputs.
// Distinct from `needsMultipleValues` which is a multi-pill "any of" set.
export const needsRangeValues = (operator: FilterOperator): boolean => {
  return operator === 'is_between';
};

// Date-operator predicate — used by ConfigureViewFilters to render
// <input type="date"> instead of a plain text box.
// NB: the relative operators (`is_in_next`/`is_in_last`) are deliberately
// excluded — they take a count + unit, not a calendar date, so they render the
// relative editor (see `needsRelativeInput`) rather than the FilterDatePicker.
export const DATE_OPERATORS: FilterOperator[] = [
  'is_before', 'is_after', 'is_on_or_before', 'is_on_or_after', 'is_between', 'equals',
];
export const isDateOperator = (operator: FilterOperator): boolean => DATE_OPERATORS.includes(operator);

// Relative ("moving") date operators — value is a [count, unit] pair, resolved
// to a today-anchored window server-side. Rendered as a number input + unit
// select (dni / tygodnie / miesiące) in ConfigureViewFilters.
export type RelativeDateUnit = 'days' | 'weeks' | 'months';
export const RELATIVE_DATE_UNITS: RelativeDateUnit[] = ['days', 'weeks', 'months'];
export const RELATIVE_DATE_OPERATORS: FilterOperator[] = ['is_in_next', 'is_in_last'];
export const needsRelativeInput = (operator: FilterOperator): boolean =>
  RELATIVE_DATE_OPERATORS.includes(operator);

export const applyFilters = (data: any[], filters: { field: string; operator: FilterOperator; values: string[] }[], columns: any[]): any[] => {
  if (filters.length === 0) return data;

  return data.filter(row => {
    return filters.every(filter => {
      const value = row[filter.field];
      const stringValue = String(value ?? '').toLowerCase();

      switch (filter.operator) {
        case 'is_any_of':
          return filter.values.some(v => String(value) === v);
        case 'is_not_any_of':
          return !filter.values.some(v => String(value) === v);
        case 'contains':
          return filter.values.some(v => stringValue.includes(v.toLowerCase()));
        case 'is_empty':
          return !value || stringValue === '';
        case 'is_not_empty':
          return !!value && stringValue !== '';
        case 'equals':
          return Number(value) === Number(filter.values[0]);
        case 'not_equals':
          return Number(value) !== Number(filter.values[0]);
        case 'greater_than':
          return Number(value) > Number(filter.values[0]);
        case 'less_than':
          return Number(value) < Number(filter.values[0]);
        case 'is_true':
          return value === true || value === 'true';
        case 'is_false':
          return value === false || value === 'false';
        default:
          return true;
      }
    });
  });
};
