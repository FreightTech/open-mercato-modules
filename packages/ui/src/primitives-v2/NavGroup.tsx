import * as React from 'react'
import { ChevronDown as LucideChevronDown } from 'lucide-react'
import { cn } from './utils'

/*
  Figma source: FMS-Componenets → NavGroup (component-set 72:154).
  Figma encodes membership as 10 boolean `itemN_show` props. We
  collapse that to a single React composition: pass `NavItem`s (or
  any nodes) as children. State (expanded / collapsed) is exposed as
  `defaultCollapsed` for uncontrolled use and `collapsed`/`onCollapse`
  for controlled use.

  Title row is optional. When present, it acts as the toggle.
*/

export type NavGroupProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Group section label (uppercase, small). Falls back to children-only layout when omitted. */
  title?: React.ReactNode
  /** Default collapsed state for uncontrolled use. */
  defaultCollapsed?: boolean
  /** Controlled collapsed state — pair with `onCollapse`. */
  collapsed?: boolean
  onCollapse?: (next: boolean) => void
}

const ChevronDown = () => <LucideChevronDown aria-hidden="true" className="h-3 w-3" />

export function NavGroup({
  title,
  defaultCollapsed = false,
  collapsed,
  onCollapse,
  className,
  children,
  ...props
}: NavGroupProps) {
  const [internalCollapsed, setInternalCollapsed] = React.useState(defaultCollapsed)
  const isCollapsed = collapsed !== undefined ? collapsed : internalCollapsed

  const toggle = () => {
    const next = !isCollapsed
    if (collapsed === undefined) setInternalCollapsed(next)
    onCollapse?.(next)
  }

  return (
    <div className={cn('flex w-full flex-col gap-1', className)} {...props}>
      {title ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!isCollapsed}
          className={cn(
            'group/navgroup mx-2 inline-flex items-center justify-between rounded-sm px-1 py-1',
            'text-body-regular-xs uppercase tracking-wider text-sidebar-v2-muted',
            'hover:text-sidebar-v2-foreground transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-v2 focus-visible:ring-offset-1',
          )}
        >
          <span>{title}</span>
          {/*
            Chevron points UP when expanded (click-to-collapse hint), DOWN when collapsed.
            Matches the Figma "NavGroup — state (expanded / collapsed)" interaction model.
          */}
          <span
            aria-hidden="true"
            className={cn('inline-flex transition-transform', isCollapsed ? 'rotate-0' : 'rotate-180')}
          >
            <ChevronDown />
          </span>
        </button>
      ) : null}
      {!isCollapsed ? <div className="flex flex-col gap-0.5">{children}</div> : null}
    </div>
  )
}
