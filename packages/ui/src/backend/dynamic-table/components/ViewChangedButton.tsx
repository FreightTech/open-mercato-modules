'use client'

/**
 * THE WAY BACK FROM A CHANGED LAYOUT, ON A TABLE WITHOUT A VIEWS BAR.
 *
 * Every table remembers what the person did to it — hidden and moved columns, the sort, pinned columns
 * (`useOwnBaseView`, or the host's own `__base__` row) — and no table shows the saved-view row just for that
 * (owner, 15.11, GEPARD-283). Before this button, a column hidden from the column menu ("Ukryj pole") could only be
 * brought back through that row: on a table without it, it was gone for good.
 *
 * So the toolbar carries one small icon while the layout differs from the table's default — nothing at all while it
 * does not: the hidden columns, each with "Pokaż", "Pokaż wszystkie", the full Configure view panel, and "Przywróć
 * domyślny" (with the same confirmation the views bar's reset uses).
 */

import * as React from 'react'
import ReactDOM from 'react-dom'
import { ArrowDownUp, EyeOff, RotateCcw, Settings2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { computeAnchoredPosition } from '../utils/anchoredPosition'
import PerspectiveDeleteDialog from './PerspectiveDeleteDialog'

const MENU_WIDTH = 260
const MENU_MAX_HEIGHT = 420

export interface ViewChangedButtonProps {
  /** Columns the person hid (beyond the ones the table hides by default), in the table's order. */
  hiddenColumns: Array<{ field: string; title: string }>
  onShow: (fields: string[]) => void
  onConfigure: () => void
  /** Back to the table's default; omitted when there is nothing to reset to (a named view is active). */
  onReset?: () => void
}

export function ViewChangedButton({ hiddenColumns, onShow, onConfigure, onReset }: ViewChangedButtonProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [confirmReset, setConfirmReset] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = React.useState({ top: 0, left: 0, maxHeight: MENU_MAX_HEIGHT })

  const reposition = React.useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const next = computeAnchoredPosition(
      trigger.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      { width: MENU_WIDTH, preferredHeight: MENU_MAX_HEIGHT, align: 'end', minHeight: 160 },
    )
    setPlacement({ top: next.top, left: next.left, maxHeight: next.maxHeight })
  }, [])

  React.useLayoutEffect(() => { if (open) reposition() }, [open, reposition])

  React.useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const onScroll = () => reposition()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, reposition])

  const label = t('dynamicTable.viewChanged.title', 'View changed')
  const count = hiddenColumns.length
  const row = 'flex h-7 w-full items-center gap-2 rounded-m3-sm px-1.5 text-left text-body-regular-xs text-[var(--m3-on-surface)] transition-colors hover:bg-[var(--m3-state-layer-hover)]'
  const gutter = 'flex w-4 shrink-0 justify-center'
  const gutterIcon = 'h-3.5 w-3.5 text-[var(--m3-on-surface-variant)]'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={count > 0 ? `${label} — ${t('dynamicTable.viewChanged.hiddenCount', '{count} hidden', { count })}` : label}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        className="hot-toolbar-overflow-btn relative"
        data-view-changed=""
        data-view-changed-hidden={count}
      >
        {count > 0 ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <ArrowDownUp className="h-4 w-4" aria-hidden="true" />}
        {count > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-m3-full bg-[var(--m3-primary)] px-[3px] text-center text-[9px] font-semibold leading-[14px] text-[var(--m3-on-primary)]"
            aria-hidden="true"
          >
            {count}
          </span>
        )}
      </button>

      {open && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          ref={panelRef}
          role="menu"
          className="fixed z-[1000] overflow-y-auto rounded-m3-md border border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-lowest)] py-1 text-[var(--m3-on-surface)] shadow-m3-2"
          style={{ top: placement.top, left: placement.left, width: MENU_WIDTH, maxHeight: placement.maxHeight }}
          data-view-changed-menu=""
        >
          {count > 0 && (
            <>
              <div className="px-2 pb-1 pt-1.5 text-label-semibold-2xs uppercase text-[var(--m3-on-surface-variant)]">
                {t('dynamicTable.viewChanged.hiddenColumns', 'Hidden columns')}
              </div>
              <div className="px-1 pb-1">
                {hiddenColumns.map((column) => (
                  <button
                    key={column.field}
                    type="button"
                    role="menuitem"
                    className={`${row} justify-between`}
                    onClick={() => onShow([column.field])}
                    data-view-changed-show={column.field}
                  >
                    <span className="min-w-0 truncate">{column.title}</span>
                    <span className="shrink-0 text-body-medium-xs text-[var(--m3-primary)]">
                      {t('dynamicTable.viewChanged.show', 'Show')}
                    </span>
                  </button>
                ))}
                {count > 1 && (
                  <button
                    type="button"
                    role="menuitem"
                    className={row}
                    onClick={() => { onShow(hiddenColumns.map((c) => c.field)); setOpen(false) }}
                    data-view-changed-show-all=""
                  >
                    <span className={gutter}><EyeOff className={gutterIcon} /></span>
                    {t('dynamicTable.viewChanged.showAll', 'Show all')}
                  </button>
                )}
              </div>
              <div className="mx-2 my-1 border-t border-[var(--m3-outline-faint)]" />
            </>
          )}
          <div className="px-1">
            <button
              type="button"
              role="menuitem"
              className={row}
              onClick={() => { setOpen(false); onConfigure() }}
              data-view-changed-configure=""
            >
              <span className={gutter}><Settings2 className={gutterIcon} /></span>
              {t('dynamicTable.perspectives.configure', 'Configure view…')}
            </button>
            {onReset && (
              <button
                type="button"
                role="menuitem"
                className={row}
                onClick={() => { setOpen(false); setConfirmReset(true) }}
                data-view-changed-reset=""
              >
                <span className={gutter}><RotateCcw className={gutterIcon} /></span>
                {t('dynamicTable.viewChanged.reset', 'Restore default…')}
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}

      <PerspectiveDeleteDialog
        variant="baseReset"
        name={confirmReset ? 'base' : null}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => { setConfirmReset(false); onReset?.() }}
      />
    </>
  )
}

export default ViewChangedButton
