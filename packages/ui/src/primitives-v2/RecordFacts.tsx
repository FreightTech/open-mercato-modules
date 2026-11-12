import * as React from 'react'
import { cn } from './utils'

/*
  A record's facts under its title — the teczka, the contractor's card, the CRM company card (FMS UX 03.11, owner: one
  header everywhere, the teczka's). Label over value, no frames and no rules between facts; one grid whose column
  count follows the header's own width — 7, 6, 4, 3, 2: counts the usual 12 facts divide into full rows — so the
  facts fill the width, line up and stay responsive. A value too long for its column is cut with "…" and shown whole
  in a tooltip. Inline pickers and fields inside a value stay quiet (a box only on hover/focus) and every value is one
  24 px line, so text, field and picker sit on one baseline.
*/

/** The facts grid's classes — for a record that renders its own fact items (the teczka's editable facts). */
export const recordFactsGridClass = cn(
  // `record-facts`: the theme's FIELDS rule leaves the facts quiet (values read as text, edit in place).
  'record-facts grid min-w-0 grid-cols-2 gap-x-5 gap-y-2 @[34rem]:grid-cols-3 @[46rem]:grid-cols-4 @[64rem]:grid-cols-6 @[76rem]:grid-cols-7',
  '[&_input:not(:focus)]:!border-transparent [&_input:not(:focus)]:!bg-transparent [&_input:not(:focus)]:!shadow-none [&_input]:-ml-2 [&_input]:!h-6 [&_input]:px-2 [&_input]:align-middle [&_input]:max-w-full [&_input]:text-ellipsis',
  '[&_button[aria-haspopup]:not(:hover)]:bg-transparent [&_button[aria-haspopup]]:-ml-2 [&_button[aria-haspopup]]:max-w-full',
  '[&_dd_button]:!h-6 [&_dd_button]:!min-h-0 [&_dd_button]:align-middle',
)

/** One fact's frame, label and value classes. */
export const recordFactClass = 'relative flex min-w-0 flex-col'
export const recordFactLabelClass = 'truncate text-body-regular-xs text-m3ft-on-surface-variant'
export const recordFactValueClass = 'min-h-6 min-w-0 truncate text-body-medium-sm leading-6 text-m3ft-on-surface'

export type RecordFactsProps = React.HTMLAttributes<HTMLDListElement> & {
  /** Indent the facts under the title, past the back arrow (36 px + 8 px gap). */
  indent?: boolean
}

export function RecordFacts({ indent = true, className, children, ...props }: RecordFactsProps) {
  return (
    <div className={cn('@container min-w-0', indent && 'pl-11')}>
      <dl className={cn(recordFactsGridClass, className)} {...props}>
        {children}
      </dl>
    </div>
  )
}

export type RecordFactProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> & {
  label: React.ReactNode
  value: React.ReactNode
  /** The whole value in the tooltip; defaults to the value when it is plain text. */
  title?: string
  valueClassName?: string
}

export function RecordFact({ label, value, title, valueClassName, className, ...props }: RecordFactProps) {
  const hint = title ?? (typeof value === 'string' || typeof value === 'number' ? String(value) : undefined)
  return (
    <div className={cn(recordFactClass, className)} title={hint} {...props}>
      <dt className={recordFactLabelClass}>{label}</dt>
      <dd className={cn(recordFactValueClass, valueClassName)}>{value === null || value === undefined || value === '' ? '—' : value}</dd>
    </div>
  )
}
