#!/usr/bin/env node
/**
 * Compare two benchmark results.
 *
 *   node perf/compare.mjs baseline candidate [--all]
 *
 * Arguments are labels (resolved in .ai/perf/results/) or paths. Lower is
 * better for every metric reported here. A change is called only when BOTH
 * hold: the median moved by more than 5%, and the two runs' [min, max] ranges
 * do not overlap. Everything else is printed as "~" (noise). This is
 * deliberately conservative — a claimed win must survive run-to-run variance.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const resultsDir = resolve(here, '../../../.ai/perf/results')
const load = (x) => JSON.parse(readFileSync(existsSync(x) ? x : join(resultsDir, `${x}.json`), 'utf8'))

const [aArg, bArg] = process.argv.slice(2).filter((x) => !x.startsWith('--'))
const showAll = process.argv.includes('--all')
if (!aArg || !bArg) {
  console.error('usage: node perf/compare.mjs <baseline> <candidate> [--all]')
  process.exit(1)
}
const A = load(aArg)
const B = load(bArg)

// The headline metrics. `--all` prints every numeric leaf.
const HEADLINE = [
  'mountMs',
  'scrollY_slow.p95', 'scrollY_slow.taskMsPerFrame', 'scrollY_slow.dropped',
  'scrollY_fast.p95', 'scrollY_fast.taskMsPerFrame', 'scrollY_fast.scriptMsPerFrame', 'scrollY_fast.styleMsPerFrame', 'scrollY_fast.layoutMsPerFrame', 'scrollY_fast.dropped', 'scrollY_fast.blankFrames', 'scrollY_fast.reactCommits',
  'scrollX.p95', 'scrollX.taskMsPerFrame', 'scrollX.dropped', 'scrollX.blankFrames',
  'keyNav.p95', 'edit.keydown.p95',
  'memory.jsHeapMB', 'afterMount.domNodes',
]
// Informational: more or fewer is not "better" by itself.
const NEUTRAL = /\.n$|mountedRows|mountedCells|commits\.count|commits\.actualMs|layoutsPerFrame/

const warn = []
if (A.env.cpuThrottle !== B.env.cpuThrottle) warn.push(`cpu throttle differs: ${A.env.cpuThrottle}x vs ${B.env.cpuThrottle}x`)
if (A.env.chromium !== B.env.chromium) warn.push(`chromium differs: ${A.env.chromium} vs ${B.env.chromium}`)
if (A.env.profilingBuild !== B.env.profilingBuild) warn.push('profiling build differs')

console.log(`A = ${A.env.label} (${A.env.gitSha}${A.env.gitDirty ? '+dirty' : ''}, ${A.env.runs} runs)`)
console.log(`B = ${B.env.label} (${B.env.gitSha}${B.env.gitDirty ? '+dirty' : ''}, ${B.env.runs} runs)`)
for (const w of warn) console.log(`!! ${w}`)

let better = 0, worse = 0
for (const wl of Object.keys(A.workloads)) {
  const a = A.workloads[wl]?.metrics
  const b = B.workloads[wl]?.metrics
  if (!a || !b) continue
  console.log(`\n${wl}`)
  const keys = showAll ? Object.keys(a) : HEADLINE.filter((k) => k in a)
  for (const k of keys) {
    const x = a[k], y = b[k]
    if (!y) continue
    const d = x.median === 0 ? (y.median === 0 ? 0 : Infinity) : ((y.median - x.median) / x.median) * 100
    const separated = y.max < x.min || y.min > x.max
    let verdict = '~'
    if (!NEUTRAL.test(k) && separated && Math.abs(d) > 5) {
      verdict = d < 0 ? 'BETTER' : 'WORSE'
      d < 0 ? better++ : worse++
    }
    const ds = Number.isFinite(d) ? `${d > 0 ? '+' : ''}${d.toFixed(1)}%` : 'n/a'
    console.log(`  ${k.padEnd(32)} ${String(x.median).padStart(9)} → ${String(y.median).padStart(9)}  ${ds.padStart(8)}  ${verdict}`)
  }
  const errs = B.workloads[wl].errors ?? []
  if (errs.length) console.log(`  !! candidate page errors: ${errs.join(' | ')}`)
}
console.log(`\n${better} better, ${worse} worse (headline metrics, noise-filtered)`)
process.exit(worse > 0 ? 2 : 0)
