'use client'

// The seam between the registry (which knows nothing about auth) and a host
// (which does).
//
// Pages live in `packages/*` and the collected registry lives in `apps/web`, so
// a page cannot import it directly without inverting the dependency. A context
// mounted once in the backend layout carries both halves — the tables the host
// collected, and the host's own feature check — to any page that wants to
// render a table by id.
//
// Spec: .ai/specs/2026-08-04-module-table-registry.md

import * as React from 'react'
import type { TableDefinition } from './types'
import { filterAccessibleTables, findTableDefinition } from './filterAccessibleTables'

export type TableRegistryValue = {
  /** Every table this host collected, before ACL. */
  tables: TableDefinition[]
  /**
   * Host-supplied grant check. Opaque to the registry — the backend resolves it
   * through `POST /api/auth/feature-check` (organization-scoped, server-side);
   * another surface would resolve it against its own authority.
   */
  hasFeature: (feature: string) => boolean
  /** False while grants are still loading, so a picker can avoid flashing an
   *  empty list and then filling it. */
  ready: boolean
}

const EMPTY: TableDefinition[] = []

const TableRegistryContext = React.createContext<TableRegistryValue>({
  tables: EMPTY,
  // Default-deny. A host that forgot to mount the provider shows nothing rather
  // than everything — the failure is visible, not permissive.
  hasFeature: () => false,
  ready: false,
})

export function TableRegistryProvider({
  value,
  children,
}: {
  value: TableRegistryValue
  children: React.ReactNode
}) {
  return (
    <TableRegistryContext.Provider value={value}>{children}</TableRegistryContext.Provider>
  )
}

export function useTableRegistry(): TableRegistryValue {
  return React.useContext(TableRegistryContext)
}

/** The tables the current user may see, memoised against the grant function. */
export function useAccessibleTables(): TableDefinition[] {
  const { tables, hasFeature } = useTableRegistry()
  return React.useMemo(() => filterAccessibleTables(tables, hasFeature), [tables, hasFeature])
}

/**
 * Resolve one table by id, with the two degradations a host needs.
 * `unknown` — not in the registry (e.g. a saved layout naming a removed table).
 * `denied`  — present but the user lacks its features.
 */
export function useTableById(id: string | null | undefined): {
  definition: TableDefinition | null
  status: 'ok' | 'unknown' | 'denied' | 'loading'
} {
  const { tables, hasFeature, ready } = useTableRegistry()
  return React.useMemo(() => {
    if (!id) return { definition: null, status: 'unknown' as const }
    const definition = findTableDefinition(tables, id)
    if (!definition) return { definition: null, status: 'unknown' as const }
    if (!ready) return { definition, status: 'loading' as const }
    const allowed = definition.metadata.features.every((f) => hasFeature(f))
    return allowed
      ? { definition, status: 'ok' as const }
      : { definition, status: 'denied' as const }
  }, [id, tables, hasFeature, ready])
}
