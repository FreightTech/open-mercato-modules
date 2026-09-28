import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '../utils'

/*
  ProcessSteps — Figma "Proces · 2 perspektywy" (676:1433).
    node      24 round: done = primary + white check; current = primary +
              white number (Medium 11); future = surface + 1.5px
              outline-variant stroke + variant number
    K1 horizontal  equal columns, node centred, label Medium 11 (future:
              Regular 11 variant) 6px under the node; 2px connectors,
              primary up to the current node, outline-variant after
    K2 vertical    node + 2px connector column, content gap 4 with 16 bottom
              padding: title Medium 16 (future: variant), meta Regular 12
              variant, optional detail/actions under the current step
    Current-step detail (K1): surface-container-low box radius 8, padding 12,
              title Medium 12 + inline facts Regular 12
*/

export type ProcessStep = {
  id: string
  label: string
  state: 'done' | 'current' | 'future'
  meta?: React.ReactNode
  /** Extra content under the current step (K2) — facts, an action. */
  detail?: React.ReactNode
}

function Node({ step, index }: { step: ProcessStep; index: number }) {
  if (step.state === 'future') {
    return (
      <span className="relative z-[1] inline-flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-m3ft-outline-variant bg-m3ft-surface text-caption-medium-md text-m3ft-on-surface-variant">
        {index + 1}
      </span>
    )
  }
  return (
    <span className="relative z-[1] inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-m3ft-primary text-caption-medium-md text-m3ft-on-primary">
      {step.state === 'done' ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : index + 1}
    </span>
  )
}

export function ProcessSteps({
  steps,
  orientation = 'horizontal',
  currentDetail,
  className,
}: {
  steps: ProcessStep[]
  orientation?: 'horizontal' | 'vertical'
  /** K1 only: the box under the stepper describing the current step. */
  currentDetail?: { title: React.ReactNode; facts?: React.ReactNode }
  className?: string
}) {
  if (orientation === 'vertical') {
    return (
      <ol className={cn('flex flex-col', className)}>
        {steps.map((s, i) => {
          const last = i === steps.length - 1
          const lineOn = s.state === 'done'
          return (
            <li key={s.id} className="flex gap-4" aria-current={s.state === 'current' ? 'step' : undefined}>
              <div className="flex flex-col items-center">
                <Node step={s} index={i} />
                {!last ? <span className={cn('w-0.5 flex-1', lineOn ? 'bg-m3ft-primary' : 'bg-m3ft-outline-variant')} /> : null}
              </div>
              <div className={cn('flex min-w-0 flex-1 flex-col gap-1', !last && 'pb-4')}>
                <span
                  className={cn(
                    'text-body-medium-md',
                    s.state === 'future' ? 'text-m3ft-on-surface-variant' : 'text-m3ft-on-surface',
                  )}
                >
                  {s.label}
                </span>
                {s.meta ? <span className="text-body-regular-xs text-m3ft-on-surface-variant">{s.meta}</span> : null}
                {s.detail}
              </div>
            </li>
          )
        })}
      </ol>
    )
  }
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <ol className="flex">
        {steps.map((s, i) => (
          <li
            key={s.id}
            className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5"
            aria-current={s.state === 'current' ? 'step' : undefined}
          >
            {i > 0 ? (
              <span
                aria-hidden
                className={cn(
                  'absolute top-[11px] right-1/2 left-[-50%] h-0.5',
                  s.state !== 'future' ? 'bg-m3ft-primary' : 'bg-m3ft-outline-variant',
                )}
              />
            ) : null}
            <Node step={s} index={i} />
            <span
              className={cn(
                'max-w-full truncate px-1 text-center',
                s.state === 'future'
                  ? 'text-body-regular-2xs text-m3ft-on-surface-variant'
                  : 'text-caption-medium-md text-m3ft-on-surface',
              )}
            >
              {s.label}
            </span>
          </li>
        ))}
      </ol>
      {currentDetail ? (
        <div className="flex flex-col gap-1 rounded-[8px] bg-m3ft-surface-container-low p-3">
          <span className="text-caption-medium-md text-m3ft-on-surface">{currentDetail.title}</span>
          {currentDetail.facts ? (
            <span className="text-body-regular-xs text-m3ft-on-surface-variant">{currentDetail.facts}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/*
  CounterStrip — "5 weryfikacji · 3 limity · 2 teczki sporne": a row of
  count + label links separated by middots, used under P1 / cockpit headers
  (breadboard U114/U115). Count Medium 14 on-surface, label Regular 14
  variant; tone colours the count.
*/

export type Counter = {
  id: string
  count: number | string
  label: string
  tone?: 'default' | 'warning' | 'error'
  onClick?: () => void
}

export function CounterStrip({ counters, className }: { counters: Counter[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-body-regular-sm', className)}>
      {counters.map((c, i) => {
        const inner = (
          <>
            <span
              className={cn(
                'text-body-medium-sm tabular-nums',
                c.tone === 'warning' ? 'text-m3ft-warning' : c.tone === 'error' ? 'text-m3ft-error' : 'text-m3ft-on-surface',
              )}
            >
              {c.count}
            </span>{' '}
            <span className="text-m3ft-on-surface-variant">{c.label}</span>
          </>
        )
        return (
          <React.Fragment key={c.id}>
            {i > 0 ? <span aria-hidden className="text-m3ft-outline">·</span> : null}
            {c.onClick ? (
              <button type="button" onClick={c.onClick} className="rounded-sm hover:underline">
                {inner}
              </button>
            ) : (
              <span>{inner}</span>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
