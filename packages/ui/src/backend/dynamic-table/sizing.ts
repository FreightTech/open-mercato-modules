import { createContext } from 'react'

/**
 * How a DynamicTable sizes its scroll body.
 *
 * - `'auto'` (default) — a fixed 600 px body, the historical behaviour of every list page.
 * - `'fill'` — fills the viewport down to the scroll pane's bottom.
 * - `'100%'` — fills its flex parent.
 * - `'content'` — exactly as tall as its header and rows, up to `maxHeight`; past that the rows scroll.
 *   For widgets on a board or a record page: one row is one row high, not 600 px of nothing.
 * - any CSS length / number — that fixed height.
 */
export type DynamicTableHeight = 'auto' | 'fill' | '100%' | 'content' | (string & {}) | number

export type DynamicTableSizing = {
  height?: DynamicTableHeight
  /** With `height: 'content'`: the tallest the rows region grows before it scrolls. */
  maxHeight?: number | string
}

/** The rows region of a `'content'` table grows to this before it scrolls (about ten rows and a header). */
export const CONTENT_MAX_HEIGHT = 480

/**
 * A host (a board slot, a record-page widget) sizes every DynamicTable inside it — e.g. a registered list
 * page shown as a widget is a `'fill'` page table, and its slot wants `'content'`. Wins over the table's
 * own `height` / `maxHeight`.
 */
export const DynamicTableSizingContext = createContext<DynamicTableSizing | null>(null)
export const DynamicTableSizingProvider = DynamicTableSizingContext.Provider
