#!/usr/bin/env node
/**
 * Explain WHY a scenario costs what it costs: runs one scroll scenario under a
 * Chrome trace and summarises the rendering pipeline per frame.
 *
 *   node perf/trace.mjs --only 100x30 --scenario scrollY_fast [--no-build] [--cpu 4]
 *
 * Reports, per scroll frame:
 *   - style recalcs and how many ELEMENTS each restyled (UpdateLayoutTree
 *     elementCount). Restyling ~= the newly inserted cells is healthy; restyling
 *     the whole table means a selector or attribute is invalidating too broadly.
 *   - layouts, and dirty vs total layout objects (a full-table relayout per
 *     frame means layout is not contained).
 *   - time in paint / prepaint / layerize / commit.
 * Writes the raw trace to .ai/perf/profiles/<label>.trace.json — open it in
 * DevTools → Performance → "Load profile" for the full picture.
 */
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { WORKLOADS } from './workloads.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const repoRoot = resolve(pkgRoot, '../..')
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }
const wl = WORKLOADS.find((w) => w.id === arg('only', '100x30'))
const scenario = arg('scenario', 'scrollY_fast')
const cpu = Number(arg('cpu', 4))
const label = arg('label', `trace-${wl.id}-${scenario}`)
const SCROLLS = { scrollY_slow: ['y', 64, 120], scrollY_fast: ['y', 640, 120], scrollX: ['x', 120, 120] }

if (!argv.includes('--no-build')) {
  const r = spawnSync('npx', ['vite', 'build', '--config', 'perf/vite.config.ts'], { cwd: pkgRoot, stdio: 'inherit' })
  if (r.status !== 0) process.exit(1)
}
const dist = join(here, 'dist')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const server = createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname
  try {
    const body = await readFile(join(dist, p === '/' ? 'index.html' : p))
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'text/html' }).end(body)
  } catch { res.writeHead(404).end() }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))

const browser = await chromium.launch({ headless: true, channel: 'chromium' })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
await page.goto(`http://127.0.0.1:${server.address().port}/?rows=${wl.rows}&cols=${wl.cols}&frozen=${wl.frozen ?? 0}&colVirt=${wl.colVirt ? 1 : 0}`)
await page.waitForFunction(() => window.__bench?.ready === true, null, { timeout: 120_000 })
await page.evaluate(() => window.__bench.scrollTo(0, 0))

const events = []
cdp.on('Tracing.dataCollected', (e) => events.push(...e.value))
const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r))
await cdp.send('Tracing.start', {
  transferMode: 'ReportEvents',
  traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'v8.execute'] },
})
const [axis, step, frames] = SCROLLS[scenario]
await page.evaluate(([a, s, f]) => window.__bench.scrollRun(a, s, f), [axis, step, frames])
await cdp.send('Tracing.end')
await done
await browser.close()
server.close()

const outDir = join(repoRoot, '.ai/perf/profiles')
await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, `${label}.trace.json`), JSON.stringify({ traceEvents: events }))

// ---- summarise (main thread of the renderer only) ------------------------------
const mainTid = events.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain')?.tid
const main = events.filter((e) => e.tid === mainTid && e.ph === 'X')
const sum = (name) => main.filter((e) => e.name === name).reduce((s, e) => s + (e.dur ?? 0), 0) / 1000
const count = (name) => main.filter((e) => e.name === name).length
const styles = main.filter((e) => e.name === 'UpdateLayoutTree')
const elems = styles.map((e) => e.args?.elementCount ?? e.args?.data?.elementCount ?? 0)
const layouts = main.filter((e) => e.name === 'Layout')
const dirty = layouts.map((e) => e.args?.beginData?.dirtyObjects ?? 0)
const total = layouts.map((e) => e.args?.beginData?.totalObjects ?? 0)
const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)
const per = (ms) => (ms / frames).toFixed(2)

console.log(`\n${label}: ${frames} frames @ ${cpu}x`)
console.log(`  style recalc   ${per(sum('UpdateLayoutTree'))} ms/frame  ${(count('UpdateLayoutTree') / frames).toFixed(2)}/frame  avg ${avg(elems)} elements restyled (max ${Math.max(0, ...elems)})`)
console.log(`  layout         ${per(sum('Layout'))} ms/frame  ${(layouts.length / frames).toFixed(2)}/frame  avg dirty ${avg(dirty)} / total ${avg(total)} objects`)
for (const n of ['FunctionCall', 'EventDispatch', 'PrePaint', 'Paint', 'Layerize', 'Commit', 'MajorGC', 'MinorGC', 'ParseAuthorStyleSheet', 'HitTest']) {
  const t = sum(n)
  if (t > 0) console.log(`  ${n.padEnd(14)} ${per(t)} ms/frame`)
}
