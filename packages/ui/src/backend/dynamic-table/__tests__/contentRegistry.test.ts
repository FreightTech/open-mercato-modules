/**
 * The unified content registry: tables AND widgets, one lookup, four states.
 *
 * The interesting assertions are the negative ones. `denied` and `unknown` are
 * different messages to the user and different bugs to a developer, so the pair
 * that separates them (catalogue absence vs. code absence) is pinned here — as
 * is default-deny, which is the behaviour that stops a missing provider from
 * silently offering everything.
 *
 * Unit companion to TC-APP-603 (picker lists both kinds, ACL-filtered) and
 * TC-APP-609 (a layout naming a removed widget degrades that pane only).
 * Spec: .ai/specs/2026-08-17-split-view-workspace-composition.md
 */

import * as React from 'react'
import { renderHook } from '@testing-library/react'
import {
  ContentRegistryProvider,
  useAccessibleContent,
  useContentById,
  type ContentStatus,
  type PaneContentItem,
} from '../registry/ContentRegistryContext'
import { TableRegistryProvider } from '../registry/TableRegistryContext'
import type { TableDefinition } from '../registry/types'
import type { WidgetCatalogEntry } from '../registry/widgetCatalog'
import type { PaneContentRef } from '../split-view/types'

// ── fixtures ────────────────────────────────────────────────────────────────

function makeTable(id: string, features: string[], group = 'Sales'): TableDefinition {
  return {
    metadata: {
      id,
      title: `Table ${id}`,
      titleKey: `tables.${id}`,
      features,
      perspectiveTableId: id,
      entityId: id.replace('.', ':'),
      href: `/backend/${id}`,
      group,
    },
    Table: () => null,
  }
}

function makeWidget(id: string, loaderKey: string, moduleId = 'invoicing'): WidgetCatalogEntry {
  return {
    id,
    title: `Widget ${id}`,
    description: null,
    loaderKey,
    icon: null,
    features: ['dashboards.view'],
    moduleId,
    defaultSettings: { window: 30 },
    defaultSize: 'md',
    supportsRefresh: true,
  }
}

const OFFERS = makeTable('offers.offer', ['offers.offers.view'])
const INVOICES = makeTable('invoicing.invoice', ['invoicing.invoices.view'], 'Finance')
const INFLOWS = makeWidget('invoicing.dashboard.inflows', 'invoicing:inflows:widget')

type Options = {
  tables?: TableDefinition[]
  granted?: string[]
  tablesReady?: boolean
  widgets?: WidgetCatalogEntry[]
  widgetsReady?: boolean
  /** Widget code present in the build but absent from the allowed catalogue. */
  existingLoaderKeys?: string[]
  /** Omit both providers, to exercise the default context. */
  noProvider?: boolean
}

function wrapperFor(options: Options) {
  const granted = new Set(options.granted ?? [])
  const contentValue = {
    widgets: options.widgets ?? [],
    context: null,
    ready: options.widgetsReady ?? true,
    loaderKeyExists: (key: string) => (options.existingLoaderKeys ?? []).includes(key),
  }
  const tableValue = {
    tables: options.tables ?? [],
    hasFeature: (feature: string) => granted.has(feature),
    ready: options.tablesReady ?? true,
  }

  return function Wrapper({ children }: { children: React.ReactNode }) {
    if (options.noProvider) return React.createElement(React.Fragment, null, children)
    return React.createElement(
      TableRegistryProvider,
      { value: tableValue },
      React.createElement(ContentRegistryProvider, { value: contentValue }, children),
    )
  }
}

function accessible(options: Options): PaneContentItem[] {
  return renderHook(() => useAccessibleContent(), { wrapper: wrapperFor(options) }).result.current
}

function resolve(ref: PaneContentRef | null, options: Options): {
  item: PaneContentItem | null
  status: ContentStatus
} {
  return renderHook(() => useContentById(ref), { wrapper: wrapperFor(options) }).result.current
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('useAccessibleContent', () => {
  it('TC-APP-603 lists tables and widgets together, each carrying its kind, title and group', () => {
    const items = accessible({
      tables: [OFFERS, INVOICES],
      granted: ['offers.offers.view', 'invoicing.invoices.view'],
      widgets: [INFLOWS],
    })

    expect(items).toHaveLength(3)
    expect(items.map((i) => [i.kind, i.id])).toEqual([
      ['table', 'offers.offer'],
      ['table', 'invoicing.invoice'],
      ['widget', 'invoicing.dashboard.inflows'],
    ])
    expect(items.find((i) => i.id === 'invoicing.invoice')?.group).toBe('Finance')
    // A widget's group is its owning module — the only grouping the DTO carries.
    expect(items.find((i) => i.kind === 'widget')?.group).toBe('invoicing')
  })

  it('TC-APP-603 drops tables whose features are not granted, keeping the rest', () => {
    const items = accessible({
      tables: [OFFERS, INVOICES],
      granted: ['offers.offers.view'],
      widgets: [INFLOWS],
    })

    expect(items.map((i) => i.id)).toEqual(['offers.offer', 'invoicing.dashboard.inflows'])
  })

  it('TC-APP-603 lists only the widgets the catalogue returned — the server is the ACL for widgets', () => {
    // The catalogue endpoint returns the ALLOWED set only, so "filtering" a
    // widget means it never arrives. Nothing client-side may add one back.
    const items = accessible({ tables: [], granted: [], widgets: [] })
    expect(items).toEqual([])
  })

  it('carries loaderKey on widgets so a picked widget can be reopened without the catalogue', () => {
    const items = accessible({ widgets: [INFLOWS] })
    const widget = items[0]
    expect(widget.kind).toBe('widget')
    expect(widget.kind === 'widget' && widget.loaderKey).toBe('invoicing:inflows:widget')
  })

  it('offers nothing when no provider is mounted (default-deny)', () => {
    const items = accessible({
      noProvider: true,
      tables: [OFFERS],
      granted: ['offers.offers.view'],
      widgets: [INFLOWS],
    })
    expect(items).toEqual([])
  })
})

describe('useContentById — tables', () => {
  it('resolves a granted table to ok', () => {
    const { item, status } = resolve(
      { kind: 'table', tableId: 'offers.offer' },
      { tables: [OFFERS], granted: ['offers.offers.view'] },
    )
    expect(status).toBe('ok')
    expect(item?.kind).toBe('table')
    expect(item?.title).toBe('Table offers.offer')
  })

  it('reports an unregistered table id as unknown', () => {
    const { item, status } = resolve(
      { kind: 'table', tableId: 'gone.table' },
      { tables: [OFFERS], granted: ['offers.offers.view'] },
    )
    expect(status).toBe('unknown')
    expect(item).toBeNull()
  })

  it('reports a registered but ungranted table as denied', () => {
    const { status } = resolve({ kind: 'table', tableId: 'offers.offer' }, { tables: [OFFERS], granted: [] })
    expect(status).toBe('denied')
  })

  it('reports loading while grants are still in flight, never denied', () => {
    // Denying during the fetch would flash "no access" at a user who has it.
    const { status } = resolve(
      { kind: 'table', tableId: 'offers.offer' },
      { tables: [OFFERS], granted: [], tablesReady: false },
    )
    expect(status).toBe('loading')
  })
})

describe('useContentById — widgets', () => {
  it('TC-APP-604 resolves a catalogued widget to ok, with its loader key and defaults', () => {
    const { item, status } = resolve(
      { kind: 'widget', widgetId: 'invoicing.dashboard.inflows', loaderKey: 'invoicing:inflows:widget' },
      { widgets: [INFLOWS] },
    )
    expect(status).toBe('ok')
    expect(item?.kind).toBe('widget')
    expect(item?.kind === 'widget' && item.loaderKey).toBe('invoicing:inflows:widget')
    expect(item?.kind === 'widget' && item.defaultSettings).toEqual({ window: 30 })
  })

  it('TC-APP-609 reports a widget absent from the catalogue AND from the build as unknown', () => {
    const { item, status } = resolve(
      { kind: 'widget', widgetId: 'offers.dashboard.deleted', loaderKey: 'offers:deleted:widget' },
      { widgets: [INFLOWS], existingLoaderKeys: [] },
    )
    expect(status).toBe('unknown')
    expect(item).toBeNull()
  })

  it('TC-APP-609 reports a widget absent from the catalogue but still in the build as denied', () => {
    // The distinction that stops "you may not have this" and "this no longer
    // exists" collapsing into one wrong message.
    const { status } = resolve(
      { kind: 'widget', widgetId: 'offers.dashboard.unsent', loaderKey: 'offers:unsent:widget' },
      { widgets: [INFLOWS], existingLoaderKeys: ['offers:unsent:widget'] },
    )
    expect(status).toBe('denied')
  })

  it('reports loading while the catalogue is in flight, never unknown', () => {
    const { status } = resolve(
      { kind: 'widget', widgetId: 'invoicing.dashboard.inflows', loaderKey: 'invoicing:inflows:widget' },
      { widgets: [], widgetsReady: false, existingLoaderKeys: ['invoicing:inflows:widget'] },
    )
    expect(status).toBe('loading')
  })

  it('never resolves a widget to ok when no provider is mounted, and warns the developer', () => {
    // Default-deny for the user; loud for whoever forgot the provider. Without
    // the warning this reads as "the widget was deleted", which sends the next
    // person looking in entirely the wrong place.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { item, status } = resolve(
        { kind: 'widget', widgetId: 'invoicing.dashboard.inflows', loaderKey: 'invoicing:inflows:widget' },
        { noProvider: true },
      )
      expect(status).not.toBe('ok')
      expect(status).toBe('unknown')
      expect(item).toBeNull()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ContentRegistryBootstrap'))
    } finally {
      warn.mockRestore()
    }
  })

  it('treats a null ref as unknown rather than throwing', () => {
    const { item, status } = resolve(null, { widgets: [INFLOWS] })
    expect(status).toBe('unknown')
    expect(item).toBeNull()
  })
})
