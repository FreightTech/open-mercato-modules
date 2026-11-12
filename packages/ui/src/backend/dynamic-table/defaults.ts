import { createContext } from 'react'

/** Where a table's settings menu (export, row height, fullscreen) sits; see `DynamicTableProps.tableMenuPlacement`. */
export type DynamicTableMenuPlacement = 'toolbar' | 'pagination'

/** An app's defaults for the props every DynamicTable inside it leaves unset. */
export type DynamicTableDefaults = {
  tableMenuPlacement?: DynamicTableMenuPlacement
  /**
   * The saved-view row ('Widok domyślny ··· + Dodaj widok') for every table that leaves `uiConfig.hidePerspectiveTabs`
   * unset; unset here too → the table's own rule (shown when it has perspectives). An app whose every list is one flat
   * table (acporath) sets it true once.
   */
  hidePerspectiveTabs?: boolean
}

/**
 * Lets an app set these once (around its backend layout) instead of on every table. A table's own prop
 * still wins.
 */
export const DynamicTableDefaultsContext = createContext<DynamicTableDefaults>({})
export const DynamicTableDefaultsProvider = DynamicTableDefaultsContext.Provider
