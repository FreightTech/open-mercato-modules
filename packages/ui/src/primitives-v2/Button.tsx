import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from './utils'

/*
  Figma source: FMS-Componenets → Button (component-set 44:92), restyled by
  FMS UX 03.11 ("one button system"): one pill shape, a near-black filled
  primary and tonal (filled, borderless) secondary buttons.

    | Variant     | Fill                                   | Border | Text
    |-------------|----------------------------------------|--------|-----------------
    | primary     | --primary-v2 (near-black in FMS)       | —      | --primary-v2-fg
    | secondary   | tonal: surface-container-high          | —      | on-surface
    | outline     | = secondary (tonal, see note below)    | —      | on-surface
    | ghost       | transparent + M3 state layer on hover  | —      | on-surface
    | destructive | --destructive-v2                       | —      | white

  Hover on a filled/tonal button mixes 8 % (pressed 12 %) of its ink into the
  fill — the M3 state layer, flattened so it works on a solid background.
  Disabled = `opacity-40` of the same look.

  Tonal fill reads `--m3ft-v2-surface-container-high` (neutral #ECECEC in FMS)
  and falls back to the M3 role `--m3-surface-container-high` where the
  m3-freighttech palette is not loaded.

  Sizes (heights unchanged):
    xs: h-7 (28px) · px-2.5 · gap-1
    sm: h-8 (32px) · px-3   · gap-1.5
    md: h-9 (36px) · px-4   · gap-2
    lg: h-10 (40px) · px-6  · gap-2
  Radius: `rounded-full` on every size (the pill is in the base class, so no
  caller has to override `rounded-md`). Text: sm/md/lg `text-body-medium-sm`,
  xs `text-body-regular-xs`.
*/

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'
export type ButtonIconPosition = 'left' | 'right'

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Optional icon element. Renders before children by default; pass `iconPosition="right"` to flip. */
  icon?: React.ReactNode
  iconPosition?: ButtonIconPosition
  /** When true, the button shrinks to a square and only renders the icon. `children` is ignored. */
  iconOnly?: boolean
  /**
   * Render as a Radix `Slot`, merging the button styling onto the single
   * child element (e.g. a Next.js `<Link>`) instead of a `<button>`. The
   * caller owns the child's content — `icon` / `iconOnly` are ignored.
   */
  asChild?: boolean
}

/*
  One row per variant: default / hover / pressed / disabled plus the focus
  ring. Hover affordances are gated on `enabled:` so they never trigger on a
  disabled button; disabled keeps the variant's look at 40 % opacity.
*/
// FMS UX 03.11: one button system — tonal fill with the M3 state layer baked
// in (8 % hover / 12 % pressed of the ink over the fill). Literal strings on
// purpose: Tailwind only emits classes it can read verbatim in the source.
const TONAL = cn(
  'bg-[color:var(--m3ft-v2-surface-container-high,var(--m3-surface-container-high))]',
  'text-[color:var(--m3ft-v2-on-surface,var(--m3-on-surface))]',
  'enabled:hover:bg-[color:color-mix(in_srgb,var(--m3ft-v2-on-surface,var(--m3-on-surface))_8%,var(--m3ft-v2-surface-container-high,var(--m3-surface-container-high)))]',
  'enabled:active:bg-[color:color-mix(in_srgb,var(--m3ft-v2-on-surface,var(--m3-on-surface))_12%,var(--m3ft-v2-surface-container-high,var(--m3-surface-container-high)))]',
)

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: cn(
    'bg-primary-v2 text-primary-v2-foreground',
    'enabled:hover:bg-primary-v2-hover',
    'focus-visible:ring-primary-v2',
    'disabled:opacity-40',
  ),
  secondary: cn(
    TONAL,
    'focus-visible:ring-primary-v2',
    'disabled:opacity-40',
  ),
  // FMS UX 03.11: `outline` keeps its name for the API but renders the same
  // tonal pill as `secondary` — the owner wants no borders on button pills.
  outline: cn(
    TONAL,
    'focus-visible:ring-primary-v2',
    'disabled:opacity-40',
  ),
  ghost: cn(
    'bg-transparent text-[color:var(--m3ft-v2-on-surface,var(--m3-on-surface))]',
    'enabled:hover:bg-m3-state-layer-hover',
    'enabled:active:bg-m3-state-layer-pressed',
    'focus-visible:ring-primary-v2',
    'disabled:opacity-40',
  ),
  destructive: cn(
    'bg-destructive-v2 text-destructive-v2-foreground',
    'enabled:hover:bg-destructive-v2-hover',
    'focus-visible:ring-destructive-v2',
    'disabled:opacity-40',
  ),
}

// FMS UX 03.11: one button system — the pill lives in the base class.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'h-7 gap-1 px-2.5 text-body-regular-xs',
  sm: 'h-8 gap-1.5 px-3 text-body-medium-sm',
  md: 'h-9 gap-2 px-4 text-body-medium-sm',
  lg: 'h-10 gap-2 px-6 text-body-medium-sm',
}

const ICON_ONLY_SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'h-7 w-7',
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-10 w-10',
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    icon,
    iconPosition = 'left',
    iconOnly = false,
    asChild = false,
    className,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  const base =
    'inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-full transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-background-v2 disabled:cursor-not-allowed'

  const classes = cn(
    base,
    iconOnly ? ICON_ONLY_SIZE_CLASSES[size] : SIZE_CLASSES[size],
    VARIANT_CLASSES[variant],
    className,
  )

  if (asChild) {
    // Slot forwards the styling onto the caller's child (e.g. a <Link>);
    // the child owns its own content, so we don't inject `icon`/children.
    return (
      <Slot ref={ref as React.Ref<HTMLElement>} className={classes} {...props}>
        {children}
      </Slot>
    )
  }

  return (
    <button ref={ref} type={type} className={classes} {...props}>
      {icon && iconPosition === 'left' && !iconOnly ? <ButtonIcon size={size}>{icon}</ButtonIcon> : null}
      {!iconOnly && children}
      {icon && iconPosition === 'right' && !iconOnly ? (
        <ButtonIcon size={size}>{icon}</ButtonIcon>
      ) : null}
      {iconOnly ? <ButtonIcon size={size}>{icon}</ButtonIcon> : null}
    </button>
  )
})

function ButtonIcon({ size, children }: { size: ButtonSize; children: React.ReactNode }) {
  const dim = size === 'xs' || size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  return (
    <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center justify-center', dim)}>
      {children}
    </span>
  )
}
