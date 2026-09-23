// Split view — a composable workspace: a tree of SLOTS, each holding a table,
// a widget, or nothing yet.
// Specs: .ai/specs/2026-08-04-dynamic-table-split-view.md (the tree)
//        .ai/specs/2026-08-17-split-view-workspace-composition.md (slots + templates)

/** Arrangement axis for one split node. 'row' = side by side, 'column' = stacked. */
export type SplitDirection = 'row' | 'column'

/**
 * Which chrome rows a pane shows. All default ON.
 *
 * Chrome is the scarce resource in a split: a pane used to spend ~150px on a
 * pane header, a toolbar repeating the same title, a views row and pagination
 * before a single data row — multiplied by pane count. These let a user spend
 * that budget where they want it.
 */
export type PaneChrome = {
  /** The whole top strip: title, search and the action buttons. */
  toolbar?: boolean
  search?: boolean
  /**
   * The whole second bar — saved-view tabs AND pagination together.
   *
   * These were separate toggles. Splitting them was a mistake: they share one
   * row, so hiding either alone reclaimed nothing, and the entire point of
   * these switches is vertical space. One toggle, one row, one row's worth of
   * space back.
   */
  viewsBar?: boolean
  /**
   * The saved-view tabs and the pagination, separately.
   *
   * `viewsBar` above still hides the WHOLE row and wins when it is `false` —
   * that is the density switch. These two are the finer ones the table
   * settings panel (⚙) exposes: a user who never pages but lives in saved views
   * turns pagination off and keeps the tabs, and vice versa. When both are off
   * the row goes too, so the space comes back either way.
   */
  tabs?: boolean
  pagination?: boolean
  /** Alternating row fills. Default OFF — a table setting, not a pane one. */
  striped?: boolean
  /**
   * Widget panes only: the footer link that opens the widget's section
   * ("Pokaż wszystko"). Default ON when the widget has somewhere to go.
   * A per-widget choice, because not every widget needs a way out.
   */
  cta?: boolean
}

/**
 * WHAT a pane holds, as opposed to WHERE it sits.
 *
 * Split out of `PaneNode` (which carried a bare `tableId`) so a pane can hold a
 * dashboard widget without a second node kind and without a second breaking
 * change: adding a variant to this union is additive, and every layout
 * algorithm below is written against the union rather than against `tableId`.
 *
 * `loaderKey` is stored alongside `widgetId` because the widget catalogue is
 * fetched at runtime — a saved layout must be resolvable without re-deriving
 * it. Both ids are OPAQUE strings: no FK, no cross-module relation, and ACL is
 * re-checked at render rather than trusted from storage.
 */
export type PaneContentRef =
  | { kind: 'table'; tableId: string }
  | { kind: 'widget'; widgetId: string; loaderKey: string; settings?: unknown }

/** Convenience constructor — the overwhelmingly common case. */
export function tableContent(tableId: string): PaneContentRef {
  return { kind: 'table', tableId }
}

/** The table id a pane shows, or `null` when it holds something else. */
export function paneTableId(node: PaneNode): string | null {
  return node.content.kind === 'table' ? node.content.tableId : null
}

export type PaneNode = {
  kind: 'pane'
  /** Absent = everything shown. */
  chrome?: PaneChrome
  /** Stable per-slot id; also seeds `storageScope`, so two panes of the same
   *  table keep independent perspectives and column widths. Preserved across
   *  every migration — losing it silently discards the user's column widths. */
  id: string
  content: PaneContentRef
}

/**
 * A slot with nothing in it yet.
 *
 * Grid templates are the reason this exists: "give me a 2×2 and let me decide
 * the contents afterwards" is unrepresentable when a pane requires content at
 * creation. The alternative — prompting N times the moment a template is
 * picked — makes the first run modal and forbids "leave that one empty".
 */
export type EmptyNode = { kind: 'empty'; id: string }

export type SplitNode = {
  kind: 'split'
  direction: SplitDirection
  /** Fractions summing to 1, one per child. */
  sizes: number[]
  children: LayoutNode[]
}

export type LayoutNode = PaneNode | EmptyNode | SplitNode

/** A pane or an empty slot — anything that occupies one cell of the layout. */
export type SlotNode = PaneNode | EmptyNode

/**
 * A TREE, not a flat list.
 *
 * v1 was flat — one axis, N panes — and could not express the arrangement users
 * asked for first: two tables side by side with a third full-width beneath.
 * That is a row nested inside a column, and no arrangement of flags on a flat
 * list produces it. The tree is the smallest model that does, and it subsumes
 * the flat cases (one split node with N children IS the old layout).
 *
 * Versions:
 *   1 — flat `{ panes, sizes, direction }`
 *   2 — tree of `{ kind:'pane', tableId }` / `{ kind:'split' }`
 *   3 — tree of `{ kind:'pane', content }` / `{ kind:'empty' }` / `{ kind:'split' }`
 *
 * v1 and v2 documents are migrated on read by `normalizeLayout`, preserving
 * pane ids, so every layout saved before this still opens with its stored
 * column widths intact.
 */
export type SplitLayout = {
  root: LayoutNode
  /**
   * Further SECTIONS below the main grid, each holding at most
   * `BOX_MAX_SLOTS` slots in its own arrangement.
   *
   * They exist so that nothing the user placed is ever thrown away by the
   * shape of the main grid: switching a 2×2 to "two columns" used to DROP the
   * two panes that no longer fitted, and adding a fifth widget to a full 2×2
   * had nowhere to go. Overflow now lands in a section of its own, which the
   * user can re-arrange (its own template) or remove. Absent = none.
   */
  boxes?: WorkspaceBox[]
  version?: number
  /**
   * Workspace-level shared search + rules, and the toggle that arms them.
   *
   * Deliberately OPAQUE here. The closed criterion vocabulary and the
   * per-table mapping are a later phase's business (`sharedCriteria.ts`); this
   * layer only has to carry them through a write/read cycle without dropping
   * them, which is exactly what an opaque field guarantees.
   */
  sharedCriteria?: unknown
  sharedFiltersEnabled?: boolean
}

/** One extra section of the workspace — a small tree of its own. */
export type WorkspaceBox = {
  /** Stable, so React keeps the section's panes mounted across edits. */
  id: string
  root: LayoutNode
}

/** A section holds at most this many slots — the designer's "max four per box". */
export const BOX_MAX_SLOTS = 4

/**
 *   4 — `boxes` (sections below the main grid). A v3 document is a v4 document
 *       with no sections, so it reads unchanged.
 */
export const SPLIT_LAYOUT_VERSION = 4

/** The shape v1 persisted. Kept so saved layouts remain readable. */
export type LegacySplitLayoutV1 = {
  panes: Array<{ id: string; tableId: string }>
  sizes: number[]
  direction?: SplitDirection
}

/**
 * Floor for a pane's width. Below this a grid cannot show a frozen column, one
 * data column and the row-actions gutter, so it would show nothing useful.
 * Paired with the compact toolbar's 520px container-query step.
 */
export const PANE_MIN_WIDTH_PX = 420

/**
 * Floor for a pane's height when stacked. Smaller than the width floor because
 * the constraint differs: a short pane still shows its toolbar and a few rows,
 * whereas a narrow pane cannot show two columns at all.
 */
export const PANE_MIN_HEIGHT_PX = 220

export function makePaneId(): string {
  // Not crypto.randomUUID(): a readable id makes a saved layout debuggable by
  // eye, and this is a client-side key, never a security token.
  return `p${Math.random().toString(36).slice(2, 9)}`
}

export function evenSizes(count: number): number[] {
  if (count <= 0) return []
  return Array.from({ length: count }, () => 1 / count)
}

function normalize(sizes: number[]): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0)
  if (total <= 0) return evenSizes(sizes.length)
  return sizes.map((size) => size / total)
}

/**
 * Re-normalise ONLY when the shares no longer add up — a child was dropped, or
 * the document was hand-written. Normalising unconditionally rewrites a user's
 * divider positions by a float epsilon on every single read.
 */
function normalizeIfNeeded(sizes: number[]): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0)
  return Math.abs(total - 1) > 1e-9 ? normalize(sizes) : sizes
}

// ── Reading ────────────────────────────────────────────────────────────────

function isChrome(value: unknown): value is PaneChrome {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Lift whatever a stored pane carried into a v3 content ref.
 *
 * v2 wrote `tableId` on the pane itself; v3 writes `content`. Both are read
 * here — the v2 branch is the entire reason a four-pane arrangement saved last
 * week still opens today.
 */
function readContent(node: Record<string, unknown>): PaneContentRef | null {
  const content = node.content as Record<string, unknown> | undefined
  if (content && typeof content === 'object') {
    if (content.kind === 'table' && typeof content.tableId === 'string' && content.tableId) {
      return { kind: 'table', tableId: content.tableId }
    }
    if (
      content.kind === 'widget' &&
      typeof content.widgetId === 'string' &&
      content.widgetId &&
      typeof content.loaderKey === 'string' &&
      content.loaderKey
    ) {
      const ref: PaneContentRef = {
        kind: 'widget',
        widgetId: content.widgetId,
        loaderKey: content.loaderKey,
      }
      return 'settings' in content ? { ...ref, settings: content.settings } : ref
    }
    return null
  }
  // v2 and v1: the table id sat directly on the pane.
  if (typeof node.tableId === 'string' && node.tableId) return { kind: 'table', tableId: node.tableId }
  return null
}

/** Parse one stored node into v3, or `null` when it carries nothing usable. */
function readNode(value: unknown): LayoutNode | null {
  if (!value || typeof value !== 'object') return null
  const node = value as Record<string, unknown>

  if (node.kind === 'empty') {
    return { kind: 'empty', id: typeof node.id === 'string' && node.id ? node.id : makePaneId() }
  }

  if (node.kind === 'pane') {
    const content = readContent(node)
    if (!content) return null
    // The pane id seeds `storageScope`. Minting a fresh one here would hand
    // every reload a new key and silently discard the user's column widths —
    // this exact bug has already shipped once.
    const pane: PaneNode = { kind: 'pane', id: typeof node.id === 'string' && node.id ? node.id : makePaneId(), content }
    return isChrome(node.chrome) ? { ...pane, chrome: node.chrome as PaneChrome } : pane
  }

  if (node.kind === 'split') {
    const rawChildren = Array.isArray(node.children) ? node.children : []
    const rawSizes = Array.isArray(node.sizes) ? (node.sizes as unknown[]) : []
    const children: LayoutNode[] = []
    const sizes: number[] = []
    rawChildren.forEach((child, index) => {
      const parsed = readNode(child)
      if (!parsed) return
      children.push(parsed)
      const size = rawSizes[index]
      sizes.push(typeof size === 'number' && size > 0 ? size : 1 / rawChildren.length)
    })
    if (children.length === 0) return null
    // A split with one surviving child is not a split any more; keeping it
    // would accumulate junk nodes across add/remove cycles.
    if (children.length === 1) return children[0]
    return {
      kind: 'split',
      direction: node.direction === 'column' ? 'column' : 'row',
      sizes: normalizeIfNeeded(sizes),
      children,
    }
  }

  return null
}

/** Sections below the main grid. Unreadable ones are dropped, never half-kept. */
function readBoxes(value: unknown): WorkspaceBox[] {
  if (!Array.isArray(value)) return []
  const boxes: WorkspaceBox[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const box = raw as Record<string, unknown>
    const root = readNode(box.root)
    if (!root) continue
    boxes.push({ id: typeof box.id === 'string' && box.id ? box.id : makePaneId(), root })
  }
  return boxes
}

/**
 * Accepts a v3 tree, a v2 tree, a v1 flat document, or junk; always yields a
 * usable tree.
 *
 * The stored `version` is CONSULTED, with shape-sniffing as the fallback. It
 * used to be written, stored and echoed in DTOs but never read — the entity's
 * own comment claimed "an unknown version is ignored on read", which was not
 * what happened. A document from a future version is now treated as unreadable
 * (single default pane) rather than half-parsed.
 */
export function normalizeLayout(input: unknown, fallbackTableId: string): SplitLayout {
  const single = (): SplitLayout => ({
    root: { kind: 'pane', id: makePaneId(), content: tableContent(fallbackTableId) },
    version: SPLIT_LAYOUT_VERSION,
  })
  if (!input || typeof input !== 'object') return single()

  const doc = input as Partial<SplitLayout> & Partial<LegacySplitLayoutV1>
  const version = typeof doc.version === 'number' ? doc.version : null
  if (version !== null && version > SPLIT_LAYOUT_VERSION) return single()

  const carry = (layout: SplitLayout): SplitLayout => {
    const next: SplitLayout = { ...layout, version: SPLIT_LAYOUT_VERSION }
    const boxes = readBoxes(doc.boxes)
    if (boxes.length > 0) next.boxes = boxes
    if (doc.sharedCriteria !== undefined) next.sharedCriteria = doc.sharedCriteria
    if (typeof doc.sharedFiltersEnabled === 'boolean') next.sharedFiltersEnabled = doc.sharedFiltersEnabled
    return next
  }

  // v2 / v3 — a tree. Sniffed as the fallback when `version` is absent, which
  // every document written before the version was read will be.
  if (version === null || version >= 2) {
    const root = readNode(doc.root)
    if (root) return carry({ root })
  }

  // v1 — a flat pane list.
  if (Array.isArray(doc.panes) && doc.panes.length > 0) {
    const children: LayoutNode[] = doc.panes
      .map((pane) => readNode({ ...pane, kind: 'pane' }))
      .filter((node): node is LayoutNode => node !== null)
    if (children.length === 1) return carry({ root: children[0] })
    if (children.length > 1) {
      return carry({
        root: {
          kind: 'split',
          direction: doc.direction === 'column' ? 'column' : 'row',
          sizes:
            Array.isArray(doc.sizes) && doc.sizes.length === children.length
              ? normalizeIfNeeded(doc.sizes)
              : evenSizes(children.length),
          children,
        },
      })
    }
  }
  return single()
}

/**
 * Every PANE in document order. Empty slots are deliberately excluded: every
 * existing caller wants "the tables on screen", and quietly handing them holes
 * would put an id with no content into `openTableIds`, the primary-pane
 * calculation and the arrange presets.
 */
export function listPanes(node: LayoutNode): PaneNode[] {
  if (node.kind === 'pane') return [node]
  if (node.kind === 'empty') return []
  return node.children.flatMap(listPanes)
}

/** Every slot — panes AND empty ones — in document order. */
export function listSlots(node: LayoutNode): SlotNode[] {
  if (node.kind === 'split') return node.children.flatMap(listSlots)
  return [node]
}

export function countPanes(node: LayoutNode): number {
  return listPanes(node).length
}

/** How many cells the layout has, filled or not. */
export function countSlots(node: LayoutNode): number {
  return listSlots(node).length
}

// ── Addressing ─────────────────────────────────────────────────────────────
//
// A node is addressed by its PATH from the root — the child index at each
// level, so [0,1] is "second child of the root's first child". Paths stay valid
// for the duration of a render, which is all a click or a splitter drag needs,
// and they avoid minting ids for interior nodes.

export type NodePath = number[]

export function getNode(root: LayoutNode, path: NodePath): LayoutNode | null {
  let current: LayoutNode = root
  for (const index of path) {
    if (current.kind !== 'split') return null
    const next = current.children[index]
    if (!next) return null
    current = next
  }
  return current
}

function replaceNode(root: LayoutNode, path: NodePath, next: LayoutNode): LayoutNode {
  if (path.length === 0) return next
  if (root.kind !== 'split') return root
  const [head, ...rest] = path
  const children = [...root.children]
  if (!children[head]) return root
  children[head] = replaceNode(children[head], rest, next)
  return { ...root, children }
}

/** Path to a pane OR an empty slot — both are addressed by the same id space. */
function findSlotPath(root: LayoutNode, slotId: string, path: NodePath = []): NodePath | null {
  if (root.kind !== 'split') return root.id === slotId ? path : null
  for (let index = 0; index < root.children.length; index++) {
    const found = findSlotPath(root.children[index], slotId, [...path, index])
    if (found) return found
  }
  return null
}

// ── Mutation ───────────────────────────────────────────────────────────────
//
// Every op below is addressed by SLOT ID and works on whichever tree holds that
// slot — the main grid or one of the sections under it. The layout-level
// wrappers find the tree; the tree-level functions never know sections exist.

/** Every tree in the layout: the main grid first, then each section. */
function trees(layout: SplitLayout): LayoutNode[] {
  return [layout.root, ...(layout.boxes ?? []).map((box) => box.root)]
}

/**
 * Apply `edit` to the tree that holds `slotId`. Returns the layout unchanged
 * when no tree holds it, so a stale click after a concurrent edit is a no-op
 * rather than a corruption.
 */
function editTreeHolding(
  layout: SplitLayout,
  slotId: string,
  edit: (root: LayoutNode, path: NodePath) => LayoutNode,
): SplitLayout {
  const rootPath = findSlotPath(layout.root, slotId)
  if (rootPath) return { ...layout, root: edit(layout.root, rootPath) }
  const boxes = layout.boxes ?? []
  for (let index = 0; index < boxes.length; index++) {
    const path = findSlotPath(boxes[index].root, slotId)
    if (!path) continue
    const next = [...boxes]
    next[index] = { ...boxes[index], root: edit(boxes[index].root, path) }
    return { ...layout, boxes: next }
  }
  return layout
}

/** Every pane across the main grid AND the sections, in reading order. */
export function listAllPanes(layout: SplitLayout): PaneNode[] {
  return trees(layout).flatMap(listPanes)
}

/** Every slot across the main grid AND the sections, in reading order. */
export function listAllSlots(layout: SplitLayout): SlotNode[] {
  return trees(layout).flatMap(listSlots)
}

/** Fill an EMPTY slot in place — same id, same share, siblings untouched. */
export function fillSlot(layout: SplitLayout, slotId: string, content: PaneContentRef): SplitLayout {
  return editTreeHolding(layout, slotId, (root, path) => {
    const node = getNode(root, path)
    if (!node || node.kind !== 'empty') return root
    // The id survives the fill: it is this slot's `storageScope`, so a template
    // slot keeps its column widths if it is emptied and refilled.
    return replaceNode(root, path, { kind: 'pane', id: node.id, content })
  })
}

/**
 * Put different content in a slot — filled or empty — keeping the slot.
 *
 * The designer's "Podmień na…": the cell stays where it is, at the size the
 * user gave it, and only what is in it changes. Widget settings are NOT
 * carried over — they belonged to the previous widget and mean nothing to the
 * next one. Pane chrome is kept, because it describes the CELL (is its header
 * shown), not its content.
 */
export function replaceContent(layout: SplitLayout, slotId: string, content: PaneContentRef): SplitLayout {
  return editTreeHolding(layout, slotId, (root, path) => {
    const node = getNode(root, path)
    if (!node || node.kind === 'split') return root
    const pane: PaneNode = { kind: 'pane', id: node.id, content }
    if (node.kind === 'pane' && node.chrome) pane.chrome = node.chrome
    return replaceNode(root, path, pane)
  })
}

/**
 * Empty a slot without collapsing it — "Usuń panel" in a grid.
 *
 * In a template the CELL is the user's decision and its content a separate
 * one; removing a widget should leave the hole it was in, ready for the next
 * one, rather than silently re-flowing every other pane. Collapsing the cell
 * itself is `removePane`, offered on the empty slot.
 */
export function emptySlotAt(layout: SplitLayout, slotId: string): SplitLayout {
  return editTreeHolding(layout, slotId, (root, path) => {
    const node = getNode(root, path)
    if (!node || node.kind !== 'pane') return root
    return replaceNode(root, path, { kind: 'empty', id: node.id })
  })
}

/**
 * Split `targetSlotId` along `direction`, inserting a pane for `content` after it.
 *
 * The new pane takes half of the TARGET's space, so the rest of the layout does
 * not move — splitting the pane you are looking at should not resize everything
 * else. When the target's parent already runs along `direction` the pane is
 * inserted as a sibling, rather than nesting a redundant split node.
 *
 * An EMPTY target is FILLED rather than split. Nesting a split inside a hole
 * the user asked to fill would turn one 2×2 cell into two half-cells and answer
 * a question nobody asked.
 */
export function splitPane(
  layout: SplitLayout,
  targetSlotId: string,
  content: PaneContentRef,
  direction: SplitDirection,
  /** Insert on the leading side — left of a row, above a column. */
  before = false,
): SplitLayout {
  return editTreeHolding(layout, targetSlotId, (root, path) =>
    splitInTree(root, path, { kind: 'pane', id: makePaneId(), content }, direction, before),
  )
}

function splitInTree(
  root: LayoutNode,
  path: NodePath,
  newPane: PaneNode,
  direction: SplitDirection,
  before: boolean,
): LayoutNode {
  const target = getNode(root, path)
  if (target?.kind === 'empty') {
    return replaceNode(root, path, { ...newPane, id: target.id })
  }

  if (path.length === 0) {
    return {
      kind: 'split',
      direction,
      sizes: [0.5, 0.5],
      children: before ? [newPane, root] : [root, newPane],
    }
  }

  const parentPath = path.slice(0, -1)
  const indexInParent = path[path.length - 1]
  const parent = getNode(root, parentPath)
  if (!parent || parent.kind !== 'split') return root

  if (parent.direction === direction) {
    const children = [...parent.children]
    const sizes = [...parent.sizes]
    const share = sizes[indexInParent] ?? 1 / children.length
    sizes[indexInParent] = share / 2
    const at = before ? indexInParent : indexInParent + 1
    children.splice(at, 0, newPane)
    sizes.splice(at, 0, share / 2)
    return replaceNode(root, parentPath, { ...parent, children, sizes: normalize(sizes) })
  }

  // Different axis — wrap the target in a nested split. THIS is what makes
  // "two side by side, one full-width below" expressible at all.
  const wrapped: SplitNode = {
    kind: 'split',
    direction,
    sizes: [0.5, 0.5],
    children: before ? [newPane, parent.children[indexInParent]] : [parent.children[indexInParent], newPane],
  }
  return replaceNode(root, parentPath.concat(indexInParent), wrapped)
}

/**
 * Remove a slot; its share goes to a sibling, and a split left with one child
 * collapses into that child.
 *
 * Removing the LAST pane of the MAIN grid leaves an empty slot rather than
 * refusing: with templates in play "close this table but keep the cell" is a
 * real intent, and an empty slot is recoverable from the UI whereas a
 * childless split is not representable at all.
 *
 * Removing the last slot of a SECTION removes the section — a section with no
 * cells has nothing to show and no control to fill it from.
 */
export function removePane(layout: SplitLayout, slotId: string): SplitLayout {
  const boxIndex = (layout.boxes ?? []).findIndex((box) => findSlotPath(box.root, slotId) !== null)
  if (boxIndex >= 0) {
    const box = layout.boxes![boxIndex]
    if (box.root.kind !== 'split') return removeBox(layout, box.id)
  }
  return editTreeHolding(layout, slotId, (root, path) => removeInTree(root, path))
}

function removeInTree(root: LayoutNode, path: NodePath): LayoutNode {
  if (path.length === 0) {
    // The root slot. A pane becomes an empty slot; an already-empty root has
    // nothing to remove (the tree must always have a node).
    if (root.kind !== 'pane') return root
    return { kind: 'empty', id: root.id }
  }

  const parentPath = path.slice(0, -1)
  const indexInParent = path[path.length - 1]
  const parent = getNode(root, parentPath)
  if (!parent || parent.kind !== 'split') return root

  const children = parent.children.filter((_, index) => index !== indexInParent)
  const sizes = [...parent.sizes]
  const [freed] = sizes.splice(indexInParent, 1)
  const neighbour = Math.min(indexInParent, sizes.length - 1)
  if (sizes[neighbour] !== undefined) sizes[neighbour] += freed ?? 0

  // A split with one child is meaningless — collapse into that child, empty or
  // not, or the tree accumulates junk nodes with every add/remove cycle.
  const next: LayoutNode =
    children.length === 0
      ? { kind: 'empty', id: makePaneId() }
      : children.length === 1
        ? children[0]
        : { ...parent, children, sizes: normalize(sizes) }
  return replaceNode(root, parentPath, next)
}

/**
 * Resize the boundary between children `index` and `index + 1` of one split
 * node. `boxId` names the section the split lives in; absent = the main grid.
 */
export function resizeAt(
  layout: SplitLayout,
  splitPath: NodePath,
  index: number,
  deltaFraction: number,
  boxId?: string,
): SplitLayout {
  const resize = (root: LayoutNode): LayoutNode => {
    const node = getNode(root, splitPath)
    if (!node || node.kind !== 'split') return root
    const sizes = [...node.sizes]
    if (index < 0 || index >= sizes.length - 1) return root
    const next = sizes[index] + deltaFraction
    const nextSibling = sizes[index + 1] - deltaFraction
    // Guard both sides so a fast drag cannot invert a pane into a negative share.
    // Empty slots clamp exactly like filled ones: a hole you cannot see is a hole
    // you cannot drop anything into.
    if (next <= 0.05 || nextSibling <= 0.05) return root
    sizes[index] = next
    sizes[index + 1] = nextSibling
    return replaceNode(root, splitPath, { ...node, sizes: normalize(sizes) })
  }
  if (!boxId) {
    const root = resize(layout.root)
    return root === layout.root ? layout : { ...layout, root }
  }
  const boxes = layout.boxes ?? []
  const at = boxes.findIndex((box) => box.id === boxId)
  if (at < 0) return layout
  const root = resize(boxes[at].root)
  if (root === boxes[at].root) return layout
  const next = [...boxes]
  next[at] = { ...boxes[at], root }
  return { ...layout, boxes: next }
}

/** Toggle one chrome row on a single pane. */
export function setPaneChrome(
  layout: SplitLayout,
  paneId: string,
  patch: Partial<PaneChrome>,
): SplitLayout {
  return editTreeHolding(layout, paneId, (root, path) => {
    const node = getNode(root, path)
    if (!node || node.kind !== 'pane') return root
    return replaceNode(root, path, { ...node, chrome: { ...node.chrome, ...patch } })
  })
}

/**
 * Store a widget pane's settings on its SLOT.
 *
 * The host owns the layout tree and its persistence, so a widget's settings
 * ride on the slot rather than being written by the pane itself — two writers
 * to one document would race, and the working layout is saved by a single
 * `setLayout` funnel precisely to avoid that.
 *
 * Keyed on the slot, not the widget id, so the same widget in two panes keeps
 * two independent configurations.
 *
 * A no-op on table panes: a table's per-instance state already lives under its
 * `storageScope`, and silently growing a `settings` bag on it would create a
 * second, competing place for the same thing.
 */
export function setPaneContentSettings(
  layout: SplitLayout,
  paneId: string,
  settings: unknown,
): SplitLayout {
  return editTreeHolding(layout, paneId, (root, path) => {
    const node = getNode(root, path)
    if (!node || node.kind !== 'pane' || node.content.kind !== 'widget') return root
    return replaceNode(root, path, { ...node, content: { ...node.content, settings } })
  })
}

/** Turn every chrome row off across the whole layout — the "maximum rows" shortcut. */
export function setAllPaneChrome(node: LayoutNode, chrome: PaneChrome): LayoutNode {
  if (node.kind === 'pane') return { ...node, chrome: { ...node.chrome, ...chrome } }
  if (node.kind === 'empty') return node
  return { ...node, children: node.children.map((child) => setAllPaneChrome(child, chrome)) }
}

/** Reset every split in the tree to equal shares. */
export function evenAll(node: LayoutNode): LayoutNode {
  if (node.kind !== 'split') return node
  return { ...node, sizes: evenSizes(node.children.length), children: node.children.map(evenAll) }
}

// ── Measuring a tree ───────────────────────────────────────────────────────

/** How many cells deep a tree is — a stacked pair is 2, a 2×2 is 2, a row is 1. */
export function rowsOf(node: LayoutNode): number {
  if (node.kind !== 'split') return 1
  const rows = node.children.map(rowsOf)
  return node.direction === 'column' ? rows.reduce((a, b) => a + b, 0) : Math.max(...rows)
}

/** How many cells wide a tree is — a row of three is 3, a 2×2 is 2. */
export function columnsOf(node: LayoutNode): number {
  if (node.kind !== 'split') return 1
  const cols = node.children.map(columnsOf)
  return node.direction === 'row' ? cols.reduce((a, b) => a + b, 0) : Math.max(...cols)
}

// ── Grid templates ─────────────────────────────────────────────────────────
//
// Templates CREATE slots; the arrange presets below RE-SHAPE panes that already
// exist. Two concepts, one menu, two labelled sections — the distinction is
// "how many cells" versus "where the cells go".

/**
 * The six grids of the "Dostosowanie widoku" drawer, in its order.
 *
 * `1+2` is kept readable for anything that still names it (a saved setting, an
 * older test), but it is no longer offered: the designer's set replaced it
 * with "one on top, two below".
 */
export type GridTemplateId =
  | '2x1'
  | '1x2'
  | '2x2'
  | '3-up'
  | 'one-top-two-below'
  | 'two-top-one-below'
  | '1+2'

function emptySlot(): EmptyNode {
  return { kind: 'empty', id: makePaneId() }
}

function splitOf(direction: SplitDirection, children: LayoutNode[]): SplitNode {
  return { kind: 'split', direction, sizes: evenSizes(children.length), children }
}

export type GridTemplate = {
  id: GridTemplateId
  label: string
  hint: string
  /** How many cells the template creates. */
  slots: number
  /** Fresh ids on every call — two instantiations must not share storage scopes. */
  build: () => LayoutNode
}

export const GRID_TEMPLATES: Record<GridTemplateId, GridTemplate> = {
  '2x1': {
    id: '2x1',
    label: 'Two columns',
    hint: 'Side by side',
    slots: 2,
    build: () => splitOf('row', [emptySlot(), emptySlot()]),
  },
  '1x2': {
    id: '1x2',
    label: 'Two rows',
    hint: 'Stacked',
    slots: 2,
    build: () => splitOf('column', [emptySlot(), emptySlot()]),
  },
  '2x2': {
    id: '2x2',
    label: 'Four cells',
    hint: 'Two by two',
    slots: 4,
    build: () =>
      splitOf('column', [
        splitOf('row', [emptySlot(), emptySlot()]),
        splitOf('row', [emptySlot(), emptySlot()]),
      ]),
  },
  '3-up': {
    id: '3-up',
    label: 'Three columns',
    hint: 'All in one row',
    slots: 3,
    build: () => splitOf('row', [emptySlot(), emptySlot(), emptySlot()]),
  },
  'one-top-two-below': {
    id: 'one-top-two-below',
    label: 'One on top, two below',
    hint: 'Full width above, pair beneath',
    slots: 3,
    build: () => splitOf('column', [emptySlot(), splitOf('row', [emptySlot(), emptySlot()])]),
  },
  'two-top-one-below': {
    id: 'two-top-one-below',
    label: 'Two on top, one below',
    hint: 'Pair above, full width beneath',
    slots: 3,
    build: () => splitOf('column', [splitOf('row', [emptySlot(), emptySlot()]), emptySlot()]),
  },
  '1+2': {
    id: '1+2',
    label: 'One left, two right',
    hint: 'Full height beside a stacked pair',
    slots: 3,
    build: () => splitOf('row', [emptySlot(), splitOf('column', [emptySlot(), emptySlot()])]),
  },
}

/** What the drawer and the layout menu offer, in the designer's order. */
export const GRID_TEMPLATE_LIST: GridTemplate[] = (
  ['2x1', '1x2', '2x2', '3-up', 'one-top-two-below', 'two-top-one-below'] as GridTemplateId[]
).map((id) => GRID_TEMPLATES[id])

/**
 * A layout's SHAPE, ignoring what fills it — `p`, `r(p,p)`, `c(p,r(p,p))`.
 *
 * Two layouts with the same signature occupy the same grid, which is exactly
 * what makes a template "the one you are currently in".
 */
export function shapeSignature(node: LayoutNode): string {
  if (node.kind !== 'split') return 'p'
  return `${node.direction === 'row' ? 'r' : 'c'}(${node.children.map(shapeSignature).join(',')})`
}

/** The template whose shape this tree is in, if any. */
export function templateOf(node: LayoutNode): GridTemplateId | null {
  const shape = shapeSignature(node)
  for (const template of GRID_TEMPLATE_LIST) {
    if (shapeSignature(template.build()) === shape) return template.id
  }
  return null
}

/** Pour `panes` into `shape` in order; returns the tree and whatever did not fit. */
function pour(shape: LayoutNode, panes: SlotNode[]): { root: LayoutNode; rest: SlotNode[] } {
  let next = 0
  const fill = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'split') return { ...node, children: node.children.map(fill) }
    const pane = panes[next]
    next += 1
    return pane ? { ...pane } : node
  }
  const root = fill(shape)
  return { root, rest: panes.slice(next) }
}

/** The arrangement a section takes for `count` cells when the user has not chosen one. */
function autoShape(count: number): LayoutNode {
  if (count <= 1) return emptySlot()
  if (count === 2) return GRID_TEMPLATES['2x1'].build()
  if (count === 3) return GRID_TEMPLATES['3-up'].build()
  return GRID_TEMPLATES['2x2'].build()
}

/**
 * Put `panes` into sections, filling holes in the existing ones first and
 * opening new 2×2 sections for the remainder. A new section shows its unused
 * cells as empty slots, so "there is room for more here" is visible without a
 * trip to the drawer.
 */
function placeInBoxes(boxes: WorkspaceBox[], panes: PaneNode[]): WorkspaceBox[] {
  let queue = [...panes]
  const out = boxes.map((box) => {
    if (queue.length === 0) return box
    const fillHoles = (node: LayoutNode): LayoutNode => {
      if (node.kind === 'split') return { ...node, children: node.children.map(fillHoles) }
      if (node.kind === 'empty' && queue.length > 0) {
        const [pane, ...rest] = queue
        queue = rest
        return { ...pane }
      }
      return node
    }
    return { ...box, root: fillHoles(box.root) }
  })
  while (queue.length > 0) {
    const chunk = queue.slice(0, BOX_MAX_SLOTS)
    queue = queue.slice(BOX_MAX_SLOTS)
    out.push({ id: makePaneId(), root: pour(GRID_TEMPLATES['2x2'].build(), chunk).root })
  }
  return out
}

/**
 * Adopt a template's SHAPE, keeping what is already on screen.
 *
 * The existing panes are poured into the template's slots in document order and
 * the remainder stay empty. Discarding them instead would mean picking "2×2"
 * from a page that is showing your table closes your table — the layout-first,
 * fill-after flow only works if choosing a shape is non-destructive.
 *
 * Panes that do NOT fit are no longer dropped: they move to the sections below
 * the grid. The designer's rule is that switching grids never deletes what the
 * user placed. `primaryPaneId` goes first so the page's own table keeps the
 * first, biggest cell — the same promise the drawer's "· główna" label makes.
 */
export function applyGridTemplate(
  layout: SplitLayout,
  templateId: GridTemplateId,
  primaryPaneId?: string,
): SplitLayout {
  const template = GRID_TEMPLATES[templateId]
  if (!template) return layout
  const existing = listPanes(layout.root)
  const ordered = primaryPaneId
    ? [
        ...existing.filter((pane) => pane.id === primaryPaneId),
        ...existing.filter((pane) => pane.id !== primaryPaneId),
      ]
    : existing
  const { root, rest } = pour(template.build(), ordered)
  const boxes = placeInBoxes(layout.boxes ?? [], rest as PaneNode[])
  return withBoxes({ ...layout, root }, boxes)
}

/** Re-shape one SECTION to a template; what no longer fits moves to the next section. */
export function applyBoxTemplate(layout: SplitLayout, boxId: string, templateId: GridTemplateId): SplitLayout {
  const template = GRID_TEMPLATES[templateId]
  const boxes = layout.boxes ?? []
  const at = boxes.findIndex((box) => box.id === boxId)
  if (!template || at < 0) return layout
  const { root, rest } = pour(template.build(), listPanes(boxes[at].root))
  const before = boxes.slice(0, at + 1).map((box, index) => (index === at ? { ...box, root } : box))
  const after = placeInBoxes(boxes.slice(at + 1), rest as PaneNode[])
  return withBoxes(layout, [...before, ...after])
}

/** Drop a whole section, and everything in it. */
export function removeBox(layout: SplitLayout, boxId: string): SplitLayout {
  return withBoxes(layout, (layout.boxes ?? []).filter((box) => box.id !== boxId))
}

function withBoxes(layout: SplitLayout, boxes: WorkspaceBox[]): SplitLayout {
  const next: SplitLayout = { ...layout }
  if (boxes.length > 0) next.boxes = boxes
  else delete next.boxes
  return next
}

/**
 * Place `content` wherever it fits — the "Dodaj widget" button.
 *
 *  1. The first empty slot, main grid first, then the sections.
 *  2. A page still showing one table splits into two columns — the shortest
 *     path from "a page" to "a workspace".
 *  3. The last section, when it has fewer than four cells, grows by one and
 *     re-arranges itself for the new count.
 *  4. Otherwise a new 2×2 section opens with the content in its first cell and
 *     three empty slots beside it, so the next additions have somewhere to go.
 *
 * Returns the id of the slot the content landed in, so the caller can point
 * the user at it.
 */
export function addContent(
  layout: SplitLayout,
  content: PaneContentRef,
): { layout: SplitLayout; slotId: string } {
  const hole = listAllSlots(layout).find((slot) => slot.kind === 'empty')
  if (hole) return { layout: fillSlot(layout, hole.id, content), slotId: hole.id }

  const pane: PaneNode = { kind: 'pane', id: makePaneId(), content }

  if (layout.root.kind === 'pane' && !(layout.boxes?.length)) {
    return {
      layout: { ...layout, root: splitOf('row', [layout.root, pane]) },
      slotId: pane.id,
    }
  }

  const boxes = layout.boxes ?? []
  const last = boxes[boxes.length - 1]
  if (last && countSlots(last.root) < BOX_MAX_SLOTS) {
    const panes = [...listPanes(last.root), pane]
    const root = pour(autoShape(panes.length), panes).root
    return { layout: withBoxes(layout, [...boxes.slice(0, -1), { ...last, root }]), slotId: pane.id }
  }

  const root = pour(GRID_TEMPLATES['2x2'].build(), [pane]).root
  return { layout: withBoxes(layout, [...boxes, { id: makePaneId(), root }]), slotId: pane.id }
}

/** Open an EMPTY section (2×2 of holes) — "Dodaj sekcję" in the drawer. */
export function addBox(layout: SplitLayout): SplitLayout {
  return withBoxes(layout, [...(layout.boxes ?? []), { id: makePaneId(), root: GRID_TEMPLATES['2x2'].build() }])
}

/**
 * Back to the page on its own — "Wyczyść układ" and "Widok domyślny".
 *
 * The page's own table keeps its pane id (and with it the unscoped storage
 * keys), so column widths and the last-used view survive the reset. Shared
 * criteria are cleared too: a single table has no workspace to share them with.
 */
export function resetLayout(layout: SplitLayout, primaryTableId: string): SplitLayout {
  const own = listAllPanes(layout).find(
    (pane) => pane.content.kind === 'table' && pane.content.tableId === primaryTableId,
  )
  return {
    root: {
      kind: 'pane',
      id: own?.id ?? makePaneId(),
      content: tableContent(primaryTableId),
      ...(own?.chrome ? { chrome: own.chrome } : {}),
    },
    version: SPLIT_LAYOUT_VERSION,
  }
}

/** True when the layout is the page's table alone — the default view. */
export function isDefaultLayout(layout: SplitLayout, primaryTableId: string): boolean {
  return (
    !(layout.boxes?.length) &&
    layout.root.kind === 'pane' &&
    layout.root.content.kind === 'table' &&
    layout.root.content.tableId === primaryTableId
  )
}

/**
 * What a layout IS, for "which saved layout am I looking at": shape and
 * content, ignoring slot ids, divider positions, chrome and widget settings —
 * dragging a divider does not make a saved layout stop being itself.
 */
export function layoutSignature(layout: SplitLayout): string {
  const sig = (node: LayoutNode): string => {
    if (node.kind === 'empty') return '_'
    if (node.kind === 'pane') {
      return node.content.kind === 'table' ? `t:${node.content.tableId}` : `w:${node.content.widgetId}`
    }
    return `${node.direction === 'row' ? 'r' : 'c'}(${node.children.map(sig).join(',')})`
  }
  return trees(layout).map(sig).join('|')
}

// ── Presets ────────────────────────────────────────────────────────────────

export type PresetId = 'columns' | 'rows' | 'two-top-one-below' | 'one-top-two-below' | 'grid'

/**
 * Re-arrange the EXISTING panes into a named shape, preserving their order.
 *
 * Empty slots are dropped: a preset is a statement about the tables you have
 * open, and carrying holes through it would produce shapes ("two on top, one
 * below" where one of the three is a hole) the user did not ask for.
 */
export function applyPreset(layout: SplitLayout, preset: PresetId): SplitLayout {
  const panes = listPanes(layout.root)
  if (panes.length === 0) return layout
  if (panes.length === 1) return { ...layout, root: panes[0] }

  const row = (children: LayoutNode[]): SplitNode => ({
    kind: 'split',
    direction: 'row',
    sizes: evenSizes(children.length),
    children,
  })

  switch (preset) {
    case 'columns':
      return { ...layout, root: row(panes) }
    case 'rows':
      return {
        ...layout,
        root: { kind: 'split', direction: 'column', sizes: evenSizes(panes.length), children: panes },
      }
    case 'two-top-one-below': {
      // Two side by side, the rest full-width beneath — the arrangement the flat
      // model could not express.
      if (panes.length < 3) return { ...layout, root: row(panes) }
      const top = row(panes.slice(0, 2))
      const below = panes.slice(2)
      const bottom: LayoutNode = below.length === 1 ? below[0] : row(below)
      return {
        ...layout,
        root: { kind: 'split', direction: 'column', sizes: [0.5, 0.5], children: [top, bottom] },
      }
    }
    case 'one-top-two-below': {
      if (panes.length < 3) return { ...layout, root: row(panes) }
      return {
        ...layout,
        root: {
          kind: 'split',
          direction: 'column',
          sizes: [0.5, 0.5],
          children: [panes[0], row(panes.slice(1))],
        },
      }
    }
    case 'grid': {
      const pairs: LayoutNode[] = []
      for (let index = 0; index < panes.length; index += 2) {
        const pair = panes.slice(index, index + 2)
        pairs.push(pair.length === 1 ? pair[0] : row(pair))
      }
      return {
        ...layout,
        root: { kind: 'split', direction: 'column', sizes: evenSizes(pairs.length), children: pairs },
      }
    }
    default:
      return layout
  }
}

export const ARRANGE_PRESETS: Array<{
  id: PresetId
  label: string
  hint: string
  /** Minimum panes for the shape to differ from a plain row. */
  minPanes: number
}> = [
  { id: 'columns', label: 'Side by side', hint: 'All in one row', minPanes: 2 },
  { id: 'rows', label: 'Stacked', hint: 'All in one column', minPanes: 2 },
  { id: 'two-top-one-below', label: 'Two on top, one below', hint: 'Pair above, full width beneath', minPanes: 3 },
  { id: 'one-top-two-below', label: 'One on top, two below', hint: 'Full width above, pair beneath', minPanes: 3 },
  { id: 'grid', label: 'Grid', hint: 'Two per row', minPanes: 4 },
]
