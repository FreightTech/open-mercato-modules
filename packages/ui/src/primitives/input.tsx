/**
 * @deprecated Use `Input` from `@freighttech/ui/components` instead.
 *   Matches the Figma "FMS-Componenets" Input spec, exposes a typed
 *   `inputSize` prop and `hasError` / `leftAddon` / `rightAddon`. Will
 *   be removed in a future minor of `@freighttech/ui`.
 */
import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

type InputProps = React.ComponentPropsWithoutRef<'input'>

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
)

Input.displayName = 'Input'
