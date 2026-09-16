import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from './utils'

/*
  Figma source: FMS-Componenets → Tag (component-set 46:38).

  Variant matrix (extracted from each variant's `fills`/`strokes`/text fill):
    | Variant   | Background | Border  | Text    | Notes
    |-----------|-----------|---------|---------|------
    | default   | #F4F4F5   | #E4E4E7 | #71717A | gray, generic
    | container | #E8EEF4   | #C9D9E7 | #18181A | "kontener" — container IDs
    | teczka    | #CCFBF1   | #99E7D8 | #0D9488 | folder/project IDs

  Plus status-color variants (success / error / warning / info / purple /
  orange) that reuse the `--status-v2-*` tokens shared with `Badge`. These
  let callers render a Tag-shaped chip (rectangular w/ 6px radius) for
  status pills like "AKTYWNA" / "Ready" / "Pending" without falling back
  to the pill-shaped Badge component. They're additive — `default` /
  `container` / `teczka` still match the Figma source exactly.

  Plus a `state` of `default | removable`. Removable adds a trailing
  "×" close button.

  Layout: gap 4px, padding 3px 8px (default) / 3px 6px 3px 8px (removable),
  radius 6px (`rounded-[6px]`), text 13px / Geist Regular 400. Matches
  the FMS Teczka detail mockup's chip — visible corner roundness but
  still reads as a rectangular tag rather than a pill at small heights.
*/

export type TagVariant =
  | 'default'
  | 'container'
  | 'teczka'
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | 'purple'
  | 'orange'

/**
 * `md` (default): Figma source — 13px / 3px padding.
 * `sm`: compact 12px / 2px padding — matches the in-card "chip" pattern
 * from the FMS Teczka detail mockup (e.g. IMPORT / AKTYWNA).
 */
export type TagSize = 'sm' | 'md'

export type TagProps = Omit<React.HTMLAttributes<HTMLSpanElement>, 'onSelect'> & {
  variant?: TagVariant
  size?: TagSize
  /** When provided, renders a close "×" button after the children and calls this on click. */
  onRemove?: (e: React.MouseEvent<HTMLButtonElement>) => void
  /** Accessible label for the close button. Falls back to "Usuń". */
  removeAriaLabel?: string
  /** Optional leading element (icon, dot, avatar). */
  leading?: React.ReactNode
}

const VARIANT_CLASSES: Record<TagVariant, string> = {
  default: 'bg-status-v2-neutral-bg border-status-v2-neutral-border text-status-v2-neutral-text',
  container: 'bg-status-v2-primary-bg border-status-v2-primary-border text-status-v2-primary-text',
  teczka: 'bg-status-v2-teal-bg border-status-v2-teal-border text-status-v2-teal-text',
  success: 'bg-status-v2-success-bg border-status-v2-success-border text-status-v2-success-text',
  error: 'bg-status-v2-error-bg border-status-v2-error-border text-status-v2-error-text',
  warning: 'bg-status-v2-warning-bg border-status-v2-warning-border text-status-v2-warning-text',
  info: 'bg-status-v2-info-bg border-status-v2-info-border text-status-v2-info-text',
  purple: 'bg-status-v2-purple-bg border-status-v2-purple-border text-status-v2-purple-text',
  orange: 'bg-status-v2-orange-bg border-status-v2-orange-border text-status-v2-orange-text',
}

const SIZE_CLASSES: Record<TagSize, string> = {
  sm: 'py-[2px] text-label-semibold-xs',
  md: 'py-[3px] text-[13px]',
}

export const Tag = React.forwardRef<HTMLSpanElement, TagProps>(function Tag(
  { variant = 'default', size = 'md', onRemove, removeAriaLabel = 'Usuń', leading, className, children, ...props },
  ref,
) {
  const removable = typeof onRemove === 'function'
  return (
    <span
      ref={ref}
      className={cn(
        // Tag text is always uppercase — matches the FMS chip convention
        // (IMPORT / AKTYWNA / LOADED / …). Callers can opt out with
        // `className="normal-case"` if they ever need raw casing.
        'inline-flex items-center gap-1 rounded-[6px] border uppercase tracking-wide',
        SIZE_CLASSES[size],
        removable ? 'pl-2 pr-1.5' : 'px-2',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    >
      {leading != null ? <span className="inline-flex shrink-0">{leading}</span> : null}
      <span>{children}</span>
      {removable ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeAriaLabel}
          className={cn(
            'ml-0.5 inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-sm',
            'opacity-70 transition-opacity hover:bg-black/5 hover:opacity-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1',
          )}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  )
})
