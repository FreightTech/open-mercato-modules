# DynamicTable performance bench

Objective, repeatable numbers for the grid. Every performance change lands with
a before/after from here — no numbers, no merge.

```bash
cd packages/ui
node perf/run.mjs --label baseline                 # full matrix, 5 runs each
node perf/run.mjs --label my-change                # same, on your change
node perf/compare.mjs baseline my-change           # noise-filtered verdicts
node perf/run.mjs --label x --only 100x30 --runs 3 # quick iteration
node perf/run.mjs --label x --only 100x30 --runs 1 --cpuprofile scrollY_fast   # where does JS time go
node perf/trace.mjs --only 100x30 --scenario scrollY_fast                       # why: style/layout/paint per frame
```

Results: `<repo>/.ai/perf/results/<label>.json`. Profiles and traces:
`<repo>/.ai/perf/profiles/` (open in DevTools → Performance). `BENCH_MINIFY=0`
keeps function names readable in profiles.

## What it does

- Builds `perf/` (a Vite app that mounts the real `DynamicTable` from `src/`)
  as a **production** React build (`react-dom/profiling`, so `<Profiler>` can
  count commits; `BENCH_PROFILE=0` for plain production).
- Seeded data (`perf/src/data.tsx`) with the FMS column mix: mono refs, status
  badges, dropdowns, dates, right-aligned amounts, booleans, long text, a custom
  renderer. Byte-identical across runs.
- Workloads (`perf/workloads.mjs`): `100x30`, `100x80`, `1000x30`, `10000x50`,
  `app-transport` (120 cols, 2 frozen, column virtualization on).
- Every run gets a fresh browser context; first run per workload is a discarded
  warm-up; viewport 1600×1000 @1x; CPU throttled 4x via CDP (`--cpu`).

## Scenarios and metrics

| Scenario | How | Metrics |
|---|---|---|
| mount | `performance.mark` before `render()` → first cells + double rAF | `mountMs`, DOM nodes, mounted rows/cells |
| scrollY_slow / scrollY_fast | 240 frames, `scrollTop += 64 / 640` at the start of each rAF | frame p50/p95/p99/max, dropped (>25 ms), blank frames, LoAF count + blocking ms, React commits + commit ms, **script / style / layout / total ms per frame** (CDP `Performance.getMetrics` deltas) |
| scrollX | 180 frames, `scrollLeft += 120` | same as above |
| keyNav | real `ArrowDown`×30 + `ArrowRight`×15 | Event Timing duration p50/p95/max (input → next paint), React commits |
| edit | Enter, type, Enter × 10 on a text column | Event Timing keydown/keypress |
| memory | forced GC after the session | JS heap MB, DOM nodes, total layouts / style recalcs |

## Reading the numbers honestly

- **Frame deltas are quantised to vsync** (16.7 ms steps). p95 = 33 ms means at
  least one missed frame in twenty. `taskMsPerFrame` is the continuous metric —
  prefer it for small wins.
- **compare.mjs only calls a change** when the median moved > 5% AND the
  [min, max] ranges of the two runs don't overlap. Otherwise `~` (noise).
- Don't run two benches at once, and don't bench with a dev server building in
  the background — CPU contention shows up as regressions.
- Headless Chrome on macOS composites in software. Relative comparisons within
  one machine are sound; absolute numbers are pessimistic for paint. Use
  `--headed` for a GPU-composited sanity check.
- Blank-frame detection samples every 8th frame (the probe forces layout).
- Event Timing rounds durations to 8 ms and only reports events ≥ 16 ms, so
  `keyNav.n` < 45 means some presses were fast enough not to be reported.
