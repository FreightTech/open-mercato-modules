import * as React from 'react'
import { cn } from './utils'

/*
  Figma source: FMS-Componenets → Input (component-set 147:379).

  State × size matrix (extracted per-variant):
    | State    | Background | Border             | Text content |
    |----------|-----------|--------------------|--------------|
    | default  | #FFFFFF   | #D4D4D8            | #71717A (placeholder)
    | hover    | #FFFFFF   | #A0A0AA            | #18181A
    | focus    | #FFFFFF   | #0D9488 (teal!)    | #18181A
    | error    | #FFFFFF   | #E7000B            | #18181A
    | disabled | #F4F4F5   | #E4E4E7            | #71717A

  Sizes in Figma: sm (h=32) and md (h=36). We add a `lg` (h=40) for
  parity with Button; not present in Figma.

  Notable: focus border is **teal**, not the navy primary — a
  deliberate accent. Reuses `--status-v2-teal-text` from the v2
  status palette so the focus color stays consistent with Tag's
  `teczka` variant.

  Text: 13px Geist Regular. Padding 0 12px (sm) / same (md).
*/

export type InputSize = 'sm' | 'md' | 'lg'

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  inputSize?: InputSize
  /** Marks the input as invalid; border + focus ring switch to destructive. */
  hasError?: boolean
  /** Optional element rendered inside the input at the start (icon, currency, …). */
  leftAddon?: React.ReactNode
  /** Optional element rendered inside the input at the end. */
  rightAddon?: React.ReactNode
}

const SIZE_CLASSES: Record<InputSize, string> = {
  sm: 'h-8 text-[13px]',
  md: 'h-9 text-[13px]',
  lg: 'h-10 text-sm',
}

const PADDING_CLASSES: Record<InputSize, { base: string; left: string; right: string }> = {
  sm: { base: 'px-3', left: 'pl-9', right: 'pr-9' },
  md: { base: 'px-3', left: 'pl-9', right: 'pr-9' },
  lg: { base: 'px-4', left: 'pl-10', right: 'pr-10' },
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { inputSize = 'md', hasError = false, leftAddon, rightAddon, className, disabled, ...props },
  ref,
) {
  const pad = PADDING_CLASSES[inputSize]
  const padClass = cn(leftAddon ? pad.left : null, rightAddon ? pad.right : null, !leftAddon && !rightAddon ? pad.base : null)

  const baseStateClasses = hasError
    ? // Error: red border, red focus ring
      'border-destructive-v2 text-foreground-v2 placeholder:text-muted-v2-foreground focus-visible:border-destructive-v2 focus-visible:ring-destructive-v2/30'
    : disabled
      ? // Disabled: muted bg, soft border, no focus
        'bg-secondary-v2 border-border-v2 text-muted-v2-foreground placeholder:text-muted-v2-foreground cursor-not-allowed'
      : // Idle → hover (darker border) → focus (teal accent)
        'border-border-v2-strong text-foreground-v2 placeholder:text-muted-v2-foreground hover:border-muted-v2-foreground focus-visible:border-accent-v2 focus-visible:ring-accent-v2/30'

  const input = (
    <input
      ref={ref}
      disabled={disabled}
      aria-invalid={hasError || undefined}
      className={cn(
        'w-full rounded-md border bg-background-v2 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
        SIZE_CLASSES[inputSize],
        padClass,
        baseStateClasses,
        className,
      )}
      {...props}
    />
  )

  if (!leftAddon && !rightAddon) return input

  return (
    <div className="relative inline-flex w-full items-center">
      {leftAddon ? (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 flex items-center text-muted-v2-foreground [&>svg]:h-4 [&>svg]:w-4',
            inputSize === 'sm' ? 'pl-2.5' : inputSize === 'lg' ? 'pl-3.5' : 'pl-3',
          )}
        >
          {leftAddon}
        </span>
      ) : null}
      {input}
      {rightAddon ? (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 flex items-center text-muted-v2-foreground [&>svg]:h-4 [&>svg]:w-4',
            inputSize === 'sm' ? 'pr-2.5' : inputSize === 'lg' ? 'pr-3.5' : 'pr-3',
          )}
        >
          {rightAddon}
        </span>
      ) : null}
    </div>
  )
})
