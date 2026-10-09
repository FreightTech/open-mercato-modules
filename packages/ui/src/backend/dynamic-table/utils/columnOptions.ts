import type { ColumnDef } from '../types/index';

export interface ColumnOption {
  value: string;
  label: string;
}

/**
 * A column's `source` (dropdown options) as a {value,label} list. Options may be
 * plain strings or {value,label}/{id,name} objects. Returns null when the column
 * has no option set (free-text/numeric/date columns).
 *
 * Shared by the filter and the highlighting editors, so both offer the same
 * picker for the same column: labels shown, raw values stored.
 */
export const getColumnOptions = (col?: ColumnDef): ColumnOption[] | null => {
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
