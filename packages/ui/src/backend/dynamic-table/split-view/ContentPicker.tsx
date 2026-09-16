'use client'

// Choose what goes in a slot: a table or a dashboard widget.
//
// The superseded table-only picker with a second kind of thing in it (that file
// is gone; this replaced it outright). Everything that made the original work is
// kept deliberately unchanged — a context dropdown anchored to whatever
// opened it (not a centred modal that hides the layout you are adding to),
// portalled to `document.body` because panes clip their overflow, positioned by
// the same `computeAnchoredPosition` every other menu in the grid uses, and
// already-open entries MARKED rather than hidden, because two panes of one table
// with different views is a legitimate layout.
//
// The one addition is a level of hierarchy: KIND first (Tables / Widgets), then
// the existing per-module group headers inside each. Kind is the axis the user
// is actually choosing on — "I want a chart here, not another grid" — so it
// outranks the module, and putting it first keeps the two catalogues from
// interleaving into one undifferentiated list as the registry grows.
//
// ACL is not resolved here, in either half: tables come from the host's grant
// check via the registry context, widgets arrive already filtered server-side.
//
// Spec: .ai/specs/2026-08-17-split-view-workspace-composition.md (Phase 2)

import * as React from 'react'
import ReactDOM from 'react-dom'
import { Search } from 'lucide-react'
import { computeAnchoredPosition } from '../utils/anchoredPosition'
import { useAccessibleContent, type PaneContentItem } from '../registry/ContentRegistryContext'
import type { PaneContentRef } from './types'

const MENU_WIDTH = 300
const MENU_MAX_HEIGHT = 340

const KIND_LABEL: Record<PaneContentItem['kind'], string> = {
  table: 'Tables',
  widget: 'Widgets',
}
// Tables first: they are the bulk of the catalogue and the thing a split view is
// usually for. Widgets are the accent, not the headline.
const KIND_ORDER: Array<PaneContentItem['kind']> = ['table', 'widget']

/** The ref a picked item becomes. Widgets carry their loader key so a saved
 *  layout can be reopened without re-deriving it from the catalogue. */
export function contentRefFor(item: PaneContentItem): PaneContentRef {
  return item.kind === 'table'
    ? { kind: 'table', tableId: item.id }
    : { kind: 'widget', widgetId: item.id, loaderKey: item.loaderKey }
}

function isOpen(item: PaneContentItem, open: PaneContentRef[]): boolean {
  return open.some((ref) =>
    ref.kind === 'table'
      ? item.kind === 'table' && ref.tableId === item.id
      : item.kind === 'widget' && ref.widgetId === item.id,
  )
}

export function ContentPicker({
  anchorRect,
  openContent,
  onPick,
  onClose,
}: {
  /** Bounding rect of the control that opened this. */
  anchorRect: DOMRect | null
  /** What the layout already holds — marked, never hidden. */
  openContent: PaneContentRef[]
  onPick: (content: PaneContentRef) => void
  onClose: () => void
}) {
  const items = useAccessibleContent()
  const [query, setQuery] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const boxRef = React.useRef<HTMLDivElement>(null)

  const [placement, setPlacement] = React.useState({
    top: 0,
    left: 0,
    maxHeight: MENU_MAX_HEIGHT,
  })

  React.useLayoutEffect(() => {
    if (!anchorRect) return
    const next = computeAnchoredPosition(
      anchorRect,
      { width: window.innerWidth, height: window.innerHeight },
      { width: MENU_WIDTH, preferredHeight: MENU_MAX_HEIGHT, align: 'end', minHeight: 160 },
    )
    setPlacement({ top: next.top, left: next.left, maxHeight: next.maxHeight })
  }, [anchorRect])

  React.useEffect(() => {
    inputRef.current?.focus()
  }, [])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) onClose()
    }
    // Scroll/resize move the anchor out from under us; close rather than leave
    // a menu floating next to nothing.
    //
    // But ONLY a scroll that actually moves the anchor counts. This listener is
    // capture-phase on `window`, so it also hears every inner scroller — and a
    // pane emits a scroll event one frame after the picker mounts, which
    // dismissed the menu ~6ms after it opened. The user-visible symptom was
    // that clicking an empty slot in a workspace that already had a filled pane
    // "did nothing" — reliably, on the second fill of a 2×2.
    //
    // Panes scroll INSIDE the layout; the slot the picker is anchored to does
    // not move when they do. So element-level scrolls are ignored and only a
    // document-level scroll dismisses.
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target !== document.scrollingElement) return
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [onClose])

  const sections = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matching = needle
      ? items.filter(
          (item) =>
            item.title.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle),
        )
      : items

    return KIND_ORDER.map((kind) => {
      const byGroup = new Map<string, PaneContentItem[]>()
      for (const item of matching) {
        if (item.kind !== kind) continue
        const key = item.group ?? 'Other'
        const list = byGroup.get(key) ?? []
        list.push(item)
        byGroup.set(key, list)
      }
      return {
        kind,
        groups: Array.from(byGroup.entries()).sort(([a], [b]) => a.localeCompare(b)),
      }
    }).filter((section) => section.groups.length > 0)
  }, [items, query])

  const menu = (
    <div
      ref={boxRef}
      role="dialog"
      aria-label="Add table or widget"
      className="fixed z-[1000] overflow-hidden rounded-m3-md border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container)] shadow-m3-2"
      style={{
        top: placement.top,
        left: placement.left,
        width: MENU_WIDTH,
        maxHeight: placement.maxHeight,
      }}
      data-split-picker=""
    >
      {/* A tinted band rather than a hairline, and the focus signal is on
          the whole row — the input inside it is borderless, so a halo on the
          field alone would float in the middle of nothing.
          The band steps the container UP from the panel and up again on focus,
          which reads the same direction in BOTH schemes (light gets greyer,
          dark gets lighter); stepping DOWN would invert between them. */}
      <div className="flex items-center gap-2 bg-[var(--m3-surface-container-high)] px-2 py-1.5 transition-[background-color,box-shadow] duration-[var(--m3-duration-short2)] ease-m3-standard focus-within:bg-[var(--m3-surface-container-highest)] focus-within:shadow-[var(--m3-focus-ring-inset)]">
        <Search className="h-3.5 w-3.5 text-[var(--m3-on-surface-variant)]" aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Add table or widget…"
          className="min-w-0 flex-1 bg-transparent text-body-regular-xs text-[var(--m3-on-surface)] outline-none placeholder:text-[var(--m3-on-surface-variant)]"
          data-split-picker-search=""
        />
      </div>

      <div className="overflow-y-auto p-1" style={{ maxHeight: placement.maxHeight - 38 }}>
        {sections.length === 0 && (
          <div
            className="px-2 py-4 text-center text-body-regular-xs text-[var(--m3-on-surface-variant)]"
            data-split-picker-empty=""
          >
            No tables or widgets available.
          </div>
        )}
        {sections.map((section) => (
          <div key={section.kind} data-split-picker-kind={section.kind}>
            {/* Section ink is `on-surface`, group ink below is `on-surface-variant`.
                Both levels used to be 12px in the SAME muted ink, and the group
                carried uppercase + tracking — so the lower level read as the more
                emphatic one and the hierarchy inverted. */}
            <div className="px-2 pb-1 pt-2 text-label-semibold-xs text-[var(--m3-on-surface)]">
              {KIND_LABEL[section.kind]}
            </div>
            {section.groups.map(([group, groupItems]) => (
              <div key={group}>
                <div className="px-2 pb-0.5 pt-1.5 text-label-semibold-2xs uppercase tracking-wider text-[var(--m3-on-surface-variant)]">
                  {group}
                </div>
                {groupItems.map((item) => {
                  const alreadyOpen = isOpen(item, openContent)
                  return (
                    <button
                      key={`${item.kind}:${item.id}`}
                      type="button"
                      onClick={() => onPick(contentRefFor(item))}
                      data-split-picker-item={item.id}
                      data-split-picker-item-kind={item.kind}
                      className="flex w-full items-center justify-between gap-2 rounded-m3-xs px-2 py-1 text-left text-body-regular-xs text-[var(--m3-on-surface)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-state-layer-hover)] active:bg-[var(--m3-state-layer-pressed)]"
                    >
                      <span className="truncate">{item.title}</span>
                      {/* A marked entry is not a dimmed one — it is a real
                          state, so it gets the selection container as a chip. */}
                      {alreadyOpen && (
                        <span className="shrink-0 rounded-m3-full bg-[var(--m3-secondary-container)] px-1.5 text-label-semibold-2xs uppercase text-[var(--m3-on-secondary-container)]">
                          open
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return menu
  return ReactDOM.createPortal(menu, document.body)
}

export default ContentPicker
