/**
 * Shared-criteria mapping — the mechanism that lets ONE workspace control drive
 * panes holding different entities.
 *
 * The assertions here are all variations on a single product rule: a pane that
 * cannot honour a criterion must SAY SO. Every silent path (an unmapped table,
 * a widget with no entry, a key nobody defined) is pinned to either a visible
 * report or a hard drop — never to "looks filtered, isn't".
 *
 * Spec: .ai/specs/2026-08-17-split-view-workspace-composition.md (TC-SPLIT-62x)
 */

import {
  SHARED_FILTER_ID_PREFIX,
  WIDGET_SHARED_FILTERS,
  mapCriteriaForTable,
  mapCriteriaForWidget,
  mergeSharedFilters,
  type SharedCriteria,
  type SharedCriterionRule,
} from '../split-view/sharedCriteria'
// NOTE (open-mercato-modules): the original suite also asserted this client
// enum matches `@freighttech/split-view`'s server zod enum, reached by relative
// path. That parity guard only makes sense in the FMS monorepo where both
// packages live; split-view is not part of this repo, so that single test was
// removed here. The mapping behaviour below still fully covers this module.
import type { FilterRow } from '../types/index'

/** Two tables that answer "customer" with DIFFERENT field names — the whole point. */
const TRANSPORTS = { sharedFilters: { customer: 'contractorId', status: 'state' } }
const OFFERS = { sharedFilters: { customer: 'customerId' } }
/** A registered table that never opted in. */
const CARRIERS = {}

const customerRule: SharedCriterionRule = {
  key: 'customer',
  operator: 'is_any_of',
  values: ['acme-1'],
}

function criteria(...rules: SharedCriterionRule[]): SharedCriteria {
  return { search: '', rules }
}

describe('TC-SPLIT-620 — a criterion maps to the table declared field name', () => {
  it('emits the declaring table own field, not the criterion key', () => {
    const { filters, unmapped } = mapCriteriaForTable(criteria(customerRule), TRANSPORTS)

    expect(unmapped).toEqual([])
    expect(filters).toEqual([
      {
        id: `${SHARED_FILTER_ID_PREFIX}customer`,
        field: 'contractorId',
        operator: 'is_any_of',
        values: ['acme-1'],
      },
    ])
  })

  it('gives the SAME criterion a different field on a different table', () => {
    const shared = criteria(customerRule)

    expect(mapCriteriaForTable(shared, TRANSPORTS).filters[0].field).toBe('contractorId')
    expect(mapCriteriaForTable(shared, OFFERS).filters[0].field).toBe('customerId')
  })

  it('maps each rule independently, mapping what it can', () => {
    const { filters, unmapped } = mapCriteriaForTable(
      criteria(customerRule, { key: 'status', operator: 'is_any_of', values: ['open'] }),
      OFFERS,
    )

    expect(filters.map((f) => f.field)).toEqual(['customerId'])
    expect(unmapped).toEqual(['status'])
  })

  it('keeps the filter row identity stable across calls, so the request string does not churn', () => {
    const a = mapCriteriaForTable(criteria(customerRule), TRANSPORTS)
    const b = mapCriteriaForTable(criteria(customerRule), TRANSPORTS)

    expect(JSON.stringify(a.filters)).toBe(JSON.stringify(b.filters))
  })
})

describe('TC-SPLIT-621 — an unmapped table yields no rule AND reports itself', () => {
  it('returns no filters and names the criterion it cannot answer', () => {
    const { filters, unmapped } = mapCriteriaForTable(criteria(customerRule), CARRIERS)

    expect(filters).toEqual([])
    expect(unmapped).toEqual(['customer'])
  })

  it('reports every live criterion it cannot answer, once each', () => {
    const { unmapped } = mapCriteriaForTable(
      criteria(
        customerRule,
        { key: 'customer', operator: 'contains', values: ['x'] },
        { key: 'transportMode', operator: 'is_any_of', values: ['sea'] },
      ),
      CARRIERS,
    )

    expect(unmapped).toEqual(['customer', 'transportMode'])
  })

  it('treats a missing metadata object the same as one with no mapping', () => {
    expect(mapCriteriaForTable(criteria(customerRule), undefined).unmapped).toEqual(['customer'])
    expect(mapCriteriaForTable(criteria(customerRule), null).unmapped).toEqual(['customer'])
  })
})

describe('TC-SPLIT-622 — shared rules never mutate the pane own filters array', () => {
  const own: FilterRow[] = [{ id: 'local-1', field: 'status', operator: 'is_any_of', values: ['open'] }]

  it('leaves the pane array untouched when shared rules are merged for a request', () => {
    const before = JSON.parse(JSON.stringify(own))
    const { filters: shared } = mapCriteriaForTable(criteria(customerRule), TRANSPORTS)

    const merged = mergeSharedFilters(own, shared)

    expect(own).toEqual(before)
    expect(own).toHaveLength(1)
    expect(merged).not.toBe(own)
    expect(merged.map((f) => f.field)).toEqual(['status', 'contractorId'])
  })

  it('returns the pane own array BY REFERENCE when nothing is shared', () => {
    // Byte-identical behaviour for the 29 pages that never pass shared filters:
    // a new array here would churn every memo downstream of it.
    expect(mergeSharedFilters(own, [])).toBe(own)
    expect(mergeSharedFilters(own, undefined)).toBe(own)
    expect(mergeSharedFilters(own, null)).toBe(own)
  })

  it('lets a shared rule win over a local rule on the SAME field, for the request only', () => {
    const { filters: shared } = mapCriteriaForTable(
      criteria({ key: 'status', operator: 'is_any_of', values: ['closed'] }),
      TRANSPORTS,
    )

    const merged = mergeSharedFilters(
      [{ id: 'local-1', field: 'state', operator: 'is_any_of', values: ['open'] }],
      shared,
    )

    // One rule for the column, not two ANDed into zero rows.
    expect(merged).toHaveLength(1)
    expect(merged[0].values).toEqual(['closed'])
  })
})

describe('TC-SPLIT-623 — disabling the toggle emits zero shared rules', () => {
  it('emits nothing when the workspace passes no criteria at all', () => {
    expect(mapCriteriaForTable(null, TRANSPORTS)).toEqual({ filters: [], unmapped: [] })
    expect(mapCriteriaForTable(undefined, TRANSPORTS)).toEqual({ filters: [], unmapped: [] })
  })

  it('emits nothing — and reports nothing unmapped — for an empty rule set', () => {
    const { filters, unmapped } = mapCriteriaForTable({ search: 'acme', rules: [] }, CARRIERS)

    // A pane must not claim "not filtered by customer" when nobody asked for a
    // customer: the marker means a LIVE criterion was dropped.
    expect(filters).toEqual([])
    expect(unmapped).toEqual([])
  })

  it('drops a rule whose operator takes values but has none', () => {
    const { filters } = mapCriteriaForTable(
      criteria({ key: 'customer', operator: 'is_any_of', values: [] }),
      TRANSPORTS,
    )

    expect(filters).toEqual([])
  })

  it('keeps a value-less operator that means something on its own', () => {
    const { filters } = mapCriteriaForTable(
      criteria({ key: 'dateRange', operator: 'is_today', values: [] }),
      { sharedFilters: { dateRange: 'etd' } },
    )

    expect(filters).toEqual([
      { id: `${SHARED_FILTER_ID_PREFIX}dateRange`, field: 'etd', operator: 'is_today', values: [] },
    ])
  })
})

describe('TC-SPLIT-624 — a widget with no entry reports unmapped, still renders', () => {
  it('maps exactly the widgets whose endpoints apply the workspace filters', () => {
    // An entry is earned by making the widget read `settings.workspaceFilters`
    // and its endpoint apply them (offers + invoicing, 2026-09-23). A guessed
    // one produces a pane that claims to be filtered and is not — so this list
    // is pinned, and growing it means changing the widget too.
    expect(Object.keys(WIDGET_SHARED_FILTERS).sort()).toEqual([
      'invoicing.dashboard.inflows',
      'invoicing.dashboard.outflows',
      'invoicing.dashboard.toBook',
      'offers.dashboard.pendingResponseOffers',
      'offers.dashboard.unsentOffers',
    ])
    // The cash-flow charts are fixed time windows: customer only, no dates.
    expect(WIDGET_SHARED_FILTERS['invoicing.dashboard.inflows']).toEqual({ customer: 'counterpartyName' })
  })

  it('reports the criterion and hands the pane nothing to apply', () => {
    const { filters, unmapped } = mapCriteriaForWidget(
      criteria(customerRule),
      'shipment-tracking:ships-map',
    )

    // Nothing to apply → the widget renders its own data, unfiltered…
    expect(filters).toEqual([])
    // …and the pane has what it needs to say "not filtered by customer".
    expect(unmapped).toEqual(['customer'])
  })

  it('behaves the same for a widget id that is not known at all', () => {
    expect(mapCriteriaForWidget(criteria(customerRule), undefined)).toEqual({
      filters: [],
      unmapped: ['customer'],
    })
  })

  it('maps through an entry once one is declared', () => {
    const declared = { ...WIDGET_SHARED_FILTERS, 'invoicing:inflows': { customer: 'contractorId' } }
    // Same mechanism the table path uses, so a declared widget cannot drift
    // from a declared table.
    expect(
      mapCriteriaForTable(criteria(customerRule), {
        sharedFilters: declared['invoicing:inflows'],
      }).filters[0].field,
    ).toBe('contractorId')
  })
})

describe('TC-SPLIT-625 — an unknown criterion key is dropped, never forwarded', () => {
  const bogus = { key: 'vessel', operator: 'is_any_of', values: ['ever given'] } as unknown as SharedCriterionRule

  it('never reaches the request, even when a mapping names it', () => {
    const { filters, unmapped } = mapCriteriaForTable(criteria(bogus), {
      sharedFilters: { vessel: 'vesselName' } as never,
    })

    expect(filters).toEqual([])
    // Not reportable either: a pane cannot honestly caption a criterion whose
    // meaning nobody defines. The server's zod enum refuses it on save; this is
    // the same refusal one layer earlier.
    expect(unmapped).toEqual([])
  })

  it('drops only the unknown rule and keeps the known ones', () => {
    const { filters, unmapped } = mapCriteriaForTable(criteria(bogus, customerRule), TRANSPORTS)

    expect(filters.map((f) => f.field)).toEqual(['contractorId'])
    expect(unmapped).toEqual([])
  })

  it('applies the same drop on the widget path', () => {
    expect(mapCriteriaForWidget(criteria(bogus), 'invoicing:inflows')).toEqual({
      filters: [],
      unmapped: [],
    })
  })
})
