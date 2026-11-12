import * as React from 'react'
import { cn } from './utils'

/*
  A region that folds to nothing and back with a smooth height change — the sidebar's groups and nested
  items, and anything else that opens in place (FMS UX 02.11). The height animates through grid rows
  (0fr ↔ 1fr), so the content keeps its natural height and nothing is measured. A closed region is inert:
  out of the tab order and hidden from assistive tech.

  Motion starts only after the first frames: a state the page restores on mount (from storage, from the
  route) settles without animating, so a page load never plays a fold. Timing comes from the M3 motion
  tokens (m3.css), which reduced motion shrinks to 1 ms.
*/

export type CollapseProps = React.HTMLAttributes<HTMLDivElement> & {
  open: boolean
}

export function Collapse({ open, className, children, ...props }: CollapseProps) {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setReady(true))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [])

  return (
    <div
      data-collapse=""
      data-open={open ? 'true' : 'false'}
      inert={open ? undefined : true}
      aria-hidden={open ? undefined : true}
      className={cn(
        'grid',
        ready &&
          (open
            ? 'transition-[grid-template-rows,opacity] duration-[var(--m3-duration-medium2)] ease-[var(--m3-ease-emphasized-decelerate)]'
            : 'transition-[grid-template-rows,opacity] duration-[var(--m3-duration-short4)] ease-[var(--m3-ease-emphasized-accelerate)]'),
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        className,
      )}
      {...props}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
