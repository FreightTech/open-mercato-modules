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

export const SPLIT_LAYOUT_VERSION = 3

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

/** Fill an EMPTY slot in place — same id, same share, siblings untouched. */
export function fillSlot(layout: SplitLayout, slotId: string, content: PaneContentRef): SplitLayout {
  const path = findSlotPath(layout.root, slotId)
  if (!path) return layout
  const node = getNode(layout.root, path)
  if (!node || node.kind !== 'empty') return layout
  // The id survives the fill: it is this slot's `storageScope`, so a template
  // slot keeps its column widths if it is emptied and refilled.
  const pane: PaneNode = { kind: 'pane', id: node.id, content }
  return { ...layout, root: replaceNode(layout.root, path, pane) }
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
  const path = findSlotPath(layout.root, targetSlotId)
  if (!path) return layout

  const target = getNode(layout.root, path)
  if (target?.kind === 'empty') return fillSlot(layout, targetSlotId, content)

  const newPane: PaneNode = { kind: 'pane', id: makePaneId(), content }

  if (path.length === 0) {
    return {
      ...layout,
      root: {
        kind: 'split',
        direction,
        sizes: [0.5, 0.5],
        children: before ? [newPane, layout.root] : [layout.root, newPane],
      },
    }
  }

  const parentPath = path.slice(0, -1)
  const indexInParent = path[path.length - 1]
  const parent = getNode(layout.root, parentPath)
  if (!parent || parent.kind !== 'split') return layout

  if (parent.direction === direction) {
    const children = [...parent.children]
    const sizes = [...parent.sizes]
    const share = sizes[indexInParent] ?? 1 / children.length
    sizes[indexInParent] = share / 2
    const at = before ? indexInParent : indexInParent + 1
    children.splice(at, 0, newPane)
    sizes.splice(at, 0, share / 2)
    return {
      ...layout,
      root: replaceNode(layout.root, parentPath, { ...parent, children, sizes: normalize(sizes) }),
    }
  }

  // Different axis — wrap the target in a nested split. THIS is what makes
  // "two side by side, one full-width below" expressible at all.
  const wrapped: SplitNode = {
    kind: 'split',
    direction,
    sizes: [0.5, 0.5],
    children: before ? [newPane, parent.children[indexInParent]] : [parent.children[indexInParent], newPane],
  }
  return { ...layout, root: replaceNode(layout.root, parentPath.concat(indexInParent), wrapped) }
}

/**
 * Remove a slot; its share goes to a sibling, and a split left with one child
 * collapses into that child.
 *
 * Removing the LAST pane leaves an empty slot rather than refusing: with
 * templates in play "close this table but keep the cell" is a real intent, and
 * an empty slot is recoverable from the UI whereas a childless split is not
 * representable at all.
 */
export function removePane(layout: SplitLayout, slotId: string): SplitLayout {
  const path = findSlotPath(layout.root, slotId)
  if (!path) return layout

  if (path.length === 0) {
    // The root slot. A pane becomes an empty slot; an already-empty root has
    // nothing to remove (the tree must always have a node).
    if (layout.root.kind !== 'pane') return layout
    return { ...layout, root: { kind: 'empty', id: layout.root.id } }
  }

  const parentPath = path.slice(0, -1)
  const indexInParent = path[path.length - 1]
  const parent = getNode(layout.root, parentPath)
  if (!parent || parent.kind !== 'split') return layout

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
  return { ...layout, root: replaceNode(layout.root, parentPath, next) }
}

/** Resize the boundary between children `index` and `index + 1` of one split node. */
export function resizeAt(
  layout: SplitLayout,
  splitPath: NodePath,
  index: number,
  deltaFraction: number,
): SplitLayout {
  const node = getNode(layout.root, splitPath)
  if (!node || node.kind !== 'split') return layout
  const sizes = [...node.sizes]
  if (index < 0 || index >= sizes.length - 1) return layout
  const next = sizes[index] + deltaFraction
  const nextSibling = sizes[index + 1] - deltaFraction
  // Guard both sides so a fast drag cannot invert a pane into a negative share.
  // Empty slots clamp exactly like filled ones: a hole you cannot see is a hole
  // you cannot drop anything into.
  if (next <= 0.05 || nextSibling <= 0.05) return layout
  sizes[index] = next
  sizes[index + 1] = nextSibling
  return {
    ...layout,
    root: replaceNode(layout.root, splitPath, { ...node, sizes: normalize(sizes) }),
  }
}

/** Toggle one chrome row on a single pane. */
export function setPaneChrome(
  layout: SplitLayout,
  paneId: string,
  patch: Partial<PaneChrome>,
): SplitLayout {
  const path = findSlotPath(layout.root, paneId)
  if (!path) return layout
  const node = getNode(layout.root, path)
  if (!node || node.kind !== 'pane') return layout
  const next: PaneNode = { ...node, chrome: { ...node.chrome, ...patch } }
  return { ...layout, root: replaceNode(layout.root, path, next) }
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
  const path = findSlotPath(layout.root, paneId)
  if (!path) return layout
  const node = getNode(layout.root, path)
  if (!node || node.kind !== 'pane' || node.content.kind !== 'widget') return layout
  const next: PaneNode = { ...node, content: { ...node.content, settings } }
  return { ...layout, root: replaceNode(layout.root, path, next) }
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

// ── Grid templates ─────────────────────────────────────────────────────────
//
// Templates CREATE slots; the arrange presets below RE-SHAPE panes that already
// exist. Two concepts, one menu, two labelled sections — the distinction is
// "how many cells" versus "where the cells go".

export type GridTemplateId = '2x1' | '1x2' | '2x2' | '3-up' | 'two-top-one-below' | '1+2'

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

export const GRID_TEMPLATE_LIST: GridTemplate[] = Object.values(GRID_TEMPLATES)

/**
 * Adopt a template's SHAPE, keeping what is already on screen.
 *
 * The existing panes are poured into the template's slots in document order and
 * the remainder stay empty. Discarding them instead would mean picking "2×2"
 * from a page that is showing your table closes your table — the layout-first,
 * fill-after flow only works if choosing a shape is non-destructive.
 *
 * Panes beyond the template's slot count are dropped: the user asked for that
 * many cells.
 */
export function applyGridTemplate(layout: SplitLayout, templateId: GridTemplateId): SplitLayout {
  const template = GRID_TEMPLATES[templateId]
  if (!template) return layout
  const existing = listPanes(layout.root)
  let next = 0
  const fill = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'split') return { ...node, children: node.children.map(fill) }
    const pane = existing[next]
    next += 1
    return pane ? { ...pane } : node
  }
  return { ...layout, root: fill(template.build()) }
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
