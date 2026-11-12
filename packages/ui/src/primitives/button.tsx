/**
 * @deprecated Use `Button` from `@freighttech/ui/components` instead.
 *   This primitive ships the upstream `class-variance-authority` API and
 *   imports `@open-mercato/shared/lib/utils#cn`, which isn't part of that
 *   package's `exports` map and breaks Vite-based tooling (Storybook).
 *   The new component matches the Figma "FMS-Componenets" Button spec,
 *   exposes the same variants under a flatter prop API, and ships with
 *   a Storybook reference.
 *   Migration path: change the import to `@freighttech/ui/components`
 *   and rename `variant="default"` → `variant="primary"`. Will be
 *   removed in a future minor of `@freighttech/ui`.
 */
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

// FMS UX 03.11: one button system — the 115 legacy call sites get the same
// look as `primitives-v2/Button`: pill on every size (in the base class, so
// no caller needs a `rounded-m3-full` override), `default` = the filled
// primary (near-black via the FMS `--primary` token), `outline` / `secondary`
// = the borderless tonal pill, no drop shadows. Heights are unchanged. The
// text stays `text-sm font-medium`: this file's `cn` is tailwind-merge, which
// would read a named typography token as a text colour and drop one of them.
const TONAL =
  'bg-[color:var(--m3ft-v2-surface-container-high,var(--m3-surface-container-high))] text-[color:var(--m3ft-v2-on-surface,var(--m3-on-surface))] hover:bg-[color:color-mix(in_srgb,var(--m3ft-v2-on-surface,var(--m3-on-surface))_8%,var(--m3ft-v2-surface-container-high,var(--m3-surface-container-high)))] active:bg-[color:color-mix(in_srgb,var(--m3ft-v2-on-surface,var(--m3-on-surface))_12%,var(--m3ft-v2-surface-container-high,var(--m3-surface-container-high)))]'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium cursor-pointer transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        // FMS UX 03.11: `outline` keeps its name but is the tonal pill — no border.
        outline: TONAL,
        secondary: TONAL,
        // FMS UX 03.11: ghost / muted hover = the M3 state layer, not the blue accent tint.
        ghost: 'hover:bg-m3-state-layer-hover active:bg-m3-state-layer-pressed',
        muted: 'text-muted-foreground hover:bg-m3-state-layer-hover hover:text-foreground active:bg-m3-state-layer-pressed',
        link: 'text-link underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 px-6 has-[>svg]:px-4',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { buttonVariants }

