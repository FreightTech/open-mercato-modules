'use client'

/**
 * DENSITY CONTROL — the picker that lets a user choose comfortable / compact /
 * dense for every grid they look at.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * HOUSE UI RULES THIS FILE OBEYS (they are not stylistic preferences here)
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *  1. NEVER a native `<select>`. A flat trigger + chevron opens a styled
 *     listbox with hover and a checkmark on the current value. Matches the two
 *     reference implementations in this codebase: `CostLinePicker`
 *     (invoicing/.../[id]/allocate/page.tsx) and `InlineSelectField`
 *     (logistics/lib/inline-edit).
 *
 *  2. THE PANEL RENDERS IN A PORTAL, `position: fixed`, anchored to the
 *     trigger's `getBoundingClientRect()`. This is load-bearing, not
 *     decoration: the DynamicTable toolbar sits inside a card that is itself
 *     inside `overflow: auto` scroll containers, and an absolutely-positioned
 *     panel is clipped by the first of them. `CostLinePicker` says the same
 *     thing in its own header comment.
 *
 *  3. Closes on outside mousedown, on Escape (CAPTURE phase +
 *     `stopPropagation`, so it does not also reach the grid's page-level ESC
 *     handler and clear the user's cell selection), and on scroll — a fixed
 *     panel does not follow its anchor, so a scrolled-away panel must go.
 *
 *  4. Named typography tokens only. No `text-sm`, no `text-[13px]`.
 *
 *  5. Full keyboard operation with real listbox semantics.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ACCESSIBILITY SHAPE
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The trigger is a `button` with `aria-haspopup="listbox"` and `aria-expanded`,
 * and its accessible name STATES THE CURRENT LEVEL ("Row density: Compact") —
 * not just "Row density". In the icon-only toolbar variant there is no visible
 * text at all, so without that a screen-reader user could open the menu and
 * still not know what is selected.
 *
 * The panel uses the `aria-activedescendant` pattern: the listbox itself takes
 * focus and the options are `role="option"` elements identified by id. That is
 * why options are `div`s and not `button`s — a roving-focus listbox made of
 * buttons announces "button" three times and loses the "3 of 3" position
 * information that a real listbox gives for free.
 *
 * Keys handled: ArrowDown / ArrowUp (move), Home / End (jump), Enter / Space
 * (choose), Escape (cancel, focus returns to the trigger), Tab (close). Opening
 * with ArrowDown/Enter starts on the CURRENT value, not the first one.
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Rows3 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DENSITY_LEVELS, type DensityLevel } from '../types/density'
import { useDensityPreference } from '../hooks/useDensityPreference'

/** Panel width in px. Wide enough for the longest Polish label + description. */
const PANEL_WIDTH = 264
/**
 * Height used ONLY to decide whether to open downwards or upwards. It is an
 * estimate (3 rows + padding), which is safe because the set of options is
 * fixed at three and always will be — a fourth level would be a design change,
 * not a runtime possibility. Measuring after mount would mean a paint at the
 * wrong position first.
 */
const PANEL_ESTIMATED_HEIGHT = 3 * 52 + 8
const VIEWPORT_MARGIN = 8

type PanelPosition = { top: number; left: number }

/**
 * Anchor the fixed panel to the trigger, keeping it inside the viewport.
 *
 * Pure, so the placement rules are readable in one place: prefer below, flip
 * above when there is no room, and clamp horizontally so a control sitting at
 * the right edge of the toolbar (which is where it lives) never opens
 * off-screen.
 */
function computePanelPosition(
  rect: DOMRect,
  align: 'start' | 'end',
  viewportWidth: number,
  viewportHeight: number,
): PanelPosition {
  const below = rect.bottom + 4
  const fitsBelow = below + PANEL_ESTIMATED_HEIGHT + VIEWPORT_MARGIN <= viewportHeight
  const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN, rect.top - 4 - PANEL_ESTIMATED_HEIGHT)

  const preferredLeft = align === 'end' ? rect.right - PANEL_WIDTH : rect.left
  const maxLeft = viewportWidth - PANEL_WIDTH - VIEWPORT_MARGIN
  const left = Math.max(VIEWPORT_MARGIN, Math.min(preferredLeft, maxLeft))

  return { top, left }
}

export interface DensityControlProps {
  /**
   * Table this control belongs to. Density is stored PER TABLE, so choosing
   * "dense" in one pane no longer re-lays-out every other grid on screen.
   */
  tableKey?: string
  /**
   * Controlled level. Omit to let the control own the user's persisted
   * preference (the normal case — one line in the toolbar and it works).
   */
  value?: DensityLevel
  /** Called on every choice, controlled or not. */
  onChange?: (level: DensityLevel) => void
  /**
   * `toolbar` — 32×32 icon button matching the grid's other toolbar actions.
   * `labelled` — bordered trigger showing the current level in words, for
   * settings panels where the control is not next to a table to compare with.
   */
  variant?: 'toolbar' | 'labelled'
  /** Which trigger edge the panel aligns to. Defaults to `end` (right-aligned). */
  align?: 'start' | 'end'
  disabled?: boolean
  className?: string
}

/**
 * Row-density picker. Uncontrolled by default: it reads and writes the current
 * user's preference through `useDensityPreference`, which is per-user, global
 * across grids, and physically cannot leak to another account.
 */
export const DensityControl: React.FC<DensityControlProps> = ({
  tableKey,
  value,
  onChange,
  variant = 'toolbar',
  align = 'end',
  disabled = false,
  className,
}) => {
  const t = useT()
  const preference = useDensityPreference(undefined, tableKey)
  const controlled = value !== undefined
  const current = controlled ? value : preference.density

  const [open, setOpen] = React.useState(false)
  const [position, setPosition] = React.useState<PanelPosition | null>(null)
  const [activeIndex, setActiveIndex] = React.useState(0)

  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const listboxId = React.useId()

  // Labels are looked up per render but the array is tiny and fixed at three;
  // this component renders once per toolbar, not once per cell, so there is no
  // hot path to protect here.
  const options = DENSITY_LEVELS.map((level) => ({
    level,
    label: LEVEL_LABEL(t, level),
    description: LEVEL_DESCRIPTION(t, level),
  }))
  const currentLabel = LEVEL_LABEL(t, current)

  const close = React.useCallback((focusTrigger: boolean) => {
    setOpen(false)
    setPosition(null)
    if (focusTrigger) triggerRef.current?.focus()
  }, [])

  const openPanel = React.useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition(
      computePanelPosition(rect, align, window.innerWidth, window.innerHeight),
    )
    const index = DENSITY_LEVELS.indexOf(current)
    setActiveIndex(index >= 0 ? index : 0)
    setOpen(true)
  }, [align, current])

  const choose = React.useCallback(
    (level: DensityLevel) => {
      if (!controlled) preference.setDensity(level)
      onChange?.(level)
      close(true)
    },
    [controlled, onChange, preference, close],
  )

  // Dismissal. All three listeners are bound only while open, and the keydown
  // one is CAPTURE so Escape is consumed here before the grid's own handler
  // sees it and clears the selection.
  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      close(false)
    }
    const onScroll = () => close(false)
    const onResize = () => close(false)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close(true)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, close])

  // Move focus into the listbox once it exists, so the arrow keys work without
  // the user having to click first.
  React.useEffect(() => {
    if (open && position) panelRef.current?.focus()
  }, [open, position])

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openPanel()
    }
  }

  const onListboxKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, DENSITY_LEVELS.length - 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(DENSITY_LEVELS.length - 1)
        break
      case 'Enter':
      case ' ': {
        event.preventDefault()
        const level = DENSITY_LEVELS[activeIndex]
        if (level) choose(level)
        break
      }
      case 'Tab':
        close(false)
        break
      default:
        break
    }
  }

  const accessibleName = `${t('dynamicTable.density.label', 'Row density')}: ${currentLabel}`

  const trigger =
    variant === 'labelled' ? (
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close(false) : openPanel())}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={accessibleName}
        className={[
          // An M3 outlined control: pill corner, `--m3-outline` (the role for
          // input and segment borders), a surface-container-lowest fill and
          // on-surface ink. The shadcn semantic classes it used to carry
          // (`border-input`, `bg-background`, `text-foreground`) resolve into
          // the legacy token set, so the control drifted away from the grid's
          // palette as soon as the grid moved to M3.
          'flex items-center justify-between gap-2 rounded-m3-full border border-[var(--m3-outline)] bg-[var(--m3-surface-container-lowest)] px-3 py-2',
          'text-left text-body-regular-sm text-[var(--m3-on-surface)] shadow-none transition-colors',
          'hover:bg-[var(--m3-state-layer-hover)] disabled:cursor-default',
          // Opacity dims a genuinely disabled control and nothing else.
          'disabled:opacity-[var(--m3-disabled-content-opacity)]',
          // Focus is TEAL, not blue: blue is selection, teal is
          // interaction-affirmative. The halo needs clearance, and this trigger
          // sits in a settings panel rather than inside a dense row, so it gets
          // the outward form.
          open ? 'border-[var(--m3-focus-ring-color)] shadow-[var(--m3-focus-halo)]' : '',
          disabled ? '' : 'cursor-pointer',
          className ?? '',
        ].join(' ')}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Rows3 className="size-4 shrink-0 text-[var(--m3-on-surface-variant)]" aria-hidden="true" />
          <span className="truncate">{currentLabel}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-[var(--m3-on-surface-variant)]" aria-hidden="true" />
      </button>
    ) : (
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close(false) : openPanel())}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={accessibleName}
        title={accessibleName}
        className={['fullscreen-toggle-btn', className ?? ''].join(' ')}
      >
        <Rows3 className="w-4 h-4" aria-hidden="true" />
      </button>
    )

  const panel =
    open && position && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={panelRef}
            id={listboxId}
            role="listbox"
            tabIndex={-1}
            aria-label={t('dynamicTable.density.label', 'Row density')}
            aria-activedescendant={`${listboxId}-${activeIndex}`}
            onKeyDown={onListboxKeyDown}
            className="fixed z-[60] overflow-auto rounded-m3-lg border border-[var(--m3-outline-faint)] bg-[var(--m3-surface-bright)] py-1 text-[var(--m3-on-surface)] shadow-m3-2 outline-none"
            style={{ top: position.top, left: position.left, width: PANEL_WIDTH }}
          >
            {options.map((option, index) => {
              const selected = option.level === current
              const active = index === activeIndex
              return (
                <div
                  key={option.level}
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  data-density-option={option.level}
                  onClick={() => choose(option.level)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={[
                    // Same concentric 8px corner every other overlay item row
                    // in the grid takes (ContextMenu.css), and the same two
                    // states: a translucent hover layer, and a
                    // `secondary-container` swap for the chosen value — M3
                    // defines no "selected" opacity, selection swaps the
                    // container and its ink.
                    'mx-1 flex cursor-pointer items-start gap-2 rounded-m3-sm px-2 py-2 transition-colors',
                    selected
                      ? 'bg-[var(--m3-secondary-container)] text-[var(--m3-on-secondary-container)]'
                      : 'text-[var(--m3-on-surface)]',
                    active && !selected ? 'bg-[var(--m3-state-layer-hover)]' : '',
                  ].join(' ')}
                >
                  <span className="flex w-4 shrink-0 justify-center pt-0.5">
                    {selected ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-regular-sm">
                      {option.label}
                    </span>
                    <span
                      className={[
                        'block text-body-regular-xs',
                        // The description is secondary INK, not dimmed text. On
                        // the selected blue it inherits `on-secondary-container`
                        // so it keeps its contrast instead of washing out.
                        selected ? '' : 'text-[var(--m3-on-surface-variant)]',
                      ].join(' ')}
                    >
                      {option.description}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>,
          document.body,
        )
      : null

  return (
    <>
      {trigger}
      {panel}
    </>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   LABELS

   English defaults live here; Polish (the primary locale) and the other three
   arrive from `apps/web/src/i18n/*.json`, which this wave may not touch — the
   keys are filed as a wiring contract. Hardcoding Polish in a shared
   @freighttech package would leak into Tier-3 apps.

   The DESCRIPTIONS are not decoration. "Dense" as a bare word does not tell
   anyone whether it will still be readable, and the whole reason this is a
   preference rather than a global change is that the product owner has
   repeatedly flagged FMS type as too small. Stating "same text size, tighter
   rows" on `compact` is what makes it the safe thing to try first.
   ─────────────────────────────────────────────────────────────────────────── */

type Translate = ReturnType<typeof useT>

function LEVEL_LABEL(t: Translate, level: DensityLevel): string {
  switch (level) {
    case 'compact':
      return t('dynamicTable.density.compact', 'Medium')
    case 'dense':
      return t('dynamicTable.density.dense', 'Tight')
    case 'comfortable':
    default:
      return t('dynamicTable.density.comfortable', 'Roomy')
  }
}

function LEVEL_DESCRIPTION(t: Translate, level: DensityLevel): string {
  switch (level) {
    case 'compact':
      return t('dynamicTable.density.compactHint', '44px rows')
    case 'dense':
      return t('dynamicTable.density.denseHint', '34px rows — the default')
    case 'comfortable':
    default:
      return t('dynamicTable.density.comfortableHint', '48px rows')
  }
}

export default DensityControl
