"use client"

import * as React from 'react'

export type CalendarPopoverSide = 'top' | 'bottom'

/** PopoverContent's default `sideOffset`. */
const SIDE_OFFSET = 4

/**
 * Vertical collision padding no popover can reach: once the side is chosen Radix
 * still shifts the popover sideways to keep it on screen, but never flips it.
 */
const NO_VERTICAL_FLIP = { top: -100_000, bottom: -100_000 }

/**
 * Below the field when the popover fits there (or there is no more room above),
 * otherwise above — the choice Radix's collision handling makes, made once.
 */
export function pickCalendarSide(
  trigger: { top: number; bottom: number },
  popoverHeight: number,
  viewportHeight: number,
): CalendarPopoverSide {
  const below = viewportHeight - trigger.bottom
  const above = trigger.top
  return below >= popoverHeight || below >= above ? 'bottom' : 'top'
}

/**
 * Open state, shown month and placement of a date picker's calendar popover.
 *
 * - It opens on the month of the value (today's when empty) — react-day-picker
 *   ignores `selected` when choosing the month, so an ETA of 18 Dec opened on
 *   the current month.
 * - It picks above/below once, when it opens, from its real height, and keeps that
 *   side until it closes. Radix re-runs collision detection whenever the content
 *   resizes, so a taller month flipped it across the field and moved the ‹ ›
 *   arrows away from the cursor (the `Calendar`'s six fixed weeks stop the resize
 *   too; the lock holds for any content).
 */
export function useCalendarPopover(value: Date | null | undefined) {
  const [open, setOpenState] = React.useState(false)
  // The month the user navigated to; until then (and again on every open) the value's month.
  const [navigatedMonth, setMonth] = React.useState<Date | undefined>(undefined)
  const [side, setSide] = React.useState<CalendarPopoverSide | undefined>(undefined)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const month = navigatedMonth ?? value ?? new Date()

  const setOpen = React.useCallback((next: boolean) => {
    if (next) setMonth(undefined)
    setOpenState(next)
  }, [])

  // The content mounts on every open: measure it there, before the first paint.
  const contentRef = React.useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      setSide(undefined)
      return
    }
    const trigger = triggerRef.current
    if (!trigger) return
    setSide(pickCalendarSide(trigger.getBoundingClientRect(), node.offsetHeight + SIDE_OFFSET, window.innerHeight))
  }, [])

  const contentProps = side ? { side, collisionPadding: NO_VERTICAL_FLIP } : {}

  return { open, setOpen, month, setMonth, triggerRef, contentRef, contentProps }
}
