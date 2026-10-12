'use client'

/**
 * The section controls shared by the grid editor and the pages that draw a grid:
 * "Ile slotów w rzędzie?" (1–6) and the dashed "Dodaj sekcję" bar.
 */

import * as React from 'react'
import { Plus, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { GRID_COLUMNS, type GridColumns } from './model'

const chip =
  'inline-flex h-7 min-w-7 items-center justify-center rounded-[8px] px-1.5 text-body-regular-sm tabular-nums text-m3ft-on-surface ' +
  'hover:bg-m3ft-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-m3ft-outline disabled:opacity-40'

/** "Ile slotów w rzędzie?" 1–6 — a new section's column count. */
export function ColumnChoice({ onPick, onCancel, label }: { onPick: (n: GridColumns) => void; onCancel: () => void; label: string }) {
  const t = useT()
  return (
    <span
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-[10px] border border-m3ft-outline-variant bg-m3ft-surface p-0.5"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      {GRID_COLUMNS.map((n) => (
        <button key={n} type="button" className={chip} onClick={() => onPick(n)} aria-label={t('split_views.grid.sectionSlots', 'Sekcja: {n} slotów', { n })} data-testid={`grid-columns-${n}`}>
          {n}
        </button>
      ))}
      <button type="button" className={chip} onClick={onCancel} aria-label={t('split_views.grid.cancel', 'Anuluj')}>
        <X className="size-4" aria-hidden />
      </button>
    </span>
  )
}

/** The dashed "Dodaj sekcję" bar; a click asks how many slots the row has. */
export function AddSection({ onAdd, testId = 'grid-add-section' }: { onAdd: (columns: GridColumns) => void; testId?: string }) {
  const t = useT()
  const [choosing, setChoosing] = React.useState(false)
  return (
    <div
      className="flex h-12 items-center justify-center gap-3 rounded-[16px] border border-dashed border-m3ft-outline-variant text-body-regular-sm text-m3ft-on-surface-variant"
      data-testid={testId}
    >
      {choosing ? (
        <>
          <span>{t('split_views.grid.howManySlots', 'Ile slotów w rzędzie?')}</span>
          <ColumnChoice
            label={t('split_views.grid.newSection', 'Nowa sekcja — ile slotów w rzędzie')}
            onPick={(n) => {
              onAdd(n)
              setChoosing(false)
            }}
            onCancel={() => setChoosing(false)}
          />
        </>
      ) : (
        <button type="button" onClick={() => setChoosing(true)} className="inline-flex h-full w-full items-center justify-center gap-2 rounded-[16px] hover:bg-m3ft-surface-container-low hover:text-m3ft-on-surface">
          <Plus className="size-4" aria-hidden />
          {t('split_views.grid.addSection', 'Dodaj sekcję')}
        </button>
      )}
    </div>
  )
}
