'use client'

// Choose what goes in a slot: a whole table ("Całe działy") or a widget.
//
// One catalogue, three entry points — the empty slot's "Dodaj tabelę lub
// widget", the workspace bar's "Dodaj widget", and a pane's "Podmień na…" — so
// the list is built ONCE here (`useContentGroups`) and each entry point only
// decides where it renders.
//
// Grouping follows the designer's prototype: tables first under one heading,
// then widgets by KIND (charts, lists, cards…) rather than by owning module.
// Kind is the axis the user is choosing on — "I want a chart here" — and a
// module id means nothing to someone who did not write it.
//
// Already-open entries are NOT marked any more. The prototype dropped the
// "OPEN" chip (gt-demo b83f137): two panes of one table with different views is
// a legitimate layout, and the chip read as "you cannot pick this". The swap
// menu leaves out only the content already in THAT pane.
//
// ACL is not resolved here, in either half: tables come from the host's grant
// check via the registry context, widgets arrive already filtered server-side.
//
// Spec: .ai/specs/2026-09-23-split-view-workspace-customize.md

import * as React from 'react'
import { Search } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useAccessibleContent, type PaneContentItem } from '../registry/ContentRegistryContext'
import { WIDGET_KINDS, widgetPresentation, type WidgetKind } from '../registry/widgetPresentation'
import { AnchoredPanel } from './AnchoredMenu'
import { M3_MENU_CAPTION, M3_MENU_ROW } from './chrome'
import type { PaneContentRef } from './types'

type Translate = ReturnType<typeof useT>

const MENU_WIDTH = 300
const MENU_MAX_HEIGHT = 420

/** The ref a picked item becomes. Widgets carry their loader key so a saved
 *  layout can be reopened without re-deriving it from the catalogue. */
export function contentRefFor(item: PaneContentItem): PaneContentRef {
  return item.kind === 'table'
    ? { kind: 'table', tableId: item.id }
    : { kind: 'widget', widgetId: item.id, loaderKey: item.loaderKey }
}

/** Is `item` what `ref` points at? */
export function isSameContent(item: PaneContentItem, ref: PaneContentRef | null | undefined): boolean {
  if (!ref) return false
  return ref.kind === 'table'
    ? item.kind === 'table' && ref.tableId === item.id
    : item.kind === 'widget' && ref.widgetId === item.id
}

/** A title in the user's language — tables carry an i18n key, widgets get one here. */
export function contentTitle(t: Translate, item: PaneContentItem): string {
  if (item.kind === 'table') {
    const key = item.definition?.metadata.titleKey
    return key ? t(key, item.title) : item.title
  }
  return t(`splitView.widgetTitle.${item.id}`, item.title)
}

const KIND_FALLBACK: Record<WidgetKind, string> = {
  charts: 'Charts',
  lists: 'Lists',
  cards: 'Cards',
  activity: 'Activity',
  process: 'Process',
  triage: 'Triage & deadlines',
  tables: 'Tables',
  banners: 'Banners',
  map: 'Map',
  other: 'Other',
}

export type ContentGroup = { key: string; label: string; items: Array<{ item: PaneContentItem; title: string }> }

/**
 * The catalogue as display groups, filtered by `query` and without `exclude`.
 * Empty groups are dropped, so a search never shows a heading over nothing.
 */
export function useContentGroups(query = '', exclude?: PaneContentRef | null): ContentGroup[] {
  const t = useT()
  const items = useAccessibleContent()
  return React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = items
      .filter((item) => !exclude || !isSameContent(item, exclude))
      .map((item) => ({ item, title: contentTitle(t, item) }))
      .filter(({ item, title }) =>
        !needle || title.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.title.localeCompare(b.title))

    const groups: ContentGroup[] = [
      {
        key: 'tables',
        label: t('splitView.picker.tables', 'Whole sections'),
        items: rows.filter((row) => row.item.kind === 'table'),
      },
      ...WIDGET_KINDS.map((kind) => ({
        key: `widgets:${kind}`,
        label: t(`splitView.picker.kind.${kind}`, KIND_FALLBACK[kind]),
        items: rows.filter(
          (row) => row.item.kind === 'widget' && (widgetPresentation(row.item.id).kind ?? 'other') === kind,
        ),
      })),
    ]
    return groups.filter((group) => group.items.length > 0)
  }, [items, query, exclude, t])
}

/**
 * The grouped list, with its own search field. Rendered inside any menu panel.
 */
export function ContentCatalogList({
  onPick,
  exclude,
  autoFocus = true,
  showSearch = true,
}: {
  onPick: (content: PaneContentRef, item: PaneContentItem) => void
  /** Leave this one out — the content already in the pane being swapped. */
  exclude?: PaneContentRef | null
  autoFocus?: boolean
  showSearch?: boolean
}) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const groups = useContentGroups(query, exclude)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // One frame late on purpose: the panel this sits in renders hidden for its
  // first frame while it measures where to go, and a hidden input cannot take
  // focus — the field looked focusable and silently was not.
  React.useEffect(() => {
    if (!autoFocus) return
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [autoFocus])

  return (
    <div className="flex min-h-0 flex-col" data-split-picker-list="">
      {showSearch && (
        // A tinted band rather than a bordered field: the whole row is the
        // field, and focus lights the band — the input inside is borderless.
        <div className="mb-1 flex h-8 shrink-0 items-center gap-2 rounded-m3-sm bg-[var(--m3-surface-container-high)] px-2 transition-[background-color,box-shadow] duration-[var(--m3-duration-short2)] ease-m3-standard focus-within:bg-[var(--m3-surface-container-highest)] focus-within:shadow-[var(--m3-focus-ring-inset)]">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--m3-on-surface-variant)]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('splitView.picker.search', 'Add table or widget…')}
            aria-label={t('splitView.picker.search', 'Add table or widget…')}
            className="min-w-0 flex-1 bg-transparent text-body-regular-xs text-[var(--m3-on-surface)] outline-none placeholder:text-[var(--m3-on-surface-variant)]"
            data-split-picker-search=""
          />
        </div>
      )}
      <div className="min-h-0 overflow-y-auto">
        {groups.length === 0 && (
          <div
            className="px-2 py-4 text-center text-body-regular-xs text-[var(--m3-on-surface-variant)]"
            data-split-picker-empty=""
          >
            {t('splitView.picker.empty', 'No results')}
          </div>
        )}
        {groups.map((group, index) => (
          <div
            key={group.key}
            // The hairline between groups is the group's own top border, so the
            // caption stays its first child (specs read the label from it).
            className={index > 0 ? 'mt-1 border-t border-[var(--m3-outline-variant)] pt-1' : undefined}
            data-split-picker-kind={group.key === 'tables' ? 'table' : 'widget'}
            data-split-picker-group={group.key}
          >
            <div className={`px-3 pb-1 pt-2 ${M3_MENU_CAPTION}`}>{group.label}</div>
            {group.items.map(({ item, title }) => (
              <button
                key={`${item.kind}:${item.id}`}
                type="button"
                onClick={() => onPick(contentRefFor(item), item)}
                className={M3_MENU_ROW}
                data-split-picker-item={item.id}
                data-split-picker-item-kind={item.kind}
              >
                <span className="truncate">{title}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The picker as a free-standing popup anchored to whatever opened it — the
 * empty slot, the "Dodaj obok" buttons. Kept under its old name and props so
 * every existing caller is unchanged.
 */
export function ContentPicker({
  anchorRect,
  onPick,
  onClose,
}: {
  /** Bounding rect of the control that opened this. */
  anchorRect: DOMRect | null
  /** Kept for API compatibility; open content is no longer marked. */
  openContent?: PaneContentRef[]
  onPick: (content: PaneContentRef) => void
  onClose: () => void
}) {
  const t = useT()
  if (!anchorRect) return null
  return (
    <AnchoredPanel
      anchor={anchorRect}
      placement={{ width: MENU_WIDTH, preferredHeight: MENU_MAX_HEIGHT, align: 'end' }}
      onClose={onClose}
      role="dialog"
      aria-label={t('splitView.picker.title', 'Add table or widget')}
      data-split-picker=""
    >
      <ContentCatalogList onPick={(content) => onPick(content)} />
    </AnchoredPanel>
  )
}

export default ContentPicker
