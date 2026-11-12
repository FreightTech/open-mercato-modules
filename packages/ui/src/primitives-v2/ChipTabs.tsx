import * as React from 'react'
import { cn } from './utils'

/*
  Chip tabs — the one control for picking one of a few views or values (FMS UX 03.11, owner: no underline tabs and no
  segmented button groups; "the chips we have", the look of a table's view chips "Widok domyślny · Dziś · Zaległe").
  A row of borderless pills: the chosen one on the grey fill (`surface-container-high`; owner 03.11 — blue is only for a
  table's own view chips), the others plain text with
  the hover state layer. `role="tablist"` for views/sections, `role="radiogroup"` for a value (row density, a
  granularity, a filter scope). Arrow keys move between options; the chosen one is the tab stop.
*/

export type ChipTabOption<V extends string = string> = {
  value: V
  label: React.ReactNode
  /** A count shown after the label (e.g. "Firmy 8"). */
  count?: React.ReactNode
  icon?: React.ReactNode
  disabled?: boolean
  title?: string
  testId?: string
}

export type ChipTabsProps<V extends string = string> = {
  value: V | null | undefined
  onChange: (value: V) => void
  options: ReadonlyArray<ChipTabOption<V>>
  ariaLabel?: string
  /** `tablist` for views and sections, `radiogroup` for picking a value. */
  role?: 'tablist' | 'radiogroup'
  /** `sm` 28px (in toolbars, menus, table rows), `md` 32px (a page's own views). */
  size?: 'sm' | 'md'
  wrap?: boolean
  className?: string
  testId?: string
}

const ITEM =
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--m3-shape-full)] px-3 text-body-medium-sm ' +
  'transition-[background-color,color] duration-[var(--m3-duration-short2)] ease-[var(--m3-ease-standard)] ' +
  // Keyboard focus: a quiet inset ring in the field focus colour, not a 2 px near-black ring around the pill.
  'focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--field-v2-stroke-focus,#666)] disabled:pointer-events-none disabled:opacity-40'
// The FMS neutral (#ECECEC), not the base M3 slate (#E9EEF5) — that drew a blue-grey pill on pages outside the FMS
// theme wrapper (owner 05.11, Finanse).
const ON = 'bg-[var(--m3ft-v2-surface-container-high,var(--m3-surface-container-high))] text-[var(--m3ft-v2-on-surface,var(--m3-on-surface))]'
const OFF = 'text-[var(--m3-on-surface-variant)] hover:bg-[var(--m3-state-layer-hover)] hover:text-[var(--m3-on-surface)]'

export function ChipTabs<V extends string = string>({
  value,
  onChange,
  options,
  ariaLabel,
  role = 'tablist',
  size = 'sm',
  wrap = false,
  className,
  testId,
}: ChipTabsProps<V>) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([])
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
  const current = options.findIndex((o) => o.value === value)
  const stop = current >= 0 ? current : enabled[0] ?? -1

  const move = (from: number, step: number) => {
    if (!enabled.length) return
    const at = enabled.indexOf(from)
    const next = enabled[(at + step + enabled.length) % enabled.length]
    refs.current[next]?.focus()
    if (role === 'radiogroup') onChange(options[next].value)
  }

  return (
    <div
      role={role}
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn('flex min-w-0 items-center gap-1', wrap ? 'flex-wrap' : 'overflow-x-auto [scrollbar-width:none]', className)}
    >
      {options.map((o, i) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role={role === 'tablist' ? 'tab' : 'radio'}
            aria-selected={role === 'tablist' ? selected : undefined}
            aria-checked={role === 'radiogroup' ? selected : undefined}
            tabIndex={i === stop ? 0 : -1}
            disabled={o.disabled}
            title={o.title}
            data-testid={o.testId}
            data-state={selected ? 'active' : 'inactive'}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault()
                move(i, 1)
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault()
                move(i, -1)
              }
            }}
            className={cn(ITEM, size === 'md' ? 'h-8' : 'h-7', selected ? ON : OFF)}
          >
            {o.icon}
            <span>{o.label}</span>
            {o.count != null ? <span className="tabular-nums opacity-70">{o.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
