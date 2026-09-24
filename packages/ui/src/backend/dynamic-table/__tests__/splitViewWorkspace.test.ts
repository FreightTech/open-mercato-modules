/**
 * The workspace operations behind the "Dostosuj" drawer and the workspace bar:
 * adding content wherever it fits, switching grids without losing anything,
 * sections below the main grid, swapping and emptying a slot, and the way
 * back to the default view.
 *
 * Pure functions over the layout document — no React, no storage.
 *
 * Spec: .ai/specs/2026-09-23-split-view-workspace-customize.md (TC-SPLIT-7xx)
 */

import {
  BOX_MAX_SLOTS,
  GRID_TEMPLATES,
  GRID_TEMPLATE_LIST,
  SPLIT_LAYOUT_VERSION,
  addBox,
  addContent,
  applyBoxTemplate,
  applyGridTemplate,
  columnsOf,
  countPanes,
  countSlots,
  emptySlotAt,
  isDefaultLayout,
  layoutSignature,
  listAllPanes,
  listAllSlots,
  normalizeLayout,
  removeBox,
  removePane,
  replaceContent,
  resetLayout,
  resizeAt,
  rowsOf,
  setPaneChrome,
  splitPane,
  tableContent,
  templateOf,
  type LayoutNode,
  type PaneContentRef,
  type PaneNode,
  type SplitLayout,
} from '../split-view/types'

const ANCHOR = 'folders.transport'

const table = (tableId: string): PaneContentRef => tableContent(tableId)
const widget = (widgetId: string): PaneContentRef => ({ kind: 'widget', widgetId, loaderKey: `${widgetId}:loader` })

function single(): SplitLayout {
  return {
    root: { kind: 'pane', id: 'own', content: table(ANCHOR) },
    version: SPLIT_LAYOUT_VERSION,
  }
}

function contentIds(layout: SplitLayout): string[] {
  return listAllPanes(layout).map((pane) =>
    pane.content.kind === 'table' ? pane.content.tableId : pane.content.widgetId,
  )
}

/** A full 2×2: the page's table plus three widgets. */
function fullGrid(): SplitLayout {
  let layout = applyGridTemplate(single(), '2x2', 'own')
  for (const id of ['w1', 'w2', 'w3']) layout = addContent(layout, widget(id)).layout
  return layout
}

describe('TC-SPLIT-700 — the designer’s six grids', () => {
  it('offers exactly the six grids of the drawer, in its order', () => {
    expect(GRID_TEMPLATE_LIST.map((template) => template.id)).toEqual([
      '2x1',
      '1x2',
      '2x2',
      '3-up',
      'one-top-two-below',
      'two-top-one-below',
    ])
  })

  it('each template builds as many slots as it advertises', () => {
    for (const template of GRID_TEMPLATE_LIST) {
      expect(countSlots(template.build())).toBe(template.slots)
    }
  })

  it('recognises the template a tree is in', () => {
    for (const template of GRID_TEMPLATE_LIST) {
      expect(templateOf(template.build())).toBe(template.id)
    }
    expect(templateOf({ kind: 'pane', id: 'x', content: table(ANCHOR) })).toBeNull()
  })

  it('measures rows and columns', () => {
    expect(rowsOf(GRID_TEMPLATES['2x2'].build())).toBe(2)
    expect(columnsOf(GRID_TEMPLATES['2x2'].build())).toBe(2)
    expect(rowsOf(GRID_TEMPLATES['3-up'].build())).toBe(1)
    expect(columnsOf(GRID_TEMPLATES['3-up'].build())).toBe(3)
    expect(rowsOf(GRID_TEMPLATES['one-top-two-below'].build())).toBe(2)
  })
})

describe('TC-SPLIT-701 — "Dodaj widget" puts content wherever it fits', () => {
  it('splits a single page into two columns', () => {
    const { layout, slotId } = addContent(single(), widget('w1'))
    expect(contentIds(layout)).toEqual([ANCHOR, 'w1'])
    expect(layout.root.kind).toBe('split')
    expect(listAllPanes(layout).some((pane) => pane.id === slotId)).toBe(true)
  })

  it('fills the first empty slot, keeping its id', () => {
    const grid = applyGridTemplate(single(), '2x2', 'own')
    const hole = listAllSlots(grid).find((slot) => slot.kind === 'empty')!
    const { layout, slotId } = addContent(grid, widget('w1'))
    expect(slotId).toBe(hole.id)
    expect(countSlots(layout.root)).toBe(4)
    expect(layout.boxes).toBeUndefined()
  })

  it('opens a 2×2 section when the grid is full, with three placeholders beside the new widget', () => {
    const { layout } = addContent(fullGrid(), widget('w4'))
    expect(layout.boxes).toHaveLength(1)
    const box = layout.boxes![0]
    expect(countSlots(box.root)).toBe(BOX_MAX_SLOTS)
    expect(countPanes(box.root)).toBe(1)
    expect(contentIds(layout)).toEqual([ANCHOR, 'w1', 'w2', 'w3', 'w4'])
  })

  it('fills that section’s placeholders next, never a second section', () => {
    let layout = addContent(fullGrid(), widget('w4')).layout
    layout = addContent(layout, widget('w5')).layout
    layout = addContent(layout, widget('w6')).layout
    layout = addContent(layout, widget('w7')).layout
    expect(layout.boxes).toHaveLength(1)
    expect(countPanes(layout.boxes![0].root)).toBe(4)
    // The fifth overflow widget is where a second section begins.
    layout = addContent(layout, widget('w8')).layout
    expect(layout.boxes).toHaveLength(2)
  })

  it('grows a section the user shrank, re-arranging it for the new count', () => {
    let layout = addContent(fullGrid(), widget('w4')).layout
    // The user removes the three placeholders, leaving a one-cell section.
    for (const slot of listAllSlots(layout).filter((s) => s.kind === 'empty')) {
      layout = removePane(layout, slot.id)
    }
    expect(countSlots(layout.boxes![0].root)).toBe(1)
    layout = addContent(layout, widget('w5')).layout
    expect(countSlots(layout.boxes![0].root)).toBe(2)
    expect(templateOf(layout.boxes![0].root)).toBe('2x1')
  })
})

describe('TC-SPLIT-702 — switching grids never deletes a pane', () => {
  it('moves panes that no longer fit into a section', () => {
    const before = fullGrid()
    const after = applyGridTemplate(before, '2x1', 'own')
    expect(countSlots(after.root)).toBe(2)
    expect(contentIds(after).sort()).toEqual(contentIds(before).sort())
    expect(after.boxes).toHaveLength(1)
  })

  it('puts the page’s own table in the first cell, wherever it was', () => {
    // A table added on the LEFT of the page's own one comes first in the tree.
    const layout = splitPane(single(), 'own', table('invoicing.invoice'), 'row', true)
    expect(contentIds(layout)).toEqual(['invoicing.invoice', ANCHOR])
    const after = applyGridTemplate(layout, '2x2', 'own')
    expect((listAllPanes(after)[0] as PaneNode).id).toBe('own')
  })

  it('fills holes in existing sections before opening new ones', () => {
    let layout = addContent(fullGrid(), widget('w4')).layout // section with 3 holes
    layout = applyGridTemplate(layout, '2x1', 'own') // two more panes overflow
    expect(layout.boxes).toHaveLength(1)
    expect(countPanes(layout.boxes![0].root)).toBe(3)
  })

  it('re-shaping a section moves its overflow to the next section', () => {
    let layout = addContent(fullGrid(), widget('w4')).layout
    for (const id of ['w5', 'w6', 'w7']) layout = addContent(layout, widget(id)).layout
    const boxId = layout.boxes![0].id
    const after = applyBoxTemplate(layout, boxId, '2x1')
    expect(countSlots(after.boxes![0].root)).toBe(2)
    expect(contentIds(after).sort()).toEqual(contentIds(layout).sort())
  })
})

describe('TC-SPLIT-703 — swapping and emptying a slot', () => {
  it('"Podmień na…" keeps the slot id and chrome, and drops the old widget’s settings', () => {
    let layout = addContent(single(), { ...widget('w1'), settings: { period: 'month' } } as PaneContentRef).layout
    const slot = listAllPanes(layout).find((pane) => pane.content.kind === 'widget')!
    layout = setPaneChrome(layout, slot.id, { cta: false })
    layout = replaceContent(layout, slot.id, widget('w2'))
    const swapped = listAllPanes(layout).find((pane) => pane.id === slot.id)!
    expect(swapped.content).toEqual(widget('w2'))
    expect(swapped.chrome).toEqual({ cta: false })
  })

  it('"Usuń panel" empties the cell in place', () => {
    const layout = fullGrid()
    const target = listAllPanes(layout)[2]
    const after = emptySlotAt(layout, target.id)
    expect(countSlots(after.root)).toBe(4)
    expect(listAllSlots(after).find((slot) => slot.id === target.id)?.kind).toBe('empty')
  })

  it('works on a pane inside a section too', () => {
    const layout = addContent(fullGrid(), widget('w4')).layout
    const inBox = listAllPanes({ root: layout.boxes![0].root }).at(0)!
    const after = replaceContent(layout, inBox.id, table('invoicing.invoice'))
    expect(contentIds(after)).toContain('invoicing.invoice')
    expect(contentIds(after)).not.toContain('w4')
  })

  it('removing the last slot of a section removes the section', () => {
    let layout = addContent(fullGrid(), widget('w4')).layout
    for (const slot of listAllSlots({ root: layout.boxes![0].root })) {
      layout = removePane(layout, slot.id)
    }
    expect(layout.boxes).toBeUndefined()
  })

  it('resizes a split inside a section without touching the main grid', () => {
    let layout = addContent(fullGrid(), widget('w4')).layout
    const boxId = layout.boxes![0].id
    const root = layout.root
    layout = resizeAt(layout, [0], 0, 0.1, boxId)
    expect(layout.root).toBe(root)
    const row = (layout.boxes![0].root as Extract<LayoutNode, { kind: 'split' }>).children[0] as Extract<
      LayoutNode,
      { kind: 'split' }
    >
    expect(row.sizes[0]).toBeCloseTo(0.6)
  })
})

describe('TC-SPLIT-704 — sections', () => {
  it('addBox opens an empty 2×2 and removeBox drops it', () => {
    const layout = addBox(applyGridTemplate(single(), '2x1', 'own'))
    expect(countSlots(layout.boxes![0].root)).toBe(4)
    expect(countPanes(layout.boxes![0].root)).toBe(0)
    expect(removeBox(layout, layout.boxes![0].id).boxes).toBeUndefined()
  })

  it('normalizeLayout keeps sections and drops unreadable ones', () => {
    const layout = addContent(fullGrid(), widget('w4')).layout
    const stored = JSON.parse(JSON.stringify({ ...layout, boxes: [...layout.boxes!, { id: 'junk', root: { kind: 'nope' } }] }))
    const read = normalizeLayout(stored, ANCHOR)
    expect(read.boxes).toHaveLength(1)
    expect(read.boxes![0]).toEqual(layout.boxes![0])
  })
})

describe('TC-SPLIT-705 — default view and saved-layout identity', () => {
  it('"Widok domyślny" / "Wyczyść układ" returns to the page’s table, keeping its id', () => {
    const layout = addContent(fullGrid(), widget('w4')).layout
    const reset = resetLayout(layout, ANCHOR)
    expect(reset.root).toEqual({ kind: 'pane', id: 'own', content: table(ANCHOR) })
    expect(reset.boxes).toBeUndefined()
    expect(isDefaultLayout(reset, ANCHOR)).toBe(true)
    expect(isDefaultLayout(layout, ANCHOR)).toBe(false)
  })

  it('a layout is still "itself" after a divider drag or a chrome toggle', () => {
    const layout = fullGrid()
    const dragged = resizeAt(layout, [], 0, 0.1)
    const toggled = setPaneChrome(dragged, 'own', { striped: true })
    expect(layoutSignature(toggled)).toBe(layoutSignature(layout))
  })

  it('but not after its content changes', () => {
    const layout = fullGrid()
    const changed = replaceContent(layout, listAllPanes(layout)[1].id, widget('other'))
    expect(layoutSignature(changed)).not.toBe(layoutSignature(layout))
  })
})
