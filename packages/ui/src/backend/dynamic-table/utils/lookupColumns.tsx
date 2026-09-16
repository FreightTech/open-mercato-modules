import * as React from 'react'
import type { ColumnDef } from '../types/index'
import type { LookupColumnRef } from '../types/perspective'

/**
 * Row field / column data key for a linked (lookup) column. The server enriches
 * each row with this key (see `@freighttech/table-lookups` resolver), and the
 * grid renders a read-only column for it. Keeping the `lookup__` prefix matches
 * the shipped convention; the `<source>__<field>` tail makes the key derivable on
 * both client and server with no stored column key.
 */
export function lookupColumnDataKey(ref: { source: string; field: string }): string {
  return `lookup__${ref.source}__${ref.field}`
}

/** True when a column data key belongs to a linked (lookup) column. */
export function isLookupColumnKey(key: string): boolean {
  return key.startsWith('lookup__')
}

/**
 * Build read-only DynamicTable column defs for a perspective's linked columns.
 * The cell value lives at `row[lookup__<source>__<field>]`, attached server-side.
 * Linked columns are never editable (editing would write back to the source,
 * breaking the unidirectional rule), so every column is `readOnly`.
 */
export function buildLookupColumnDefs(refs: LookupColumnRef[]): ColumnDef[] {
  return refs.map((r) => ({
    data: lookupColumnDataKey(r),
    title: r.label,
    readOnly: true,
    renderer: (value: unknown) => {
      const isEmpty = value == null || value === ''
      return (
        <span className={isEmpty ? 'text-m3-on-surface-variant' : undefined}>
          {isEmpty ? '—' : String(value)}
        </span>
      )
    },
  }))
}

/** Serialize a perspective's linked columns into the `lookups` query param value
 *  (`source:field,source:field`). Empty when there are no linked columns. */
export function lookupColumnsToParam(refs: LookupColumnRef[]): string {
  return refs.map((r) => `${r.source}:${r.field}`).join(',')
}
