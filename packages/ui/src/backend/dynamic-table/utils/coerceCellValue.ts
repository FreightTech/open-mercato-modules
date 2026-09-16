// utils/coerceCellValue.ts
//
// THE coercion table: "can this raw value become this column's type, and if so
// what exactly gets stored?"
//
// It used to be `parseValueByType`, a private function inside
// `handlers/index.ts` reachable only from the inline-edit path. Paste, fill,
// find-&-replace and import all need the same answer, and a second table is how
// a pasted date ends up stored differently from a typed one. So it moved here,
// and it now RETURNS A VERDICT rather than a value: a multi-cell write must be
// able to say "3 cells were not numbers" instead of silently blanking them.
//
// Pure: no store, no React, no DOM.

import type { ColumnDef } from '../types/index';
import type { CoerceResult } from '../handlers/cellWrites';

/** Empty in the "user cleared the cell" sense. Clearing is always allowed. */
function isEmptyInput(value: unknown): boolean {
  return value === '' || value === null || value === undefined;
}

/** `col.source` entries may be plain scalars or `{ value | id }` objects. */
function sourceValues(col: ColumnDef): string[] | null {
  const src = col.source;
  if (!Array.isArray(src) || src.length === 0) return null;
  return src.map((o) =>
    o && typeof o === 'object'
      ? String((o as Record<string, unknown>).value ?? (o as Record<string, unknown>).id ?? '')
      : String(o),
  );
}

/**
 * Coerce one raw value for one column.
 *
 * Structurally identical to `CellValueCoercer`, so it can be handed straight to
 * `applyCellWrites({ coerce: coerceCellValue, ... })`.
 *
 * Verdicts:
 *  - `readOnly`      the column refuses writes outright;
 *  - `notCoercible`  a non-empty value that cannot become the column's type
 *                    (`'abc'` into a numeric column, `'32/13'` into a date);
 *  - `notInSource`   a `dropdown` / `multiselect` value outside `col.source`.
 *
 * Emptying is never a rejection here — `ColumnDef.required` is enforced one
 * level up, in `applyCellWrites`, where the row is known.
 */
export function coerceCellValue(value: unknown, column: ColumnDef): CoerceResult {
  if (column.readOnly) return { ok: false, reason: 'readOnly' };
  if (!column.type) return { ok: true, value };
  if (isEmptyInput(value)) return { ok: true, value: null };

  switch (column.type) {
    case 'numeric': {
      // Accept the Polish decimal comma users actually type; `parseFloat` alone
      // reads "1,5" as 1.
      const raw = typeof value === 'number' ? value : String(value).trim().replace(',', '.');
      const parsed = typeof raw === 'number' ? raw : parseFloat(raw);
      if (!Number.isFinite(parsed)) return { ok: false, reason: 'notCoercible' };
      return { ok: true, value: parsed };
    }

    case 'date': {
      const date = value instanceof Date ? value : new Date(value as string);
      if (Number.isNaN(date.getTime())) return { ok: false, reason: 'notCoercible' };
      // ISO date string (YYYY-MM-DD) so a Date round-tripped through a string
      // stays the same day. LOCAL parts, not UTC: `toISOString()` would shift a
      // Warsaw midnight back to the previous day.
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return { ok: true, value: `${year}-${month}-${day}` };
    }

    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value };
      const s = String(value).trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes' || s === 'tak') return { ok: true, value: true };
      if (s === 'false' || s === '0' || s === 'no' || s === 'nie') return { ok: true, value: false };
      return { ok: false, reason: 'notCoercible' };
    }

    case 'dropdown':
    case 'multiselect': {
      const allowed = sourceValues(column);
      if (!allowed) return { ok: true, value };
      const wanted = Array.isArray(value) ? value.map(String) : [String(value)];
      if (wanted.some((v) => !allowed.includes(v))) return { ok: false, reason: 'notInSource' };
      return { ok: true, value };
    }

    default:
      return { ok: true, value };
  }
}
