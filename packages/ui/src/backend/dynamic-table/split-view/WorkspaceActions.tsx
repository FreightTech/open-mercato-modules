'use client'

/**
 * The workspace-level controls: the "Dostosuj" tab that hangs under the top
 * bar, and the right end of the workspace bar — "Dodaj widget", "Wygląd" and
 * "Pełny ekran" — plus a section's own header.
 *
 * All of it acts on the LAYOUT, never on one pane, which is why it lives above
 * the panes rather than in any pane's menu. An earlier build put templates,
 * arrange presets and saved layouts into every pane's ⋯ menu, so the same
 * workspace controls appeared in N places and in none of them obviously.
 */

import * as React from 'react'
import { Check, ChevronDown, LayoutGrid, Maximize, Minimize, Plus, Settings, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AnchoredMenu } from './AnchoredMenu'
import { ContentCatalogList } from './ContentPicker'
import { TemplateTiles } from './TemplatePreview'
import { BAR_PILL, BAR_PILL_ON, ICON_BUTTON, M3_MENU_CAPTION, M3_MENU_DIVIDER, M3_MENU_ROW, M3_MENU_ROW_ON } from './chrome'
import type { SavedSplitLayout } from './useSplitViewLayouts'
import type { GridTemplateId, PaneContentRef } from './types'

// ─── Dostosuj ────────────────────────────────────────────────────────────────

/**
 * The tab that hangs from the top bar — "przyklejony do navbaru", reachable
 * however the content below scrolls (recording 00:19).
 *
 * It occupies the page's own top padding and nothing else: positioned against
 * the host, `bottom: 100%`, so it adds no height to the page and costs no row.
 * A 24px tab in 24px of padding that was empty anyway.
 */
export function CustomizeTab({ onOpen, active }: { onOpen: () => void; active?: boolean }) {
  const t = useT()
  const ref = React.useRef<HTMLButtonElement>(null)
  // How far above the host the scroll container's top edge is. The tab hangs
  // from THAT edge — the top of the content surface, right under the top bar —
  // not from the host, which can sit a few px lower behind page wrappers.
  const [offset, setOffset] = React.useState<number | null>(null)

  React.useLayoutEffect(() => {
    const tab = ref.current
    const host = tab?.parentElement
    if (!tab || !host) return
    let scroller: HTMLElement | null = host.parentElement
    while (scroller && scroller !== document.body) {
      const overflowY = getComputedStyle(scroller).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') break
      scroller = scroller.parentElement
    }
    const measure = () => {
      if (!scroller || scroller === document.body) return setOffset(null)
      const gap = Math.round(host.getBoundingClientRect().top - scroller.getBoundingClientRect().top)
      setOffset(gap > 0 ? gap : null)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // 28px like the prototype's bubble, never taller than the gap it hangs in.
  const height = offset === null ? 24 : Math.max(20, Math.min(28, offset - 4))
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      style={offset === null ? undefined : { top: -offset, height, bottom: 'auto' }}
      className={`absolute bottom-full right-0 z-10 flex h-6 items-center gap-1 rounded-b-m3-md border border-t-0 px-2.5 text-label-semibold-xs shadow-m3-1 transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard [&_svg]:h-3.5 [&_svg]:w-3.5 ${
        active
          ? 'border-transparent bg-[var(--m3-secondary-container)] text-[var(--m3-on-secondary-container)]'
          : 'border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-lowest)] text-[var(--m3-on-surface-variant)] hover:bg-[var(--m3-container-hover)] hover:text-[var(--m3-on-surface)]'
      }`}
      aria-haspopup="dialog"
      data-split-customize-tab=""
    >
      <LayoutGrid />
      {t('splitView.customize.tab', 'Customize')}
      <ChevronDown />
    </button>
  )
}

// ─── Dodaj widget ────────────────────────────────────────────────────────────

/**
 * The bar's entry point for new content: fills the first free slot, or opens
 * a new section when the grid is full (see `addContent`).
 */
export function AddWidgetMenu({ onAdd }: { onAdd: (content: PaneContentRef) => void }) {
  const t = useT()
  return (
    <AnchoredMenu
      placement={{ width: 300, preferredHeight: 460, align: 'end' }}
      panelProps={{ 'data-workspace-add-widget-menu': '' }}
      renderTrigger={({ ref, open, toggle }) => (
        <button
          ref={ref}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
          className={open ? BAR_PILL_ON : BAR_PILL}
          data-workspace-add-widget=""
        >
          <Plus />
          <span className="@max-[1180px]/wsbar:hidden">{t('splitView.bar.addWidget', 'Add widget')}</span>
          <ChevronDown />
        </button>
      )}
    >
      {(close) => (
        <ContentCatalogList
          onPick={(content) => {
            onAdd(content)
            close()
          }}
        />
      )}
    </AnchoredMenu>
  )
}

// ─── Wygląd ──────────────────────────────────────────────────────────────────

/**
 * Switch between saved layouts, back to the default view, change the grid,
 * save what is on screen, or open the drawer.
 *
 * The grid tiles are here as well as in the drawer because the designer found
 * the layout editor had "fallen into the drawer" once widgets were placed
 * (recording 06:11): from the main view you could only switch or add.
 */
export function LayoutMenu({
  layouts,
  activeId,
  isDefault,
  onApply,
  onDefault,
  onSaveCurrent,
  onCustomize,
}: {
  layouts: SavedSplitLayout[]
  activeId: string | null
  isDefault: boolean
  onApply: (saved: SavedSplitLayout) => void
  onDefault: () => void
  onSaveCurrent: () => void
  onCustomize: () => void
}) {
  const t = useT()
  const active = layouts.find((saved) => saved.id === activeId)
  const label = active ? active.name : t('splitView.bar.layout', 'Layout')
  return (
    <AnchoredMenu
      placement={{ width: 280, preferredHeight: 560, align: 'end' }}
      panelProps={{ 'data-workspace-layout-menu': '' }}
      renderTrigger={({ ref, open, toggle }) => (
        <button
          ref={ref}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
          className={active || open ? BAR_PILL_ON : BAR_PILL}
          title={label}
          data-workspace-layout=""
        >
          <LayoutGrid />
          <span className="max-w-40 truncate @max-[1180px]/wsbar:max-w-24">{label}</span>
          <ChevronDown />
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col">
          {/* The design's menu: saved layouts, then "save current" and the
              way into the drawer. The grid is chosen in the drawer. */}
          <div className={`px-3 pb-1 pt-2 ${M3_MENU_CAPTION}`}>{t('splitView.bar.savedLayouts', 'Saved layouts')}</div>
          <button
            type="button"
            onClick={() => {
              onDefault()
              close()
            }}
            className={isDefault ? M3_MENU_ROW_ON : M3_MENU_ROW}
            data-workspace-layout-default=""
          >
            <span className="flex-1 truncate">{t('splitView.layouts.default', 'Default view')}</span>
            {isDefault && <Check className="h-3.5 w-3.5" />}
          </button>
          {layouts.map((saved) => {
            const on = saved.id === activeId
            return (
              <button
                key={saved.id}
                type="button"
                onClick={() => {
                  onApply(saved)
                  close()
                }}
                className={on ? M3_MENU_ROW_ON : M3_MENU_ROW}
                data-workspace-layout-item={saved.name}
              >
                <span className="flex-1 truncate">{saved.name}</span>
                {on && <Check className="h-3.5 w-3.5" />}
              </button>
            )
          })}
          <div className={M3_MENU_DIVIDER} />
          <button
            type="button"
            onClick={() => {
              onSaveCurrent()
              close()
            }}
            className={M3_MENU_ROW}
            data-workspace-layout-save=""
          >
            <span className="flex w-4 justify-center"><Plus className="h-3.5 w-3.5 text-[var(--m3-on-surface-variant)]" /></span>
            {t('splitView.bar.saveCurrent', 'Save current')}
          </button>
          <button
            type="button"
            onClick={() => {
              onCustomize()
              close()
            }}
            className={M3_MENU_ROW}
            data-workspace-customize=""
          >
            <span className="flex w-4 justify-center"><Settings className="h-3.5 w-3.5 text-[var(--m3-on-surface-variant)]" /></span>
            {t('splitView.bar.customize', 'Customize…')}
          </button>
        </div>
      )}
    </AnchoredMenu>
  )
}

// ─── Pełny ekran ─────────────────────────────────────────────────────────────

export function FullscreenToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={active ? BAR_PILL_ON : BAR_PILL}
      aria-label={active ? t('splitView.bar.exitFullscreen', 'Exit full screen') : t('splitView.bar.fullscreen', 'Full screen')}
      title={active ? t('splitView.bar.exitFullscreen', 'Exit full screen') : t('splitView.bar.fullscreen', 'Full screen')}
      data-workspace-fullscreen={active ? 'on' : 'off'}
    >
      {active ? <Minimize /> : <Maximize />}
      <span className="@max-[1180px]/wsbar:hidden">
        {active ? t('splitView.bar.exitFullscreen', 'Exit full screen') : t('splitView.bar.fullscreen', 'Full screen')}
      </span>
    </button>
  )
}

// ─── Section header ──────────────────────────────────────────────────────────

/**
 * The strip above a section below the main grid: its name, how full it is,
 * its own grid, and the way to remove it. The designer's "a new box in which
 * we can place up to four widgets" with "the ability to edit this layout
 * here" (recording 04:02, 05:15).
 */
export function BoxHeader({
  index,
  count,
  max,
  currentTemplate,
  onPickTemplate,
  onRemove,
}: {
  index: number
  count: number
  max: number
  currentTemplate: GridTemplateId | null
  onPickTemplate: (id: GridTemplateId) => void
  onRemove: () => void
}) {
  const t = useT()
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 px-1" data-workspace-box-header="">
      <span className="text-label-semibold-xs text-[var(--m3-on-surface)]">
        {t('splitView.box.label', 'Section {n}', { n: String(index) })}
      </span>
      <span className="text-body-regular-xs text-[var(--m3-on-surface-variant)]">
        {t('splitView.box.capacity', '{count} of {max}', { count: String(count), max: String(max) })}
      </span>
      <span className="h-px flex-1 bg-[var(--m3-outline-variant)]" aria-hidden="true" />
      <AnchoredMenu
        placement={{ width: 260, preferredHeight: 200, align: 'end' }}
        renderTrigger={({ ref, open, toggle }) => (
          <button
            ref={ref}
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="inline-flex h-7 items-center gap-1 rounded-m3-full px-2 text-label-semibold-xs text-[var(--m3-on-surface-variant)] transition-colors hover:bg-[var(--m3-state-layer-hover)] hover:text-[var(--m3-on-surface)] [&_svg]:h-3.5 [&_svg]:w-3.5"
            data-workspace-box-grid=""
          >
            <LayoutGrid />
            {t('splitView.bar.grid', 'Grid')}
            <ChevronDown />
          </button>
        )}
      >
        {(close) => (
          <div className="p-1">
            <TemplateTiles
              currentId={currentTemplate}
              dataPrefix="data-workspace-box-template"
              onPick={(id) => {
                onPickTemplate(id)
                close()
              }}
            />
          </div>
        )}
      </AnchoredMenu>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('splitView.box.remove', 'Remove section')}
        title={t('splitView.box.remove', 'Remove section')}
        className={`${ICON_BUTTON} hover:bg-[var(--m3-state-layer-error-hover)] hover:text-[var(--m3-error)]`}
        data-workspace-box-remove=""
      >
        <X />
      </button>
    </div>
  )
}
