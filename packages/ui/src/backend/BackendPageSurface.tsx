'use client'

import { useLayoutEffect } from 'react'

export type BackendPageSurfaceProps = {
  /**
   * CSS color (hex, rgb(), named, etc.) to paint behind the page's content.
   * Stays in effect for the lifetime of this component; the previous value
   * is restored on unmount so sibling backend routes keep their default
   * surface.
   *
   * Defaults to `--page-surface-v2-tint` (the v2 backend canvas color)
   * so page code doesn't need to carry a hex literal.
   */
  tint?: string
}

/**
 * Drop-in tint for the AppShell's `<main>` background — use when a backend
 * route wants a non-white canvas (e.g. dashboards or detail pages that mix
 * white cards on a gray surface) but doesn't want to fight `<main>`'s
 * computed height to make a wrapper `bg-…` extend the full content area.
 *
 * Renders nothing. Render it once near the top of a page component:
 *
 * ```tsx
 * export default function FilePage() {
 *   return (
 *     <>
 *       <BackendPageSurface />
 *       …page content…
 *     </>
 *   )
 * }
 * ```
 *
 * Implementation note: AppShell's `<main>` is `flex-1` inside a flex
 * column; its height is determined by the flex algorithm and can exceed a
 * child's `min-h-screen`. The cleanest fix without changing the shared
 * AppShell contract is to tint `<main>` itself — that's what this component
 * does, encapsulated so individual pages don't sprinkle DOM mutation. We
 * use `useLayoutEffect` (rather than `useEffect`) so the bg is in place
 * before the browser paints the first frame, avoiding a flash of white.
 */
export function BackendPageSurface({ tint = 'var(--page-surface-v2-tint)' }: BackendPageSurfaceProps) {
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return
    const main = document.querySelector('main')
    if (!main) return
    const prev = main.style.backgroundColor
    main.style.backgroundColor = tint
    return () => {
      main.style.backgroundColor = prev
    }
  }, [tint])
  return null
}
