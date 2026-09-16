import * as React from 'react'
import { cn } from './utils'

/*
  Figma source: FMS-Componenets → Checkbox (component-set 45:73).
  The checked / indeterminate fill is the brand blue `#3B82F6`
  (Figma blue/500), stored as `--selection-v2` and shared with the
  active Tab underline and the selected-row fill. (It was teal
  `#0D9488` / `--accent-v2` until the Teczka design moved selection
  states to blue.)

    | State           | Bg                | Border           | Glyph
    |-----------------|-------------------|-------------------|------
    | unchecked       | #FFFFFF           | #D4D4D8           | —
    | checked         | #3B82F6 (blue)    | #3B82F6           | white check
    | indeterminate   | #3B82F6 (blue)    | #3B82F6           | white dash
    | disabled        | #F4F4F5           | #E4E4E7           | dimmed
    | error           | #FFFFFF           | #E7000B           | —
    | focus           | (border blue)     | #3B82F6 (blue)    | — (ring)

  Implementation: native `<input type="checkbox">` with `appearance: none`
  and inline-SVG background-images for the check / dash glyphs. The
  `indeterminate` flag is set imperatively via the ref (HTML has no
  declarative attribute for it).
*/

export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  indeterminate?: boolean
  hasError?: boolean
  /** Inline label rendered to the right of the box. */
  label?: React.ReactNode
}

const CHECK_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3 8.5l3.5 3.5L13 5' fill='none' stroke='%23ffffff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")"

const DASH_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8h9' fill='none' stroke='%23ffffff' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E\")"

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { indeterminate = false, hasError = false, label, className, disabled, id, ...props },
  forwardedRef,
) {
  const innerRef = React.useRef<HTMLInputElement | null>(null)
  React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLInputElement)
  React.useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate
  }, [indeterminate])

  const generatedId = React.useId()
  const inputId = id ?? generatedId

  const box = (
    <input
      ref={innerRef}
      id={inputId}
      type="checkbox"
      disabled={disabled}
      aria-invalid={hasError || undefined}
      style={
        {
          ['--cb-check-svg' as never]: CHECK_SVG,
          ['--cb-dash-svg' as never]: DASH_SVG,
        } as React.CSSProperties
      }
      className={cn(
        'relative inline-flex h-4 w-4 shrink-0 cursor-pointer appearance-none rounded border bg-background-v2 transition-colors',
        'border-border-v2-strong',
        'checked:border-selection-v2 checked:bg-selection-v2',
        'indeterminate:border-selection-v2 indeterminate:bg-selection-v2',
        'checked:bg-[image:var(--cb-check-svg)] checked:bg-center checked:bg-no-repeat',
        'indeterminate:bg-[image:var(--cb-dash-svg)] indeterminate:bg-center indeterminate:bg-no-repeat',
        // Focus uses the brand blue selection accent.
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection-v2 focus-visible:ring-offset-1 focus-visible:ring-offset-background-v2',
        // Disabled
        'disabled:cursor-not-allowed disabled:border-border-v2 disabled:bg-secondary-v2',
        'disabled:checked:border-muted-v2-foreground disabled:checked:bg-muted-v2-foreground',
        'disabled:indeterminate:border-muted-v2-foreground disabled:indeterminate:bg-muted-v2-foreground',
        // Error
        hasError
          ? 'border-destructive-v2 checked:border-destructive-v2 checked:bg-destructive-v2 indeterminate:border-destructive-v2 indeterminate:bg-destructive-v2 focus-visible:ring-destructive-v2'
          : null,
      )}
      {...props}
    />
  )

  if (label == null) return box

  return (
    <label
      htmlFor={inputId}
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 text-body-regular-sm text-foreground-v2',
        disabled ? 'cursor-not-allowed text-muted-v2-foreground' : null,
        className,
      )}
    >
      {box}
      <span className="select-none">{label}</span>
    </label>
  )
})
