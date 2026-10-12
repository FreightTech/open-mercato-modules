/**
 * The grid (./model.ts) over the split-view layout document the Pulpit already
 * stores (`SplitLayout`: `root` + `boxes`, spec 2026-09-28-wiw-01). The document,
 * its API, role defaults, resolution and every server test stay as they are; the
 * Pulpit only DRAWS it as Karol's grid (fms-design PR #35, 30.09) and writes the
 * grid back into the same shape.
 *
 *   section        = `root` (the first) or one `boxes[i].root`
 *   section tree   = a `row` split of the columns (one column: the column itself)
 *   column         = a `column` split of its places (one place: the leaf itself)
 *   place          = a pane (a widget of the grid) or an empty slot (a free place)
 *
 * Reading accepts any tree (older layouts, the split-view editor's): the columns
 * are the children of a top `row` split, and a column's places are its leaves in
 * order. More than 6 columns or 3 places spill into new one-column sections.
 *
 * PURE (types only from the split view). Shared by the Pulpit (FMS) and the
 * DynamicTable split view's "Dostosuj widok" — one editor for every layout.
 */

import type { LayoutNode, PaneContentRef, PaneNode, SplitLayout } from '../dynamic-table/split-view/types'

type PaneChrome = NonNullable<PaneNode['chrome']>
import { MAX_COLUMNS, MAX_STACK, cellsOf, normalizeSections, type GridColumns, type GridSection } from './model'

/** One pane of the Pulpit as a grid widget: the pane id is the widget id. */
export type PaneWidget = { id: string; content: PaneContentRef; chrome?: PaneChrome }

export const ROOT_SECTION_ID = 'root'

type Leaf = { kind: 'pane'; id: string; content: PaneContentRef; chrome?: PaneChrome } | { kind: 'empty'; id: string }

function leaves(node: LayoutNode | undefined | null): Leaf[] {
  if (!node) return []
  if (node.kind === 'split') return node.children.flatMap((child) => leaves(child))
  if (node.kind === 'pane') return [{ kind: 'pane', id: node.id, content: node.content, ...(node.chrome ? { chrome: node.chrome } : {}) }]
  return [{ kind: 'empty', id: node.id }]
}

function sectionsOfTree(id: string, root: LayoutNode | undefined | null): GridSection<PaneWidget>[] {
  const columnNodes: LayoutNode[] = !root ? [] : root.kind === 'split' && root.direction === 'row' ? root.children : [root]
  const columns = columnNodes.map((node) => leaves(node))
  const out: GridSection<PaneWidget>[] = []
  const spill: PaneWidget[] = []
  const main = columns.slice(0, MAX_COLUMNS)
  for (const extra of columns.slice(MAX_COLUMNS)) for (const leaf of extra) if (leaf.kind === 'pane') spill.push(toWidget(leaf))
  const widgets: PaneWidget[] = []
  const slots: number[] = []
  const stacks: number[] = []
  main.forEach((places, column) => {
    const panes = places.filter((p): p is Extract<Leaf, { kind: 'pane' }> => p.kind === 'pane')
    panes.slice(0, MAX_STACK).forEach((pane) => {
      widgets.push(toWidget(pane))
      slots.push(column)
    })
    for (const pane of panes.slice(MAX_STACK)) spill.push(toWidget(pane))
    stacks.push(Math.min(MAX_STACK, Math.max(1, places.length)))
  })
  const count = Math.max(1, main.length) as GridColumns
  out.push({ id, columns: count, widgets, slots, ...(stacks.some((n) => n > 1) ? { stacks } : {}) })
  spill.forEach((widget, i) => out.push({ id: `${id}-s${i + 1}`, columns: 1, widgets: [widget], slots: [0] }))
  return out
}

function toWidget(leaf: Extract<Leaf, { kind: 'pane' }>): PaneWidget {
  return { id: leaf.id, content: leaf.content, ...(leaf.chrome ? { chrome: leaf.chrome } : {}) }
}

/** The stored layout → the grid's sections. */
export function gridFromSplit(layout: SplitLayout | null | undefined): GridSection<PaneWidget>[] {
  if (!layout) return []
  const sections = [
    ...sectionsOfTree(ROOT_SECTION_ID, layout.root),
    ...(layout.boxes ?? []).flatMap((box) => sectionsOfTree(box.id, box.root)),
  ]
  // A layout whose only section is one empty slot is an empty Pulpit.
  if (sections.length === 1 && sections[0].widgets.length === 0 && sections[0].columns === 1 && !sections[0].stacks) return []
  return normalizeSections(sections)
}

const equal = (n: number) => Array.from({ length: n }, () => 1 / n)

/**
 * The shares a split already had, when it still has as many children — so
 * applying the editor does not undo the user's divider drags. Otherwise equal.
 */
function sharesOf(prior: LayoutNode | undefined, direction: 'row' | 'column', n: number): number[] {
  if (prior?.kind === 'split' && prior.direction === direction && prior.children.length === n && prior.sizes.length === n) return [...prior.sizes]
  return equal(n)
}

function treeOf(section: GridSection<PaneWidget>, prior?: LayoutNode | null): LayoutNode {
  const cells = cellsOf(section)
  const priorColumns: Array<LayoutNode | undefined> =
    prior?.kind === 'split' && prior.direction === 'row' && prior.children.length === cells.length ? prior.children : cells.length === 1 && prior ? [prior] : []
  const columns: LayoutNode[] = cells.map((cell) => {
    const places: LayoutNode[] = cell.widgets.map((w) => ({ kind: 'pane', id: w.id, content: w.content, ...(w.chrome ? { chrome: w.chrome } : {}) }))
    for (let i = places.length; i < cell.stack; i++) places.push({ kind: 'empty', id: `${section.id}-c${cell.column}-e${i}` })
    return places.length === 1 ? places[0] : { kind: 'split', direction: 'column', sizes: sharesOf(priorColumns[cell.column], 'column', places.length), children: places }
  })
  return columns.length === 1 ? columns[0] : { kind: 'split', direction: 'row', sizes: sharesOf(prior ?? undefined, 'row', columns.length), children: columns }
}

/**
 * The grid → the stored layout. Everything else on `base` (version, workspace
 * criteria, search switches) is kept. No sections = one empty slot (the
 * document always has a root).
 */
export function splitFromGrid(sections: GridSection<PaneWidget>[], base?: SplitLayout | null): SplitLayout {
  const [first, ...rest] = sections
  const priorTree = (id: string) => (id === ROOT_SECTION_ID ? base?.root : base?.boxes?.find((box) => box.id === id)?.root)
  const root: LayoutNode = first ? treeOf(first, priorTree(first.id)) : { kind: 'empty', id: 'pulpit-empty' }
  const { boxes: _boxes, root: _root, ...keep } = base ?? ({} as SplitLayout)
  return {
    ...keep,
    root,
    // The first section is stored as `root` and has no id of its own; a former root moved down gets a fresh one.
    ...(rest.length
      ? { boxes: rest.map((section, i) => ({ id: section.id === ROOT_SECTION_ID ? `section-${Date.now().toString(36)}-${i}` : section.id, root: treeOf(section, priorTree(section.id)) })) }
      : {}),
  }
}
