#!/usr/bin/env node
/**
 * What triggered React work in a CPU profile?
 *
 *   node perf/why-render.mjs .ai/perf/profiles/<file>.cpuprofile
 *
 * Finds every top-level React render entry (performWorkOnRoot / flushSync
 * work) and groups them by the JS call chain that led there — a scroll
 * listener, a rAF callback, a ResizeObserver, a scheduler task — with total
 * time and sample count. Needs a profile from an unminified build
 * (BENCH_MINIFY=0 node perf/run.mjs … --cpuprofile <scenario>).
 */
import { readFileSync } from 'node:fs'

const p = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const byId = new Map(p.nodes.map((n) => [n.id, n]))
const parent = new Map()
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id)

const self = new Map()
p.samples.forEach((s, i) => self.set(s, (self.get(s) ?? 0) + (p.timeDeltas[i] ?? 0)))
const total = new Map()
for (const [id, us] of self) {
  for (let c = id; c; c = parent.get(c)) total.set(c, (total.get(c) ?? 0) + us)
}

const ENTRY = /^(performWorkOnRoot|flushSyncWorkAcrossRoots_impl|performWorkOnRootViaSchedulerTask|flushSpawnedWork|commitRoot)$/
const name = (id) => byId.get(id).callFrame.functionName || '(anon)'
const agg = new Map()
for (const n of p.nodes) {
  if (!ENTRY.test(n.callFrame.functionName)) continue
  const chain = []
  let nested = false
  for (let cur = parent.get(n.id); cur; cur = parent.get(cur)) {
    if (ENTRY.test(name(cur))) { nested = true; break }
    chain.push(name(cur))
  }
  if (nested) continue
  const key = `${n.callFrame.functionName}  ⇐  ${chain.filter((f) => f !== '(root)').slice(0, 8).join(' ⇐ ')}`
  const a = agg.get(key) ?? { us: 0, hits: 0 }
  a.us += total.get(n.id) ?? 0
  a.hits++
  agg.set(key, a)
}
for (const [k, v] of [...agg].sort((a, b) => b[1].us - a[1].us).slice(0, 12)) {
  console.log(`${(v.us / 1000).toFixed(0).padStart(7)} ms  ${k}`)
}
