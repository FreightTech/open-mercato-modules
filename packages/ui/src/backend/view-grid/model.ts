/**
 * The view grid — a pure model shared by every configurable screen (the Pulpit,
 * the contractor's views; the teczka next). Port of fms-design PR #35
 * `composite/GridLayout/model.ts` (Karol, 30.09; call 30.09 "Kastomizowany pulpit").
 *
 * A view is sections one under another. A section is ONE row of 1–6 equal
 * columns (slots). A slot can be split vertically into 2–3 places (next to a tall
 * table, two small widgets one under the other). More widgets = another section.
 *
 * The model does not know widget types — it needs an `id` only. A widget's place
 * is `slots[i]` (the column of `widgets[i]`); the order inside a column is the
 * order in `widgets`. A missing or bad `slots` puts widgets into free places in
 * order (so older documents still open).
 *
 * A section with `sizes` is a FREE GRID instead (spec 2026-10-07-grid-widget-spans):
 * its widgets flow in order through the columns, each `w` columns wide and `h` rows
 * tall (absent = 1 × 1) — "the second widget two columns and two rows". `slots` and
 * `stacks` do not apply there. A section without `sizes` is the slot grid above.
 *
 * PURE: no React, no ORM — the API, the client and jest all use it.
 */

export type GridColumns = 1 | 2 | 3 | 4 | 5 | 6
export const GRID_COLUMNS: readonly GridColumns[] = [1, 2, 3, 4, 5, 6]
export const MAX_COLUMNS = 6
export const MAX_STACK = 3
/** How many rows a widget of a free grid may span. */
export const MAX_ROWS = 4

/** A widget's span in a free grid: `w` columns × `h` rows. */
export type GridSize = { w: number; h: number }

export type GridSection<W extends { id: string }> = {
  id: string
  columns: GridColumns
  widgets: W[]
  /** The column of each widget (parallel to `widgets`). */
  slots?: number[]
  /** Places per column (1–3); absent = 1. */
  stacks?: number[]
  /** Free grid: each widget's span, by widget id (absent = 1 × 1). Present → `slots` / `stacks` are ignored. */
  sizes?: Record<string, GridSize>
  /** `compact`: tighter widgets — the table's Tight spacing and 12 px text (spec 2026-10-07-grid-widget-spans D7). */
  density?: 'compact'
}

export type GridDensity = 'standard' | 'compact'

/** The view's density: compact when every section is (an empty view: standard). */
export const viewDensity = (sections: ReadonlyArray<{ density?: string }>): GridDensity =>
  sections.length > 0 && sections.every((s) => s.density === 'compact') ? 'compact' : 'standard'

/** Every section in `density` — the configurator's "Gęstość" applies to the whole view. */
export function setDensity<W extends { id: string }>(sections: GridSection<W>[], density: GridDensity): GridSection<W>[] {
  return sections.map((s) => {
    const { density: _old, ...rest } = s
    return density === 'compact' ? { ...rest, density: 'compact' } : rest
  })
}

/** A section added to a compact view is compact too. */
export const inViewDensity = <W extends { id: string }>(before: GridSection<W>[], after: GridSection<W>[]): GridSection<W>[] =>
  viewDensity(before) === 'compact' ? setDensity(after, 'compact') : after

/** A free-grid section (widgets flow in order, each with its own span). */
export const isFlow = (section: { sizes?: unknown }): boolean =>
  Boolean(section.sizes) && typeof section.sizes === 'object' && !Array.isArray(section.sizes)

const clampInt = (value: unknown, min: number, max: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : min
  return Math.min(max, Math.max(min, n))
}

/** A widget's span in a free-grid section, clamped to the section (1 × 1 when not set). */
export function sizeOf(section: { columns: number; sizes?: Record<string, GridSize> }, id: string): GridSize {
  const size = section.sizes?.[id]
  return { w: clampInt(size?.w, 1, Math.max(1, section.columns)), h: clampInt(size?.h, 1, MAX_ROWS) }
}

/** A free-grid section with clean `sizes` (only its widgets, clamped, 1 × 1 left out) and no slot fields. */
function normalizeFlow<W extends { id: string }>(section: GridSection<W>): GridSection<W> {
  const sizes: Record<string, GridSize> = {}
  const seen = new Set<string>()
  const widgets = section.widgets.filter((w) => !seen.has(w.id) && (seen.add(w.id), true))
  for (const widget of widgets) {
    const size = sizeOf(section, widget.id)
    if (size.w > 1 || size.h > 1) sizes[widget.id] = size
  }
  const { slots: _slots, stacks: _stacks, ...rest } = section
  return { ...rest, widgets, sizes }
}

/**
 * The slot section as a free grid that draws the same picture: rows = the most
 * places any slot fills; a slot's widgets share those rows (3 over 2 = 2 + 1);
 * widgets in reading order (row, then column). Empty places go — they were only
 * placeholders. A free-grid section comes back cleaned.
 */
export function toFlow<W extends { id: string }>(section: GridSection<W>): GridSection<W> {
  if (isFlow(section)) return normalizeFlow(section)
  const cells = cellsOf(section)
  const rows = Math.max(1, ...cells.map((cell) => cell.widgets.length))
  const items: Array<{ widget: W; column: number; row: number; h: number }> = []
  for (const cell of cells) {
    const k = cell.widgets.length
    if (!k) continue
    const base = Math.floor(rows / k)
    const extra = rows % k
    let row = 0
    cell.widgets.forEach((widget, i) => {
      const h = base + (i < extra ? 1 : 0)
      items.push({ widget, column: cell.column, row, h })
      row += h
    })
  }
  items.sort((a, b) => a.row - b.row || a.column - b.column)
  const sizes: Record<string, GridSize> = {}
  for (const item of items) if (item.h > 1) sizes[item.widget.id] = { w: 1, h: item.h }
  const { slots: _slots, stacks: _stacks, ...rest } = section
  return { ...rest, widgets: items.map((item) => item.widget), sizes }
}

/** Where a free-grid widget lands: column `x`, row `y` (0-based), `w` × `h`. */
export type GridRect = { x: number; y: number; w: number; h: number }

/**
 * A free-grid section laid out — CSS grid's own sparse auto-placement, replayed: each
 * widget goes to the first place at or after the previous one where it fits. `rows` =
 * how many rows it fills; `cursor` = where the next widget would start looking.
 */
export function flowPlacement<W extends { id: string }>(section: GridSection<W>): { rects: Map<string, GridRect>; rows: number; cursor: { x: number; y: number } } {
  const columns = Math.max(1, section.columns)
  const taken = new Set<string>()
  const rects = new Map<string, GridRect>()
  const free = (r: number, c: number, w: number, h: number) => {
    if (c + w > columns) return false
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (taken.has(`${y}:${x}`)) return false
    return true
  }
  let row = 0
  let col = 0
  let rows = 0
  for (const widget of section.widgets) {
    if (rects.has(widget.id)) continue
    const { w, h } = sizeOf(section, widget.id)
    while (!free(row, col, w, h)) {
      col++
      if (col + w > columns) {
        col = 0
        row++
      }
    }
    for (let y = row; y < row + h; y++) for (let x = col; x < col + w; x++) taken.add(`${y}:${x}`)
    rects.set(widget.id, { x: col, y: row, w, h })
    rows = Math.max(rows, row + h)
    col += w
  }
  return { rects, rows, cursor: { x: col, y: row } }
}

/** The cells of a laid-out free grid that no widget covers, row by row (rows 0 … `rows` − 1). */
export function flowFreeCells<W extends { id: string }>(section: GridSection<W>): Array<{ x: number; y: number }> {
  const { rects, rows } = flowPlacement(section)
  const taken = new Set<string>()
  for (const r of rects.values()) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) taken.add(`${y}:${x}`)
  const out: Array<{ x: number; y: number }> = []
  for (let y = 0; y < rows; y++) for (let x = 0; x < section.columns; x++) if (!taken.has(`${y}:${x}`)) out.push({ x, y })
  return out
}

/**
 * Whether a free-grid section has room for one more 1 × 1 widget in the row its last
 * widget ends on. The page offers "+ Dodaj widżet" there only; a full section does not
 * grow an empty row for it.
 */
export function flowHasRoom<W extends { id: string }>(section: GridSection<W>): boolean {
  if (!section.widgets.length) return true
  const { rects, cursor } = flowPlacement(section)
  const taken = new Set<string>()
  for (const r of rects.values()) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) taken.add(`${y}:${x}`)
  for (let c = cursor.x; c < section.columns; c++) if (!taken.has(`${cursor.y}:${c}`)) return true
  return false
}

const withSize = (sizes: Record<string, GridSize> | undefined, id: string, size: GridSize): Record<string, GridSize> => {
  const next = { ...sizes }
  if (size.w > 1 || size.h > 1) next[id] = size
  else delete next[id]
  return next
}

/**
 * A width change of `id` that keeps the rest of the section where it was: every widget
 * keeps its row, and only the widgets right of `id` on its row may shift sideways.
 * Anything else (a widget wrapping to the next row, one pulled up from below) → null.
 */
function keepsRows<W extends { id: string }>(before: GridSection<W>, after: GridSection<W>, id: string): GridSection<W> | null {
  const a = flowPlacement(before).rects
  const b = flowPlacement(after).rects
  const me = a.get(id)!
  for (const [wid, ra] of a) {
    const rb = b.get(wid)
    if (!rb || rb.y !== ra.y) return null
    const mayShift = wid !== id && ra.y === me.y && ra.x > me.x
    if (!mayShift && rb.x !== ra.x) return null
  }
  return after
}

/** One column wider: into free room on the row (the widgets after it shift right), else taken from the nearest wider neighbour. */
function growOne<W extends { id: string }>(section: GridSection<W>, id: string): GridSection<W> | null {
  const rects = flowPlacement(section).rects
  const me = rects.get(id)!
  if (me.x + me.w >= section.columns) return null
  const wider = { ...section, sizes: withSize(section.sizes, id, { w: me.w + 1, h: me.h }) }
  const pushed = keepsRows(section, wider, id)
  if (pushed) return pushed
  const neighbours = [...rects.entries()].filter(([wid, r]) => wid !== id && r.y === me.y && r.x >= me.x + me.w).sort((p, q) => p[1].x - q[1].x)
  for (const [nid, r] of neighbours) {
    if (r.w <= 1) continue
    const traded = keepsRows(section, { ...wider, sizes: withSize(wider.sizes, nid, { w: r.w - 1, h: r.h }) }, id)
    if (traded) return traded
  }
  // Every neighbour is down to one column: the last ones wrap to the next row, as long as the widget itself stays put.
  const at = flowPlacement(wider).rects.get(id)!
  return at.x === me.x && at.y === me.y ? wider : null
}

/** One column narrower: in a full row the neighbour on its right takes the column (a divider); otherwise the row just keeps the room. */
function shrinkOne<W extends { id: string }>(section: GridSection<W>, id: string): GridSection<W> | null {
  const rects = flowPlacement(section).rects
  const me = rects.get(id)!
  if (me.w <= 1) return null
  const narrower = { ...section, sizes: withSize(section.sizes, id, { w: me.w - 1, h: me.h }) }
  const onRow = [...rects.values()].filter((r) => r.y <= me.y && r.y + r.h > me.y)
  const rowFull = onRow.reduce((n, r) => n + r.w, 0) >= section.columns
  const next = [...rects.entries()].find(([wid, r]) => wid !== id && r.y === me.y && r.x === me.x + me.w)
  const traded = next ? keepsRows(section, { ...narrower, sizes: withSize(narrower.sizes, next[0], { w: next[1].w + 1, h: next[1].h }) }, id) : null
  if (rowFull && traded) return traded
  // A plain shrink that pulls a widget up from the next row is not what the drag meant — the neighbour takes it then.
  return keepsRows(section, narrower, id) ?? traded ?? narrower
}

/**
 * Resizes a widget the way a drag on its edge means it (owner 07.10: "dragging to the
 * right when there is another widget doesn't resize the other one"): the height as
 * asked; the width a column at a time — into free room on the row first, then taken
 * from the neighbours on the right (each shrinks down to one column), and given back
 * to the neighbour when the widget narrows in a full row. Only when every neighbour is
 * down to one column do the last ones wrap to the next row. A slot section becomes a
 * free grid first.
 */
export function resizeWidget<W extends { id: string }>(sections: GridSection<W>[], widgetId: string, want: GridSize): GridSection<W>[] {
  const target = sections.find((s) => s.widgets.some((w) => w.id === widgetId))
  if (!target) return sections
  const flow = toFlow(target)
  const start = sizeOf(flow, widgetId)
  const goal = sizeOf({ columns: flow.columns, sizes: { [widgetId]: want } }, widgetId)
  let current: GridSection<W> = { ...flow, sizes: withSize(flow.sizes, widgetId, { w: start.w, h: goal.h }) }
  while (sizeOf(current, widgetId).w !== goal.w) {
    const next = sizeOf(current, widgetId).w < goal.w ? growOne(current, widgetId) : shrinkOne(current, widgetId)
    if (!next) break
    current = next
  }
  const result = normalizeFlow(current)
  return sections.map((s) => (s.id === target.id ? result : s))
}

/** Sets a widget's span (clamped to its section); a slot section becomes a free grid first. */
export function setSize<W extends { id: string }>(sections: GridSection<W>[], widgetId: string, size: GridSize): GridSection<W>[] {
  const target = sections.find((s) => s.widgets.some((w) => w.id === widgetId))
  if (!target) return sections
  const flow = toFlow(target)
  const next = sizeOf({ columns: flow.columns, sizes: { [widgetId]: size } }, widgetId)
  const sizes = { ...flow.sizes }
  if (next.w > 1 || next.h > 1) sizes[widgetId] = next
  else delete sizes[widgetId]
  return sections.map((s) => (s.id === target.id ? { ...flow, sizes } : s))
}

/**
 * Moves a widget into the free-grid section `sectionId`, before `beforeId` (absent:
 * at the end). It keeps its span when it comes from a free grid. A slot section as
 * the target → the same array (use `placeWidget`).
 */
export function moveBefore<W extends { id: string }>(sections: GridSection<W>[], id: string, sectionId: string, beforeId?: string): GridSection<W>[] {
  const from = sections.find((s) => s.widgets.some((w) => w.id === id))
  const to = sections.find((s) => s.id === sectionId)
  if (!from || !to || !isFlow(to) || beforeId === id) return sections
  const widget = from.widgets.find((w) => w.id === id)!
  const size = isFlow(from) ? from.sizes?.[id] : undefined
  return sections.map((s) => {
    let next = s
    if (next.id === from.id) next = withoutWidget(next, id)
    if (next.id === to.id) {
      const flow = normalizeFlow(next)
      const widgets = flow.widgets.filter((w) => w.id !== id)
      const at = beforeId ? widgets.findIndex((w) => w.id === beforeId) : -1
      widgets.splice(at < 0 ? widgets.length : at, 0, widget)
      next = normalizeFlow({ ...flow, widgets, sizes: size ? { ...flow.sizes, [id]: size } : flow.sizes })
    }
    return next
  })
}

export type GridCell<W> = { column: number; stack: number; widgets: W[] }

export const isGridColumns = (n: unknown): n is GridColumns => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_COLUMNS

export const stackOf = (section: { stacks?: number[] }, column: number): number =>
  Math.min(MAX_STACK, Math.max(1, section.stacks?.[column] ?? 1))

export const capacity = (section: { columns: number; stacks?: number[] }): number =>
  Array.from({ length: section.columns }, (_, c) => stackOf(section, c)).reduce((a, b) => a + b, 0)

/** Valid `slots` for a section: keeps saved places, puts the rest in the first free places; returns what does not fit. */
function place<W extends { id: string }>(section: GridSection<W>): { slots: number[]; fit: W[]; overflow: W[] } {
  const used = Array.from({ length: section.columns }, () => 0)
  const slots: number[] = []
  const fit: W[] = []
  const overflow: W[] = []
  const later: W[] = []
  section.widgets.forEach((widget, i) => {
    const column = section.slots?.[i]
    if (column !== undefined && column >= 0 && column < section.columns && used[column] < stackOf(section, column)) {
      used[column]++
      slots.push(column)
      fit.push(widget)
    } else later.push(widget)
  })
  for (const widget of later) {
    const column = used.findIndex((n, c) => n < stackOf(section, c))
    if (column < 0) {
      overflow.push(widget)
      continue
    }
    used[column]++
    slots.push(column)
    fit.push(widget)
  }
  return { slots, fit, overflow }
}

/** The section with ordered `slots` (and `stacks` cut to the column count). */
export function normalize<W extends { id: string }>(section: GridSection<W>): GridSection<W> {
  if (isFlow(section)) return normalizeFlow(section)
  const { slots, fit } = place(section)
  const stacks = section.stacks?.slice(0, section.columns)
  const next: GridSection<W> = { ...section, widgets: fit, slots }
  if (stacks?.some((n) => n > 1)) next.stacks = stacks
  else delete next.stacks
  return next
}

/** The section's columns with their widgets (for the page and the editor). */
export function cellsOf<W extends { id: string }>(section: GridSection<W>): GridCell<W>[] {
  if (isFlow(section)) {
    // A free grid has no slots; a caller that only knows slots sees its widgets dealt into the columns in order.
    const columns = Math.max(1, section.columns)
    const stack = Math.max(1, Math.ceil(section.widgets.length / columns))
    return Array.from({ length: columns }, (_, column) => ({ column, stack, widgets: section.widgets.filter((_, i) => i % columns === column) }))
  }
  const { slots, fit } = place(section)
  return Array.from({ length: section.columns }, (_, column) => ({
    column,
    stack: stackOf(section, column),
    widgets: fit.filter((_, i) => slots[i] === column),
  }))
}

/**
 * Sections from a list of widgets: rows of `columns`, each widget in the next slot.
 * Used to migrate documents that had no sections (and for presets written as lists).
 */
export function gridRows<W extends { id: string }>(id: string, columns: GridColumns, widgets: W[]): GridSection<W>[] {
  if (widgets.length <= columns) return [{ id, columns, widgets }]
  const out: GridSection<W>[] = []
  for (let i = 0; i < widgets.length; i += columns) {
    out.push({ id: i ? `${id}-${i / columns + 1}` : id, columns, widgets: widgets.slice(i, i + columns) })
  }
  return out
}

/** Every section normalized; a section's widgets that no longer fit start new one-column sections under it. */
export function normalizeSections<W extends { id: string }>(sections: GridSection<W>[]): GridSection<W>[] {
  const out: GridSection<W>[] = []
  const seen = new Set<string>()
  sections.forEach((raw, index) => {
    if (!raw) return
    // A duplicate or missing id is renamed, never dropped (the section's widgets would go with it).
    let id = typeof raw.id === 'string' && raw.id ? raw.id : `section-${index + 1}`
    while (seen.has(id)) id = `${id}-${index + 1}`
    seen.add(id)
    const section: GridSection<W> = { ...raw, id, columns: isGridColumns(raw.columns) ? raw.columns : 1, widgets: Array.isArray(raw.widgets) ? raw.widgets : [] }
    if (isFlow(section)) {
      out.push(normalizeFlow(section))
      return
    }
    const { overflow } = place(section)
    out.push(normalize(section))
    overflow.forEach((widget, i) => out.push({ id: `${section.id}-o${i + 1}`, columns: 1, widgets: [widget], slots: [0] }))
  })
  return out
}

const withoutWidget = <W extends { id: string }>(section: GridSection<W>, id: string): GridSection<W> => {
  if (isFlow(section)) {
    const { [id]: _gone, ...sizes } = section.sizes ?? {}
    return normalizeFlow({ ...section, widgets: section.widgets.filter((w) => w.id !== id), sizes })
  }
  const n = normalize(section)
  const i = n.widgets.findIndex((w) => w.id === id)
  if (i < 0) return n
  return { ...n, widgets: n.widgets.filter((_, j) => j !== i), slots: n.slots!.filter((_, j) => j !== i) }
}

const insert = <W extends { id: string }>(section: GridSection<W>, widget: W, column: number, index = Infinity): GridSection<W> => {
  if (isFlow(section)) {
    const widgets = section.widgets.filter((w) => w.id !== widget.id)
    widgets.splice(Math.min(index, widgets.length), 0, widget)
    return normalizeFlow({ ...section, widgets })
  }
  const n = normalize(section)
  const inColumn = n.widgets.map((_, i) => i).filter((i) => n.slots![i] === column)
  const at = inColumn[Math.min(index, inColumn.length)] ?? n.widgets.length
  const widgets = [...n.widgets]
  const slots = [...n.slots!]
  widgets.splice(at, 0, widget)
  slots.splice(at, 0, column)
  return { ...n, widgets, slots }
}

const freeIn = <W extends { id: string }>(section: GridSection<W>, column: number): boolean => {
  if (isFlow(section)) return true
  const cell = cellsOf(section)[column]
  return cell ? cell.widgets.length < cell.stack : false
}

/** Into a free place: the given column, or the first free one. No room → the same array. */
export function addWidget<W extends { id: string }>(sections: GridSection<W>[], sectionId: string, widget: W, column?: number): GridSection<W>[] {
  const target = sections.find((s) => s.id === sectionId)
  if (!target) return sections
  if (isFlow(target)) return sections.map((s) => (s.id === sectionId ? insert(s, widget, 0) : s))
  const col = column ?? cellsOf(target).findIndex((cell) => cell.widgets.length < cell.stack)
  if (col < 0 || !freeIn(target, col)) return sections
  return sections.map((s) => (s.id === sectionId ? insert(s, widget, col) : s))
}

export const addSection = <W extends { id: string }>(sections: GridSection<W>[], id: string, columns: GridColumns): GridSection<W>[] => [
  ...sections,
  { id, columns, widgets: [] },
]

/** A new section in the middle of the view — before section `index` (the gap between sections). */
export const insertSection = <W extends { id: string }>(sections: GridSection<W>[], index: number, id: string, columns: GridColumns): GridSection<W>[] => [
  ...sections.slice(0, index),
  { id, columns, widgets: [] },
  ...sections.slice(index),
]

/** A new slot (column) inside a row — before column `at` (the vertical gap). At most 6. */
export function insertColumn<W extends { id: string }>(sections: GridSection<W>[], id: string, at: number): GridSection<W>[] {
  const target = sections.find((s) => s.id === id)
  if (!target || target.columns >= MAX_COLUMNS || at < 0 || at > target.columns) return sections
  if (isFlow(target)) return sections.map((s) => (s.id === id ? normalizeFlow({ ...target, columns: (target.columns + 1) as GridColumns }) : s))
  const n = normalize(target)
  const stacks = Array.from({ length: target.columns }, (_, c) => stackOf(target, c))
  stacks.splice(at, 0, 1)
  const next: GridSection<W> = { ...n, columns: (target.columns + 1) as GridColumns, slots: n.slots!.map((c) => (c >= at ? c + 1 : c)), stacks }
  return sections.map((s) => (s.id === id ? normalize(next) : s))
}

/** The column count — never drops an occupied column (then: the same array). */
export function setColumns<W extends { id: string }>(sections: GridSection<W>[], id: string, columns: GridColumns): GridSection<W>[] {
  const target = sections.find((s) => s.id === id)
  if (!target) return sections
  if (isFlow(target)) return sections.map((s) => (s.id === id ? normalizeFlow({ ...target, columns }) : s))
  const n = normalize(target)
  if (n.slots!.some((column) => column >= columns)) return sections
  return sections.map((s) => (s.id === id ? normalize({ ...n, columns }) : s))
}

/** The highest column a widget sits in, + 1 (the smallest column count the section can have). */
export const usedColumns = <W extends { id: string }>(section: GridSection<W>): number =>
  isFlow(section) ? Math.min(1, section.widgets.length) : Math.max(0, ...cellsOf(section).filter((c) => c.widgets.length).map((c) => c.column + 1))

/** Split a slot vertically (1–3 places). Never below the widgets already in it. */
export function setStack<W extends { id: string }>(sections: GridSection<W>[], id: string, column: number, stack: number): GridSection<W>[] {
  const target = sections.find((s) => s.id === id)
  if (!target || isFlow(target) || column < 0 || column >= target.columns || stack < 1 || stack > MAX_STACK) return sections
  if (cellsOf(target)[column].widgets.length > stack) return sections
  const stacks = Array.from({ length: target.columns }, (_, c) => (c === column ? stack : stackOf(target, c)))
  return sections.map((s) => (s.id === id ? normalize({ ...normalize(target), stacks }) : s))
}

/**
 * Drag a widget into column `column` of section `sectionId` (position `index` in it).
 * A full column elsewhere → the widget swaps places with the one it was dropped on (`swapWith`).
 */
export function placeWidget<W extends { id: string }>(
  sections: GridSection<W>[],
  id: string,
  sectionId: string,
  column: number,
  index = Infinity,
  swapWith?: string,
): GridSection<W>[] {
  const from = sections.find((s) => s.widgets.some((w) => w.id === id))
  const to = sections.find((s) => s.id === sectionId)
  if (!from || !to || column < 0 || column >= to.columns) return sections
  const widget = from.widgets.find((w) => w.id === id)!
  // A free grid on either side: into a free grid → before the widget it was dropped on; out of one → a free slot only.
  if (isFlow(to)) return moveBefore(sections, id, to.id, swapWith)
  if (isFlow(from)) {
    if (!freeIn(to, column)) return sections
    return sections.map((s) => {
      let next = s
      if (next.id === from.id) next = withoutWidget(next, id)
      if (next.id === to.id) next = insert(next, widget, column, index)
      return next
    })
  }
  const fromCell = cellsOf(from).find((cell) => cell.widgets.some((w) => w.id === id))!
  if (from.id === to.id && fromCell.column === column) {
    const current = fromCell.widgets.findIndex((w) => w.id === id)
    const at = Math.min(index, fromCell.widgets.length - 1)
    if (current === at) return sections
    return sections.map((s) => (s.id === to.id ? insert(withoutWidget(s, id), widget, column, at) : s))
  }
  if (!freeIn(to, column)) {
    const other = swapWith ? to.widgets.find((w) => w.id === swapWith) : undefined
    if (!other) return sections
    const otherIndex = cellsOf(to)[column].widgets.findIndex((w) => w.id === other.id)
    const myIndex = fromCell.widgets.findIndex((w) => w.id === id)
    const cleared = sections.map((s) => {
      let next = s
      if (next.id === from.id) next = withoutWidget(next, id)
      if (next.id === to.id) next = withoutWidget(next, other.id)
      return next
    })
    return cleared.map((s) => {
      let next = s
      if (next.id === to.id) next = insert(next, widget, column, otherIndex)
      if (next.id === from.id) next = insert(next, other, fromCell.column, myIndex)
      return next
    })
  }
  return sections.map((s) => {
    let next = s
    if (next.id === from.id) next = withoutWidget(next, id)
    if (next.id === to.id) next = insert(next, widget, column, index)
    return next
  })
}

/** Keyboard ←/→: one place in reading order; at the edge, into the next section if it has room. */
export function moveWidget<W extends { id: string }>(sections: GridSection<W>[], id: string, delta: -1 | 1): GridSection<W>[] {
  const si = sections.findIndex((s) => s.widgets.some((w) => w.id === id))
  if (si < 0) return sections
  if (isFlow(sections[si])) {
    const own = sections[si]
    const i = own.widgets.findIndex((w) => w.id === id)
    const j = i + delta
    if (j >= 0 && j < own.widgets.length) {
      const widgets = [...own.widgets]
      ;[widgets[i], widgets[j]] = [widgets[j], widgets[i]]
      return sections.map((s, k) => (k === si ? { ...own, widgets } : s))
    }
    const target = sections[si + delta]
    if (!target) return sections
    if (isFlow(target)) return moveBefore(sections, id, target.id, delta > 0 ? target.widgets[0]?.id : undefined)
    const targetFree = cellsOf(target).filter((cell) => cell.widgets.length < cell.stack).map((cell) => cell.column)
    const column = delta > 0 ? targetFree[0] : targetFree[targetFree.length - 1]
    return column === undefined ? sections : placeWidget(sections, id, target.id, column, delta > 0 ? 0 : Infinity)
  }
  const cells = cellsOf(sections[si])
  const order = cells.flatMap((cell) => cell.widgets.map((w, i) => ({ w, column: cell.column, i })))
  const k = order.findIndex((x) => x.w.id === id)
  const j = k + delta
  if (j >= 0 && j < order.length) {
    const other = order[j]
    return placeWidget(sections, id, sections[si].id, other.column, other.i, other.w.id)
  }
  const free = cells.map((cell) => cell.column).filter((c) => cells[c].widgets.length < cells[c].stack)
  const mine = order[k].column
  const inside = delta > 0 ? free.find((c) => c > mine) : [...free].reverse().find((c) => c < mine)
  if (inside !== undefined) return placeWidget(sections, id, sections[si].id, inside)
  const target = sections[si + delta]
  if (!target) return sections
  if (isFlow(target)) return moveBefore(sections, id, target.id, delta > 0 ? target.widgets[0]?.id : undefined)
  const targetFree = cellsOf(target).filter((cell) => cell.widgets.length < cell.stack).map((cell) => cell.column)
  const column = delta > 0 ? targetFree[0] : targetFree[targetFree.length - 1]
  if (column === undefined) return sections
  return placeWidget(sections, id, target.id, column, delta > 0 ? 0 : Infinity)
}

/** A whole section (row) one up / down. */
export function moveSection<W extends { id: string }>(sections: GridSection<W>[], id: string, delta: -1 | 1): GridSection<W>[] {
  const i = sections.findIndex((s) => s.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= sections.length) return sections
  const next = [...sections]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/** Removes a row with its widgets (in the editor "Anuluj" undoes it). */
export const removeSection = <W extends { id: string }>(sections: GridSection<W>[], id: string): GridSection<W>[] =>
  sections.filter((s) => s.id !== id)

export const removeWidget = <W extends { id: string }>(sections: GridSection<W>[], id: string): GridSection<W>[] =>
  sections.map((s) => (s.widgets.some((w) => w.id === id) ? withoutWidget(s, id) : s))

export const replaceWidget = <W extends { id: string }>(sections: GridSection<W>[], id: string, next: W): GridSection<W>[] =>
  sections.map((s) => {
    if (!s.widgets.some((w) => w.id === id)) return s
    const widgets = s.widgets.map((w) => (w.id === id ? next : w))
    if (!s.sizes?.[id] || next.id === id) return { ...s, widgets }
    const { [id]: size, ...sizes } = s.sizes
    return { ...s, widgets, sizes: { ...sizes, [next.id]: size } }
  })

/** Every widget of the view, in reading order (section, column, top to bottom). */
export const allWidgets = <W extends { id: string }>(sections: GridSection<W>[]): W[] =>
  sections.flatMap((s) => (isFlow(s) ? s.widgets : cellsOf(s).flatMap((cell) => cell.widgets)))

/** A short random id for a new section / widget instance. */
export function gridId(prefix: string): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${rnd}`
}
