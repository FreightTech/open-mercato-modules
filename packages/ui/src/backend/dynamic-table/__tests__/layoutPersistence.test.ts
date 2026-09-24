/**
 * Working-layout persistence, and the v1 → v2 → v3 migration that keeps it
 * readable.
 *
 * Every case here is a defect that actually shipped and was caught by driving
 * the browser, not by reasoning about the code:
 *
 *   • the split view forgot a four-pane arrangement on reload (no persistence)
 *   • it forgot it AGAIN once persistence existed, because the storage key's
 *     scope segment resolves before the shared uid cache is populated, so
 *     writes landed under `shared` and reads looked under the user id
 *   • a pane whose table the user can no longer open must not be restored as
 *     an unremovable empty box
 *
 * The migration cases carry the same weight: a pane id IS a storage scope, so
 * a migration that mints fresh ids silently discards every column width the
 * user ever dragged.
 *
 * Spec: .ai/specs/2026-08-17-split-view-workspace-composition.md (TC-SPLIT-61x)
 */

import {
  readStoredLayout,
  writeStoredLayout,
  clearStoredLayout,
  SPLIT_LAYOUT_STORAGE_PREFIX,
} from '../split-view/layoutPersistence'
import {
  SPLIT_LAYOUT_VERSION,
  countSlots,
  listSlots,
  tableContent,
  type PaneContentRef,
  type PaneNode,
  type SplitLayout,
  type SplitNode,
} from '../split-view/types'

const UID = 'user-1'
const ANCHOR = 'folders.transport'
const ALL_KNOWN = () => true
const TABLES_ONLY = (content: PaneContentRef) => content.kind === 'table'

function twoPane(): SplitLayout {
  return {
    version: SPLIT_LAYOUT_VERSION,
    root: {
      kind: 'split',
      direction: 'row',
      sizes: [0.3, 0.7],
      children: [
        { kind: 'pane', id: 'p1', content: tableContent('folders.transport') },
        { kind: 'pane', id: 'p2', content: tableContent('invoicing.invoice') },
      ],
    },
  }
}

/** Write a raw document, bypassing the typed writer, to stage an old version. */
function seed(raw: string): void {
  window.localStorage.setItem(`${SPLIT_LAYOUT_STORAGE_PREFIX}:shared:${ANCHOR}`, raw)
}

const asSplit = (layout: SplitLayout): SplitNode => {
  expect(layout.root.kind).toBe('split')
  return layout.root as SplitNode
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('round trip', () => {
  it('restores the tree, the sizes and the pane ids', () => {
    writeStoredLayout(ANCHOR, twoPane())
    const restored = readStoredLayout(ANCHOR, ALL_KNOWN)
    expect(restored).not.toBeNull()
    const root = asSplit(restored!)
    expect(root.sizes).toEqual([0.3, 0.7])
    expect(root.children.map((child) => (child as PaneNode).id)).toEqual(['p1', 'p2'])
    expect(root.children.map((child) => (child as PaneNode).content)).toEqual([
      { kind: 'table', tableId: 'folders.transport' },
      { kind: 'table', tableId: 'invoicing.invoice' },
    ])
  })

  it('keeps per-pane chrome — hiding one pane\'s search must survive a reload', () => {
    const layout = twoPane()
    const root = layout.root as SplitNode
    root.children[0] = { ...(root.children[0] as PaneNode), chrome: { search: false } }
    writeStoredLayout(ANCHOR, layout)

    const restored = readStoredLayout(ANCHOR, ALL_KNOWN)!
    const first = asSplit(restored).children[0] as PaneNode
    expect(first.chrome?.search).toBe(false)
  })

  it('keeps EMPTY slots — a hole the user left in a template is a choice', () => {
    const layout: SplitLayout = {
      version: SPLIT_LAYOUT_VERSION,
      root: {
        kind: 'split',
        direction: 'row',
        sizes: [0.5, 0.5],
        children: [
          { kind: 'pane', id: 'p1', content: tableContent('folders.transport') },
          { kind: 'empty', id: 'e1' },
        ],
      },
    }
    writeStoredLayout(ANCHOR, layout)

    const restored = readStoredLayout(ANCHOR, ALL_KNOWN)!
    expect(countSlots(restored.root)).toBe(2)
    expect(listSlots(restored.root)[1]).toEqual({ kind: 'empty', id: 'e1' })
  })

  it('scopes per anchor table, so two pages do not share an arrangement', () => {
    writeStoredLayout(ANCHOR, twoPane())
    expect(readStoredLayout('invoicing.invoice', ALL_KNOWN)).toBeNull()
  })
})

describe('migration', () => {
  it('TC-SPLIT-610 v1 flat doc → current tree, panes wrapped in content: {kind:"table"}', () => {
    seed(
      JSON.stringify({
        panes: [
          { id: 'legacy-a', tableId: 'folders.transport' },
          { id: 'legacy-b', tableId: 'invoicing.invoice' },
        ],
        sizes: [0.4, 0.6],
        direction: 'column',
      }),
    )

    const restored = readStoredLayout(ANCHOR, ALL_KNOWN)!
    expect(restored.version).toBe(SPLIT_LAYOUT_VERSION)
    const root = asSplit(restored)
    expect(root.direction).toBe('column')
    expect(root.sizes).toEqual([0.4, 0.6])
    expect(root.children).toEqual([
      { kind: 'pane', id: 'legacy-a', content: { kind: 'table', tableId: 'folders.transport' } },
      { kind: 'pane', id: 'legacy-b', content: { kind: 'table', tableId: 'invoicing.invoice' } },
    ])
  })

  it('TC-SPLIT-611 v2 tableId pane → current content ref, pane id preserved', () => {
    seed(
      JSON.stringify({
        version: 2,
        root: {
          kind: 'split',
          direction: 'row',
          sizes: [0.3, 0.7],
          children: [
            { kind: 'pane', id: 'p1', tableId: 'folders.transport', chrome: { viewsBar: false } },
            { kind: 'pane', id: 'p2', tableId: 'invoicing.invoice' },
          ],
        },
      }),
    )

    const restored = readStoredLayout(ANCHOR, ALL_KNOWN)!
    expect(restored.version).toBe(SPLIT_LAYOUT_VERSION)
    const children = asSplit(restored).children as PaneNode[]

    // The id IS the storage scope. Minting new ones here would hand every
    // migrated pane a fresh key and drop the user's saved column widths.
    expect(children.map((child) => child.id)).toEqual(['p1', 'p2'])
    expect(children.map((child) => child.content)).toEqual([
      { kind: 'table', tableId: 'folders.transport' },
      { kind: 'table', tableId: 'invoicing.invoice' },
    ])
    expect(children[0].chrome).toEqual({ viewsBar: false })
    // The v2 field is gone, not carried alongside the v3 one.
    expect('tableId' in children[0]).toBe(false)
  })

  it('TC-SPLIT-612 a current-version doc round-trips byte-identically', () => {
    const raw = JSON.stringify(twoPane().root)
    const doc = `{"root":${raw},"version":${SPLIT_LAYOUT_VERSION}}`
    seed(doc)

    const restored = readStoredLayout(ANCHOR, ALL_KNOWN)!
    expect(JSON.stringify(restored)).toBe(doc)

    // And again through the writer, which is the path a live session takes.
    writeStoredLayout(ANCHOR, restored)
    expect(JSON.stringify(readStoredLayout(ANCHOR, ALL_KNOWN))).toBe(doc)
  })

  it('TC-SPLIT-613 a v3 doc reads as v4 with no sections, tree untouched', () => {
    const raw = JSON.stringify(twoPane().root)
    seed(`{"root":${raw},"version":3}`)

    const restored = readStoredLayout(ANCHOR, ALL_KNOWN)!
    expect(restored.version).toBe(SPLIT_LAYOUT_VERSION)
    expect(JSON.stringify(restored.root)).toBe(raw)
    expect(restored.boxes).toBeUndefined()
  })

  it('TC-SPLIT-614 v4 sections survive a write/read cycle, slot ids and all', () => {
    const layout = {
      ...twoPane(),
      version: SPLIT_LAYOUT_VERSION,
      boxes: [
        {
          id: 'box-1',
          root: {
            kind: 'split' as const,
            direction: 'row' as const,
            sizes: [0.5, 0.5],
            children: [
              { kind: 'pane' as const, id: 'w1', content: { kind: 'widget' as const, widgetId: 'offers.dashboard.unsentOffers', loaderKey: 'offers:unsent' } },
              { kind: 'empty' as const, id: 'hole' },
            ],
          },
        },
      ],
    }
    writeStoredLayout(ANCHOR, layout)
    const restored = readStoredLayout(ANCHOR, ALL_KNOWN)!
    expect(restored.boxes).toEqual(layout.boxes)
  })

  it('refuses a document from a FUTURE version instead of half-parsing it', () => {
    seed(
      JSON.stringify({
        version: SPLIT_LAYOUT_VERSION + 1,
        root: { kind: 'pane', id: 'p1', content: { kind: 'table', tableId: 'folders.transport' } },
        somethingNewWeDoNotUnderstand: true,
      }),
    )

    // `layoutVersion` used to be written and never read; the fallback is the
    // page's own table, never a partially understood tree.
    const restored = readStoredLayout(ANCHOR, ALL_KNOWN)!
    expect((restored.root as PaneNode).id).not.toBe('p1')
    expect((restored.root as PaneNode).content).toEqual({ kind: 'table', tableId: ANCHOR })
  })
})

describe('scope drift — the bug that made persistence look broken', () => {
  it('reads a layout written BEFORE the user id was known', () => {
    // First paint: no uid cached, so the write lands under the fallback scope.
    writeStoredLayout(ANCHOR, twoPane())
    expect(
      window.localStorage.getItem(`${SPLIT_LAYOUT_STORAGE_PREFIX}:shared:${ANCHOR}`),
    ).not.toBeNull()

    // Identity resolves later in the page's life.
    window.localStorage.setItem('fms.dt.uid', UID)

    // Keying only on the "current" scope would miss it and reset the layout.
    expect(readStoredLayout(ANCHOR, ALL_KNOWN)).not.toBeNull()
  })

  it('TC-SPLIT-616 collapses to ONE entry so a stale fallback cannot resurrect an old layout', () => {
    writeStoredLayout(ANCHOR, twoPane())
    window.localStorage.setItem('fms.dt.uid', UID)
    writeStoredLayout(ANCHOR, twoPane())

    const keys = Object.keys(window.localStorage).filter((k) =>
      k.startsWith(SPLIT_LAYOUT_STORAGE_PREFIX),
    )
    expect(keys).toEqual([`${SPLIT_LAYOUT_STORAGE_PREFIX}:${UID}:${ANCHOR}`])
  })
})

describe('content the user may no longer open', () => {
  it('drops an inaccessible pane and lets its sibling absorb the space', () => {
    writeStoredLayout(ANCHOR, twoPane())
    const restored = readStoredLayout(
      ANCHOR,
      (content) => content.kind === 'table' && content.tableId !== 'invoicing.invoice',
    )
    // One survivor is not a split any more.
    expect(restored!.root.kind).toBe('pane')
    expect((restored!.root as PaneNode).content).toEqual({
      kind: 'table',
      tableId: 'folders.transport',
    })
  })

  it('TC-SPLIT-614 drops a widget pane whose widget left the catalogue', () => {
    seed(
      JSON.stringify({
        version: 3,
        root: {
          kind: 'split',
          direction: 'row',
          sizes: [0.5, 0.5],
          children: [
            { kind: 'pane', id: 'p1', content: { kind: 'table', tableId: 'folders.transport' } },
            {
              kind: 'pane',
              id: 'p2',
              content: { kind: 'widget', widgetId: 'ships-map', loaderKey: 'shipment_tracking/ships-map' },
            },
          ],
        },
      }),
    )

    // The catalogue no longer offers that widget — it renders no toolbar, so
    // it would render no menu to close itself with.
    const restored = readStoredLayout(ANCHOR, TABLES_ONLY)!
    expect(restored.root.kind).toBe('pane')
    expect((restored.root as PaneNode).id).toBe('p1')

    // With the widget still in the catalogue, the pane survives intact.
    const kept = readStoredLayout(ANCHOR, ALL_KNOWN)!
    const children = asSplit(kept).children as PaneNode[]
    expect(children[1].content).toEqual({
      kind: 'widget',
      widgetId: 'ships-map',
      loaderKey: 'shipment_tracking/ships-map',
    })
  })

  it('TC-SPLIT-615 returns null when NOTHING resolves, so the caller falls back to the default', () => {
    writeStoredLayout(ANCHOR, twoPane())
    expect(readStoredLayout(ANCHOR, () => false)).toBeNull()

    // A workspace whose every pane died leaves only holes — not worth
    // restoring either, since the page's own table is the better answer.
    seed(
      JSON.stringify({
        version: 3,
        root: {
          kind: 'split',
          direction: 'row',
          sizes: [0.5, 0.5],
          children: [
            { kind: 'pane', id: 'p1', content: { kind: 'table', tableId: 'ghost.removed' } },
            { kind: 'empty', id: 'e1' },
          ],
        },
      }),
    )
    expect(readStoredLayout(ANCHOR, () => false)).toBeNull()
  })
})

describe('shared criteria', () => {
  it('TC-SPLIT-617 sharedCriteria and the toggle survive a write/read cycle', () => {
    const layout: SplitLayout = {
      ...twoPane(),
      sharedFiltersEnabled: true,
      sharedCriteria: {
        search: 'Maersk',
        rules: [{ key: 'customer', operator: 'eq', values: ['c-1'] }],
      },
    }
    writeStoredLayout(ANCHOR, layout)

    const restored = readStoredLayout(ANCHOR, ALL_KNOWN)!
    expect(restored.sharedFiltersEnabled).toBe(true)
    expect(restored.sharedCriteria).toEqual({
      search: 'Maersk',
      rules: [{ key: 'customer', operator: 'eq', values: ['c-1'] }],
    })

    // Absent stays absent — an untouched workspace must not start persisting
    // an empty criteria object that later reads as "shared filtering is on".
    writeStoredLayout(ANCHOR, twoPane())
    const plain = readStoredLayout(ANCHOR, ALL_KNOWN)!
    expect(plain.sharedCriteria).toBeUndefined()
    expect(plain.sharedFiltersEnabled).toBeUndefined()
  })
})

describe('never throws on bad input', () => {
  it('TC-SPLIT-613 corrupt JSON yields null, never a throw', () => {
    seed('{not json')
    expect(() => readStoredLayout(ANCHOR, ALL_KNOWN)).not.toThrow()
    expect(readStoredLayout(ANCHOR, ALL_KNOWN)).toBeNull()

    seed('null')
    expect(readStoredLayout(ANCHOR, ALL_KNOWN)).toBeNull()

    // Structurally valid JSON that is not a layout degrades to the page's own
    // table — the same thing the user would have seen with nothing stored.
    for (const junk of ['[1,2,3]', '{"root":{"kind":"pane","id":"p1"}}', '{"root":42}', '{"panes":[]}']) {
      seed(junk)
      const restored = readStoredLayout(ANCHOR, ALL_KNOWN)
      expect(restored).not.toBeNull()
      expect((restored!.root as PaneNode).content).toEqual({ kind: 'table', tableId: ANCHOR })
    }
  })

  it('returns null when nothing was ever stored', () => {
    expect(readStoredLayout(ANCHOR, ALL_KNOWN)).toBeNull()
  })

  it('clears every scope, not just the current one', () => {
    writeStoredLayout(ANCHOR, twoPane())
    window.localStorage.setItem('fms.dt.uid', UID)
    writeStoredLayout(ANCHOR, twoPane())
    clearStoredLayout(ANCHOR)
    expect(
      Object.keys(window.localStorage).filter((k) => k.startsWith(SPLIT_LAYOUT_STORAGE_PREFIX)),
    ).toEqual([])
  })
})
