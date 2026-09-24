#!/usr/bin/env node
/**
 * DynamicTable benchmark runner.
 *
 *   node perf/run.mjs --label baseline                 # full matrix, 5 runs
 *   node perf/run.mjs --label try-x --only 100x30 --runs 7
 *   node perf/run.mjs --label quick --runs 3 --cpu 1 --no-build
 *   node perf/run.mjs --label css-has --base HEAD --only 100x30   # A/B, interleaved
 *
 * A/B mode (--base <git ref>) is THE way to judge a change on a shared machine:
 * it builds the same harness against `packages/ui/src` at <ref> and against the
 * working tree, then alternates base/head runs (ABBA order) inside one session,
 * so background load lands on both sides equally. Writes <label>.base.json and
 * <label>.head.json and prints the comparison.
 *
 * Builds the fixture (production React), serves it from a local static server,
 * and for every workload opens a FRESH browser context per run (no warm JIT or
 * cache carried between runs). The first run of each workload is a discarded
 * warm-up. Results land in <repo>/.ai/perf/results/<label>.json; compare two
 * with perf/compare.mjs.
 *
 * CPU throttling (default 4x, via CDP) stands in for a mid-range office laptop
 * AND makes regressions visible: an M-series Mac hides a 3x slowdown inside
 * the 16.7 ms frame budget.
 */
import { spawnSync, execSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { chromium } from '@playwright/test'
import { WORKLOADS } from './workloads.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const repoRoot = resolve(pkgRoot, '../..')

// ---- args --------------------------------------------------------------------
const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? dflt : argv[i + 1]
}
const flag = (name) => argv.includes(`--${name}`)
const label = arg('label', `run-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const runs = Number(arg('runs', 5))
const cpu = Number(arg('cpu', 4))
const only = arg('only', null)?.split(',')
const headed = flag('headed')
// --cpuprofile <scenario>: after the timed runs, profile ONE extra run of that
// scenario (scrollY_slow | scrollY_fast | scrollX | keyDown | keyRight) and print the hottest functions.
const cpuProfileScenario = arg('cpuprofile', null)

// ---- build + serve -----------------------------------------------------------
const baseRef = arg('base', null)
const git = (cmd) => { try { return execSync(`git ${cmd}`, { cwd: repoRoot }).toString().trim() } catch { return null } }

function build(env, outDir) {
  const r = spawnSync('npx', ['vite', 'build', '--config', 'perf/vite.config.ts'], {
    cwd: pkgRoot, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ...env, BENCH_OUT: outDir },
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const variants = { head: join(here, 'dist') }
let baseSha = null
if (baseRef) {
  baseSha = git(`rev-parse --short ${baseRef}`)
  if (!baseSha) { console.error(`unknown ref ${baseRef}`); process.exit(1) }
  // Extract ONLY packages/ui/src at the ref, inside packages/ui so module
  // resolution still finds the repo's node_modules. The harness itself
  // (perf/src) is the working tree's for both sides — same measurement code.
  const srcDir = join(here, '.base', baseSha)
  if (!existsSync(join(srcDir, 'packages/ui/src'))) {
    execSync(`mkdir -p ${srcDir} && git archive ${baseSha} packages/ui/src | tar -x -C ${srcDir}`, { cwd: repoRoot })
  }
  variants.base = join(here, 'dist-base')
  if (!flag('no-build')) build({ BENCH_SRC: join(srcDir, 'packages/ui/src') }, variants.base)
}
if (!flag('no-build')) build({}, variants.head)
for (const d of Object.values(variants)) {
  if (!existsSync(join(d, 'index.html'))) { console.error(`${d} missing — run without --no-build`); process.exit(1) }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
// /head/… and /base/… serve the two builds; the fixture uses relative asset paths.
const server = createServer(async (req, res) => {
  const [, variant, ...rest] = decodeURIComponent(new URL(req.url, 'http://x').pathname).split('/')
  const root = variants[variant]
  const file = root && join(root, rest.join('/') || 'index.html')
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

// ---- stats -------------------------------------------------------------------
const pct = (xs, p) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
const median = (xs) => pct(xs, 50)
const round = (x) => Math.round(x * 100) / 100

/** Frame-delta summary. A frame over 1.5 budgets is one the user saw stutter. */
function frameStats(deltas) {
  const budget = 1000 / 60
  return {
    p50: round(pct(deltas, 50)),
    p95: round(pct(deltas, 95)),
    p99: round(pct(deltas, 99)),
    max: round(Math.max(...deltas)),
    dropped: deltas.filter((d) => d > budget * 1.5).length,
  }
}

function eventStats(events, name) {
  const xs = events.filter((e) => e.name === name).map((e) => e.duration)
  return { n: xs.length, p50: round(median(xs)), p95: round(pct(xs, 95)), max: xs.length ? round(Math.max(...xs)) : NaN }
}

/** Chrome's own cumulative main-thread counters (seconds). Deltas around a
 *  scenario split its cost into script / style / layout without a trace. */
async function cdpMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map((x) => [x.name, x.value]))
}
function breakdown(a, b, frames) {
  const perFrame = (k) => round(((b[k] - a[k]) * 1000) / frames)
  return {
    scriptMsPerFrame: perFrame('ScriptDuration'),
    styleMsPerFrame: perFrame('RecalcStyleDuration'),
    layoutMsPerFrame: perFrame('LayoutDuration'),
    taskMsPerFrame: perFrame('TaskDuration'),
    layoutsPerFrame: round((b.LayoutCount - a.LayoutCount) / frames),
  }
}

// ---- one run -----------------------------------------------------------------
const SCROLLS = { scrollY_slow: ['y', 64, 240], scrollY_fast: ['y', 640, 240], scrollX: ['x', 120, 180] }

async function runOnce(browser, wl, opts = {}) {
  const variant = opts.variant ?? 'head'
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  const url = `${origin}/${variant}/?rows=${wl.rows}&cols=${wl.cols}&height=${wl.height ?? 800}&frozen=${wl.frozen ?? 0}&colVirt=${wl.colVirt ? 1 : 0}`
  await page.goto(url)
  await page.waitForFunction(() => window.__bench?.ready === true, null, { timeout: 120_000 })
  const out = { mountMs: round(await page.evaluate(() => window.__bench.mountMs)) }
  out.afterMount = await page.evaluate(() => window.__bench.snapshot())
  // Evidence the build rendered what we think it did (and at what density).
  if (opts.screenshot) await page.screenshot({ path: opts.screenshot })

  if (opts.profile) {
    await page.evaluate(() => window.__bench.scrollTo(0, 0))
    const key = { keyDown: 'ArrowDown', keyRight: 'ArrowRight' }[opts.profile]
    if (key) await page.locator('td[data-row="2"][data-col="1"]').click()
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
    await cdp.send('Profiler.start')
    if (key) {
      for (let i = 0; i < 30; i++) await page.keyboard.press(key)
    } else {
      const [axis, step, frames] = SCROLLS[opts.profile]
      await page.evaluate(([a, s, f]) => window.__bench.scrollRun(a, s, f), [axis, step, frames])
    }
    const { profile } = await cdp.send('Profiler.stop')
    await context.close()
    return profile
  }

  // Vertical scroll: ~2 rows/frame (steady reading) and ~20 rows/frame (fling).
  for (const [name, step] of [['scrollY_slow', 64], ['scrollY_fast', 640]]) {
    await page.evaluate(() => window.__bench.scrollTo(0, 0))
    const m0 = await cdpMetrics(cdp)
    const r = await page.evaluate(([s]) => window.__bench.scrollRun('y', s, 240), [step])
    out[name] = { ...frameStats(r.frameDeltas), blankFrames: r.blankFrames, loafCount: r.loafCount, loafBlockingMs: round(r.loafBlockingMs), reactCommits: r.reactCommits, reactNestedCommits: r.reactNestedCommits, reactCommitMs: round(r.reactCommitMs), ...breakdown(m0, await cdpMetrics(cdp), r.frames) }
  }
  // Horizontal scroll (column virtualisation path).
  await page.evaluate(() => window.__bench.scrollTo(0, 0))
  {
    const m0 = await cdpMetrics(cdp)
    const r = await page.evaluate(() => window.__bench.scrollRun('x', 120, 180))
    out.scrollX = { ...frameStats(r.frameDeltas), blankFrames: r.blankFrames, loafCount: r.loafCount, loafBlockingMs: round(r.loafBlockingMs), reactCommits: r.reactCommits, reactNestedCommits: r.reactNestedCommits, reactCommitMs: round(r.reactCommitMs), ...breakdown(m0, await cdpMetrics(cdp), r.frames) }
  }

  // Keyboard navigation: real key presses, input→next-paint from Event Timing.
  await page.evaluate(() => window.__bench.scrollTo(0, 0))
  await page.locator('td[data-row="2"][data-col="1"]').click()
  await page.evaluate(() => window.__bench.resetEvents())
  // Down and Right are separate paths: Down moves the row selection, Right can
  // move the column window (column virtualisation) — measured apart so one
  // cannot hide in the other's p95.
  const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  // Event Timing is quantised to 8 ms and drops events < 16 ms, so with 30
  // presses its p95 is often just the max. The continuous signal is Chrome's
  // own main-thread counters per press (script / task ms) — judge by those.
  const PRESSES = 30
  const keyRun = async (key) => {
    await page.evaluate(() => window.__bench.resetEvents())
    const c0 = await page.evaluate(() => window.__bench.commits.count)
    const m0 = await cdpMetrics(cdp)
    for (let i = 0; i < PRESSES; i++) await page.keyboard.press(key)
    await settle()
    const m1 = await cdpMetrics(cdp)
    const events = await page.evaluate(() => window.__bench.events)
    const c1 = await page.evaluate(() => window.__bench.commits.count)
    const kd = events.filter((e) => e.name === 'keydown').map((e) => e.duration)
    return {
      ...eventStats(events, 'keydown'),
      slowPresses: kd.filter((d) => d >= 48).length,
      scriptMsPerPress: round(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / PRESSES),
      taskMsPerPress: round(((m1.TaskDuration - m0.TaskDuration) * 1000) / PRESSES),
      reactCommits: c1 - c0,
    }
  }
  const down = await keyRun('ArrowDown')
  const right = await keyRun('ArrowRight')
  out.keyNav = { n: down.n + right.n, p95: Math.max(down.p95 || 0, right.p95 || 0), down, right }

  // Correctness, not speed: after every arrow press the caret must be fully
  // inside the visible band (below the sticky header, inside the scroller).
  // Walks 40 down then 40 up from the top — past the bottom edge and back.
  await page.evaluate(() => window.__bench.scrollTo(0, 0))
  await page.locator('td[data-row="0"][data-col="2"]').click()
  const caretVisible = () => page.evaluate(() => {
    const c = document.querySelector('td[data-cell-selected="true"]') || [...document.querySelectorAll('td[data-in-range="true"]')].find((td) => td.dataset.rangeTop === 'true')
    if (!c) return false
    const s = document.querySelector('.hot-virtual-container').getBoundingClientRect()
    const h = document.querySelector('.hot-headers-sticky')?.getBoundingClientRect().bottom ?? s.top
    const r = c.getBoundingClientRect()
    return r.top >= Math.max(s.top, h) - 1 && r.bottom <= s.bottom + 1 && r.left >= s.left - 1 && r.right <= s.right + 1
  })
  let hidden = 0
  const steps = Math.min(40, wl.rows - 1)
  for (const key of ['ArrowDown', 'ArrowUp']) {
    for (let i = 0; i < steps; i++) { await page.keyboard.press(key); if (!(await caretVisible())) hidden++ }
  }
  out.caret = { presses: steps * 2, hidden }

  // Edit: open an editor on a text column, type, commit with Enter. Ten cells.
  await page.evaluate(() => window.__bench.scrollTo(0, 0))
  const textCol = wl.cols > 7 ? 7 : 0
  await page.locator(`td[data-row="1"][data-col="${textCol}"]`).click()
  await page.evaluate(() => window.__bench.resetEvents())
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Enter') // open editor
    await page.keyboard.type('x')
    await page.keyboard.press('Enter') // commit (moves down)
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const editEvents = await page.evaluate(() => window.__bench.events)
  out.edit = { keydown: eventStats(editEvents, 'keydown'), keypress: eventStats(editEvents, 'keypress') }

  // Memory + DOM after the session. GC first so the number is live heap.
  await cdp.send('HeapProfiler.collectGarbage')
  const { metrics } = await cdp.send('Performance.getMetrics')
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]))
  out.memory = { jsHeapMB: round(m.JSHeapUsedSize / 1048576), domNodes: m.Nodes, layoutCount: m.LayoutCount, recalcStyleCount: m.RecalcStyleCount }
  out.final = await page.evaluate(() => window.__bench.snapshot())
  out.errors = errors
  await context.close()
  return out
}

/** Self time per function (name + source position), top 30. Open the
 *  .cpuprofile in Chrome DevTools → Performance for the full flame chart. */
function printHotspots(profile) {
  const dt = new Map()
  const { samples, timeDeltas, nodes } = profile
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (let i = 0; i < samples.length; i++) dt.set(samples[i], (dt.get(samples[i]) ?? 0) + (timeDeltas[i] ?? 0))
  const agg = new Map()
  let total = 0
  for (const [id, us] of dt) {
    const f = byId.get(id).callFrame
    const key = `${f.functionName || '(anon)'}  ${f.url.split('/').pop()}:${f.lineNumber + 1}`
    agg.set(key, (agg.get(key) ?? 0) + us)
    total += us
  }
  const top = [...agg].sort((a, b) => b[1] - a[1]).slice(0, 30)
  for (const [k, us] of top) console.log(`    ${(us / 1000).toFixed(1).padStart(8)}ms ${((100 * us) / total).toFixed(1).padStart(5)}%  ${k}`)
}

// ---- aggregate ---------------------------------------------------------------
/** Flatten a run into { 'scrollY_fast.p95': 12.3, ... } for numeric leaves. */
function flatten(o, prefix = '', acc = {}) {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'number') acc[key] = v
    else if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, acc)
  }
  return acc
}

function aggregate(runResults) {
  const flat = runResults.map((r) => flatten(r))
  const keys = Object.keys(flat[0] ?? {})
  const metrics = {}
  for (const k of keys) {
    const xs = flat.map((f) => f[k]).filter((x) => Number.isFinite(x))
    metrics[k] = { median: round(median(xs)), min: round(Math.min(...xs)), max: round(Math.max(...xs)), values: xs }
  }
  return metrics
}

// ---- main --------------------------------------------------------------------
const envFor = (variant) => ({
  label: baseRef ? `${label}.${variant}` : label,
  variant,
  date: new Date().toISOString(),
  gitSha: variant === 'base' ? baseSha : git('rev-parse --short HEAD'),
  gitBranch: git('rev-parse --abbrev-ref HEAD'),
  gitDirty: variant === 'base' ? false : !!git('status --porcelain -- packages/ui/src'),
  cpuThrottle: cpu,
  runs,
  interleaved: !!baseRef,
  host: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30), platform: `${os.platform()} ${os.release()}` },
  loadAvgAtStart: os.loadavg().map((x) => round(x)),
  profilingBuild: process.env.BENCH_PROFILE !== '0',
})

const browser = await chromium.launch({ headless: !headed, channel: 'chromium', args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] })
const names = Object.keys(variants) // ['head'] or ['head', 'base']
const results = Object.fromEntries(names.map((v) => [v, { env: { ...envFor(v), chromium: browser.version() }, workloads: {} }]))
const selected = WORKLOADS.filter((w) => (only ? only.includes(w.id) : !w.diagnostic))
const outDir = join(repoRoot, '.ai/perf/results')
await mkdir(outDir, { recursive: true })
console.log(`bench ${label}: ${selected.length} workloads × ${runs} runs (+1 warm-up)${baseRef ? ` × A/B vs ${baseRef} (${baseSha})` : ''}, cpu ${cpu}x, chromium ${browser.version()}, load ${os.loadavg()[0].toFixed(1)}`)

const summary = (metrics) => {
  const g = (k) => metrics[k]?.median
  return `mount ${g('mountMs')}ms | scrollY fast ${g('scrollY_fast.taskMsPerFrame')}ms/f p95 ${g('scrollY_fast.p95')} | slow ${g('scrollY_slow.taskMsPerFrame')}ms/f | scrollX ${g('scrollX.taskMsPerFrame')}ms/f | key p95 ${g('keyNav.p95')}ms | heap ${g('memory.jsHeapMB')}MB`
}

for (const wl of selected) {
  process.stdout.write(`  ${wl.id.padEnd(14)} `)
  for (const v of names) await runOnce(browser, wl, { variant: v }) // warm-ups, discarded
  const runResults = Object.fromEntries(names.map((v) => [v, []]))
  for (let i = 0; i < runs; i++) {
    // ABBA: alternate which side goes first so slow drift cancels out.
    const order = i % 2 === 0 ? names : [...names].reverse()
    for (const v of order) {
      const shot = i === 0 ? join(outDir, `${label}${baseRef ? `.${v}` : ''}-${wl.id}.png`) : undefined
      runResults[v].push(await runOnce(browser, wl, { variant: v, screenshot: shot }))
    }
    process.stdout.write('.')
  }
  console.log()
  for (const v of names) {
    const errors = [...new Set(runResults[v].flatMap((r) => r.errors))]
    const metrics = aggregate(runResults[v])
    results[v].workloads[wl.id] = { workload: wl, metrics, errors }
    console.log(`    ${baseRef ? v.padEnd(5) : ''}${summary(metrics)}${errors.length ? ` | ${errors.length} PAGE ERRORS` : ''}`)
  }
}

if (cpuProfileScenario) {
  for (const wl of selected) {
    const profile = await runOnce(browser, wl, { profile: cpuProfileScenario })
    const profDir = join(repoRoot, '.ai/perf/profiles')
    await mkdir(profDir, { recursive: true })
    const file = join(profDir, `${label}-${wl.id}-${cpuProfileScenario}.cpuprofile`)
    await writeFile(file, JSON.stringify(profile))
    console.log(`\n  cpu profile ${wl.id} ${cpuProfileScenario} → ${file}`)
    printHotspots(profile)
  }
}

await browser.close()
server.close()

for (const v of names) {
  const outFile = join(outDir, `${results[v].env.label}.json`)
  await writeFile(outFile, JSON.stringify(results[v], null, 2))
  console.log(`→ ${outFile}`)
}
if (baseRef) {
  console.log()
  spawnSync('node', [join(here, 'compare.mjs'), join(outDir, `${label}.base.json`), join(outDir, `${label}.head.json`)], { stdio: 'inherit' })
}
