// Module table registry — the contract by which a module declares a table it
// owns, so the table has an identity beyond "the body of one page.tsx".
//
// Deliberately mirrors `DashboardWidgetModule`
// (@open-mercato/shared/modules/dashboard/widgets): same shape of
// `{ metadata, Component }`, same lazy-loader helper, same `features` field for
// ACL. Modules already know that pattern; this is not a second dialect.
//
// Spec: .ai/specs/2026-08-04-module-table-registry.md

import type * as React from 'react'
import type { FilterRow } from '../types/index'
import type { SharedFilterMapping } from '../split-view/sharedCriteria'

/**
 * What a host passes a table when the table is NOT the whole page.
 *
 * Three props, each earned by a verified problem rather than anticipated need.
 * A table rendered with none of them behaves exactly as it does today.
 */
export type TableHostContext = {
  /**
   * Prefix for this instance's per-table client storage keys (last-used
   * perspective, column widths).
   *
   * Absent or '' → today's keys, byte-for-byte. Without this, two instances of
   * the SAME table overwrite each other, because those keys are derived from
   * `tableId` alone.
   */
  storageScope?: string
  /**
   * True when the table is not the whole page. One rule, two consequences:
   * **an embedded table does not touch page-level state**.
   *
   *  1. Row clicks select instead of navigating — otherwise a click inside a
   *     host tears the host down.
   *  2. No reading or writing of the URL query string. Four tables today seed
   *     filters from it (`?status=`, `?fileId=`) and one writes back to it, so
   *     two embedded instances would contend over the same query keys.
   */
  embedded?: boolean
  /**
   * Filters the host wants applied on mount. This is what replaces the URL
   * seeding an embedded table must not do.
   */
  initialFilters?: FilterRow[]
  /**
   * Filters a WORKSPACE is driving this pane with, already translated into this
   * table's own field names by `mapCriteriaForTable`.
   *
   * Distinct from `initialFilters`, which is read ONCE on mount. These are
   * LIVE: the user retypes in the workspace bar and every pane re-narrows. They
   * are also kept apart from the table's own filter state all the way down, so
   * turning the workspace off restores exactly what the user had set locally.
   */
  sharedFilters?: FilterRow[]
  /**
   * The workspace search box's value while it is driving this pane.
   *
   * Presence is the switch: `undefined` means no workspace search and the
   * pane's own box applies; `''` means the bar is on with an empty needle, and
   * the pane's own (now hidden) search must stop filtering — otherwise the grid
   * stays narrowed by a control the user can no longer see.
   */
  sharedSearch?: string
  /**
   * Controls the HOST wants rendered inside the table's own toolbar row.
   *
   * Exists so a host adds no vertical chrome of its own. An earlier build put
   * the split/layout controls in a strip ABOVE the grid, which pushed every
   * adopted page's first row ~33px down — a straight density loss on pages
   * whose entire purpose is rows per screen. The toolbar already has a wide
   * empty gap between the search box and the action buttons; that is where
   * host controls belong.
   *
   * The table merges this into `uiConfig.searchBarEnd` alongside anything it
   * already puts there.
   */
  /**
   * True only when this table is ONE OF SEVERAL on screen.
   *
   * Distinct from `embedded`, which merely says "a host owns my bounds" and is
   * true even for a single pane. Page-level chrome — a mode selector that
   * decides what the whole page is about — is still correct for one pane and
   * wrong for several, where it repeats and implies a selection nobody made.
   */
  multiview?: boolean
  /**
   * True when this table IS the page's subject, so opening a row is what the
   * page is for.
   *
   * ═══ WHY THIS IS NOT JUST `!embedded` ═══
   *
   * `embedded` above claims to mean "not the whole page", and `multiview`'s
   * note says it "merely says a host owns my bounds and is true even for a
   * single pane". Both are true of it, and that is the problem: it carries two
   * meanings that come apart at exactly one place — the PRIMARY pane of a
   * split-view host, which is the page's own table rendered inside a host that
   * owns its bounds.
   *
   * `multiview` was already carved out of `embedded` for the same reason. This
   * is the second carve-out, and it was not free: every list page in the app
   * moved to `SplitViewHost`, which passes `embedded` to every pane, so the
   * Files list lost its row links and its row-click handler at once and a
   * forwarder had **no way to open a file from the list of files** (HEDGE-110
   * step 1). The table's navigation code was all still there; nothing called
   * it.
   *
   * Hosts that own bounds AND own the page (the primary pane) set this. A
   * drawer or a secondary pane does not — there, a navigation really would
   * tear the host down, which is what `embedded` was protecting against.
   */
  ownsPageNavigation?: boolean
  /**
   * Rows the HOST wants inside the table's overflow menu.
   *
   * Deliberately NOT a toolbar slot: a host rendering its own button beside the
   * table's overflow leaves two near-identical menus in one strip. One menu,
   * host items appended.
   */
  overflowExtras?: React.ReactNode
  /**
   * Chrome rows the host wants suppressed, so a pane can trade toolbar for
   * rows. The table maps these onto `DynamicTable`'s existing
   * `hideSearch` / `hidePerspectiveTabs` / `hidePagination`.
   */
  hideToolbar?: boolean
  hideSearch?: boolean
  hideViews?: boolean
  hidePagination?: boolean
}

export type TableDefinitionMetadata = {
  /** '<module>.<entity>', singular entity — 'offers.offer', 'products.product'. */
  id: string
  title: string
  titleKey: string
  /** ACL features. Opaque strings — the registry never resolves them. */
  features: string[]
  /**
   * The table's EXISTING perspectives key, a **separate and immutable**
   * namespace from `id`. Today's values are flat slugs that predate this
   * registry ('products', 'facilities', 'products_carriers', 'fms-files') and
   * have live user data behind them at `/api/perspectives/{tableId}` — so they
   * must never be renamed to match `id`. Declared here so a table's two
   * identities are visible in one place.
   */
  perspectiveTableId: string
  /** Entity id from the generated ids (e.g. 'products:product'). */
  entityId: string
  /** Canonical full-page route — powers "open full page" from any host. */
  href: string
  /** lucide-react icon name. A string, matching the dashboard-widget convention. */
  icon?: string
  /** Grouping for pickers; reuse the owning route's pageGroup. */
  group?: string
  groupKey?: string
  /**
   * Which of THIS table's fields answers a shared workspace criterion.
   * Absent = not participating.
   *
   * Declared per table because panes hold different entities: "customer" is
   * `contractorId` here and `customerId` there. Without an explicit
   * declaration the workspace bar would have to guess, and a pane that guesses
   * wrong shows unfiltered rows to someone who believes they are filtered —
   * the one failure this whole mechanism exists to prevent. A criterion with
   * no entry here is REPORTED back to the pane as unmapped, so the pane says
   * "not filtered by customer" instead of staying quiet.
   */
  sharedFilters?: SharedFilterMapping
}

export type TableDefinition = {
  metadata: TableDefinitionMetadata
  Table: React.ComponentType<TableHostContext>
}

export type TableLoader = () => Promise<
  | { default: React.ComponentType<TableHostContext> }
  | React.ComponentType<TableHostContext>
>
