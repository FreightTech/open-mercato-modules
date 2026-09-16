import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from './utils'

/*
  Figma source: FMS-Componenets → Button (component-set 44:92).

  Variant × state matrix extracted from Figma (one entry per leaf
  variant's `fills` / `strokes` / text fill):

    | Variant     | State    | Background        | Border    | Text
    |-------------|----------|-------------------|-----------|-----------
    | primary     | default  | #0E3762 (-v2)     | —         | #FFFFFF
    | primary     | hover    | #0B2C4F (-v2-hov) | —         | #FFFFFF
    | primary     | disabled | #0E3762 @ 50%     | —         | #A0A0AA
    | secondary   | default  | #F4F4F5           | #E4E4E7   | #18181A
    | secondary   | hover    | #EDEDEF           | #E4E4E7   | #18181A
    | secondary   | disabled | #F4F4F5           | #E4E4E7   | #A0A0AA
    | outline     | default  | #FFFFFF           | #D4D4D8   | #18181A
    | outline     | hover    | #F4F4F5           | #D4D4D8   | #18181A
    | outline     | disabled | #FFFFFF           | #E4E4E7   | #A0A0AA
    | ghost       | default  | transparent       | —         | #18181A
    | ghost       | hover    | #F4F4F5           | —         | #18181A
    | ghost       | disabled | transparent       | —         | #A0A0AA
    | destructive | default  | #E7000B           | —         | #FFFFFF
    | destructive | hover    | #C00009           | —         | #FFFFFF
    | destructive | disabled | #F4F4F5           | —         | #A0A0AA

  Colors live in `packages/ui/src/theme/tokens.css` as `-v2` tokens.

  Sizes (Figma):
    xs: h-7 (28px) · px-2.5 (10px) · gap-1 (4px)   — compact inline CTA
    sm: h-8 (32px) · px-3 (12px) · gap-1.5 (6px)
    md: h-9 (36px) · px-4 (16px) · gap-2 (8px)
    lg: h-10 (40px) · px-6 (24px) · gap-2 (8px)
  Radius: rounded-md (= 8px with --radius=0.625rem).
  Text: sm/md/lg use `text-sm font-semibold` (Geist 14/600). The xs size
  uses `text-body-regular-xs` (12px / 400) — matches the in-card "small
  pill" CTA pattern from the FMS Teczka detail mockup.
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
  One row per variant. Each row carries default / hover / disabled
  triplet, plus the focus ring color. Disabled rules use Tailwind's
  `disabled:` modifier (works on native <button>) so callers don't
  need to track state in React.
*/
/**
 * Disabled state follows the Figma design system: each variant keeps its own
 * brand color (faded navy, faded red, etc.) instead of collapsing to a neutral
 * gray. We achieve that with `disabled:opacity-40` — preserving bg, text, and
 * border tone, just dimmed. Hover affordances are gated on `enabled:` so they
 * never trigger when the button is disabled.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: cn(
    'bg-primary-v2 text-primary-v2-foreground',
    'enabled:hover:bg-primary-v2-hover',
    'focus-visible:ring-primary-v2',
    'disabled:opacity-40',
  ),
  secondary: cn(
    'bg-secondary-v2 text-secondary-v2-foreground border border-border-v2',
    'enabled:hover:bg-secondary-v2-hover',
    'focus-visible:ring-primary-v2',
    'disabled:opacity-40',
  ),
  outline: cn(
    'bg-background-v2 text-foreground-v2 border border-border-v2-strong',
    'enabled:hover:bg-secondary-v2',
    'focus-visible:ring-primary-v2',
    'disabled:opacity-40',
  ),
  ghost: cn(
    'bg-transparent text-foreground-v2',
    'enabled:hover:bg-secondary-v2',
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

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'h-7 gap-1 rounded-md px-2.5 text-body-regular-xs',
  sm: 'h-8 gap-1.5 rounded-md px-3 text-sm font-semibold',
  md: 'h-9 gap-2 rounded-md px-4 text-sm font-semibold',
  lg: 'h-10 gap-2 rounded-md px-6 text-sm font-semibold',
}

const ICON_ONLY_SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'h-7 w-7 rounded-md',
  sm: 'h-8 w-8 rounded-md',
  md: 'h-9 w-9 rounded-md',
  lg: 'h-10 w-10 rounded-md',
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
    'inline-flex cursor-pointer items-center justify-center whitespace-nowrap transition-colors ' +
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
