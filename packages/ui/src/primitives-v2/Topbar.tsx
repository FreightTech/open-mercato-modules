import * as React from 'react'
import { cn } from './utils'

/*
  Figma source: FMS-Componenets → Topbar (component 150:367, 1440×52).
  Three-slot composition: leading (breadcrumb / page title), center
  (search / context controls), trailing (org selector / actions /
  avatar). Height pinned to 52px to match Figma; horizontal padding
  24px.

  Stays presentation-only — no router wiring; pass whatever JSX you
  need into each slot. The Storybook story shows a realistic FMS
  composition.
*/

export type TopbarProps = React.HTMLAttributes<HTMLElement> & {
  leading?: React.ReactNode
  center?: React.ReactNode
  trailing?: React.ReactNode
}

export function Topbar({ leading, center, trailing, className, ...props }: TopbarProps) {
  return (
    <header
      className={cn(
        'flex h-13 w-full shrink-0 items-center gap-3 border-b border-border-v2 bg-background-v2 px-6',
        className,
      )}
      style={{ height: 52 }}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">{leading}</div>
      {center ? <div className="flex shrink-0 items-center gap-2">{center}</div> : null}
      <div className="flex shrink-0 items-center gap-2">{trailing}</div>
    </header>
  )
}
