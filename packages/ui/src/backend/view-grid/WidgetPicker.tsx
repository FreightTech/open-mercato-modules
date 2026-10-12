'use client'

/**
 * "Dodaj widżet" / "Podmień" — a searchable list of what a place of the grid can
 * hold (fms-design PR #35 `SearchSelect variant="slot"`). The trigger is the
 * place itself (a dashed box with "+"), or nothing when `defaultOpen` (Podmień
 * opens straight on the list).
 */

import * as React from 'react'
import { Check, Plus, Search } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../../primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from './cn'

/** The compact filled field (FMS visual language: 40 px, filled, no outline at rest). */
const compactControl =
  'h-10 w-full min-w-0 rounded-[10px] border border-transparent bg-m3ft-surface-container-high px-3 ' +
  'text-body-regular-sm text-m3ft-on-surface placeholder:text-m3ft-on-surface-variant ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-m3ft-outline ' +
  'aria-[invalid=true]:border-m3ft-error disabled:opacity-60'

export type WidgetOption = {
  value: string
  label: string
  /** The group heading in the list ("Tabele", "Widżety", a module name). */
  group?: string
  description?: string | null
}

export function WidgetPicker({
  options,
  onPick,
  label,
  addLabel,
  value,
  defaultOpen,
  onClose,
  compact,
  testId,
}: {
  options: WidgetOption[]
  onPick: (value: string) => void
  /** Accessible name of the trigger ("Dodaj widżet do sekcji 2"). */
  label: string
  /** The trigger's visible text ("Dodaj widżet", "Dodaj"). */
  addLabel: string
  /** The current choice, ticked in the list (Podmień). */
  value?: string
  defaultOpen?: boolean
  onClose?: () => void
  /** A small trigger (the editor's free place) instead of the page's tall one. */
  compact?: boolean
  testId?: string
}) {
  const t = useT()
  const [open, setOpen] = React.useState(Boolean(defaultOpen))
  const [query, setQuery] = React.useState('')
  const q = query.trim().toLowerCase()
  const visible = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.group ?? '').toLowerCase().includes(q) || (o.description ?? '').toLowerCase().includes(q))
    : options
  const groups = React.useMemo(() => {
    // One heading per group, in the order groups first appear.
    const out = new Map<string, WidgetOption[]>()
    for (const o of visible) {
      const g = o.group ?? ''
      out.set(g, [...(out.get(g) ?? []), o])
    }
    return [...out].map(([group, items]) => ({ group, items }))
  }, [visible])
  const change = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setQuery('')
      onClose?.()
    }
  }
  const trigger = (
    <button
      type="button"
      aria-label={label}
      data-testid={testId}
      className={cn(
        'flex h-full w-full flex-col items-center justify-center gap-1 rounded-[12px] text-body-regular-sm text-m3ft-on-surface-variant',
        'hover:bg-m3ft-surface-container-low hover:text-m3ft-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-m3ft-outline',
        compact ? 'min-h-10 flex-row' : 'min-h-[140px]',
      )}
    >
      <Plus className="size-4" aria-hidden />
      {addLabel}
    </button>
  )
  return (
    <Popover modal open={open} onOpenChange={change}>
      {defaultOpen ? (
        <PopoverAnchor asChild>
          <div className="h-full min-h-10 w-full" />
        </PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      )}
      <PopoverContent
        align="start"
        className="theme-m3-freighttech z-[90] w-80 rounded-[12px] border border-m3ft-outline-variant bg-m3ft-surface p-2 shadow-none"
        data-testid={testId ? `${testId}-list` : undefined}
      >
        <label className="relative mb-2 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-m3ft-on-surface-variant" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('split_views.grid.searchWidget', 'Szukaj widżetu')}
            placeholder={t('split_views.grid.searchWidget', 'Szukaj widżetu')}
            className={cn(compactControl, 'pl-9')}
          />
        </label>
        {visible.length === 0 ? (
          <p className="px-2 py-2 text-body-regular-sm text-m3ft-on-surface-variant">{t('split_views.grid.noWidgets', 'Brak pasujących widżetów.')}</p>
        ) : (
          <div role="listbox" className="max-h-80 overflow-y-auto">
            {groups.map(({ group, items }) => (
              <div key={group || '-'} className="py-1">
                {group ? <p className="px-2 pb-1 pt-1 text-body-regular-xs text-m3ft-on-surface-variant">{group}</p> : null}
                {items.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    data-value={o.value}
                    onClick={() => {
                      onPick(o.value)
                      change(false)
                    }}
                    className="flex min-h-9 w-full items-start gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-m3ft-surface-container"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center pt-0.5">{o.value === value ? <Check className="size-4" aria-hidden /> : null}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-regular-sm text-m3ft-on-surface">{o.label}</span>
                      {o.description ? <span className="block truncate text-body-regular-xs text-m3ft-on-surface-variant">{o.description}</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
