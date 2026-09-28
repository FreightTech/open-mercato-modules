import * as React from 'react'
import { AlertTriangle, Info, Megaphone } from 'lucide-react'
import { cn } from '../utils'

/*
  InsightBanner — the optional strip under a widget header
  (Figma "Banner", lists V2/V5):
    surface-container fill · radius 8 · padding 16/20 · gap 16
    8px dot (warning amber for TRIGGER, primary for info, outline for neutral)
    text Regular 14/20 on-surface (bold spans passed in as children)
    outlined pill action: 32 high, 1px outline, Medium 12 on-surface-variant
*/

export type InsightTone = 'neutral' | 'info' | 'warning' | 'error'

const DOT: Record<InsightTone, string> = {
  neutral: 'bg-m3ft-outline',
  info: 'bg-m3ft-primary',
  warning: 'bg-m3ft-warning',
  error: 'bg-m3ft-error',
}

export type InsightBannerProps = {
  tone?: InsightTone
  children: React.ReactNode
  action?: { label: string; onClick: () => void }
  className?: string
}

export function InsightBanner({ tone = 'warning', children, action, className }: InsightBannerProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-4 rounded-[8px] bg-m3ft-surface-container px-5 py-4',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[tone])} />
        <p className="min-w-0 text-body-regular-sm text-m3ft-on-surface">{children}</p>
      </div>
      {action ? <PillButton onClick={action.onClick}>{action.label}</PillButton> : null}
    </div>
  )
}

export function PillButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 shrink-0 items-center rounded-full border border-m3ft-outline bg-m3ft-surface px-3 text-caption-medium-md text-m3ft-on-surface-variant transition-colors hover:bg-m3ft-surface-container-low',
        className,
      )}
      {...props}
    />
  )
}

/*
  WidgetBanner — full-width page banner (Figma "Banery · 3 warianty", 03.09):
    radius 8 · padding 12/14 · gap 12
    34px white round icon slot (lucide icon — the Figma emoji are a draft)
    title SemiBold 13 → label-semibold-md · text Regular 12 on-surface-variant
    outlined pill action
  Variants: info (surface-container), promo (promo-container, ink #00344E),
  alert (warning-container, warning ink).
*/

export type WidgetBannerVariant = 'info' | 'promo' | 'alert'

const BANNER: Record<WidgetBannerVariant, { box: string; title: string; icon: string; Icon: typeof Info }> = {
  info: { box: 'bg-m3ft-surface-container', title: 'text-m3ft-on-surface', icon: 'text-m3ft-on-surface-variant', Icon: Info },
  promo: { box: 'bg-m3ft-promo-container', title: 'text-m3ft-on-promo-container', icon: 'text-m3ft-on-promo-container', Icon: Megaphone },
  alert: { box: 'bg-m3ft-warning-container', title: 'text-m3ft-on-warning-container', icon: 'text-m3ft-warning', Icon: AlertTriangle },
}

export type WidgetBannerProps = {
  variant?: WidgetBannerVariant
  title: React.ReactNode
  text?: React.ReactNode
  icon?: React.ReactNode
  action?: { label: string; onClick: () => void }
  className?: string
}

export function WidgetBanner({ variant = 'info', title, text, icon, action, className }: WidgetBannerProps) {
  const v = BANNER[variant]
  return (
    <div
      role={variant === 'alert' ? 'alert' : 'status'}
      className={cn('flex items-center gap-3 rounded-[8px] px-3.5 py-3', v.box, className)}
    >
      <span className={cn('inline-flex size-[34px] shrink-0 items-center justify-center rounded-full bg-m3ft-surface', v.icon)}>
        {icon ?? <v.Icon className="size-4" aria-hidden />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={cn('text-label-semibold-md', v.title)}>{title}</p>
        {text ? <p className="text-body-regular-xs text-m3ft-on-surface-variant">{text}</p> : null}
      </div>
      {action ? <PillButton onClick={action.onClick}>{action.label}</PillButton> : null}
    </div>
  )
}
