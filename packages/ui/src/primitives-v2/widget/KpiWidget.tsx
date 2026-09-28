import * as React from 'react'
import { cn } from '../utils'
import { WidgetCard, type WidgetCardProps } from './WidgetCard'

/*
  Figma "KPI · 4 warianty" (801:1424). Body gap 12 inside the shared shell.
    K1 value + delta      value Bold 28 (text-display-bold-lg) + delta pill
    K2 value + sparkline  sparkline 2px primary stroke, 28 high, full width
    K3 progress to goal   value + "goal" caption (Regular 12), 6px track
                          surface-container, fill primary, radius full
    K4 period comparison  current Bold 22 on-surface, previous Bold 22
                          on-surface-variant, captions Regular 11, delta pill
  Delta pill: radius full, padding 3/8, gap 4, triangle 9×7 + Medium 12;
  up = success-container / success ink, down = error-container / error ink.
  Meta line: Regular 11/16 on-surface-variant.
*/

/**
 * Polish number format as drawn in Figma ("1 284", "128 400,00"). Polish
 * CLDR does not group four-digit numbers by default, so grouping is forced.
 */
export function formatWidgetNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat('pl-PL', { useGrouping: 'always', ...options } as Intl.NumberFormatOptions).format(value)
}

export type KpiDelta = { value: string; direction: 'up' | 'down'; srLabel?: string }

export function DeltaPill({ delta, className }: { delta: KpiDelta; className?: string }) {
  const up = delta.direction === 'up'
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-caption-medium-md tabular-nums',
        up ? 'bg-m3ft-success-container text-m3ft-on-success-container' : 'bg-m3ft-error-container text-m3ft-error',
        className,
      )}
    >
      <svg viewBox="0 0 9 7" className="h-[7px] w-[9px]" aria-hidden>
        <path d={up ? 'M4.5 0L9 7H0z' : 'M4.5 7L0 0h9z'} fill="currentColor" />
      </svg>
      {delta.srLabel ? <span className="sr-only">{delta.srLabel}</span> : null}
      {delta.value}
    </span>
  )
}

export function Sparkline({ points, className }: { points: number[]; className?: string }) {
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * 100
      const y = 26 - ((p - min) / span) * 24
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className={cn('h-7 w-full', className)} aria-hidden>
      <path d={d} fill="none" stroke="var(--m3ft-v2-primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

export type KpiWidgetProps = Omit<WidgetCardProps, 'children'> & {
  /** Formatted main value ("1 284", "64%", "84 ofert"). */
  value: string
  delta?: KpiDelta
  /** K2: sparkline series. */
  trend?: number[]
  /** K3: progress 0..1 and its caption ("cel: 2 000"). */
  progress?: { ratio: number; caption?: string; label?: string }
  /** K4: previous period. */
  comparison?: { currentLabel: string; previous: string; previousLabel: string }
  meta?: React.ReactNode
}

export function KpiWidget({ value, delta, trend, progress, comparison, meta, ...card }: KpiWidgetProps) {
  const ratio = progress ? Math.max(0, Math.min(1, progress.ratio)) : 0
  return (
    <WidgetCard {...card}>
      <div className="flex flex-col gap-3">
        {comparison ? (
          <div className="flex items-center gap-6">
            <div className="flex flex-col gap-0.5">
              <span className="text-display-bold-md tabular-nums text-m3ft-on-surface">{value}</span>
              <span className="text-body-regular-2xs text-m3ft-on-surface-variant">{comparison.currentLabel}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-display-bold-md tabular-nums text-m3ft-on-surface-variant">{comparison.previous}</span>
              <span className="text-body-regular-2xs text-m3ft-on-surface-variant">{comparison.previousLabel}</span>
            </div>
            {delta ? <DeltaPill delta={delta} /> : null}
          </div>
        ) : (
          <div className={cn('flex items-center', progress ? 'gap-2' : 'gap-2.5')}>
            <span className="text-display-bold-lg tabular-nums text-m3ft-on-surface">{value}</span>
            {progress?.caption ? (
              <span className="text-body-regular-xs text-m3ft-on-surface-variant">{progress.caption}</span>
            ) : null}
            {delta ? <DeltaPill delta={delta} /> : null}
          </div>
        )}
        {trend ? <Sparkline points={trend} /> : null}
        {progress ? (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratio * 100)}
            aria-label={progress.label}
            className="h-1.5 w-full overflow-hidden rounded-full bg-m3ft-surface-container"
          >
            <div className="h-full rounded-full bg-m3ft-primary" style={{ width: `${ratio * 100}%` }} />
          </div>
        ) : null}
        {meta ? <p className="text-body-regular-2xs text-m3ft-on-surface-variant">{meta}</p> : null}
      </div>
    </WidgetCard>
  )
}
