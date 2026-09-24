'use client'

/**
 * The table's ⚙ — how THIS table looks: row density, and which of its bars are
 * shown.
 *
 * From the designer's prototype (gt-demo `TableSettingsMenu`): one gear per
 * table, holding the density segmented control and a switch per bar. It is
 * deliberately separate from the ⋯ menu, which is about what you can DO with
 * the table (export, open, swap, remove). The designer's rule: "enlarging the
 * content and what the table shows is a table setting only" — a widget has no
 * rows to densify, so this never appears on one.
 *
 * Density is written under the table's own key, the same store the ⋯ menu's
 * density control used, so moving the control here moves no user's setting.
 * The switches are the HOST's (`TableDisplayContext`): they describe the pane
 * and persist with the layout.
 */

import * as React from 'react'
import ReactDOM from 'react-dom'
import { Check, Settings } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Toggle } from '../../../primitives-v2/Toggle'
import { DENSITY_LEVELS, type DensityLevel } from '../types/density'
import { setDensityPreference, useDensityPreference } from '../hooks/useDensityPreference'
import { computeAnchoredPosition } from '../utils/anchoredPosition'
import type { TableDisplayToggle } from './TableDisplayContext'

const MENU_WIDTH = 248

const DENSITY_FALLBACK: Record<DensityLevel, string> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
  dense: 'Dense',
}

export function TableSettingsMenu({
  densityTableKey,
  toggles,
  showDensity = true,
  className = 'hot-toolbar-overflow-btn',
}: {
  densityTableKey?: string
  toggles: TableDisplayToggle[]
  showDensity?: boolean
  /** The trigger's look — the toolbar's round icon button by default. */
  className?: string
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = React.useState({ top: 0, left: 0, maxHeight: 480, flipAbove: false })
  const { density } = useDensityPreference(undefined, densityTableKey)

  const reposition = React.useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const next = computeAnchoredPosition(
      trigger.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { width: MENU_WIDTH, preferredHeight: 360, align: 'end', minHeight: 160 },
    )
    setPlacement({ top: next.top, left: next.left, maxHeight: next.maxHeight, flipAbove: next.flipAbove })
  }, [])

  React.useLayoutEffect(() => { if (open) reposition() }, [open, reposition])

  React.useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    // Capture + stopPropagation: Escape here must not also reach the grid's
    // page-level Escape, which clears the user's cell selection.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    const onMove = () => reposition()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, reposition])

  const label = t('splitView.tableSettings.title', 'Table settings')

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={className}
        data-table-settings=""
      >
        <Settings className="h-4 w-4" />
      </button>
      {open && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={label}
          className="fixed z-[1000] flex flex-col gap-2.5 overflow-y-auto rounded-m3-md border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container)] p-3 text-[var(--m3-on-surface)] shadow-m3-2"
          // Flipped above the ⚙, `top` is where the panel's BOTTOM edge goes.
          style={{
            ...(placement.flipAbove ? { bottom: window.innerHeight - placement.top } : { top: placement.top }),
            left: placement.left,
            width: MENU_WIDTH,
            maxHeight: placement.maxHeight,
          }}
          data-table-settings-menu=""
          data-split-menu-panel=""
        >
          {showDensity && (
            <div className="flex flex-col gap-1">
              <div className="text-label-semibold-2xs uppercase tracking-wider text-[var(--m3-on-surface-variant)]">
                {t('dynamicTable.density.label', 'Row height')}
              </div>
              {/* M3 connected button group — the same control the ⋯ menu used,
                  so the selected look (secondary-container + check) matches a
                  selected row and a selected menu item everywhere. */}
              <div className="flex h-7 overflow-hidden rounded-m3-full border border-[var(--m3-outline)]" role="group">
                {DENSITY_LEVELS.map((level, index) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setDensityPreference(level, densityTableKey)}
                    className={[
                      'flex flex-1 items-center justify-center gap-1 text-caption-medium-md transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard',
                      index > 0 ? 'border-l border-[var(--m3-outline)]' : '',
                      density === level
                        ? 'bg-[var(--m3-secondary-container)] text-[var(--m3-on-secondary-container)]'
                        : 'text-[var(--m3-on-surface-variant)] hover:bg-[var(--m3-state-layer-hover)]',
                    ].join(' ')}
                    aria-pressed={density === level}
                    title={t(`dynamicTable.density.${level}Hint`, '')}
                    data-density-option={level}
                  >
                    {density === level ? <Check size={11} aria-hidden="true" /> : null}
                    {t(`dynamicTable.density.${level}`, DENSITY_FALLBACK[level])}
                  </button>
                ))}
              </div>
            </div>
          )}
          {toggles.map((toggle) => (
            // The whole row is the target, label on the left and the switch on
            // the right — a 16px switch alone is too small to aim at.
            <label
              key={toggle.key}
              className="flex cursor-pointer items-center justify-between gap-3 text-body-regular-sm text-[var(--m3-on-surface-variant)]"
              data-table-setting={toggle.key}
              data-table-setting-on={toggle.checked ? 'true' : 'false'}
            >
              <span className="whitespace-nowrap">{toggle.label}</span>
              <Toggle
                toggleSize="sm"
                checked={toggle.checked}
                onChange={(event) => toggle.onChange(event.target.checked)}
                aria-label={toggle.label}
              />
            </label>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

export default TableSettingsMenu
