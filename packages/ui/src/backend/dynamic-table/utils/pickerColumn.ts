/**
 * A "picker" column: its editor is a list or a calendar, not a text box. One click on such a cell
 * opens the picker straight away — the double-click a text cell needs is friction here, because
 * there is nothing to type and nothing a second click could add (owner 07.10: "it should open
 * directly on click").
 *
 * Built-in `dropdown` / `multiselect` / `date` columns are pickers. A column with its own `editor`
 * is one when that editor carries this mark (the package's entity-search and date-time factories
 * do), or when the column says `openOnClick: true`. `openOnClick: false` opts a column out.
 */
export const PICKER_EDITOR_MARK = Symbol.for('freighttech.dynamicTable.pickerEditor')

export function markPickerEditor<T extends object>(editor: T): T {
  ;(editor as Record<symbol, unknown>)[PICKER_EDITOR_MARK] = true
  return editor
}

const PICKER_TYPES = new Set(['dropdown', 'multiselect', 'date'])

export function columnOpensOnClick(column: { type?: string; editor?: unknown; readOnly?: boolean; openOnClick?: boolean } | undefined): boolean {
  if (!column || column.readOnly) return false
  if (typeof column.openOnClick === 'boolean') return column.openOnClick
  const editor = column.editor as Record<symbol, unknown> | undefined
  if (editor) return (typeof editor === 'function' || typeof editor === 'object') && editor[PICKER_EDITOR_MARK] === true
  return PICKER_TYPES.has(column.type ?? '')
}
