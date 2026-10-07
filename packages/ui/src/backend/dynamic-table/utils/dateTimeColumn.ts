/**
 * A date column that also holds a time — the cell keeps "YYYY-MM-DDTHH:mm" (wall clock) instead of
 * being cut to the day. A column says so with `withTime: true`, or by editing through
 * `createDateTimeEditor()`, whose editors carry this mark.
 */
export const DATETIME_EDITOR_MARK = Symbol.for('freighttech.dynamicTable.datetimeEditor')

export function markDateTimeEditor<T extends object>(editor: T): T {
  ;(editor as Record<symbol, unknown>)[DATETIME_EDITOR_MARK] = true
  return editor
}

export function columnKeepsTime(column: { withTime?: boolean; editor?: unknown }): boolean {
  if (column.withTime === true) return true
  const editor = column.editor as Record<symbol, unknown> | undefined
  return (typeof editor === 'function' || (typeof editor === 'object' && editor !== null)) && editor[DATETIME_EDITOR_MARK] === true
}

/** "1 850,50" / "1850.5" / "-3,25" → a number; NaN when it is not one. Spaces (also NBSP) group thousands. */
export function parseLocaleNumber(text: string): number {
  const s = text.trim().replace(/[\s ]/g, '').replace(',', '.')
  return s === '' ? Number.NaN : Number(s)
}
