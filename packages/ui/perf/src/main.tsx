import React, { Profiler, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '@bench-src/backend/dynamic-table/DynamicTable'
import './bench.css' // tailwind first, as in globals.css
import { makeColumns, makeRows } from './data'

/**
 * DynamicTable benchmark fixture.
 *
 * URL parameters pick the workload:
 *   rows     row count                          (default 100)
 *   cols     column count                       (default 30)
 *   height   grid height in px                  (default 800)
 *   frozen   leading columns pinned left          (default 0)
 *   colVirt  1 = uiConfig.enableColumnVirtualization (default 0; the FMS
 *            transport, folder and invoice tables turn it on)
 *
 * The page exposes `window.__bench` — the runner (perf/run.mjs) drives it.
 * Every in-page driver measures with rAF timestamps and the browser's own
 * Long Animation Frame + Event Timing entries, never with Date.now() around
 * a synchronous call (that would miss style, layout and paint).
 */
const params = new URLSearchParams(location.search)
const ROWS = Number(params.get('rows') ?? 100)
const COLS = Number(params.get('cols') ?? 30)
const HEIGHT = Number(params.get('height') ?? 800)
const FROZEN = Number(params.get('frozen') ?? 0)
const COL_VIRT = params.get('colVirt') === '1'

const columns = makeColumns(COLS).map((c, i) => (i < FROZEN ? { ...c, sticky: 'left' as const } : c))
const uiConfig = COL_VIRT ? { enableColumnVirtualization: true } : undefined
const data = makeRows(ROWS, COLS)

// ---- React commit accounting (profiling build only) -------------------------
// `nested-update` = a commit forced synchronously from inside another commit
// (a layout-effect setState or flushSync) — the classic "two renders per frame".
const commits = { count: 0, actualMs: 0, mount: 0, update: 0, nestedUpdate: 0 }
const onRender: React.ProfilerOnRenderCallback = (_id, phase, actualDuration) => {
  commits.count++
  commits.actualMs += actualDuration
  if (phase === 'mount') commits.mount++
  else if (phase === 'update') commits.update++
  else commits.nestedUpdate++
}

// ---- Browser-reported jank ---------------------------------------------------
type Loaf = { start: number; duration: number; blocking: number }
const loafs: Loaf[] = []
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as any[]) {
      loafs.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration ?? 0 })
    }
  }).observe({ type: 'long-animation-frame', buffered: true })
} catch { /* LoAF unsupported: jank metrics fall back to frame deltas only */ }

type EventTiming = { name: string; start: number; duration: number; processing: number }
const events: EventTiming[] = []
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as any[]) {
      events.push({
        name: e.name,
        start: e.startTime,
        duration: e.duration,
        processing: e.processingEnd - e.processingStart,
      })
    }
  }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit)
} catch { /* Event Timing unsupported */ }

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r))

function scroller(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.hot-virtual-container')
  if (!el) throw new Error('bench: .hot-virtual-container not found')
  return el
}

/** Is the viewport centre painted with a real cell? A blank frame is a frame
 *  where the user scrolled into rows the virtualiser had not mounted yet. */
function centreIsCell(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return !!hit?.closest('td[data-row]')
}

/**
 * Scroll by a fixed step every animation frame and record the frame deltas.
 * The scroll write happens at the START of a frame, so each delta covers the
 * full cost of reacting to it: scroll event → virtualiser → React commit →
 * style → layout → paint.
 */
async function scrollRun(axis: 'y' | 'x', step: number, frames: number) {
  const el = scroller()
  const t0 = performance.now()
  const loafFrom = loafs.length
  const c0 = { ...commits }
  const deltas: number[] = []
  let blank = 0
  let last = await nextFrame()
  for (let i = 0; i < frames; i++) {
    if (axis === 'y') el.scrollTop += step
    else el.scrollLeft += step
    const now = await nextFrame()
    deltas.push(now - last)
    last = now
    // Sampled every 8th frame: the probe forces a synchronous layout, and
    // doing that every frame would move (and slightly inflate) the very work
    // being measured. 30 samples per run is plenty to catch checkerboarding.
    if (i % 8 === 7 && !centreIsCell(el)) blank++
    const max = axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth
    const pos = axis === 'y' ? el.scrollTop : el.scrollLeft
    if (pos >= max - 1) step = -Math.abs(step)
    if (pos <= 0) step = Math.abs(step)
  }
  const wall = performance.now() - t0
  // Give the observer one more frame to flush the tail.
  await nextFrame()
  const jank = loafs.slice(loafFrom).filter((l) => l.start >= t0)
  return {
    frames,
    wallMs: wall,
    frameDeltas: deltas,
    blankFrames: blank,
    loafCount: jank.length,
    loafBlockingMs: jank.reduce((s, l) => s + l.blocking, 0),
    reactCommits: commits.count - c0.count,
    reactNestedCommits: commits.nestedUpdate - c0.nestedUpdate,
    reactCommitMs: commits.actualMs - c0.actualMs,
  }
}

function snapshot() {
  return {
    mountedRows: document.querySelectorAll('tr[data-row]').length,
    mountedCells: document.querySelectorAll('td[data-row][data-col]').length,
    domNodes: document.getElementsByTagName('*').length,
    commits: { ...commits },
  }
}

declare global {
  interface Window { __bench: any }
}

window.__bench = {
  config: { rows: ROWS, cols: COLS, height: HEIGHT, frozen: FROZEN, colVirt: COL_VIRT },
  ready: false,
  mountMs: NaN,
  scrollRun,
  snapshot,
  events,
  loafs,
  commits,
  resetEvents: () => { events.length = 0 },
  scrollTo: async (top: number, left = 0) => {
    const el = scroller()
    el.scrollTop = top
    el.scrollLeft = left
    await nextFrame(); await nextFrame()
  },
}

function Bench() {
  const tableRef = useRef<HTMLDivElement | null>(null)
  return (
    <I18nProvider locale="en" dict={{}}>
      <Profiler id="grid" onRender={onRender}>
        <DynamicTable
          tableRef={tableRef}
          data={data}
          columns={columns}
          colHeaders
          rowHeaders
          striped
          height={HEIGHT}
          tableName="Bench"
          idColumnName="id"
          uiConfig={uiConfig}
        />
      </Profiler>
    </I18nProvider>
  )
}

performance.mark('bench:mount-start')
createRoot(document.getElementById('root')!).render(<Bench />)

// Mounted = cells are in the DOM AND the browser has painted them (double rAF).
;(async function waitMounted() {
  while (!document.querySelector('td[data-row][data-col]')) await nextFrame()
  await nextFrame(); await nextFrame()
  performance.mark('bench:mounted')
  window.__bench.mountMs = performance.measure('bench:mount', 'bench:mount-start', 'bench:mounted').duration
  window.__bench.ready = true
})()
