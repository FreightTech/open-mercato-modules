/**
 * Layout algebra with EMPTY slots present.
 *
 * The tree stopped being "panes and splits" the moment grid templates arrived:
 * a template is a shape full of holes, and every operation below has to stay
 * correct while a hole is one of the operands. These pin the cases where the
 * old code would have produced a childless split, a redundant nested split, or
 * an empty node leaking into a caller that only ever wanted tables.
 *
 * Spec: .ai/specs/2026-08-17-split-view-workspace-composition.md (TC-SPLIT-60x)
 */

import {
  GRID_TEMPLATES,
  applyPreset,
  countPanes,
  countSlots,
  fillSlot,
  listPanes,
  listSlots,
  removePane,
  resizeAt,
  splitPane,
  tableContent,
  type EmptyNode,
  type LayoutNode,
  type PaneNode,
  type SplitLayout,
  type SplitNode,
} from '../split-view/types'

const asSplit = (node: LayoutNode): SplitNode => {
  expect(node.kind).toBe('split')
  return node as SplitNode
}

const empty = (id: string): EmptyNode => ({ kind: 'empty', id })
const pane = (id: string, tableId: string): PaneNode => ({
  kind: 'pane',
  id,
  content: tableContent(tableId),
})

/** row [ pane p1, empty e1 ] */
function paneAndHole(): SplitLayout {
  return {
    version: 3,
    root: {
      kind: 'split',
      direction: 'row',
      sizes: [0.6, 0.4],
      children: [pane('p1', 'folders.transport'), empty('e1')],
    },
  }
}

/** Every size at every level, top-down. */
function allSizes(node: LayoutNode): number[][] {
  if (node.kind !== 'split') return []
  return [node.sizes, ...node.children.flatMap(allSizes)]
}

describe('grid templates', () => {
  it('TC-SPLIT-600 GRID_TEMPLATES["2x2"] yields 4 empty nodes, sizes summing to 1 at every level', () => {
    const root = GRID_TEMPLATES['2x2'].build()

    const slots = listSlots(root)
    expect(slots).toHaveLength(4)
    expect(slots.every((slot) => slot.kind === 'empty')).toBe(true)
    expect(countPanes(root)).toBe(0)
    expect(countSlots(root)).toBe(4)

    for (const sizes of allSizes(root)) {
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1, 10)
    }

    // Every slot needs its OWN id — two cells sharing one would share a
    // storage scope, and with it the user's column widths.
    const ids = new Set(slots.map((slot) => slot.id))
    expect(ids.size).toBe(4)

    // A template must mint fresh ids per instantiation, not hand out a shared
    // frozen tree.
    const second = listSlots(GRID_TEMPLATES['2x2'].build()).map((slot) => slot.id)
    expect(second.some((id) => ids.has(id))).toBe(false)

    // Every declared template agrees with what it actually builds.
    for (const template of Object.values(GRID_TEMPLATES)) {
      expect(countSlots(template.build())).toBe(template.slots)
    }
  })

  it('TC-SPLIT-601 filling one empty slot replaces that node in place, siblings sizes unchanged', () => {
    const layout: SplitLayout = { version: 3, root: GRID_TEMPLATES['2x2'].build() }
    const target = listSlots(layout.root)[2]
    const before = allSizes(layout.root)

    const next = fillSlot(layout, target.id, tableContent('invoicing.invoice'))

    const slots = listSlots(next.root)
    expect(slots).toHaveLength(4)
    expect(countPanes(next.root)).toBe(1)
    // Same position, same id — the slot was filled, not replaced by a new one.
    expect(slots[2].kind).toBe('pane')
    expect(slots[2].id).toBe(target.id)
    expect((slots[2] as PaneNode).content).toEqual({ kind: 'table', tableId: 'invoicing.invoice' })
    expect(slots.filter((slot) => slot.kind === 'empty')).toHaveLength(3)
    expect(allSizes(next.root)).toEqual(before)
  })
})

describe('slot-aware traversal', () => {
  it('TC-SPLIT-602 listPanes excludes empty nodes; countSlots includes them', () => {
    const layout = paneAndHole()

    expect(listPanes(layout.root).map((node) => node.id)).toEqual(['p1'])
    expect(countPanes(layout.root)).toBe(1)
    expect(listSlots(layout.root).map((node) => node.id)).toEqual(['p1', 'e1'])
    expect(countSlots(layout.root)).toBe(2)

    // A bare empty root counts as a slot but not as a pane.
    expect(countPanes(empty('solo'))).toBe(0)
    expect(countSlots(empty('solo'))).toBe(1)
  })
})

describe('removal', () => {
  it('TC-SPLIT-603 removePane on the last non-empty pane leaves an empty slot, never a childless split', () => {
    const next = removePane(paneAndHole(), 'p1')

    // [pane, empty] minus the pane is a one-child split — which collapses.
    expect(next.root.kind).toBe('empty')
    expect(countPanes(next.root)).toBe(0)
    expect(countSlots(next.root)).toBe(1)

    // The same holds for a single-pane layout: the cell survives, the content
    // does not, so there is always something to add back into.
    const solo: SplitLayout = { version: 3, root: pane('only', 'folders.transport') }
    const emptied = removePane(solo, 'only')
    expect(emptied.root).toEqual({ kind: 'empty', id: 'only' })
  })

  it('TC-SPLIT-604 removing a child collapses a one-child split, empty or not', () => {
    // Empty survivor.
    const withHole: SplitLayout = {
      version: 3,
      root: {
        kind: 'split',
        direction: 'column',
        sizes: [0.5, 0.5],
        children: [
          { kind: 'split', direction: 'row', sizes: [0.5, 0.5], children: [pane('p1', 't1'), empty('e1')] },
          pane('p2', 't2'),
        ],
      },
    }
    const collapsed = asSplit(removePane(withHole, 'p1').root)
    expect(collapsed.children[0]).toEqual(empty('e1'))
    expect(collapsed.children).toHaveLength(2)

    // Pane survivor — and the freed share goes to it, not into thin air.
    const twoPanes: SplitLayout = {
      version: 3,
      root: {
        kind: 'split',
        direction: 'row',
        sizes: [0.3, 0.7],
        children: [pane('p1', 't1'), pane('p2', 't2')],
      },
    }
    const single = removePane(twoPanes, 'p1')
    expect(single.root).toEqual(pane('p2', 't2'))

    // Removing the EMPTY one deletes the cell outright; nothing is left behind.
    const holeGone = removePane(paneAndHole(), 'e1')
    expect(holeGone.root).toEqual(pane('p1', 'folders.transport'))
  })
})

describe('splitting', () => {
  it('TC-SPLIT-605 splitPane on an empty node fills it instead of nesting a redundant split', () => {
    const layout = paneAndHole()

    // A column split of a row's empty child would nest — unless the target is
    // a hole, in which case the answer is simply "put it there".
    const next = splitPane(layout, 'e1', tableContent('products.product'), 'column', false)

    const root = asSplit(next.root)
    expect(root.children).toHaveLength(2)
    expect(root.sizes).toEqual([0.6, 0.4])
    expect(root.children[1]).toEqual(pane('e1', 'products.product'))
    expect(countSlots(next.root)).toBe(2)

    // The `before` flag is meaningless when filling and must not change the
    // outcome or reorder siblings.
    const leading = splitPane(layout, 'e1', tableContent('products.product'), 'row', true)
    expect(asSplit(leading.root).children[1]).toEqual(pane('e1', 'products.product'))

    // A PANE target still splits, so the ordinary path is untouched.
    const split = splitPane(layout, 'p1', tableContent('products.product'), 'column', false)
    expect(countSlots(split.root)).toBe(3)
    expect(asSplit(asSplit(split.root).children[0]).direction).toBe('column')
  })
})

describe('resizing', () => {
  it('TC-SPLIT-606 resizeAt still clamps at 0.05 with empty siblings present', () => {
    const layout = paneAndHole()

    // Ordinary drag: the boundary moves and the pair still sums to 1.
    const moved = asSplit(resizeAt(layout, [], 0, 0.1).root)
    expect(moved.sizes[0]).toBeCloseTo(0.7, 10)
    expect(moved.sizes[1]).toBeCloseTo(0.3, 10)

    // Dragging the EMPTY slot below the floor is refused, not clamped-to-zero:
    // a hole you cannot see is a hole you cannot drop anything into.
    expect(resizeAt(layout, [], 0, 0.36)).toBe(layout)
    // …and the same on the pane's side.
    expect(resizeAt(layout, [], 0, -0.56)).toBe(layout)

    // Just under the floor is refused; just over it is honoured. (Not tested
    // exactly AT 0.05: `0.4 - 0.35` is 0.05000000000000004 in binary floating
    // point, so "exactly" is not a state a drag can reach.)
    expect(resizeAt(layout, [], 0, 0.3501)).toBe(layout)
    expect(asSplit(resizeAt(layout, [], 0, 0.3499).root).sizes[1]).toBeCloseTo(0.0501, 10)
  })
})

describe('presets', () => {
  it('TC-SPLIT-607 applyPreset preserves content order and drops trailing empties', () => {
    const layout: SplitLayout = {
      version: 3,
      root: {
        kind: 'split',
        direction: 'column',
        sizes: [0.5, 0.5],
        children: [
          { kind: 'split', direction: 'row', sizes: [0.5, 0.5], children: [pane('p1', 't1'), pane('p2', 't2')] },
          { kind: 'split', direction: 'row', sizes: [0.5, 0.5], children: [pane('p3', 't3'), empty('e1')] },
        ],
      },
    }

    const next = applyPreset(layout, 'columns')
    const root = asSplit(next.root)
    expect(root.direction).toBe('row')
    expect(root.children.map((child) => (child as PaneNode).id)).toEqual(['p1', 'p2', 'p3'])
    expect(countSlots(next.root)).toBe(3)
    expect(listSlots(next.root).some((slot) => slot.kind === 'empty')).toBe(false)
    expect(root.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1, 10)

    // Three panes reach the shape the flat model could not express, and the
    // dropped hole does not take a slot in it.
    const stacked = asSplit(applyPreset(layout, 'two-top-one-below').root)
    expect(stacked.direction).toBe('column')
    expect(asSplit(stacked.children[0]).children.map((c) => (c as PaneNode).id)).toEqual(['p1', 'p2'])
    expect(stacked.children[1]).toEqual(pane('p3', 't3'))

    // An all-empty template has no content to arrange — leave it alone rather
    // than collapsing the user's grid to nothing.
    const holesOnly: SplitLayout = { version: 3, root: GRID_TEMPLATES['2x2'].build() }
    expect(applyPreset(holesOnly, 'columns')).toBe(holesOnly)
  })
})

/**
 * TC-SPLIT-620 — the PRIMARY pane is chosen by IDENTITY, never by position.
 *
 * `TablePaneBody` gives the primary pane the UNSCOPED storage keys, so whichever
 * pane wins that title owns the page's saved column widths and last-used view.
 * The host used to pick `panes[0]` — document order — but `splitPane(…, before)`
 * inserts the new pane FIRST, and both "Left" and "Above" pass `before: true`.
 * Adding a table to the left of the page's own table therefore handed the
 * unscoped keys to the newcomer (which then wrote over the standalone page's
 * keys for that table) and demoted the page's own table to a `pane:<id>:` scope,
 * silently discarding the widths the user had saved. Closing the pane flipped it
 * back mid-session.
 *
 * This pins the rule the host now implements.
 */
function primaryPaneId(layout: SplitLayout, anchorTableId: string): string | undefined {
  const panes = listPanes(layout.root)
  const own = panes.find(
    (p) => p.content.kind === 'table' && p.content.tableId === anchorTableId,
  )
  return (own ?? panes[0])?.id
}

describe('primary pane selection (TC-SPLIT-620)', () => {
  const ANCHOR = 'offers.offer'

  it('keeps the page table primary when a pane is added BEFORE it', () => {
    const solo: SplitLayout = { version: 3, root: pane('own', ANCHOR) }
    expect(primaryPaneId(solo, ANCHOR)).toBe('own')

    const added = splitPane(solo, 'own', tableContent('contractors.contractor'), 'row', true)
    const panes = listPanes(added.root)

    // Document order really does put the newcomer first — this is the trap.
    expect(panes[0].content).toEqual(tableContent('contractors.contractor'))
    expect(panes[0].id).not.toBe('own')

    // …and identity still says the page's own table.
    expect(primaryPaneId(added, ANCHOR)).toBe('own')
  })

  it('is stable across adding and then closing a leading pane', () => {
    const solo: SplitLayout = { version: 3, root: pane('own', ANCHOR) }
    const added = splitPane(solo, 'own', tableContent('products.product'), 'row', true)
    const leading = listPanes(added.root)[0].id

    expect(primaryPaneId(added, ANCHOR)).toBe('own')
    expect(primaryPaneId(removePane(added, leading), ANCHOR)).toBe('own')
  })

  it('falls back to document order when the page table is not in the layout', () => {
    const solo: SplitLayout = { version: 3, root: pane('own', ANCHOR) }
    const added = splitPane(solo, 'own', tableContent('files.file'), 'row', true)
    const without = removePane(added, 'own')

    expect(listPanes(without.root)).toHaveLength(1)
    expect(primaryPaneId(without, ANCHOR)).toBe(listPanes(without.root)[0].id)
  })
})
