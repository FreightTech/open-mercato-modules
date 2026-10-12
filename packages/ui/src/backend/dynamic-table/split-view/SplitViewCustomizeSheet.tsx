'use client'

/**
 * "Dostosuj widok" for the split view — the SAME editor as the contractor page
 * and the Pulpit (`../../view-grid`): sections of 1–6 slots one under another,
 * each pane a tile, "+ Dodaj" in a free place, "Dodaj sekcję", and nothing is
 * changed before "Zastosuj" (owner 12.10: "I don't want separate things to do
 * the same thing").
 *
 * The layout document is unchanged (`SplitLayout`); the editor reads and writes
 * it through `gridFromSplit` / `splitFromGrid`, exactly as the Pulpit does. A
 * layout the editor did not change is never rewritten, so a tree the grid
 * cannot draw (an older nested template) survives opening and closing it.
 *
 * Below the sections: the search switches (the shared search row is OFF unless
 * turned on here — it costs a row above every pane) and the saved layouts.
 */

import * as React from 'react'
import { Check, Search } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Toggle } from '../../../primitives-v2/Toggle'
import { GridCustomizeSheet, gridBtnSecondary } from '../../view-grid/GridEditor'
import { gridFromSplit, splitFromGrid, type PaneWidget } from '../../view-grid/split-layout'
import type { GridSection } from '../../view-grid/model'
import type { WidgetOption } from '../../view-grid/WidgetPicker'
import { cn } from '../../view-grid/cn'
import { instanceContent } from '../../dashboard/widgetInstances'
import { useTableRegistry } from '../registry/TableRegistryContext'
import { MenuPortalContext } from './AnchoredMenu'
import { contentRefFor, isSameInstance, useContentGroups, type ContentRow } from './ContentPicker'
import { SavedLayoutRow } from './CustomizeDrawer'
import { useSplitViewLayouts } from './useSplitViewLayouts'
import { isDefaultLayout, layoutSignature, makePaneId, resetLayout, type PaneContentRef, type SplitLayout } from './types'

type SetLayout = (update: (current: SplitLayout) => SplitLayout) => void

export type SplitViewCustomizeSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  layout: SplitLayout
  setLayout: SetLayout
  /** The page's own table: its pane is locked in the editor (the page IS that table). */
  primaryTableId: string
  primaryPaneId: string | undefined
}

type SearchSwitches = { workspaceSearch: boolean; paneSearch: boolean }

/** The search switches a layout has — the shared row is opt-in (owner 12.10). */
export function searchSwitchesOf(layout: Pick<SplitLayout, 'workspaceSearch' | 'paneSearch'>): SearchSwitches {
  const workspaceSearch = layout.workspaceSearch === true
  return { workspaceSearch, paneSearch: layout.paneSearch ?? !workspaceSearch }
}

function withSearch(layout: SplitLayout, search: SearchSwitches): SplitLayout {
  const current = searchSwitchesOf(layout)
  if (current.workspaceSearch === search.workspaceSearch && current.paneSearch === search.paneSearch) return layout
  return { ...layout, workspaceSearch: search.workspaceSearch, paneSearch: search.paneSearch }
}

const sameGrid = (a: GridSection<PaneWidget>[], b: GridSection<PaneWidget>[]) => JSON.stringify(a) === JSON.stringify(b)

const valueOfRow = (row: ContentRow): string =>
  row.instance
    ? `instance:${row.instance.widgetId}:${row.instance.instance.key}`
    : row.item.kind === 'table'
      ? `table:${row.item.id}`
      : `widget:${row.item.id}`

/** A block under the sections, framed like them. */
function Block({ title, children, ...rest }: { title: string; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className="mt-3 flex flex-col gap-2 rounded-[16px] border border-m3ft-outline-variant p-3" {...rest}>
      <strong className="text-body-medium-sm text-m3ft-on-surface">{title}</strong>
      {children}
    </section>
  )
}

function SwitchRow({ label, hint, checked, onChange, testId }: { label: string; hint?: string; checked: boolean; onChange: (next: boolean) => void; testId: string }) {
  const id = React.useId()
  return (
    <div className="flex items-start gap-3 py-1" data-split-search-switch={testId} data-on={checked ? 'true' : 'false'}>
      <Search className="mt-0.5 size-4 shrink-0 text-m3ft-on-surface-variant" aria-hidden />
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col">
        <span className="text-body-regular-sm text-m3ft-on-surface">{label}</span>
        {hint ? <span className="text-body-regular-xs text-m3ft-on-surface-variant">{hint}</span> : null}
      </label>
      <Toggle id={id} checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </div>
  )
}

export function SplitViewCustomizeSheet({ open, onOpenChange, layout, setLayout, primaryTableId, primaryPaneId }: SplitViewCustomizeSheetProps) {
  const t = useT()
  const registry = useTableRegistry()
  const groups = useContentGroups('')
  const { layouts, save, remove, rename, share } = useSplitViewLayouts(primaryTableId)
  const [portalTarget, setPortalTarget] = React.useState<HTMLElement | null>(null)
  const [layoutName, setLayoutName] = React.useState('')

  // The grid as the layout is now. The sheet copies it into its draft on open.
  const sections = React.useMemo(() => gridFromSplit(layout), [layout])
  const [search, setSearch] = React.useState<SearchSwitches>(() => searchSwitchesOf(layout))
  React.useEffect(() => {
    if (open) setSearch(searchSwitchesOf(layout))
    // Re-seed on open only, like the grid draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // One list for every free place and "Podmień": tables, saved widget instances, widgets.
  const { options, contentOf, rows } = React.useMemo(() => {
    const contentOf = new Map<string, PaneContentRef>()
    const options: WidgetOption[] = []
    const rows: ContentRow[] = []
    for (const group of groups) {
      for (const row of group.items) {
        const value = valueOfRow(row)
        if (contentOf.has(value)) continue
        contentOf.set(value, row.instance ? instanceContent(row.instance) : contentRefFor(row.item))
        options.push({ value, label: row.title, group: group.label, description: row.description ?? null })
        rows.push(row)
      }
    }
    return { options, contentOf, rows }
  }, [groups])

  const titleOf = React.useCallback(
    (content: PaneContentRef): string => {
      if (content.kind === 'table') {
        const definition = registry.tables.find((table) => table.metadata.id === content.tableId)
        return definition ? t(definition.metadata.titleKey, definition.metadata.title) : content.tableId
      }
      // A slot showing a saved instance is named by it ("Revenue by carrier"), not by its widget type.
      const instance = rows.find((row) => row.instance && isSameInstance(row.instance, content))
      if (instance) return instance.title
      const widget = rows.find((row) => !row.instance && row.item.kind === 'widget' && row.item.id === content.widgetId)
      return widget?.title ?? t(`splitView.widgetTitle.${content.widgetId}`, content.widgetId)
    },
    [registry.tables, rows, t],
  )

  const name = React.useCallback(
    (widget: PaneWidget) => {
      const title = titleOf(widget.content)
      return widget.id === primaryPaneId ? t('splitView.customize.mainSlot', '{title} · main', { title }) : title
    },
    [titleOf, primaryPaneId, t],
  )

  const create = React.useCallback(
    (value: string): PaneWidget => ({ id: makePaneId(), content: contentOf.get(value) ?? { kind: 'table', tableId: value.replace(/^table:/, '') } }),
    [contentOf],
  )

  /** The layout the draft stands for — the live one, untouched, when the grid did not change. */
  const layoutOf = React.useCallback(
    (draft: GridSection<PaneWidget>[]) => withSearch(sameGrid(draft, sections) ? layout : splitFromGrid(draft, layout), search),
    [sections, layout, search],
  )

  const close = () => onOpenChange(false)
  const signature = layoutSignature(layout)
  const activeId = layouts.find((saved) => layoutSignature(saved.layout) === signature)?.id ?? null
  const isDefault = isDefaultLayout(layout, primaryTableId)
  const primaryTitle = titleOf({ kind: 'table', tableId: primaryTableId })

  return (
    <GridCustomizeSheet<PaneWidget>
      open={open}
      onOpenChange={onOpenChange}
      title={t('splitView.customize.sheetTitle', 'Customize view')}
      subtitle={primaryTitle}
      sections={sections}
      name={name}
      options={options}
      create={create}
      locked={(widget) => widget.id === primaryPaneId}
      restoreLabel={t('splitView.customize.clear', 'Clear layout')}
      onRestore={() => {
        setLayout((current) => resetLayout(current, primaryTableId))
        close()
      }}
      onApply={(draft) => {
        const next = layoutOf(draft)
        if (next !== layout) setLayout(() => next)
        close()
      }}
      extra={(draft) => (
        <MenuPortalContext.Provider value={portalTarget}>
          <div ref={setPortalTarget} data-split-customize="">
            <Block title={t('splitView.bar.searchSection', 'Search')} data-split-customize-search="">
              <SwitchRow
                testId="workspaceSearch"
                label={t('splitView.customize.sharedSearch', 'One search above all panes')}
                hint={t('splitView.customize.sharedSearchHint', 'Adds a row above the panes; typing there searches every table at once.')}
                checked={search.workspaceSearch}
                onChange={(next) => setSearch((current) => ({ ...current, workspaceSearch: next }))}
              />
              <SwitchRow
                testId="paneSearch"
                label={t('splitView.customize.paneSearch', 'Search box in each table')}
                checked={search.paneSearch}
                onChange={(next) => setSearch((current) => ({ ...current, paneSearch: next }))}
              />
            </Block>

            <Block title={t('splitView.bar.savedLayouts', 'Saved layouts')} data-split-layouts-menu="">
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setLayout((current) => resetLayout(current, primaryTableId))
                    close()
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-left',
                    isDefault ? 'bg-m3ft-secondary-container text-m3ft-on-secondary-container' : 'text-m3ft-on-surface hover:bg-m3ft-surface-container',
                  )}
                  data-split-layout-default=""
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body-medium-sm">{t('splitView.layouts.default', 'Default view')}</span>
                    <span className="text-body-regular-xs opacity-80">{t('splitView.layouts.defaultMeta', 'The page’s own table')}</span>
                  </span>
                  {isDefault ? <Check className="size-4 shrink-0" aria-hidden /> : null}
                </button>
                {layouts.map((saved) => (
                  <SavedLayoutRow
                    key={saved.id}
                    saved={saved}
                    active={saved.id === activeId}
                    onApply={() => {
                      setLayout(() => saved.layout)
                      close()
                    }}
                    onRename={(next) => rename(saved.id, next)}
                    onDelete={() => void remove(saved.id)}
                    onShare={(userIds) => share(saved.id, userIds)}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={layoutName}
                  onChange={(event) => setLayoutName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    // Enter saves this field; it must not also apply the sheet (Cmd/Ctrl+Enter).
                    event.preventDefault()
                    event.stopPropagation()
                    const nextName = layoutName.trim() || t('splitView.layouts.defaultName', 'Layout {n}', { n: String(layouts.length + 1) })
                    void save(nextName, layoutOf(draft)).then((saved) => saved && setLayoutName(''))
                  }}
                  placeholder={t('splitView.layouts.namePlaceholder', 'Layout name…')}
                  aria-label={t('splitView.layouts.namePlaceholder', 'Layout name…')}
                  className="h-9 min-w-0 flex-1 rounded-[10px] border border-transparent bg-m3ft-surface-container-high px-3 text-body-regular-sm text-m3ft-on-surface placeholder:text-m3ft-on-surface-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-m3ft-outline"
                  data-split-layout-name=""
                />
                <button
                  type="button"
                  className={gridBtnSecondary}
                  onClick={() => {
                    const nextName = layoutName.trim() || t('splitView.layouts.defaultName', 'Layout {n}', { n: String(layouts.length + 1) })
                    void save(nextName, layoutOf(draft)).then((saved) => saved && setLayoutName(''))
                  }}
                  data-split-layout-save=""
                >
                  {t('splitView.layouts.saveCurrent', 'Save current')}
                </button>
              </div>
            </Block>
          </div>
        </MenuPortalContext.Provider>
      )}
    />
  )
}

export default SplitViewCustomizeSheet
