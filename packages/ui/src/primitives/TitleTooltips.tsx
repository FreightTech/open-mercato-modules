"use client"

import * as React from 'react'
import { createPortal } from 'react-dom'
import { tooltipSurfaceClass } from './tooltip'

/*
  The app's tooltip for every `title` attribute (FMS UX 03.11, owner: "przejść przez tooltipy i ujednolicić je
  wszystkie"). A `title` shows the browser's own grey box, which no style reaches, and the app carries well over a
  thousand of them. Mounted once (AppShell), this layer shows the app's tooltip instead — the `TooltipContent` look —
  so every hover hint looks alike without touching the elements that carry it.

  On hover the element's `title` moves to `data-title-tooltip` for as long as the tooltip shows (the browser's box
  would otherwise open on top of it) and is put back on leave. Keyboard focus shows the same tooltip and leaves
  `title` in place, so assistive tech keeps reading it. An element opts out with `data-native-title`.
*/

const DELAY_MS = 400
const GAP = 6
const EDGE = 8

type Shown = { text: string; x: number; y: number; placement: 'below' | 'above' }

function titled(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const el = target.closest<HTMLElement>('[title]:not([data-native-title]), [data-title-tooltip]')
  if (!el || el instanceof SVGElement) return null
  const text = el.getAttribute('title') ?? el.getAttribute('data-title-tooltip')
  return text && text.trim() ? el : null
}

export function TitleTooltips() {
  const [shown, setShown] = React.useState<Shown | null>(null)
  const [mounted, setMounted] = React.useState(false)
  const bubble = React.useRef<HTMLDivElement | null>(null)
  const active = React.useRef<{ el: HTMLElement; hover: boolean } | null>(null)
  const timer = React.useRef<number | undefined>(undefined)

  React.useEffect(() => setMounted(true), [])

  React.useEffect(() => {
    const restore = () => {
      const current = active.current
      if (current?.hover) {
        const text = current.el.getAttribute('data-title-tooltip')
        if (text != null && !current.el.hasAttribute('title')) current.el.setAttribute('title', text)
        current.el.removeAttribute('data-title-tooltip')
      }
      active.current = null
    }
    const hide = () => {
      window.clearTimeout(timer.current)
      restore()
      setShown(null)
    }
    const open = (el: HTMLElement, hover: boolean) => {
      if (active.current?.el === el) return
      hide()
      const text = (el.getAttribute('title') ?? el.getAttribute('data-title-tooltip') ?? '').trim()
      if (!text) return
      if (hover) {
        el.setAttribute('data-title-tooltip', el.getAttribute('title') ?? text)
        el.removeAttribute('title')
      }
      active.current = { el, hover }
      timer.current = window.setTimeout(() => {
        if (active.current?.el !== el || !el.isConnected) return
        const r = el.getBoundingClientRect()
        const below = r.bottom + GAP + 40 < window.innerHeight
        setShown({ text, x: r.left + r.width / 2, y: below ? r.bottom + GAP : r.top - GAP, placement: below ? 'below' : 'above' })
      }, DELAY_MS)
    }
    const onOver = (e: MouseEvent) => {
      const el = titled(e.target)
      if (el) open(el, true)
      else if (active.current?.hover) hide()
    }
    const onOut = (e: MouseEvent) => {
      const current = active.current
      if (current?.hover && !(e.relatedTarget instanceof Node && current.el.contains(e.relatedTarget))) hide()
    }
    const onFocus = (e: FocusEvent) => {
      const el = titled(e.target)
      if (el && (e.target as Element).matches?.(':focus-visible')) open(el, false)
    }
    const onBlur = () => { if (active.current && !active.current.hover) hide() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    document.addEventListener('mouseover', onOver, true)
    document.addEventListener('mouseout', onOut, true)
    document.addEventListener('focusin', onFocus, true)
    document.addEventListener('focusout', onBlur, true)
    document.addEventListener('mousedown', hide, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      hide()
      document.removeEventListener('mouseover', onOver, true)
      document.removeEventListener('mouseout', onOut, true)
      document.removeEventListener('focusin', onFocus, true)
      document.removeEventListener('focusout', onBlur, true)
      document.removeEventListener('mousedown', hide, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // Keep the bubble inside the window once its width is known.
  React.useLayoutEffect(() => {
    const node = bubble.current
    if (!node || !shown) return
    const half = node.offsetWidth / 2
    const x = Math.min(Math.max(shown.x, EDGE + half), window.innerWidth - EDGE - half)
    node.style.left = `${x}px`
  }, [shown])

  if (!mounted || !shown) return null
  return createPortal(
    <div
      ref={bubble}
      role="tooltip"
      data-slot="tooltip-content"
      data-state="delayed-open"
      data-title-layer=""
      className={tooltipSurfaceClass}
      style={{
        position: 'fixed',
        left: shown.x,
        top: shown.y,
        // `translate`, not `transform`: the enter animation (theme/m3.css) owns `transform`.
        translate: shown.placement === 'below' ? '-50% 0' : '-50% -100%',
        pointerEvents: 'none',
      }}
    >
      {shown.text}
    </div>,
    document.body,
  )
}
