import * as React from 'react'
import { cn } from './utils'

/*
  Figma sources:
    - SidebarHeader (component 112:110)
    - SidebarFooter (component 112:117)
    - Sidebar       (component 137:354, 240×1656)

  The shell is a column flexbox with three slots: header (sticky top,
  border-bottom), body (scrollable), footer (sticky bottom,
  border-top). Background uses the existing `--sidebar` token so the
  theme system (light / dark / brand) flows in.

  Width default: 240px to match the Figma "Sidebar" frame. Override via className.
*/

export type SidebarProps = React.HTMLAttributes<HTMLElement> & {
  header?: React.ReactNode
  footer?: React.ReactNode
}

export function Sidebar({ header, footer, className, children, ...props }: SidebarProps) {
  return (
    <aside
      className={cn(
        'flex h-full w-[240px] shrink-0 flex-col bg-sidebar-v2 text-sidebar-v2-foreground',
        className,
      )}
      {...props}
    >
      {header ? <SidebarHeaderShell>{header}</SidebarHeaderShell> : null}
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Główna nawigacja">
        {children}
      </nav>
      {footer ? <SidebarFooterShell>{footer}</SidebarFooterShell> : null}
    </aside>
  )
}

function SidebarHeaderShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex shrink-0 items-center gap-2.5 bg-sidebar-v2 px-3"
      style={{ height: 52 }}
    >
      {children}
    </div>
  )
}

function SidebarFooterShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-sidebar-v2-border bg-sidebar-v2 px-2 pb-3 pt-2">
      {children}
    </div>
  )
}

export type SidebarHeaderProps = {
  /**
   * Brand mark / logo on the left. Rendered as-is — pass an `<img>`,
   * an SVG, or any styled element. The header does not wrap it in a
   * coloured square; the caller controls its full appearance.
   */
  logo?: React.ReactNode
  /** Workspace / org name. */
  title?: React.ReactNode
  /** Optional trailing element (e.g. sidebar-collapse toggle). */
  trailing?: React.ReactNode
}

/** Default header layout — pass `logo`, `title`, and an optional `trailing` slot. */
export function SidebarHeader({ logo, title, trailing }: SidebarHeaderProps) {
  return (
    <div className="flex w-full items-center gap-2.5">
      {logo ? <span className="inline-flex shrink-0 items-center">{logo}</span> : null}
      <span className="min-w-0 flex-1 truncate text-body-medium-md text-sidebar-v2-foreground">{title}</span>
      {trailing ? <span className="ml-auto inline-flex shrink-0">{trailing}</span> : null}
    </div>
  )
}

export type SidebarFooterProps = {
  /** Primary footer row (e.g. user info). */
  children: React.ReactNode
}

/** Default footer layout. Renders the children inside the footer shell. */
export function SidebarFooter({ children }: SidebarFooterProps) {
  return <div className="flex flex-col gap-2">{children}</div>
}
