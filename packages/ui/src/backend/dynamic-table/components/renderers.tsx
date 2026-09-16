import { format, parseISO, isValid } from 'date-fns';
import type { ReactNode } from 'react';
import type { DynamicTableBadgeVariant } from '../types/index';

export type CellRendererFunction = (
  value: any,
  rowData: any,
  columnConfig: any,
  rowIndex?: number,
  colIndex?: number
) => React.ReactNode;

// Text renderer (default)
export const textRenderer: CellRendererFunction = (value) => {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.join(', ');
    return JSON.stringify(value);
  }
  return value;
};

// Numeric renderer
export const numericRenderer: CellRendererFunction = (value, rowData, columnConfig) => {
  if (value === null || value === undefined || value === '') return '';

  try {
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(num)) return value;

    const locale = columnConfig.numericFormat?.locale || 'en-US';
    const options = { ...columnConfig.numericFormat };
    delete options.locale;

    // Default format if no options provided
    if (Object.keys(options).length === 0) {
      options.minimumFractionDigits = 2;
      options.maximumFractionDigits = 2;
    }

    return new Intl.NumberFormat(locale, options).format(num);
  } catch (error) {
    return value;
  }
};

// Date renderer
export const dateRenderer: CellRendererFunction = (value, rowData, columnConfig) => {
  if (!value) return '';

  try {
    const dateFormat = columnConfig.dateFormat || 'yyyy-MM-dd';

    let date: Date;
    if (value instanceof Date) {
      date = value;
    } else if (typeof value === 'string') {
      date = parseISO(value);
    } else if (typeof value === 'number') {
      date = new Date(value);
    } else {
      return value;
    }

    if (!isValid(date)) return value;

    return format(date, dateFormat);
  } catch (error) {
    return value;
  }
};

// Boolean renderer
export const booleanRenderer: CellRendererFunction = (value) => {
  if (value === true) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ width: 16, height: 16, color: 'var(--m3-success)' }}
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  return null;
};

// Badge renderer (type: 'badge') — renders a status pill using the
// --status-v2-* palette. Variant resolves from columnConfig.badgeVariant
// (function | string) then columnConfig.badgeMap, falling back to 'neutral'.
const BADGE_VARIANTS = new Set([
  'neutral', 'primary', 'outline', 'success', 'error', 'warning',
  'info', 'purple', 'teal', 'orange', 'sky', 'rose',
]);

/**
 * v2 status pill. Used internally by `badge` columns, and exported so custom
 * renderers can produce the same pill when the value is nested or needs a
 * custom label (e.g. a column whose `data` is a dot-path). Colors come from
 * the `--status-v2-*` tokens via the `.cell-badge-*` classes.
 */
export function DynamicTableBadge({
  variant = 'neutral',
  className,
  children,
}: {
  variant?: DynamicTableBadgeVariant;
  className?: string;
  children?: ReactNode;
}) {
  const v = BADGE_VARIANTS.has(variant) ? variant : 'neutral';
  return <span className={`cell-badge cell-badge-${v}${className ? ` ${className}` : ''}`}>{children}</span>;
}

export const badgeRenderer: CellRendererFunction = (value, rowData, columnConfig) => {
  if (value === null || value === undefined || value === '') return '';
  const label = Array.isArray(value) ? value.join(', ') : String(value);

  let variant: DynamicTableBadgeVariant = 'neutral';
  const bv = columnConfig.badgeVariant;
  if (typeof bv === 'function') {
    variant = bv(value, rowData) || 'neutral';
  } else if (typeof bv === 'string') {
    variant = bv as DynamicTableBadgeVariant;
  } else if (columnConfig.badgeMap && columnConfig.badgeMap[label] != null) {
    variant = columnConfig.badgeMap[label];
  }

  return <DynamicTableBadge variant={variant}>{label}</DynamicTableBadge>;
};

// Get renderer function based on column type
export const getCellRenderer = (columnConfig: any): CellRendererFunction => {
  // Custom renderer takes precedence
  if (typeof columnConfig.renderer === 'function') {
    return columnConfig.renderer;
  }

  // Badge is a presentation flag (orthogonal to the data type)
  if (columnConfig.badge) {
    return badgeRenderer;
  }

  // Built-in renderers
  switch (columnConfig.type) {
    case 'numeric':
      return numericRenderer;
    case 'date':
      return dateRenderer;
    case 'boolean':
      return booleanRenderer;
    case 'text':
    default:
      return textRenderer;
  }
};
