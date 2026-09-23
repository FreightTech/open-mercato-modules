'use client'

/**
 * How a HOST tells the table it wraps how to present itself — without threading
 * a prop through every module's table component.
 *
 * The split view owns per-pane display choices (zebra rows, which chrome rows
 * are shown) and the ⚙ panel that edits them, but it cannot render that panel
 * itself: row density is stored under the TABLE's own key, which only the
 * table knows. So the host publishes the choices and the switch handlers here,
 * and the table renders the ⚙ button with its own density key.
 *
 * A context rather than a `TableHostContext` prop because that prop would have
 * to be forwarded by hand through ~12 module table components (each maps host
 * props into `uiConfig` itself) — the exact plumbing that already let
 * `hideViews` go missing in some of them.
 *
 * `DynamicTable` resets this to `null` for its own subtree, so a table nested
 * inside a pane (a drawer's sub-grid) never picks up the pane's settings.
 */

import * as React from 'react'

export type TableDisplayToggle = {
  key: string
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}

export type TableDisplayHost = {
  /** Alternating row fills for this pane. */
  striped?: boolean
  /** The switches the ⚙ panel lists under the density control. */
  toggles: TableDisplayToggle[]
}

export const TableDisplayContext = React.createContext<TableDisplayHost | null>(null)

export function useTableDisplayHost(): TableDisplayHost | null {
  return React.useContext(TableDisplayContext)
}
