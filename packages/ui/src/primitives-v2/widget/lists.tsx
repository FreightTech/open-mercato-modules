import * as React from 'react'
import { AlertTriangle, AlertCircle } from 'lucide-react'
import { cn } from '../utils'
import { useWidgetLink } from './WidgetCard'

/*
  Figma "Listy · 4 wersje" (579:648). Rows run edge to edge — put them in a
  `<WidgetCard bleed>`; separators are 1px outline-variant between rows.

    V1 two-line   64 high, padding 10/16, gap 12; 20px leading icon
                  (on-surface-variant); title Regular 16/24 on-surface
                  (text-body-regular-md); supporting Regular 14/20 variant;
                  trailing Medium 14 variant.
    V2 state      56 high, padding 10/24, gap 16; title Medium 14/20,
                  meta Regular 11/16; trailing action Medium 14 on-surface.
                  warning → icon + title amber; error → icon + title red.
    V4 no icons   V1 without the leading slot.
  `density="compact"` switches V1 to the V2 metrics (for dense places).
*/

export type WidgetListRowTone = 'default' | 'warning' | 'error'

export type WidgetListRowProps = {
  icon?: React.ReactNode
  title: React.ReactNode
  supporting?: React.ReactNode
  trailing?: React.ReactNode
  /** Trailing action (V2): a text button on the right. */
  action?: { label: string; onClick: () => void }
  tone?: WidgetListRowTone
  href?: string
  onClick?: () => void
  density?: 'comfortable' | 'compact'
  className?: string
}

const TONE_TEXT: Record<WidgetListRowTone, string> = {
  default: 'text-m3ft-on-surface',
  warning: 'text-m3ft-warning',
  error: 'text-m3ft-error',
}
const TONE_ICON: Record<WidgetListRowTone, string> = {
  default: 'text-m3ft-on-surface-variant',
  warning: 'text-m3ft-warning',
  error: 'text-m3ft-error',
}

export function WidgetListRow({
  icon,
  title,
  supporting,
  trailing,
  action,
  tone = 'default',
  href,
  onClick,
  density = 'comfortable',
  className,
}: WidgetListRowProps) {
  const Link = useWidgetLink()
  const compact = density === 'compact' || tone !== 'default' || !!action
  const leading =
    icon ??
    (tone === 'warning' ? <AlertTriangle aria-hidden /> : tone === 'error' ? <AlertCircle aria-hidden /> : null)
  const interactive = !!(href || onClick)
  const content = (
    <>
      {leading ? (
        <span className={cn('inline-flex size-5 shrink-0 items-center justify-center [&>svg]:size-5', TONE_ICON[tone])}>
          {leading}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'truncate',
            compact ? 'text-body-medium-sm' : 'text-body-regular-md',
            TONE_TEXT[tone],
          )}
        >
          {title}
        </span>
        {supporting ? (
          <span
            className={cn(
              'truncate text-m3ft-on-surface-variant',
              compact ? 'text-body-regular-2xs' : 'text-body-regular-sm',
            )}
          >
            {supporting}
          </span>
        ) : null}
      </span>
      {trailing ? (
        <span className="shrink-0 text-body-medium-sm tabular-nums text-m3ft-on-surface-variant">{trailing}</span>
      ) : null}
    </>
  )
  const rowClass = cn(
    'flex w-full items-center text-left',
    compact ? 'min-h-14 gap-4 px-6 py-2.5' : 'min-h-16 gap-3 px-4 py-2.5',
    action && 'pr-2',
    interactive && 'transition-colors hover:bg-m3ft-surface-container-low focus-visible:bg-m3ft-surface-container-low focus-visible:outline-none',
    className,
  )
  return (
    <li className="flex items-center border-b border-m3ft-outline-variant last:border-b-0">
      {href ? (
        <Link href={href} className={rowClass}>
          {content}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={rowClass}>
          {content}
        </button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mr-4 inline-flex h-8 shrink-0 items-center rounded-full px-2 text-body-medium-sm text-m3ft-on-surface transition-colors hover:bg-m3ft-surface-container"
        >
          {action.label}
        </button>
      ) : null}
    </li>
  )
}

export function WidgetList({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn('flex flex-col', className)} {...props} />
}
