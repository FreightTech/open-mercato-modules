/**
 * READ-ONLY, PER COLUMN OR PER ROW (0.14.35).
 *
 * `ColumnDef.readOnly` was a column flag. Two gt-fms grids needed it per row and worked around it: the tasks type
 * wizard (a status a module defines keeps its board column — its "Column" cell opened the dropdown and then refused
 * the pick) and invoicing verification (a correction's "before" row — a `NoLineEdit` editor that closed itself as it
 * opened). A function decides per cell; `true` / `false` / unset behave exactly as before.
 */

/** `true` — the whole column is read-only; a function — read-only where it returns true for that row. */
export type ColumnReadOnly = boolean | ((row: any, rowIndex: number) => boolean)

/**
 * Is THIS cell read-only? A predicate that throws counts as read-only: a cell that cannot say whether it may be
 * edited is safer left alone.
 */
export function isCellReadOnly(
  column: { readOnly?: ColumnReadOnly } | null | undefined,
  row: unknown,
  rowIndex: number,
): boolean {
  const readOnly = column?.readOnly
  if (typeof readOnly === 'function') {
    try {
      return readOnly(row, rowIndex) === true
    } catch {
      return true
    }
  }
  return readOnly === true
}

/** Is the WHOLE column read-only (the old flag)? A per-row predicate is not: some of its rows are editable. */
export function isColumnReadOnly(column: { readOnly?: ColumnReadOnly } | null | undefined): boolean {
  return column?.readOnly === true
}
