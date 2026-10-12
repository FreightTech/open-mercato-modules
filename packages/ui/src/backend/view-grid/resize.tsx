'use client'

/**
 * Resizing a widget by dragging (spec 2026-10-07-grid-widget-spans D3; owner 07.10:
 * "more dragging and resizing"): handles on the right edge, the bottom edge and the
 * corner of a grid item (in "Dostosuj widok" only — never on the page, owner 07.10).
 * The pointer snaps to the section's columns and rows; the host previews every step
 * live (`resizeWidget`: a neighbour narrows to make room) and commits on release.
 * Arrow keys on the corner handle resize by one (←/→ width, ↑/↓ height).
 */

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from './cn'
import { MAX_ROWS, type GridSize } from './model'

type Axis = 'x' | 'y' | 'both'

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** The item's column and row (0-based) and the grid's measurements at the start of a drag. */
function measure(item: HTMLElement, columns: number) {
  const grid = item.parentElement as HTMLElement
  const style = getComputedStyle(grid)
  const colGap = parseFloat(style.columnGap) || 0
  const rowGap = parseFloat(style.rowGap) || 0
  const gridRect = grid.getBoundingClientRect()
  const itemRect = item.getBoundingClientRect()
  const colWidth = (gridRect.width - colGap * (columns - 1)) / columns
  const startCol = clamp(Math.round((itemRect.left - gridRect.left) / (colWidth + colGap)), 0, columns - 1)
  // Row tracks as laid out now; rows past them count as the grid's minimum row height.
  const tracks = style.gridTemplateRows.split(' ').map((v) => parseFloat(v)).filter((n) => Number.isFinite(n))
  const minRow = parseFloat(style.gridAutoRows.match(/minmax\(([\d.]+)px/)?.[1] ?? '') || 128
  let top = 0
  let startRow = 0
  while (startRow < tracks.length && top + tracks[startRow] / 2 < itemRect.top - gridRect.top) {
    top += tracks[startRow] + rowGap
    startRow++
  }
  return { colGap, rowGap, colWidth, startCol, tracks, minRow, itemRect, startRow }
}

/** Starts a drag of a resize handle; `preview` on every new size, `commit` once on release. */
export function beginResize(
  event: React.PointerEvent<HTMLElement>,
  axis: Axis,
  columns: number,
  start: GridSize,
  preview: (size: GridSize) => void,
  commit: (size: GridSize) => void,
) {
  const item = event.currentTarget.closest('[data-grid-item]') as HTMLElement | null
  if (!item || event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const m = measure(item, columns)
  const maxW = columns - m.startCol
  let last = start
  const move = (ev: PointerEvent) => {
    let w = last.w
    let h = last.h
    if (axis !== 'y') w = clamp(Math.round((ev.clientX - m.itemRect.left + m.colGap) / (m.colWidth + m.colGap)), 1, maxW)
    if (axis !== 'x') {
      const dy = ev.clientY - m.itemRect.top
      let acc = 0
      h = 0
      for (let r = m.startRow; h < MAX_ROWS; r++) {
        const track = m.tracks[r] ?? m.minRow
        if (h > 0 && acc + track / 2 > dy) break
        acc += track + m.rowGap
        h++
      }
      h = clamp(h, 1, MAX_ROWS)
    }
    if (w !== last.w || h !== last.h) {
      last = { w, h }
      preview(last)
    }
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
    commit(last)
  }
  document.body.style.cursor = axis === 'x' ? 'ew-resize' : axis === 'y' ? 'ns-resize' : 'nwse-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}

export type ResizeHandlesProps = {
  columns: number
  size: GridSize
  name: string
  onPreview: (size: GridSize) => void
  onCommit: (size: GridSize) => void
  testId?: string
  /** Always shown (the editor), not only on hover. */
  visible?: boolean
}

/**
 * The three handles of a grid item. The item must carry `data-grid-item`, be
 * `relative` and a `group/item` (the handles show on hover and while focused).
 */
export function ResizeHandles({ columns, size, name, onPreview, onCommit, testId, visible }: ResizeHandlesProps) {
  const t = useT()
  const edge = cn(
    'group/handle absolute z-20 transition-opacity focus-visible:opacity-100',
    visible ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover/item:opacity-100',
  )
  const bar = 'rounded-full bg-m3ft-primary transition-transform group-hover/handle:scale-125'
  return (
    <>
      {/* One column: nothing to widen into — no width handle (the corner still sets the height). */}
      {columns > 1 ? (
        <span
          aria-hidden
          className={cn(edge, 'inset-y-6 -right-2 flex w-4 cursor-ew-resize items-center justify-center')}
          title={t('split_views.grid.resizeWidth', 'Przeciągnij, aby zmienić szerokość')}
          onPointerDown={(e) => beginResize(e, 'x', columns, size, onPreview, onCommit)}
          data-testid={testId ? `${testId}-x` : undefined}
        >
          <span className={cn(bar, 'h-10 w-1')} />
        </span>
      ) : null}
      <span
        aria-hidden
        className={cn(edge, 'inset-x-6 -bottom-2 flex h-4 cursor-ns-resize items-center justify-center')}
        title={t('split_views.grid.resizeHeight', 'Przeciągnij, aby zmienić wysokość')}
        onPointerDown={(e) => beginResize(e, 'y', columns, size, onPreview, onCommit)}
        data-testid={testId ? `${testId}-y` : undefined}
      >
        <span className={cn(bar, 'h-1 w-10')} />
      </span>
      <button
        type="button"
        className={cn(edge, '-bottom-2 -right-2 size-5 cursor-nwse-resize rounded-[6px] border-2 border-m3ft-primary bg-m3ft-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-m3ft-outline')}
        aria-label={t('split_views.grid.resize', 'Zmień rozmiar: {name} — {w} × {h} (strzałki)', { name, w: size.w, h: size.h })}
        title={t('split_views.grid.resizeHint', 'Przeciągnij, aby zmienić szerokość i wysokość')}
        onPointerDown={(e) => beginResize(e, 'both', columns, size, onPreview, onCommit)}
        onKeyDown={(e) => {
          const step: Record<string, GridSize> = {
            ArrowRight: { w: size.w + 1, h: size.h },
            ArrowLeft: { w: size.w - 1, h: size.h },
            ArrowDown: { w: size.w, h: size.h + 1 },
            ArrowUp: { w: size.w, h: size.h - 1 },
          }
          const next = step[e.key]
          if (!next) return
          e.preventDefault()
          e.stopPropagation()
          onCommit({ w: clamp(next.w, 1, columns), h: clamp(next.h, 1, MAX_ROWS) })
        }}
        data-testid={testId}
      />
    </>
  )
}

/** "2 × 2" over an item while it is being resized. */
export function SizeBadge({ size }: { size: GridSize }) {
  return (
    <span className="pointer-events-none absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-[8px] bg-m3ft-on-surface px-2 py-1 text-label-semibold-xs tabular-nums text-m3ft-surface">
      {size.w} × {size.h}
    </span>
  )
}
