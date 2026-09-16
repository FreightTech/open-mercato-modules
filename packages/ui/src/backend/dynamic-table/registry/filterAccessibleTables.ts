import type { TableDefinition } from './types'

/**
 * Narrow a registry to the tables a user may see.
 *
 * **Pure on purpose.** It calls no endpoint and knows nothing about who is
 * logged in — `metadata.features` are opaque strings and the HOST injects the
 * check. That is what keeps the registry usable by more than one surface: the
 * backend resolves grants through `POST /api/auth/feature-check` (which is
 * organization-scoped, server-side), and any other host wires `hasFeature` to
 * its own authority.
 *
 * **This filter is UX, not security.** The boundary is unchanged and unmoved:
 * every table's own list route still declares and enforces its feature
 * requirements. Hiding an inaccessible table from a picker is courtesy — it
 * stops a host offering something that would render an empty error — and a
 * table reached some other way (a stale saved layout) is still refused by the
 * route, not by this function.
 */
export function filterAccessibleTables(
  tables: TableDefinition[],
  hasFeature: (feature: string) => boolean,
): TableDefinition[] {
  return tables.filter((table) =>
    table.metadata.features.every((feature) => hasFeature(feature)),
  )
}

/** Look one up by `metadata.id`. Returns null rather than throwing — a host
 *  restoring a saved layout must degrade that slot, not fail the whole view. */
export function findTableDefinition(
  tables: TableDefinition[],
  id: string,
): TableDefinition | null {
  return tables.find((t) => t.metadata.id === id) ?? null
}
