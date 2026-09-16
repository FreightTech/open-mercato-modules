import * as React from 'react'
import { Info, CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react'
import { cn } from './utils'

/*
  Figma source: FMS-Componenets → Alert (component-set 46:22).

  Variant matrix (extracted from each variant's `fills`/`strokes`/text fill):
    | Variant  | Background | Border  | Text    |
    |----------|-----------|---------|---------|
    | info     | #EFF6FF   | #BFDBFE | #1E40AF |
    | success  | #F0FDF4   | #BBF7D0 | #166534 |
    | warning  | #FFFBEB   | #FDE68A | #92400E |
    | error    | #FEF2F2   | #FECACA | #991B1B |

  Figma does NOT define a `neutral` Alert variant. We keep one in code
  via the v2 neutral tokens for situations where the page needs an
  informational message without urgency (e.g. empty-state hints).

  Figma's Alert is TEXT-ONLY — no leading icon. We add lucide icons by
  default (`Info` / `CheckCircle2` / `AlertTriangle` / `XCircle`) because
  every realistic FMS screen renders one; pass `icon={null}` to hide.

  Title uses `heading/semibold/md`, description uses `body/regular/xs`.
  Border radius 10px = `rounded-[10px]`. Padding 12px / 16px-12px.
*/

export type AlertVariant = 'info' | 'success' | 'warning' | 'error' | 'neutral'

export type AlertProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: AlertVariant
  title?: React.ReactNode
  /** Override the default icon. Pass `null` to hide. */
  icon?: React.ReactNode | null
  /** When provided, renders a dismiss "×" button that calls this. */
  onDismiss?: () => void
  dismissAriaLabel?: string
}

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  info: 'bg-status-v2-info-bg border-status-v2-info-border text-status-v2-info-text',
  success: 'bg-status-v2-success-bg border-status-v2-success-border text-status-v2-success-text',
  warning: 'bg-status-v2-warning-bg border-status-v2-warning-border text-status-v2-warning-text',
  error: 'bg-status-v2-error-bg border-status-v2-error-border text-status-v2-error-text',
  neutral: 'bg-status-v2-neutral-bg border-status-v2-neutral-border text-status-v2-neutral-text',
}

const DEFAULT_ICONS: Record<AlertVariant, React.ReactNode> = {
  info: <Info />,
  success: <CheckCircle2 />,
  warning: <AlertTriangle />,
  error: <XCircle />,
  neutral: <Info />,
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(function Alert(
  {
    variant = 'info',
    title,
    icon,
    onDismiss,
    dismissAriaLabel = 'Zamknij',
    className,
    children,
    role = 'alert',
    ...props
  },
  ref,
) {
  const resolvedIcon = icon === undefined ? DEFAULT_ICONS[variant] : icon

  return (
    <div
      ref={ref}
      role={role}
      className={cn(
        'flex w-full items-start gap-3 rounded-[10px] border px-4 py-3',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    >
      {resolvedIcon ? (
        <span aria-hidden="true" className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">
          {resolvedIcon}
        </span>
      ) : null}
      <div className="flex-1 min-w-0">
        {title ? <div className="text-heading-semibold-md">{title}</div> : null}
        {children ? <div className={cn('text-body-regular-xs', title ? 'mt-0.5' : null)}>{children}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissAriaLabel}
          className={cn(
            'shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md',
            'opacity-70 transition-opacity hover:opacity-100 hover:bg-black/5',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1',
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
})
