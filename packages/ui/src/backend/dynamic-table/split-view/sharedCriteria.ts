/**
 * Workspace-level shared criteria — one question asked of every pane at once.
 *
 * WHY A MAPPING AT ALL: panes hold DIFFERENT entities. "Customer" is
 * `contractorId` on transports, `customerId` on offers and nothing at all on a
 * ships map. Matching on column name was rejected (FMS schemas barely share
 * names, so nearly every pane would grey out); matching semantically off
 * `entityId` was rejected for a worse reason — when a pane silently fails to
 * filter, the user is reading the wrong rows *believing* they are filtered.
 *
 * So every table DECLARES which of its own fields answers each criterion
 * (`TableDefinitionMetadata.sharedFilters`), and anything that cannot be
 * answered is RETURNED as `unmapped` for the pane to say so out loud. Silence
 * is the failure mode this module exists to prevent.
 *
 * Pure functions, no React, no I/O — the whole mechanism is unit-testable.
 *
 * Spec: .ai/specs/2026-08-17-split-view-workspace-composition.md
 */

import type { FilterRow } from '../types/index'
import { needsValueInput, type FilterOperator } from '../types/filters'

/**
 * The vocabulary. CLOSED, deliberately: an open one cannot be mapped onto a
 * table's own field names, validated on the server, or explained to a user when
 * a pane cannot honour it.
 *
 * MUST stay identical to `SHARED_CRITERION_KEYS` in
 * `packages/split-view/src/modules/split_views/data/validators.ts` — that zod
 * enum is the server's authority and rejects anything it does not know, so a
 * key added here alone would 400 on save with no clue why.
 */
export const SHARED_CRITERION_KEYS = ['customer', 'dateRange', 'status', 'transportMode'] as const

export type SharedCriterionKey = (typeof SHARED_CRITERION_KEYS)[number]

export type SharedCriterionRule = {
  key: SharedCriterionKey
  operator: FilterOperator
  values: unknown[]
}

/** What the workspace bar owns: one search string plus zero or more rules. */
export type SharedCriteria = {
  search?: string
  rules: SharedCriterionRule[]
}

/** A table's (or widget's) answer to the vocabulary, in its OWN field names. */
export type SharedFilterMapping = Partial<Record<SharedCriterionKey, string>>

/**
 * The result of asking one pane to honour the criteria.
 *
 * `unmapped` is not diagnostics — it is what the pane renders as "not filtered
 * by customer". A caller that drops it reintroduces exactly the silent wrong
 * data this module was written to prevent.
 */
export type MappedCriteria = {
  filters: FilterRow[]
  unmapped: SharedCriterionKey[]
}

/** Shared identity for "nothing to apply", so callers can compare by reference. */
const NOTHING: MappedCriteria = Object.freeze({
  filters: Object.freeze([]) as unknown as FilterRow[],
  unmapped: Object.freeze([]) as unknown as SharedCriterionKey[],
})

/** `FilterRow.id` prefix. Deterministic — see `mapCriteriaForTable`. */
export const SHARED_FILTER_ID_PREFIX = 'shared:'

export function isSharedCriterionKey(value: unknown): value is SharedCriterionKey {
  return (SHARED_CRITERION_KEYS as readonly unknown[]).includes(value)
}

/** True for a rule that would filter nothing away, so it is not worth sending. */
function isInert(rule: SharedCriterionRule): boolean {
  return needsValueInput(rule.operator) && rule.values.length === 0
}

function mapWith(criteria: SharedCriteria | null | undefined, mapping: SharedFilterMapping | undefined): MappedCriteria {
  const rules = criteria?.rules
  if (!rules || rules.length === 0) return NOTHING

  const filters: FilterRow[] = []
  const unmapped: SharedCriterionKey[] = []

  for (const rule of rules) {
    // A key outside the vocabulary is DROPPED here and never reaches the
    // request. It cannot be reported as unmapped either — `unmapped` is typed
    // to the vocabulary, and a pane cannot honestly caption a criterion whose
    // meaning nobody defines. The server's zod enum rejects it on save; this is
    // the same refusal one layer earlier, for criteria restored from an older
    // client or a hand-edited row.
    if (!isSharedCriterionKey(rule.key)) continue

    const field = mapping?.[rule.key]
    if (!field) {
      if (!unmapped.includes(rule.key)) unmapped.push(rule.key)
      continue
    }
    if (isInert(rule)) continue

    filters.push({
      // Deterministic, not random: the same criteria must produce the same
      // request string on every render, or the list query key churns and the
      // pane refetches on every parent re-render. The prefix also lets a
      // consumer tell a shared row from one the user authored.
      id: `${SHARED_FILTER_ID_PREFIX}${rule.key}`,
      field,
      operator: rule.operator,
      values: [...rule.values],
    })
  }

  if (filters.length === 0 && unmapped.length === 0) return NOTHING
  return { filters, unmapped }
}

/**
 * Translate the workspace criteria into ONE table's own field names.
 *
 * `metadata` is deliberately a structural type rather than the whole
 * `TableDefinitionMetadata`: this stays testable without building a registry
 * entry, and a table that never declares `sharedFilters` simply reports every
 * live criterion as unmapped.
 */
export function mapCriteriaForTable(
  criteria: SharedCriteria | null | undefined,
  metadata: { sharedFilters?: SharedFilterMapping } | null | undefined,
): MappedCriteria {
  return mapWith(criteria, metadata?.sharedFilters)
}

/**
 * Widget shared-filter mappings, keyed by widget id.
 *
 * WHY IT IS HERE and not on the widget: `DashboardWidgetMetadata` is an
 * `@open-mercato/*` type this repo consumes read-only. Declaring the mapping on
 * it would be an upstream change, which this spec forbids outright — so the
 * declaration lives on our side of the line instead.
 *
 * DELIBERATELY EMPTY. A widget appears here only once someone has READ its
 * component and confirmed it accepts an equivalent value through `settings`;
 * an invented entry would produce a pane that claims to be filtered and is not,
 * which is strictly worse than one that admits it is not filtered.
 *
 * To add one:
 *   1. Open the widget and find the `settings` key it filters on.
 *   2. Add `'<module>:<widget>': { customer: 'contractorId' }` below.
 *   3. The pane stops reporting that criterion as unmapped, and the host passes
 *      the mapped value through the slot's `settings`.
 */
export const WIDGET_SHARED_FILTERS: Record<string, SharedFilterMapping> = {}

/**
 * Same contract as `mapCriteriaForTable`, for a widget pane.
 *
 * A widget with no entry reports every live criterion as unmapped and STILL
 * RENDERS — its own data, unfiltered, with the pane saying so. Blanking it
 * would destroy the reason the user put it on screen.
 */
export function mapCriteriaForWidget(
  criteria: SharedCriteria | null | undefined,
  widgetId: string | null | undefined,
): MappedCriteria {
  return mapWith(criteria, widgetId ? WIDGET_SHARED_FILTERS[widgetId] : undefined)
}

/**
 * The pane's OWN filters combined with the workspace's, for one request.
 *
 * Two invariants, both load-bearing:
 *
 *  1. **`own` is never mutated and never re-ordered.** Shared criteria are a
 *     view over the pane's state, not a write to it — otherwise turning the
 *     workspace toggle off could not restore what the user had, because it
 *     would have been overwritten.
 *  2. **With nothing shared, the SAME array reference comes back**, so every
 *     memo downstream of it (query params, and through them the list query key)
 *     is byte-identical to a build without this feature.
 *
 * Precedence: a shared rule REPLACES the pane's own rule on the same field for
 * the duration of the request. Sending both would AND two rules over one column
 * — usually zero rows — and the bar is the control the user is looking at.
 */
export function mergeSharedFilters(
  own: FilterRow[],
  shared: FilterRow[] | null | undefined,
): FilterRow[] {
  if (!shared || shared.length === 0) return own
  const sharedFields = new Set(shared.map((row) => row.field))
  return [...own.filter((row) => !sharedFields.has(row.field)), ...shared]
}
