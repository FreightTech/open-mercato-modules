'use client'

/**
 * One anchored, portalled menu for every popup the split view opens — the
 * workspace bar's "Dodaj widget" and "Wygląd", the pane ⋮ menus, the drawer's
 * slot pickers and the "Podmień na…" flyout.
 *
 * Before this there were three hand-rolled copies (`PaneRestoreMenu`,
 * `WidgetPaneMenu`, and the picker), each with its own outside-click and
 * Escape handling, and each a little different. The rules they all needed:
 *
 *  - PORTALLED to `document.body` and `position: fixed`. Panes clip their
 *    overflow, so an absolutely-positioned panel is painted over by the grid's
 *    sticky columns and clicks land on `td.hot-cell` instead (the bug
 *    `PaneRestoreMenu` used to document).
 *  - Positioned by `computeAnchoredPosition`, the grid's own placement rule:
 *    below when there is room, flipped above when not, clamped to the viewport.
 *  - Escape closes in the CAPTURE phase with `stopPropagation`, so it never
 *    also reaches the grid's page-level Escape (which clears the selection).
 *  - A scroll of the DOCUMENT closes it (the anchor moved); a scroll of a pane
 *    does not — panes scroll inside the layout and the anchor stays put. The
 *    picker used to close ~6ms after opening because a pane emitted a scroll.
 *  - Nested menus (a flyout) count as inside: a click in a child panel must
 *    not close the parent. Panels mark themselves `data-split-menu-panel` and
 *    any click inside ANY of them is ignored by every open menu.
 */

import * as React from 'react'
import ReactDOM from 'react-dom'
import { computeAnchoredPosition } from '../utils/anchoredPosition'
import { ToolbarOverflowCloseProvider } from '../components/ToolbarOverflow'
import { M3_MENU_PANEL } from './chrome'

export type AnchoredMenuPlacement = {
  width: number
  preferredHeight?: number
  align?: 'start' | 'end'
  minHeight?: number
  /** Open BESIDE the anchor (a flyout) instead of below it. */
  side?: 'below' | 'left' | 'right'
}

/**
 * `bottom` is set instead of `top` when the panel opens ABOVE its anchor:
 * `computeAnchoredPosition` then reports the anchor's top edge, which is where
 * the panel's BOTTOM edge belongs. Treating it as `top` drew a flipped panel
 * downward from the anchor and ran it off the screen.
 */
type Position = { top: number | null; bottom: number | null; left: number; maxHeight: number }

/**
 * Where menus portal to. `document.body` by default; a MODAL surface (the
 * customise drawer is a Radix dialog) provides its own element instead. A
 * modal dialog traps focus inside itself and sets `pointer-events: none` on
 * the body, so a menu portalled to the body from inside it would be visible
 * but unclickable, and its search field would lose focus the moment it got it.
 */
export const MenuPortalContext = React.createContext<HTMLElement | null>(null)

function place(anchor: DOMRect, placement: AnchoredMenuPlacement): Position {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const preferredHeight = placement.preferredHeight ?? 420
  if (placement.side === 'left' || placement.side === 'right') {
    // A flyout: level with the row that opened it, beside the parent panel,
    // and on whichever side has room.
    const gap = 4
    const roomRight = viewport.width - anchor.right - gap
    const openLeft = placement.side === 'left' ? anchor.left - gap >= placement.width || roomRight < placement.width : roomRight < placement.width
    const left = openLeft ? Math.max(8, anchor.left - gap - placement.width) : anchor.right + gap
    const maxHeight = Math.min(preferredHeight, viewport.height - 16)
    const top = Math.max(8, Math.min(anchor.top - 4, viewport.height - maxHeight - 8))
    return { top, bottom: null, left, maxHeight }
  }
  const next = computeAnchoredPosition(anchor, viewport, {
    width: placement.width,
    preferredHeight,
    align: placement.align ?? 'end',
    minHeight: placement.minHeight ?? 160,
  })
  return next.flipAbove
    ? { top: null, bottom: viewport.height - next.top, left: next.left, maxHeight: next.maxHeight }
    : { top: next.top, bottom: null, left: next.left, maxHeight: next.maxHeight }
}

/**
 * The panel alone, for a caller that owns its own open state and anchor — the
 * drawer's slot picker, the flyout. `onClose` fires on outside click, Escape
 * and document scroll.
 */
export function AnchoredPanel({
  anchor,
  placement,
  onClose,
  children,
  className,
  ...rest
}: {
  anchor: DOMRect | HTMLElement | null
  placement: AnchoredMenuPlacement
  onClose: () => void
  children: React.ReactNode
  className?: string
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const portalTarget = React.useContext(MenuPortalContext)
  const [position, setPosition] = React.useState<Position | null>(null)
  const latestClose = React.useRef(onClose)
  latestClose.current = onClose

  const reposition = React.useCallback(() => {
    if (!anchor) return
    const rect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor
    setPosition(place(rect, placement))
    // `placement` is an object literal at most call sites; its fields are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, placement.width, placement.preferredHeight, placement.align, placement.side, placement.minHeight])

  React.useLayoutEffect(() => { reposition() }, [reposition])

  React.useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (!target) return
      if (target.closest?.('[data-split-menu-panel]')) return
      if (anchor instanceof HTMLElement && anchor.contains(target)) return
      latestClose.current()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Only the TOPMOST panel handles Escape, so one press closes one level.
      const panels = document.querySelectorAll('[data-split-menu-panel]')
      if (panels[panels.length - 1] !== panelRef.current) return
      event.stopPropagation()
      event.preventDefault()
      latestClose.current()
    }
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target !== document.scrollingElement) {
        // A scroll inside a menu or inside a pane leaves the anchor where it was.
        return
      }
      latestClose.current()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', reposition)
    }
  }, [anchor, reposition])

  if (typeof document === 'undefined' || !anchor) return null
  return ReactDOM.createPortal(
    <div
      ref={panelRef}
      role="menu"
      className={`${M3_MENU_PANEL} ${className ?? ''}`.trim()}
      style={{
        ...(position
          ? position.bottom !== null
            ? { bottom: position.bottom }
            : { top: position.top ?? 0 }
          : { top: -9999 }),
        left: position?.left ?? -9999,
        width: placement.width,
        maxHeight: position?.maxHeight ?? placement.preferredHeight ?? 420,
        visibility: position ? 'visible' : 'hidden',
      }}
      data-split-menu-panel=""
      {...rest}
    >
      {children}
    </div>,
    portalTarget ?? document.body,
  )
}

/**
 * A trigger plus its panel. `children` receives `close`, and the panel also
 * provides the toolbar-overflow close context, so rows written for the table's
 * overflow menu (`useToolbarOverflowClose`) close THIS menu when rendered in it.
 */
export function AnchoredMenu({
  renderTrigger,
  placement,
  children,
  panelProps,
  onOpenChange,
}: {
  renderTrigger: (props: {
    ref: React.Ref<HTMLButtonElement>
    open: boolean
    toggle: () => void
  }) => React.ReactNode
  placement: AnchoredMenuPlacement
  children: (close: () => void) => React.ReactNode
  panelProps?: Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & Record<string, unknown>
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const setOpenAndNotify = React.useCallback(
    (next: boolean) => {
      setOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )
  const close = React.useCallback(() => setOpenAndNotify(false), [setOpenAndNotify])
  const toggle = React.useCallback(() => setOpenAndNotify(!open), [open, setOpenAndNotify])

  return (
    <>
      {renderTrigger({ ref: triggerRef, open, toggle })}
      {open && (
        <AnchoredPanel anchor={triggerRef.current} placement={placement} onClose={close} {...panelProps}>
          <ToolbarOverflowCloseProvider value={close}>{children(close)}</ToolbarOverflowCloseProvider>
        </AnchoredPanel>
      )}
    </>
  )
}

export default AnchoredMenu
