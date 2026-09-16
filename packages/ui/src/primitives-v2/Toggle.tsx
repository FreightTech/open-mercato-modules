import * as React from 'react'
import { cn } from './utils'

/*
  Figma source: FMS-Componenets → Toggle (component-set 45:80).
  Colours verified by visual diff against the Figma frame (we never
  walked the Figma variants — rate-limit hit on the first attempt —
  but the side-by-side screenshot confirmed teal `#0D9488` is the
  on-state track, matching Checkbox's checked fill, Input's focus
  border, and Tag's `teczka` variant. Stored as `--accent-v2`.

    off:       track #E4E4E7, thumb #FFFFFF
    on:        track #0D9488 (accent), thumb #FFFFFF
    disabled:  track #F4F4F5, thumb dimmed (via opacity)
    focus:     accent ring (matches Input / Checkbox)

  Built on `<input type="checkbox" role="switch">` with a styled track
  + absolute-positioned thumb. Two sizes — Figma ships one (md); we
  also expose `sm` for inline / table-row usage.
*/

export type ToggleSize = 'sm' | 'md'

export type ToggleProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  toggleSize?: ToggleSize
  /** Optional label rendered to the right of the switch. */
  label?: React.ReactNode
}

const TRACK_SIZE: Record<ToggleSize, string> = {
  sm: 'h-4 w-7',
  md: 'h-5 w-9',
}

const THUMB_SIZE: Record<ToggleSize, string> = {
  sm: 'h-3 w-3 translate-x-0.5 peer-checked:translate-x-3.5',
  md: 'h-4 w-4 translate-x-0.5 peer-checked:translate-x-4',
}

export const Toggle = React.forwardRef<HTMLInputElement, ToggleProps>(function Toggle(
  { toggleSize = 'md', label, className, disabled, id, ...props },
  ref,
) {
  const generatedId = React.useId()
  const inputId = id ?? generatedId

  const control = (
    <span className="relative inline-flex shrink-0 items-center">
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        role="switch"
        disabled={disabled}
        className="peer sr-only"
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex shrink-0 cursor-pointer rounded-full bg-border-v2 transition-colors',
          TRACK_SIZE[toggleSize],
          'peer-checked:bg-accent-v2',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-accent-v2 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-background-v2',
          'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-background-v2 shadow-sm transition-transform',
          THUMB_SIZE[toggleSize],
        )}
      />
    </span>
  )

  if (label == null) return control

  return (
    <label
      htmlFor={inputId}
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 text-body-regular-sm text-foreground-v2',
        disabled ? 'cursor-not-allowed text-muted-v2-foreground' : null,
        className,
      )}
    >
      {control}
      <span className="select-none">{label}</span>
    </label>
  )
})
