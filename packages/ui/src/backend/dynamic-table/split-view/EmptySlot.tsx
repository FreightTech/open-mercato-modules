'use client'

/**
 * An unfilled cell of a grid template.
 *
 * The whole cell is the affordance — a click anywhere in it opens the picker,
 * anchored to whatever the user clicked, exactly like the "add table left /
 * right" rows do. A small centred button inside a big dead box would make the
 * target smaller than the thing it sits in for no reason.
 *
 * Deliberately quiet: a dashed hairline and one line of text. Four of these on
 * screen at once is the normal first second of a 2×2, and four loud boxes read
 * as an error state rather than an invitation.
 *
 * Colours come from theme variables, never literals — the split view already
 * shipped one hardcoded light-theme colour that turned invisible in dark mode.
 */

import * as React from 'react'
import { Plus, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ICON_BUTTON } from './chrome'

export function EmptySlot({
  slotId,
  canRemove,
  onAdd,
  onRemove,
}: {
  slotId: string
  /** False for the only slot in the layout — removing it would leave no tree. */
  canRemove: boolean
  /** The rect anchors the picker; pass the clicked element's own rect. */
  onAdd: (anchor: DOMRect) => void
  onRemove: () => void
}) {
  const t = useT()
  const labelRef = React.useRef<HTMLSpanElement>(null)
  return (
    // No padding of its own: the pane area is padded and the gutter is the
    // gutter, so an empty cell occupies EXACTLY the box a filled pane would.
    <div className="relative flex h-full min-h-0 min-w-0 flex-1" data-pane-empty={slotId}>
      <button
        type="button"
        // Anchor the picker to the "+ Dodaj" label in the middle of the cell,
        // not to the cell: a cell is half a screen tall, and a menu opened
        // below it lands far from where the user clicked.
        onClick={(event) => onAdd((labelRef.current ?? event.currentTarget).getBoundingClientRect())}
        // Same 16px corner as a filled pane card, so an empty cell and a
        // filled one agree on shape. The border stays DASHED — here "nothing
        // yet" genuinely is a placeholder — and hover raises a state layer
        // rather than swapping the border colour.
        // The prototype's "AddTile": a dashed placeholder on a faintly tinted
        // ground, and on hover the border takes the accent — "drop it here".
        className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-m3-lg border border-dashed border-[var(--m3-outline-variant)] bg-[var(--m3-surface-container-low)] text-[var(--m3-on-surface-variant)] transition-colors duration-[var(--m3-duration-short2)] ease-m3-standard hover:border-[var(--m3-accent)] hover:bg-[var(--m3-surface-container)] hover:text-[var(--m3-on-surface)]"
        data-pane-empty-add={slotId}
      >
        <span ref={labelRef} className="flex flex-col items-center gap-2">
          <Plus className="h-5 w-5" aria-hidden="true" />
          <span className="text-label-medium-md">{t('splitView.slot.add', 'Add table or widget')}</span>
        </span>
      </button>

      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('splitView.slot.remove', 'Remove this slot')}
          title={t('splitView.slot.remove', 'Remove this slot')}
          className={`absolute right-2 top-2 ${ICON_BUTTON}`}
          data-pane-empty-remove={slotId}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export default EmptySlot
