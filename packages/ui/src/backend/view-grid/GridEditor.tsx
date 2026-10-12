'use client'

/**
 * "Dostosuj pulpit" / "Dostosuj widok · Główna" (fms-design PR #35 `GridEditor`,
 * call 30.09): a drawer where each section is ONE row — its slot count 1–6, up /
 * down, delete — and its widgets are tiles with a handle (drag to another place;
 * a full place swaps; ←/→ on the handle moves by one), × to take it out, and
 * "+ w pionie" to split a slot into 2–3 places. Free places read "+ Dodaj".
 * "Dodaj sekcję" closes the list. Nothing is saved before "Zastosuj".
 *
 * With `spans` (spec 2026-10-07-grid-widget-spans) every section is a free grid
 * drawn as it will look: faint column guides behind, each widget at its real place
 * and span, a "+" in every free cell. A tile's header drags it (onto another tile =
 * before that one, onto a free cell = there); its right / bottom edge and corner
 * resize it, and widening a widget in a full row narrows its neighbour (owner 07.10).
 * The page has no handles — this is the one place to arrange.
 */

import * as React from 'react'
import { ChevronDown, ChevronUp, GripVertical, Info, Loader2, Plus, Trash2, X } from 'lucide-react'
import { Sheet, SheetContent } from '../../primitives/sheet'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from './cn'
import {
  GRID_COLUMNS,
  MAX_STACK,
  addSection,
  addWidget,
  cellsOf,
  flowFreeCells,
  flowPlacement,
  gridId,
  inViewDensity,
  isFlow,
  moveBefore,
  moveSection,
  moveWidget,
  placeWidget,
  removeSection,
  removeWidget,
  replaceWidget,
  resizeWidget,
  setColumns,
  setDensity,
  setStack,
  sizeOf,
  toFlow,
  usedColumns,
  viewDensity,
  type GridRect,
  type GridSection,
  type GridSize,
} from './model'
import { AddSection } from './sections'
import { ResizeHandles, SizeBadge } from './resize'
import { WidgetPicker, type WidgetOption } from './WidgetPicker'

type W = { id: string }

const btnBase =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] text-body-medium-sm disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-m3ft-outline'
export const gridBtnPrimary = `${btnBase} h-9 bg-m3ft-primary px-4 text-m3ft-on-primary hover:opacity-90`
export const gridBtnText = `${btnBase} h-9 px-3 text-m3ft-on-surface hover:bg-m3ft-surface-container`
export const gridBtnSecondary = `${btnBase} h-9 bg-m3ft-surface-container-high px-3 text-m3ft-on-surface hover:bg-m3ft-surface-container`
/** A 36 px square icon-only button ("Dostosuj pulpit", top right). */
export const gridBtnIcon = `${btnBase} size-9 text-m3ft-on-surface-variant hover:bg-m3ft-surface-container hover:text-m3ft-on-surface`
const iconBtn =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] text-m3ft-on-surface-variant hover:bg-m3ft-surface-container disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-m3ft-outline'
const COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5', 6: 'grid-cols-6' }

export type GridEditorProps<T extends W> = {
  sections: GridSection<T>[]
  onChange: (sections: GridSection<T>[]) => void
  name: (widget: T) => string
  options: WidgetOption[]
  create: (type: string) => T
  /** A tile's own body (the SOP tile: its entries and "+ Dodaj"). Absent = the widget's name. */
  tileBody?: (widget: T, patch: (next: T) => void) => React.ReactNode | undefined
  /** Offer each widget's size (columns × rows). Only for hosts whose storage keeps `sizes` (kartoteka, teczka). */
  spans?: boolean
  /**
   * A widget the view cannot lose (the split view's own table: the page IS that
   * table). Its tile has no ×, and its section no "delete section".
   */
  locked?: (widget: T) => boolean
}

export function GridEditor<T extends W>({ sections: given, onChange, name, options, create, tileBody, spans = false, locked }: GridEditorProps<T>) {
  const t = useT()
  const set = onChange
  const isLocked = (widget: T) => Boolean(locked?.(widget))
  // Span hosts edit every section as a free grid (D2: the same picture); every change below starts from it.
  const sections = React.useMemo(() => (spans ? given.map((s) => toFlow(s)) : given), [given, spans])
  const [resizing, setResizing] = React.useState<{ id: string; size: GridSize } | null>(null)
  // While a handle is dragged the grid shows the outcome live — the neighbour narrowing too.
  const shown = resizing ? resizeWidget(sections, resizing.id, resizing.size) : sections
  const [dragging, setDragging] = React.useState<string | null>(null)
  const [over, setOver] = React.useState<string | null>(null)
  const endDrag = () => {
    setDragging(null)
    setOver(null)
  }
  const drop = (key: string, next: () => GridSection<T>[]) => ({
    'data-drop': over === key ? 'true' : undefined,
    // A drop target cancels dragenter and dragover; a place that changes nothing still accepts (its drop is a no-op).
    onDragEnter: (event: React.DragEvent) => {
      if (dragging) event.preventDefault()
    },
    onDragOver: (event: React.DragEvent) => {
      if (!dragging) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setOver(next() !== sections ? key : null)
    },
    onDragLeave: () => setOver(null),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault()
      if (dragging) {
        const result = next()
        if (result !== sections) set(result)
      }
      endDrag()
    },
  })
  /** One widget's tile in a slot section: handle (drag, ←/→), ×, its name or body. `dropTo` = what a drop on it does. */
  const tile = (widget: T, dropKey: string, dropTo: () => GridSection<T>[]) => {
    const label = name(widget)
    const body = tileBody?.(widget, (next) => set(replaceWidget(sections, widget.id, next)))
    return (
      <div
        key={widget.id}
        className={cn(
          'relative flex min-h-[72px] min-w-0 flex-col rounded-[12px] border border-m3ft-outline bg-m3ft-surface',
          dragging === widget.id && 'opacity-50',
          over === dropKey && 'border-m3ft-primary',
        )}
        data-widget-id={widget.id}
        data-testid={`grid-tile-${widget.id}`}
        {...drop(dropKey, dropTo)}
      >
        {/* The same header as a free-grid tile (the contractor page): grip, name, ×. */}
        <span className="flex h-9 shrink-0 items-center gap-1 rounded-t-[11px] border-b border-m3ft-outline-variant bg-m3ft-surface-container-low px-1">
          <button
            type="button"
            draggable
            aria-label={t('split_views.grid.move', 'Przesuń: {name} (przeciągnij albo strzałki)', { name: label })}
            className={cn(iconBtn, 'size-7 cursor-grab active:cursor-grabbing')}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', widget.id)
              setDragging(widget.id)
            }}
            onDragEnd={endDrag}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              set(moveWidget(sections, widget.id, event.key === 'ArrowLeft' ? -1 : 1))
            }}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
          <span className="min-w-0 flex-1 truncate text-body-medium-sm text-m3ft-on-surface" title={label}>
            {label}
          </span>
          {isLocked(widget) ? null : (
            <button type="button" className={cn(iconBtn, 'size-7')} aria-label={t('split_views.grid.removeNamed', 'Usuń z widoku: {name}', { name: label })} onClick={() => set(removeWidget(sections, widget.id))} data-testid={`grid-tile-remove-${widget.id}`}>
              <X className="size-4" aria-hidden />
            </button>
          )}
        </span>
        {body ? <div className="min-h-0 flex-1 px-2 py-1.5">{body}</div> : null}
      </div>
    )
  }
  /** The dragged widget into a free grid, before `beforeId`; a section it leaves empty goes too (owner 07.10). */
  const moveTo = (sectionId: string, beforeId?: string) => {
    if (!dragging) return sections
    const next = moveBefore(sections, dragging, sectionId, beforeId)
    if (next === sections) return sections
    return next.filter((s) => s.widgets.length > 0 || !sections.find((p) => p.id === s.id)?.widgets.length)
  }
  /**
   * A free-grid widget at its real place: the header drags it (←/→ on its grip moves it
   * by one), "2 × 1" is its size, × takes it out; the edges and the corner resize it.
   */
  const flowTile = (base: GridSection<T>, section: GridSection<T>, widget: T, rect: GridRect) => {
    const label = name(widget)
    const body = tileBody?.(widget, (next) => set(replaceWidget(sections, widget.id, next)))
    const dropKey = `${section.id}:flow:${widget.id}`
    const active = resizing?.id === widget.id
    return (
      <div
        key={widget.id}
        style={{ gridColumn: `${rect.x + 1} / span ${rect.w}`, gridRow: `${rect.y + 1} / span ${rect.h}` }}
        className={cn(
          'group/item relative flex min-w-0 flex-col rounded-[12px] border bg-m3ft-surface',
          active || over === dropKey ? 'border-m3ft-primary' : 'border-m3ft-outline',
          dragging === widget.id && 'opacity-40',
        )}
        data-widget-id={widget.id}
        data-grid-item=""
        data-testid={`grid-tile-${widget.id}`}
        {...drop(dropKey, () => moveTo(section.id, widget.id))}
      >
        {/* Where a dropped widget goes: before this one. */}
        {over === dropKey ? <span aria-hidden className="pointer-events-none absolute inset-y-1 -left-[6px] z-30 w-1 rounded-full bg-m3ft-primary" /> : null}
        <div
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', widget.id)
            setDragging(widget.id)
          }}
          onDragEnd={endDrag}
          title={t('split_views.grid.dragHint', 'Przeciągnij, aby przenieść')}
          className="flex h-9 shrink-0 cursor-grab items-center gap-1 rounded-t-[11px] border-b border-m3ft-outline-variant bg-m3ft-surface-container-low px-1 active:cursor-grabbing"
          data-testid={`grid-tile-drag-${widget.id}`}
        >
          <button
            type="button"
            aria-label={t('split_views.grid.move', 'Przesuń: {name} (przeciągnij albo strzałki)', { name: label })}
            className={cn(iconBtn, 'size-7 cursor-grab')}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              set(moveWidget(sections, widget.id, event.key === 'ArrowLeft' ? -1 : 1))
            }}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
          <span className="min-w-0 flex-1 truncate text-body-medium-sm text-m3ft-on-surface" title={label}>
            {label}
          </span>
          <span
            className={cn(
              'shrink-0 rounded-[6px] px-1.5 py-0.5 text-label-semibold-xs tabular-nums',
              active ? 'bg-m3ft-primary text-m3ft-on-primary' : 'bg-m3ft-surface-container-high text-m3ft-on-surface-variant',
            )}
            title={t('split_views.grid.sizeHint', 'Kolumny × wiersze')}
            data-testid={`grid-tile-size-${widget.id}`}
          >
            {rect.w} × {rect.h}
          </span>
          {isLocked(widget) ? null : (
            <button
              type="button"
              className={cn(iconBtn, 'size-7')}
              aria-label={t('split_views.grid.removeNamed', 'Usuń z widoku: {name}', { name: label })}
              onClick={() => set(removeWidget(sections, widget.id))}
              data-testid={`grid-tile-remove-${widget.id}`}
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
        {body ? <div className="min-h-0 flex-1 px-2 py-1.5">{body}</div> : null}
        <ResizeHandles
          visible
          columns={section.columns}
          size={sizeOf(base, widget.id)}
          name={label}
          onPreview={(size) => setResizing({ id: widget.id, size })}
          onCommit={(size) => {
            setResizing(null)
            const next = resizeWidget(sections, widget.id, size)
            const key = (list: GridSection<T>[]) => JSON.stringify(list.find((x) => x.id === section.id)?.sizes ?? {})
            if (key(next) !== key(sections)) set(next)
          }}
          testId={`grid-tile-resize-${widget.id}`}
        />
        {active ? <SizeBadge size={rect} /> : null}
      </div>
    )
  }
  /** A free-grid section as it will look: column guides, the widgets at their places, a "+" in every free cell. */
  const flowGrid = (section: GridSection<T>, si: number) => {
    const base = sections.find((x) => x.id === section.id) ?? section
    const { rects, rows } = flowPlacement(section)
    const free = section.widgets.length ? flowFreeCells(section) : Array.from({ length: section.columns }, (_, x) => ({ x, y: 0 }))
    // A full last row: one wide "+" under the grid (drop there = to the end).
    const lastRowFull = section.widgets.length > 0 && !free.some((c) => c.y === rows - 1)
    // A drop on a free cell goes before the first widget after it in reading order — CSS then lays it out there.
    const firstAfter = (cell: { x: number; y: number }) =>
      section.widgets.find((w) => {
        const r = rects.get(w.id)
        return r ? r.y > cell.y || (r.y === cell.y && r.x > cell.x) : false
      })?.id
    const template = { gridTemplateColumns: `repeat(${section.columns}, minmax(0, 1fr))` }
    const freeCell = (key: string, style: React.CSSProperties, beforeId: string | undefined, testId: string) => (
      <div
        key={key}
        style={style}
        className={cn('relative flex min-h-[88px] rounded-[12px] border border-dashed', over === key ? 'border-m3ft-primary bg-m3ft-surface-container' : 'border-m3ft-outline-variant')}
        {...drop(key, () => moveTo(section.id, beforeId))}
      >
        <WidgetPicker
          compact
          options={options}
          label={t('split_views.grid.addToSection', 'Dodaj widżet do sekcji {n}', { n: si + 1 })}
          addLabel={t('split_views.grid.add', 'Dodaj')}
          testId={testId}
          onPick={(type) => {
            const widget = create(type)
            const added = addWidget(sections, section.id, widget)
            set(beforeId ? moveBefore(added, widget.id, section.id, beforeId) : added)
          }}
        />
      </div>
    )
    return (
      <div className="flex flex-col gap-2" data-flow="true">
        <div className="relative">
          {/* The columns a widget can span, behind the tiles. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 grid gap-2" style={template} data-testid={`grid-editor-guides-${si}`}>
            {Array.from({ length: section.columns }, (_, c) => (
              <span key={c} className="rounded-[12px] bg-m3ft-surface-container-low" />
            ))}
          </div>
          <div className="relative grid gap-2" style={{ ...template, gridAutoRows: 'minmax(88px, auto)' }}>
            {section.widgets.map((widget) => {
              const rect = rects.get(widget.id)
              return rect ? flowTile(base, section, widget, rect) : null
            })}
            {free.map((cell) =>
              freeCell(`${section.id}:cell:${cell.x}:${cell.y}`, { gridColumn: `${cell.x + 1} / span 1`, gridRow: `${cell.y + 1} / span 1` }, firstAfter(cell), `grid-editor-free-${si}-${cell.x}-${cell.y}`),
            )}
          </div>
        </div>
        {lastRowFull ? freeCell(`${section.id}:flow:end`, { minHeight: 44 }, undefined, `grid-editor-free-${si}-end`) : null}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3" data-testid="grid-editor">
      {spans ? (
        <p className="flex items-start gap-2 text-body-regular-sm text-m3ft-on-surface-variant" data-testid="grid-editor-hint">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('split_views.grid.spansHint', 'Przeciągnij nagłówek widżetu, aby go przenieść. Przeciągnij prawą lub dolną krawędź (albo róg), aby zmienić rozmiar — sąsiedni widżet w rzędzie dopasuje się.')}
        </p>
      ) : null}
      {spans ? (
        // "Gęstość" — compact widgets show more on the page (the table's Tight spacing, 12 px text).
        <div className="flex items-center gap-3" data-testid="grid-editor-density">
          <span className="text-body-medium-sm text-m3ft-on-surface">{t('split_views.grid.density', 'Gęstość widżetów')}</span>
          <span role="group" aria-label={t('split_views.grid.density', 'Gęstość widżetów')} className="inline-flex rounded-[10px] border border-m3ft-outline-variant p-0.5">
            {(['standard', 'compact'] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={viewDensity(sections) === d}
                onClick={() => set(setDensity(sections, d))}
                data-testid={`grid-editor-density-${d}`}
                className={cn(
                  'inline-flex h-7 items-center rounded-[8px] px-2.5 text-body-regular-sm',
                  viewDensity(sections) === d ? 'bg-m3ft-surface-container-high text-m3ft-on-surface' : 'text-m3ft-on-surface-variant hover:bg-m3ft-surface-container',
                )}
              >
                {d === 'compact' ? t('split_views.grid.densityCompact', 'Kompaktowa') : t('split_views.grid.densityStandard', 'Standardowa')}
              </button>
            ))}
          </span>
        </div>
      ) : null}
      {shown.map((section, si) => {
        const flow = isFlow(section)
        const cells = flow ? [] : cellsOf(section)
        const minColumns = usedColumns(section)
        return (
          <section key={section.id} className="flex flex-col gap-2 rounded-[16px] border border-m3ft-outline-variant p-3" data-section={section.id} aria-label={t('split_views.grid.sectionN', 'Sekcja {n}', { n: si + 1 })} data-testid={`grid-editor-section-${si}`}>
            <div className="flex items-center gap-2">
              <strong className="min-w-0 flex-1 text-body-medium-sm text-m3ft-on-surface">{t('split_views.grid.sectionN', 'Sekcja {n}', { n: si + 1 })}</strong>
              {flow ? <span className="text-body-regular-sm text-m3ft-on-surface-variant">{t('split_views.grid.columns', 'Kolumny')}</span> : null}
              <span role="group" aria-label={t('split_views.grid.slotsInRow', 'Sloty w rzędzie — sekcja {n}', { n: si + 1 })} className="inline-flex rounded-[10px] border border-m3ft-outline-variant p-0.5">
                {GRID_COLUMNS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={section.columns === n}
                    disabled={n < minColumns}
                    title={n < minColumns ? t('split_views.grid.columnsBlocked', 'Najpierw przenieś albo usuń widżety z ostatnich slotów') : t('split_views.grid.nSlots', '{n} w rzędzie', { n })}
                    onClick={() => set(setColumns(sections, section.id, n))}
                    data-testid={`grid-editor-columns-${si}-${n}`}
                    className={cn(
                      'inline-flex h-7 min-w-7 items-center justify-center rounded-[8px] px-1.5 text-body-regular-sm tabular-nums disabled:opacity-35',
                      section.columns === n ? 'bg-m3ft-surface-container-high text-m3ft-on-surface' : 'text-m3ft-on-surface-variant hover:bg-m3ft-surface-container',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </span>
              <button type="button" className={iconBtn} aria-label={t('split_views.grid.sectionUp', 'Sekcja {n} wyżej', { n: si + 1 })} disabled={si === 0} onClick={() => set(moveSection(sections, section.id, -1))}>
                <ChevronUp className="size-4" aria-hidden />
              </button>
              <button type="button" className={iconBtn} aria-label={t('split_views.grid.sectionDown', 'Sekcja {n} niżej', { n: si + 1 })} disabled={si === sections.length - 1} onClick={() => set(moveSection(sections, section.id, 1))}>
                <ChevronDown className="size-4" aria-hidden />
              </button>
              <button type="button" className={iconBtn} aria-label={t('split_views.grid.sectionRemove', 'Usuń sekcję {n} razem z widżetami', { n: si + 1 })} disabled={section.widgets.some(isLocked)} onClick={() => set(removeSection(sections, section.id))} data-testid={`grid-editor-remove-section-${si}`}>
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
            {flow ? (
              flowGrid(section, si)
            ) : (
            <ol className={cn('grid gap-2', COLS[section.columns])}>
              {cells.map((cell) => (
                <li key={cell.column} className="flex min-w-0 flex-col gap-2" data-slot={cell.column + 1}>
                  {cell.widgets.map((widget, wi) =>
                    tile(widget, `${section.id}:${cell.column}:${widget.id}`, () => (dragging ? placeWidget(sections, dragging, section.id, cell.column, wi, widget.id) : sections)),
                  )}
                  {Array.from({ length: cell.stack - cell.widgets.length }, (_, i) => (
                    <div
                      key={`free-${i}`}
                      className={cn('relative flex min-h-[72px] rounded-[12px] border border-dashed border-m3ft-outline-variant', over === `${section.id}:${cell.column}:free` && 'border-m3ft-primary')}
                      {...drop(`${section.id}:${cell.column}:free`, () => (dragging ? placeWidget(sections, dragging, section.id, cell.column) : sections))}
                    >
                      <WidgetPicker
                        compact
                        options={options}
                        label={t('split_views.grid.addToSection', 'Dodaj widżet do sekcji {n}', { n: si + 1 })}
                        addLabel={t('split_views.grid.add', 'Dodaj')}
                        testId={`grid-editor-free-${si}-${cell.column}-${i}`}
                        onPick={(type) => set(addWidget(sections, section.id, create(type), cell.column))}
                      />
                      {cell.stack > 1 && i === cell.stack - cell.widgets.length - 1 ? (
                        <button type="button" className={cn(iconBtn, 'absolute right-1 top-1 size-6')} title={t('split_views.grid.mergeHint', 'Usuń to miejsce (scal slot)')} aria-label={t('split_views.grid.merge', 'Usuń miejsce w pionie — slot {slot}, sekcja {n}', { slot: cell.column + 1, n: si + 1 })} onClick={() => set(setStack(sections, section.id, cell.column, cell.stack - 1))}>
                          <X className="size-3.5" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {cell.stack < MAX_STACK ? (
                    <button
                      type="button"
                      className="inline-flex h-7 items-center justify-center gap-1 rounded-[8px] text-body-regular-xs text-m3ft-on-surface-variant hover:bg-m3ft-surface-container hover:text-m3ft-on-surface"
                      onClick={() => set(setStack(sections, section.id, cell.column, cell.stack + 1))}
                      title={t('split_views.grid.splitHint', 'Dodaj miejsce pod spodem (w pionie)')}
                      aria-label={t('split_views.grid.splitSlot', 'Podziel w pionie: slot {slot}, sekcja {n}', { slot: cell.column + 1, n: si + 1 })}
                      data-testid={`grid-editor-split-${si}-${cell.column}`}
                    >
                      <Plus className="size-3.5" aria-hidden />
                      {t('split_views.grid.vertical', 'w pionie')}
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
            )}
          </section>
        )
      })}
      <AddSection testId="grid-editor-add-section" onAdd={(columns) => set(inViewDensity(sections, addSection(sections, gridId('section'), columns)))} />
    </div>
  )
}

/**
 * The drawer around `GridEditor`: title ("Dostosuj pulpit", "Dostosuj widok · Główna"),
 * the editor on a draft, and Anuluj · Przywróć zestaw · Zastosuj. 880 px — the
 * design system's drawer width (fms-design 30.09).
 */
export function GridCustomizeSheet<T extends W>({
  open,
  onOpenChange,
  title,
  subtitle,
  sections,
  onApply,
  onRestore,
  restoreLabel,
  saving,
  extra,
  ...editor
}: Omit<GridEditorProps<T>, 'sections' | 'onChange'> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  subtitle?: string | null
  /** The layout the drawer starts from (copied into a draft on every open). */
  sections: GridSection<T>[]
  onApply: (sections: GridSection<T>[]) => void | Promise<void>
  /** "Przywróć zestaw": back to the preset (the role's, or the code default). */
  onRestore?: () => void | Promise<void>
  restoreLabel?: string
  saving?: boolean
  /**
   * Extra content under the sections (e.g. role settings link). A function gets
   * the draft — for controls that act on what is being edited, not on the page.
   */
  extra?: React.ReactNode | ((draft: GridSection<T>[], setDraft: (next: GridSection<T>[]) => void) => React.ReactNode)
}) {
  const t = useT()
  const [draft, setDraft] = React.useState(sections)
  React.useEffect(() => {
    if (open) setDraft(sections)
    // Re-seed on open only: while open the draft is the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        ariaTitle={title}
        className="theme-m3-freighttech flex w-full flex-col gap-0 bg-m3ft-surface p-0 sm:max-w-none"
        style={{ maxWidth: 880, width: '100%' }}
        data-testid="grid-customize-sheet"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void onApply(draft)
          }
        }}
      >
        <header className="flex items-center gap-3 border-b border-m3ft-outline-variant px-6 py-4">
          <h2 className="min-w-0 flex-1 truncate text-heading-semibold-lg text-m3ft-on-surface">
            {title}
            {subtitle ? <span className="text-m3ft-on-surface-variant"> · {subtitle}</span> : null}
          </h2>
          <button type="button" className={iconBtn} aria-label={t('split_views.grid.close', 'Zamknij')} onClick={() => onOpenChange(false)}>
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <GridEditor {...editor} sections={draft} onChange={setDraft} />
          {typeof extra === 'function' ? extra(draft, setDraft) : extra}
        </div>
        <footer className="flex items-center gap-2 border-t border-m3ft-outline-variant px-6 py-3">
          <button type="button" className={gridBtnText} onClick={() => onOpenChange(false)} data-testid="grid-customize-cancel">
            {t('split_views.grid.cancel', 'Anuluj')}
          </button>
          {onRestore ? (
            <button type="button" className={gridBtnText} onClick={() => void onRestore()} disabled={saving} data-testid="grid-customize-restore">
              {restoreLabel ?? t('split_views.grid.restore', 'Przywróć zestaw')}
            </button>
          ) : null}
          <span className="flex-1" />
          <button type="button" className={gridBtnPrimary} onClick={() => void onApply(draft)} disabled={saving} data-testid="grid-customize-apply">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {t('split_views.grid.apply', 'Zastosuj')}
          </button>
        </footer>
      </SheetContent>
    </Sheet>
  )
}
