import * as React from 'react'
import { cn } from './utils'

/*
  Figma source: FMS-Componenets → NavItem (component-set 60:78), aligned to the
  current backend Sidebar frame (137:354).

    | State    | Background          | Text                          | Icon                          | Badge
    |----------|---------------------|-------------------------------|-------------------------------|--------------
    | default  | transparent         | item-foreground (slate/600)   | item-foreground               | solid blue
    | hover    | accent (slate/200)  | item-foreground (slate/600)   | item-foreground               | solid blue
    | active   | white pill + 1px slate/200 border | accent-foreground (blue/700) | accent-foreground (blue/700) | solid blue
    | disabled | transparent         | item-disabled (slate/500)     | item-disabled (slate/500)     | opacity-50

  Typography is `body/medium/sm` (Figma name) → `text-body-medium-sm`.
  The active row is a white pill carrying brand-blue text + icon — see
  spec `.ai/specs/2026-05-25-sidebar-redesign.md`. The earlier rail
  (3px left bar) treatment was removed; pill is the only supported
  active state. The count badge is a sidebar-specific solid blue pill,
  not a general-purpose `Badge`.

  Rendered as a polymorphic element: defaults to <button> but accepts
  a custom element via the `render` callback for Next.js <Link>
  integration.
*/

export type NavItemProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ReactNode
  /** Numeric count rendered on the right. Strings/numbers get the default solid-blue pill; pass a ReactNode to render a custom element. */
  badge?: React.ReactNode
  /** Highlight as the currently selected route. */
  isActive?: boolean
  /** Render a custom element (e.g. Next's Link) — return a JSX element that the parent will style. */
  render?: (props: { className: string; children: React.ReactNode }) => React.ReactElement
}

export const NavItem = React.forwardRef<HTMLButtonElement, NavItemProps>(function NavItem(
  { icon, badge, isActive = false, render, className, children, disabled, ...props },
  ref,
) {
  const baseClass = cn(
    'group/navitem relative inline-flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-body-medium-sm transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-v2 focus-visible:ring-offset-1',
    isActive
      ? // Active: white pill with 1px slate/200 border, brand-blue text + icon
        'bg-sidebar-v2-accent-active text-sidebar-v2-accent-foreground border-sidebar-v2-accent'
      : disabled
        ? // Disabled: faded text, no hover
          'cursor-not-allowed text-sidebar-v2-item-disabled hover:bg-transparent'
        : // Default + hover: slate-200 pill, slate-600 text
          'cursor-pointer text-sidebar-v2-item-foreground hover:bg-sidebar-v2-accent',
    className,
  )

  const iconColorClass = isActive
    ? 'text-sidebar-v2-accent-foreground'
    : disabled
      ? 'text-sidebar-v2-item-disabled'
      : 'text-sidebar-v2-item-foreground'

  const content = (
    <>
      {icon ? (
        <span
          aria-hidden="true"
          className={cn('inline-flex h-4 w-4 shrink-0 items-center justify-center', iconColorClass)}
        >
          {icon}
        </span>
      ) : null}
      <span className="flex-1 truncate text-left">{children}</span>
      {badge != null ? (
        typeof badge === 'string' || typeof badge === 'number' ? (
          <span
            className={cn(
              'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-sidebar-v2-badge-bg px-1.5 text-label-semibold-xs text-sidebar-v2-badge-foreground',
              disabled ? 'opacity-50' : null,
            )}
          >
            {badge}
          </span>
        ) : (
          badge
        )
      ) : null}
    </>
  )

  if (render) {
    return render({ className: baseClass, children: content })
  }

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-current={isActive ? 'page' : undefined}
      className={baseClass}
      {...props}
    >
      {content}
    </button>
  )
})
