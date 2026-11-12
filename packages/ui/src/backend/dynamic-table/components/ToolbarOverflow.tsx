'use client'

/**
 * THE table's overflow menu. One button, everything secondary inside it.
 *
 * Export, row height and fullscreen are occasional controls that were each
 * spending permanent toolbar width on every table in the app, crowding the
 * primary action a page exists for.
 *
 * A host (split view) injects its own items via `extras` rather than rendering
 * a second button beside this one — an earlier build did exactly that and left
 * two near-identical `⋯` buttons side by side, which is worse than the problem
 * it set out to fix.
 */

import * as React from 'react'
import ReactDOM from 'react-dom'
import { Check, Download, Maximize2, MoreHorizontal, SlidersHorizontal } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DENSITY_LEVELS, type DensityLevel } from '../types/density'
import { setDensityPreference, useDensityPreference } from '../hooks/useDensityPreference'
import type { ExportFormat } from '../utils/exportTable'
import { computeAnchoredPosition } from '../utils/anchoredPosition'

/**
 * Lets an injected row close the menu it lives in.
 *
 * The menu used to close on ANY click inside `extras`, which made expandable
 * rows (Arrange, Layouts) look dead: the click toggled the section open and
 * tore the menu down in the same gesture. Closing is now the row's own call —
 * terminal actions ask for it, disclosure toggles do not.
 */
const ToolbarOverflowCloseContext = React.createContext<() => void>(() => {})

export function useToolbarOverflowClose(): () => void {
  return React.useContext(ToolbarOverflowCloseContext)
}

/** Lets another popover host the same rows and still honour their close calls. */
export const ToolbarOverflowCloseProvider = ToolbarOverflowCloseContext.Provider

export interface ToolbarOverflowProps {
  onExport?: (format: ExportFormat) => void
  exportDisabled?: boolean
  showDensity?: boolean
  densityTableKey?: string
  onFullscreen?: () => void
  /** Host-supplied rows appended below the table's own. */
  extras?: React.ReactNode
  /**
   * `more` (default): the `⋯` button among the toolbar's actions. `settings`: a sliders button titled
   * "Table settings", for the menu placed after the pagination (`tableMenuPlacement: 'pagination'`).
   */
  look?: 'more' | 'settings'
}

const MENU_WIDTH = 216
/**
 * Generous on purpose. `computeAnchoredPosition` clamps this to what actually
 * fits, so asking for a tall panel means "use the space you have" rather than
 * "be this tall". At 460 the menu capped itself well short of the viewport, and
 * expanding Arrange pushed Layouts, Open full page and Close pane into a scroll
 * region below the fold — they looked absent.
 */
const MENU_MAX_HEIGHT = 720

const DENSITY_LABELS: Record<DensityLevel, string> = {
  comfortable: 'Roomy',
  compact: 'Medium',
  dense: 'Tight',
}

export const ToolbarOverflow: React.FC<ToolbarOverflowProps> = ({
  onExport,
  exportDisabled,
  showDensity = true,
  densityTableKey,
  onFullscreen,
  extras,
  look = 'more',
}) => {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [exportOpen, setExportOpen] = React.useState(false)
  const boxRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const [placement, setPlacement] = React.useState({ top: 0, left: 0, maxHeight: MENU_MAX_HEIGHT })

  /**
   * The panel was plain `absolute`, so near the bottom of the viewport it ran
   * straight off screen — with the host's rows appended it is tall enough that
   * Views bar, Arrange, Layouts and Close became unreachable. Portalled to body
   * and positioned with the same helper every other menu in the grid uses: it
   * flips above when there is more room there, clamps to the height that
   * actually fits, and scrolls inside.
   */
  const reposition = React.useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const next = computeAnchoredPosition(
      trigger.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { width: MENU_WIDTH, preferredHeight: MENU_MAX_HEIGHT, align: 'end', minHeight: 180 },
    )
    setPlacement({ top: next.top, left: next.left, maxHeight: next.maxHeight })
  }, [])

  React.useLayoutEffect(() => { if (open) reposition() }, [open, reposition])

  React.useEffect(() => {
    if (!open) return
    const onScroll = () => reposition()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, reposition])
  const { density } = useDensityPreference(undefined, densityTableKey)

  const closeMenu = React.useCallback(() => { setOpen(false); setExportOpen(false) }, [])

  React.useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      // The panel is portalled to body, so it is NOT inside the trigger's
      // wrapper any more — both have to count as "inside", or clicking the
      // trigger would close here and immediately reopen via onClick.
      const insidePanel = boxRef.current?.contains(target)
      const onTrigger = triggerRef.current?.contains(target)
      // A host row can open its own portalled flyout ("Podmień na…"). A click
      // in it is a click in THIS menu's content, not outside it.
      const inChildMenu = (target as Element).closest?.('[data-split-menu-panel]')
      if (!insidePanel && !onTrigger && !inChildMenu) {
        setOpen(false)
        setExportOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); setExportOpen(false) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!onExport && !showDensity && !onFullscreen && !extras) return null

  // One M3 menu row: the concentric 8px corner the overlay sheet gives every
  // other menu item, a translucent hover state layer, and the 12/16 body token
  // instead of a raw `text-[12px]`.
  const row = 'flex h-7 w-full items-center gap-2 rounded-m3-sm px-1.5 text-left text-body-regular-xs text-[var(--m3-on-surface)] transition-colors hover:bg-[var(--m3-state-layer-hover)]'
  const gutter = 'flex w-4 shrink-0 justify-center'
  // Leading glyphs are meta, so they take the variant ink. They used to be
  // dimmed with `opacity-70`, which mutes the icon's own colour against an
  // unknown ground rather than giving it a role.
  const gutterIcon = 'h-3.5 w-3.5 text-[var(--m3-on-surface-variant)]'

  return (
    <div className="relative" ref={boxRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={look === 'settings' ? t('dynamicTable.toolbar.tableSettings', 'Table settings') : t('dynamicTable.toolbar.more', 'More')}
        aria-label={look === 'settings' ? t('dynamicTable.toolbar.tableSettings', 'Table settings') : t('dynamicTable.toolbar.more', 'More table actions')}
        aria-expanded={open}
        className="hot-toolbar-overflow-btn"
        data-toolbar-overflow=""
        data-toolbar-overflow-look={look}
      >
        {look === 'settings' ? <SlidersHorizontal className="w-4 h-4" /> : <MoreHorizontal className="w-4 h-4" />}
      </button>

      {open && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          ref={boxRef}
          // z-[1000] is the house level for portalled dropdowns (RowActions,
          // ActionsDropdown). At z-50 this panel rendered UNDER the app
          // sidebar: a pane on the left anchors its menu over the nav, and
          // nav links intercepted the clicks, so menu rows that happened to
          // overlap a link were dead while their neighbours worked.
          className="fixed z-[1000] overflow-y-auto rounded-m3-md border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-lowest)] py-1 text-[var(--m3-on-surface)] shadow-m3-2"
          style={{ top: placement.top, left: placement.left, width: MENU_WIDTH, maxHeight: placement.maxHeight }}
          data-toolbar-overflow-menu=""
        >
          {onExport && (
            <div className="px-1">
              <button
                type="button"
                disabled={exportDisabled}
                onClick={() => setExportOpen((value) => !value)}
                className={row}
                data-toolbar-export=""
              >
                <span className={gutter}><Download className={gutterIcon} /></span>
                {t('dynamicTable.export.button', 'Export')}
              </button>
              {exportOpen && (
                <div className="mb-1 ml-6 flex flex-col gap-0.5">
                  {(['csv', 'xlsx'] as const).map((format) => (
                    <button
                      key={format}
                      type="button"
                      onClick={() => { onExport(format as ExportFormat); setExportOpen(false); setOpen(false) }}
                      className="flex h-6 items-center rounded-m3-full px-2 text-left text-body-regular-2xs uppercase text-[var(--m3-on-surface-variant)] transition-colors hover:bg-[var(--m3-state-layer-hover)] hover:text-[var(--m3-on-surface)]"
                      data-toolbar-export-format={format}
                    >
                      {format}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {showDensity && (
            <>
              {/* 10px chrome goes through the 10px token. Routing it through
                  `text-caption-medium-md` (12/16) would grow this label by 20%
                  and its line box by 60%. It was also dimmed with `opacity-45`,
                  which washes the ink toward the menu ground instead of naming
                  it as secondary — `on-surface-variant` is the role for that. */}
              <div className="px-2 pb-1 pt-1.5 text-label-semibold-2xs uppercase text-[var(--m3-on-surface-variant)]">
                {t('dynamicTable.density.label', 'Row height')}
              </div>
              {/* FMS UX 03.11: inside a menu the levels are menu items, not chips
                  — borderless chips read as plain text there. One row per level,
                  the chosen one with M3's check in the leading gutter. */}
              <div className="px-1 pb-1" role="group" aria-label={t('dynamicTable.density.label', 'Row height')}>
                {DENSITY_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    role="menuitemradio"
                    aria-checked={density === level}
                    onClick={() => setDensityPreference(level, densityTableKey)}
                    className={row}
                    data-testid={`dynamic-table-density-${level}`}
                    data-density-option={level}
                  >
                    <span className={gutter}>
                      {density === level ? <Check className="h-3.5 w-3.5 text-[var(--m3-on-surface)]" aria-hidden="true" /> : null}
                    </span>
                    {t(`dynamicTable.density.${level}`, DENSITY_LABELS[level])}
                  </button>
                ))}
              </div>
            </>
          )}

          {onFullscreen && (
            <div className="px-1">
              <button
                type="button"
                onClick={() => { onFullscreen(); setOpen(false) }}
                className={row}
                data-toolbar-fullscreen=""
              >
                <span className={gutter}><Maximize2 className={gutterIcon} /></span>
                {t('dynamicTable.toolbar.fullscreen', 'Fullscreen')}
              </button>
            </div>
          )}

          {extras && (
            <>
              <div className="mx-2 my-1 border-t border-[var(--m3-outline-faint)]" />
              <ToolbarOverflowCloseContext.Provider value={closeMenu}>
                {extras}
              </ToolbarOverflowCloseContext.Provider>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

export default ToolbarOverflow
