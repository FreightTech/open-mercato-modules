import * as React from 'react'
import { cn } from './utils'

/*
  Figma source: FMS-Componenets → Badge (component-set 45:26).

  Variant matrix (extracted from each variant's `fills`/`strokes`/text fill):
    | Variant   | Background | Border  | Text    |
    |-----------|-----------|---------|---------|
    | neutral   | #F4F4F5   | #E4E4E7 | #71717A |
    | primary   | #E8EEF4   | #C9D9E7 | #18181A |
    | outline   | #FFFFFF   | #E4E4E7 | #71717A |
    | success   | #F0FDF4   | #BBF7D0 | #166534 |
    | error     | #FEF2F2   | #FECACA | #991B1B |
    | warning   | #FFFBEB   | #FDE68A | #92400E |
    | info      | #EFF6FF   | #BFDBFE | #1E40AF |
    | purple    | #EDE9FE   | #DDD6FE | #6D28D9 |
    | teal      | #CCFBF1   | #99F6E4 | #0F766E |
    | orange    | #FFEDD5   | #FED7AA | #C2410C |
    | sky       | #E0F2FE   | #BAE6FD | #0369A1 |
    | rose      | #FFE4E6   | #FECDD3 | #BE123C |

  All variants pull from `-v2-status-*` tokens in tokens.css. No border (FMS UX 03.11, owner: badges and chips
  carry their tone in the fill alone; Figma's 1px strokes are dropped) — only `outline` keeps its line, as an inset
  shadow, because the line is that variant's whole look.

  Sizes:
    sm: `label/semibold/xs` (12px / 16px) — Figma's default for tags.
    md: `label/semibold/md` (14px / 20px).
  Padding 2px / 10px. Radius 9999px (pill).
*/

export type BadgeVariant =
  | 'neutral'
  | 'primary'
  | 'outline'
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | 'purple'
  | 'teal'
  | 'orange'
  | 'sky'
  | 'rose'

export type BadgeSize = 'sm' | 'md'

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant
  size?: BadgeSize
  /** Optional leading dot indicator (e.g. coloured status indicator). */
  withDot?: boolean
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'bg-status-v2-neutral-bg border-status-v2-neutral-border text-status-v2-neutral-text',
  primary: 'bg-status-v2-primary-bg border-status-v2-primary-border text-status-v2-primary-text',
  outline: 'bg-status-v2-outline-bg border-status-v2-outline-border text-status-v2-outline-text',
  success: 'bg-status-v2-success-bg border-status-v2-success-border text-status-v2-success-text',
  error: 'bg-status-v2-error-bg border-status-v2-error-border text-status-v2-error-text',
  warning: 'bg-status-v2-warning-bg border-status-v2-warning-border text-status-v2-warning-text',
  info: 'bg-status-v2-info-bg border-status-v2-info-border text-status-v2-info-text',
  purple: 'bg-status-v2-purple-bg border-status-v2-purple-border text-status-v2-purple-text',
  teal: 'bg-status-v2-teal-bg border-status-v2-teal-border text-status-v2-teal-text',
  orange: 'bg-status-v2-orange-bg border-status-v2-orange-border text-status-v2-orange-text',
  sky: 'bg-status-v2-sky-bg border-status-v2-sky-border text-status-v2-sky-text',
  rose: 'bg-status-v2-rose-bg border-status-v2-rose-border text-status-v2-rose-text',
}

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'h-5 px-2 text-label-semibold-xs',
  md: 'h-6 px-2.5 text-label-semibold-md',
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = 'neutral', size = 'sm', withDot = false, className, children, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        // No border on a badge (FMS UX 03.11, owner: "nie używamy borderów") — the fill alone carries the tone; the
        // `outline` variant keeps its line as an inset shadow, the one badge whose look is the line.
        'inline-flex items-center gap-1 rounded-full',
        variant === 'outline' && 'shadow-[inset_0_0_0_1px_var(--status-v2-outline-border)]',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    >
      {withDot ? (
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80"
        />
      ) : null}
      {children}
    </span>
  )
})
