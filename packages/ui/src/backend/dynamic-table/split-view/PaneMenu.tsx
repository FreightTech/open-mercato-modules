'use client'

/**
 * What one pane can do — the rows of its ⋮ menu.
 *
 * The designer's panel menu (gt-demo `PaneMenu`, 03.09) is three rows:
 * "Otwórz dział", "Podmień na ▸" and "Usuń panel". Two things are added here,
 * both from the same recording:
 *
 *   - "Dodaj obok" — the existing split-in-place (left/right/above/below). It
 *     is the fastest way from a page to a workspace and costs one row.
 *   - Widget settings — the header and the "Pokaż wszystko" link, per widget.
 *     "Not every widget needs a CTA" (recording 07:00).
 *
 * Table settings (density, bars, zebra) are NOT here: they live on the table's
 * own ⚙, because they are about the table, not the panel.
 *
 * These are ROWS, not a menu: a table pane injects them into the table's one ⋯
 * overflow (`overflowExtras`), a widget pane into its card's ⋮. Rows close the
 * menu they are in through `useToolbarOverflowClose`, whichever that is.
 */

import * as React from 'react'
import { Check, ChevronRight, ExternalLink, PanelBottom, PanelLeft, PanelRight, PanelTop, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useToolbarOverflowClose } from '../components/ToolbarOverflow'
import { AnchoredPanel } from './AnchoredMenu'
import { ContentCatalogList } from './ContentPicker'
import { M3_MENU_CAPTION, M3_MENU_DIVIDER, M3_MENU_ROW, M3_MENU_ROW_ON } from './chrome'
import type { PaneChrome, PaneContentRef, SplitDirection } from './types'

// The design's menu (gt-demo ActionMenu): the label leads, the icon trails.
const TRAIL = 'flex w-4 shrink-0 justify-center [&_svg]:h-3.5 [&_svg]:w-3.5'
const TRAIL_ICON = 'text-[var(--m3-on-surface-variant)]'

export type PaneMenuRowsProps = {
  /** The section this pane summarises — "Otwórz dział". */
  href?: string
  /** What is in the pane now; the swap list leaves it out. */
  current: PaneContentRef
  /** False for the page's own table: it IS the page, so it is not swapped or removed. */
  canSwap: boolean
  canRemove: boolean
  /** Widget panes only. */
  widget?: {
    chrome?: PaneChrome
    /** Whether the widget links anywhere at all — no link, no CTA switch. */
    hasCta: boolean
    onToggleChrome: (patch: Partial<PaneChrome>) => void
  }
  onSplit: (direction: SplitDirection, before: boolean, anchor: DOMRect) => void
  onSwap: (content: PaneContentRef) => void
  onRemove: () => void
}

/** "Podmień na ▸" — a row that opens the catalogue beside the menu. */
function ReplaceWithRow({ current, onSwap }: { current: PaneContentRef; onSwap: (content: PaneContentRef) => void }) {
  const t = useT()
  const closeMenu = useToolbarOverflowClose()
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null)
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          const row = event.currentTarget
          setAnchor((open) => (open ? null : row))
        }}
        className={anchor ? M3_MENU_ROW_ON : M3_MENU_ROW}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        data-pane-swap=""
      >
        <span className="flex-1">{t('splitView.pane.replaceWith', 'Replace with…')}</span>
        <span className={TRAIL}><ChevronRight className={TRAIL_ICON} /></span>
      </button>
      {anchor && (
        <AnchoredPanel
          anchor={anchor}
          placement={{ width: 280, preferredHeight: 420, side: 'left' }}
          onClose={() => setAnchor(null)}
          data-split-picker=""
          data-pane-swap-menu=""
        >
          <ContentCatalogList
            exclude={current}
            onPick={(content) => {
              onSwap(content)
              setAnchor(null)
              closeMenu()
            }}
          />
        </AnchoredPanel>
      )}
    </>
  )
}

export function PaneMenuRows({
  href,
  current,
  canSwap,
  canRemove,
  widget,
  onSplit,
  onSwap,
  onRemove,
}: PaneMenuRowsProps) {
  const t = useT()
  const closeMenu = useToolbarOverflowClose()

  const addBeside: Array<{ dir: SplitDirection; before: boolean; key: string; fallback: string; Icon: typeof PanelLeft; attr: string }> = [
    { dir: 'row', before: true, key: 'left', fallback: 'Left', Icon: PanelLeft, attr: 'data-pane-split-left' },
    { dir: 'row', before: false, key: 'right', fallback: 'Right', Icon: PanelRight, attr: 'data-pane-split-right' },
    { dir: 'column', before: true, key: 'above', fallback: 'Above', Icon: PanelTop, attr: 'data-pane-split-up' },
    { dir: 'column', before: false, key: 'below', fallback: 'Below', Icon: PanelBottom, attr: 'data-pane-split-down' },
  ]

  const widgetToggles = widget
    ? [
        { key: 'toolbar' as const, label: t('splitView.pane.header', 'Header') },
        ...(widget.hasCta ? [{ key: 'cta' as const, label: t('splitView.pane.cta', '“Show all” link') }] : []),
      ]
    : []

  return (
    <div className="px-1" data-pane-menu-rows="">
      {href && (
        <a href={href} className={M3_MENU_ROW} onClick={closeMenu} data-pane-open-full="">
          <span className="flex-1">{t('splitView.pane.openSection', 'Open section')}</span>
          <span className={TRAIL}><ExternalLink className={TRAIL_ICON} /></span>
        </a>
      )}
      {canSwap && <ReplaceWithRow current={current} onSwap={onSwap} />}

      {(href || canSwap) && <div className={M3_MENU_DIVIDER} />}
      <div className={`px-3 pb-1 pt-1 ${M3_MENU_CAPTION}`}>{t('splitView.pane.addBeside', 'Add beside')}</div>
      <div className="px-0.5 pb-1">
        {/* An M3 connected button group: one pill, hairline-divided. */}
        <div className="flex overflow-hidden rounded-m3-full border border-[var(--m3-outline)]">
          {addBeside.map((item, index) => {
            const label = t(`splitView.pane.side.${item.key}`, item.fallback)
            return (
              <button
                key={item.key}
                type="button"
                title={label}
                aria-label={label}
                onClick={(event) => {
                  onSplit(item.dir, item.before, event.currentTarget.getBoundingClientRect())
                  closeMenu()
                }}
                className={`flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[var(--m3-on-surface-variant)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:bg-[var(--m3-state-layer-hover)] hover:text-[var(--m3-on-surface)] active:bg-[var(--m3-state-layer-pressed)] ${
                  index > 0 ? 'border-l border-[var(--m3-outline)]' : ''
                }`}
                {...{ [item.attr]: '' }}
              >
                <item.Icon className="h-3.5 w-3.5" />
                <span className="text-label-semibold-2xs">{label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {widget && widgetToggles.length > 0 && (
        <>
          <div className={M3_MENU_DIVIDER} />
          <div className={`px-3 pb-1 pt-1 ${M3_MENU_CAPTION}`}>{t('splitView.pane.widgetSettings', 'Widget')}</div>
          {widgetToggles.map((item) => {
            const on = widget.chrome?.[item.key] !== false
            return (
              <button
                key={item.key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                // Toggles do NOT close the menu, so several can be flipped in one visit.
                onClick={(event) => {
                  event.stopPropagation()
                  widget.onToggleChrome({ [item.key]: !on } as Partial<PaneChrome>)
                }}
                className={M3_MENU_ROW}
                data-pane-chrome={item.key}
                data-pane-chrome-on={on ? 'true' : 'false'}
              >
                <span className={`flex-1 ${on ? '' : 'text-[var(--m3-on-surface-variant)]'}`}>{item.label}</span>
                <span className={TRAIL}>{on && <Check className="text-[var(--m3-primary)]" />}</span>
              </button>
            )
          })}
        </>
      )}

      {canRemove && (
        <>
          <div className={M3_MENU_DIVIDER} />
          <button
            type="button"
            onClick={() => {
              onRemove()
              closeMenu()
            }}
            className={M3_MENU_ROW}
            data-pane-close=""
          >
            <span className="flex-1">{t('splitView.pane.remove', 'Remove panel')}</span>
            <span className={TRAIL}><X className="text-[var(--m3-error)]" /></span>
          </button>
        </>
      )}
    </div>
  )
}

export default PaneMenuRows
