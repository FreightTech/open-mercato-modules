'use client'

/**
 * VIEW MODE SWITCH — the list/grid control in the toolbar's icon cluster.
 *
 * A Material 3 **segmented button**, not a dropdown: two options do not earn a
 * menu, and the reference this feature is modelled on (Google Drive) uses a
 * toggle. The selected segment carries the `secondary-container` /
 * `on-secondary-container` PAIR — never a background without its matching
 * foreground, which is the mechanism that makes a Material surface legible in
 * both themes without a second set of colours.
 *
 * Three things here are house rules rather than taste:
 *
 *  1. **48 dp minimum touch target.** The visible segment is 32 px to sit in a
 *     dense toolbar; the target is grown to 48 with a transparent inset rather
 *     than by making the control bigger. A control you can see and cannot
 *     reliably hit is a control that reads as broken on a laptop trackpad.
 *  2. **Interaction is a state LAYER** — an 8% wash of the content colour over
 *     whatever is underneath — not a background swap. A hover that replaces the
 *     fill loses the selected/unselected distinction for the frame it is under
 *     the cursor.
 *  3. **Radio semantics, not two buttons.** `role="radiogroup"` with
 *     `aria-checked` announces "2 of 2" and the current choice. Two independent
 *     buttons announce neither, and a screen-reader user cannot tell which view
 *     they are already in.
 *
 * Arrow keys move the selection (radio-group convention); Tab enters and leaves
 * the group once, landing on the checked segment.
 */

import * as React from 'react'
import type { TableViewMode, TableViewModeOption } from '../types/index'

export interface ViewModeSwitchProps {
  options: TableViewModeOption[]
  value: TableViewMode
  onChange: (mode: TableViewMode) => void
}

export const ViewModeSwitch: React.FC<ViewModeSwitchProps> = ({ options, value, onChange }) => {
  // One option is not a choice. Rendering a segmented control with a single
  // segment offers the user a decision that does not exist.
  if (options.length < 2) return null

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown'
      ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        ? -1
        : 0
    if (dir === 0) return
    e.preventDefault()
    const idx = options.findIndex((o) => o.mode === value)
    const next = options[(idx + dir + options.length) % options.length]
    if (next) onChange(next.mode)
  }

  return (
    <div
      className="hot-viewmode-switch"
      role="radiogroup"
      aria-label={options.map((o) => o.label).join(' / ')}
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => {
        const selected = option.mode === value
        return (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            /* Only the checked segment is tabbable — the radio-group
               convention. Otherwise Tab stops twice inside one control. */
            tabIndex={selected ? 0 : -1}
            data-selected={selected ? 'true' : undefined}
            data-view-mode={option.mode}
            className="hot-viewmode-segment"
            onClick={() => { if (!selected) onChange(option.mode) }}
          >
            {option.icon}
          </button>
        )
      })}
    </div>
  )
}

export default ViewModeSwitch
