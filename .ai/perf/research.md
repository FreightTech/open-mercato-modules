# DynamicTable performance — research

Researched 2026-09-23. Scope: how high-performance grids get fast, and how to measure an editable React DOM grid objectively.
Every claim has a source URL. "HT-blog" = https://handsontable.com/blog/one-million-rows-later-how-handsontable-fixed-its-performance.

---

## 1. Handsontable: 17.1.0 → 18.1.0 (June 25 – July 17, 2026)

### 1.1 What was slow (17.1.0) — HT-blog
- Out of memory at 500k rows; page stalled at 915 MB.
- JS heap 3–10x higher than competing grids.
- Full data replacement ran at ~7 FPS.
- **2,400,118 detached DOM nodes** retained after scrolling a 100k-row grid — the renderer's node pool was keyed by *absolute cell coordinates* and never bounded.
- 10,000,001 cell-metadata objects pre-created at startup.
- Keyboard nav summed row heights from row 0 on every move (O(n)).
- Super-linear hot loops in paste, row removal, `columns()` callback, date sort.
- Layout thrashing: 185 layout passes on a vertical scroll run, 468 on horizontal.

### 1.2 What they changed and the measured effect — HT-blog

| # | Change | Before → After |
|---|--------|----------------|
| 1 | Removed diffing renderer + unbounded node pool; direct DOM rendering with retention **bounded by the viewport by construction** | First render of 100k rows: 3,444 ms → 110 ms (31x) |
| 2 | Lazy cell-meta creation instead of eager 10M objects | Large heap cut (see memory table) |
| 3 | Scroll never changes DOM *shape*: row/cell elements stay in place, only content is rewritten; surviving rows reused; extra rows pre-rendered **only in scroll direction**; layout once per frame with *predicted* scrollbar geometry | **0 node insertions/removals over a 120-step scripted scroll** |
| 4 | Prefix-sum cache of row heights (no re-summing from row 0) | Keypress at row 900k: 92 ms → 1.9 ms; Ctrl+End: 207 ms → 7 ms |
| 5 | Paste into filtered column: collect affected columns, rescan each once per paste (not per cell) | 1,000 cells into 100k filtered column: 55.8 s → 198 ms (~280x) |
| 6 | Row removal: one batched splice instead of per-row splice | Remove 10k of 1M rows: 2,013 ms → 0.2 ms |
| 7 | Memoised index translation in `columns()` callback | 26M calls → ~25k; `getColHeader()` 271.5 ms → 0.7 ms |
| 8 | Pre-parse dates once before sort (not per comparison) | Sort 300k dates: 5.2 s → 1.1 s (~40M parses removed) |
| 9 | All DOM reads behind a geometry proxy; one layout pass per render; delta-render only incoming rows | Vertical-scroll layout passes 185 → 57; horizontal scroll 12 → 48 FPS over the project |

Process: 17 "finder" AI agents each hunted super-linear patterns (nested loops, `indexOf`/`splice` in loops, per-comparison allocation) in one subsystem; verifier agents refuted false positives: 89 raw → 76 confirmed (4 critical, 39 high). Every fix verified in real Chrome over CDP (heap snapshots, traces, frame timing); automated JS-heap scenarios used as **merge gates**; 31 PRs in 7 workstreams (HT-blog).

### 1.3 How they measured — HT-blog + https://www.1771technologies.com/blog/performance-benchmarks + https://github.com/1771-Technologies/react-data-grid-benchmarking
- Harness: 1771 Technologies' public React grid benchmark (built on "Measure Right", a Playwright library) — launches system Chrome, **headed**.
- HT's run: 5 warm-ups, 20 recorded iterations, averaged; one browser launch per grid per iteration; 2000x1200 viewport, 1920x1080 grid, **300 columns**; row headers off for scroll demos (HT-blog).
- 1771's own run: 5 warm-ups, 50 recorded runs, 1 s cooldown, **top/bottom 5% trimmed** before mean; MacBook Air M4, 16 GB, Chrome 149, 60 Hz display (1771 blog).
- **FPS** = "cadence of `AnimationFrame` async-start events within the benchmark window" read from a Chrome trace (repo README). Scroll driver calls `scrollBy` in fixed 500 px steps, each wrapped in `requestAnimationFrame` (1771 blog).
- **Memory** = CDP `JSHeapUsedSize` after a forced synchronous major GC (1771 blog).
- Completion signals: cell-updates waits on `toBeVisible()`; sort/filter assert specific cell values — timed from interaction to final frame commit (repo README).
- Normalisation: row+column virtualisation on, **overscan 0**, animations off, pagination/toolbars off, resize/reorder off, identical custom cell renderer, 20 px row height, precomputed seeded data (LCG seed 12345, values 0–10) (repo README, 1771 blog).
- Scenarios: vertical scroll 10k–1M rows; sort 10k–100k; filter 10k–100k; cell updates (1,000 rows x 50 full dataset swaps); horizontal scroll 50k; pinned rows/cols 200k (1771 blog).

### 1.4 Numbers (17.1.0 → 18.1.0) — HT-blog

| Test | Heap MB before → after | FPS before → after |
|------|------------------------|--------------------|
| Scroll 10k | 144 → 19 | 26.1 → 30.1 |
| Scroll 200k | 2,010 → 246 | 25.0 → 30.4 |
| Scroll 500k | OOM → 602 | OOM → 31.1 |
| Scroll 1M | OOM → 1,199 | OOM → 28.2 |
| Sort 100k | 1,338 → 126 | 13.6 → 28.2 |
| Filter 100k | 1,339 → 127 | — |
| Cell updates | — | 6.8 → 20.0 |

- Competitors at 1M rows: heap HT 1,199 / LyteNyte 1,624 / AG Grid 1,657 MB; scroll FPS LyteNyte 57.2 / HT 28.2 / AG Grid 22.0 (HT-blog). HT lowest heap in 12 of 13 tests.
- Their key selling point is a **flat curve**: ~30 FPS from 10k to 1M rows — cost independent of dataset size (HT-blog).
- Their caveat: synthetic page, uniform data, script-driven; real performance depends on data shape, renderers, plugins (HT-blog).

### 1.5 Handsontable's documented user-level tips — https://handsontable.com/docs/react-data-grid/performance/
- Fixed `colWidths` / `rowHeights`; disable `autoRowSize` / `autoColumnSize` (they measure DOM; `autoRowSize.syncLimit` default 500 rows, `autoColumnSize.syncLimit` default 50 cols, rest async; `samplingRatio` limits sampled cells) — https://handsontable.com/docs/react-data-grid/api/options
- Tune `viewportRowRenderingOffset` / `viewportColumnRenderingOffset` (`'auto'` or number); `renderAllRows: true` disables virtualisation — api/options.
- Avoid the `cells` function option: it runs **before every render for every visible cell**; prefer static `columns`/`cell`/`setCellMeta`.
- `hot.batch(fn)` = suspend render + execution, recompute caches and render once; `batchRender`, `batchExecution`; manual `suspendRender/resumeRender`, `suspendExecution/resumeExecution` for async — https://handsontable.com/docs/react-data-grid/batch-operations
- Few CSS animations/transitions; measure with `beforeRender`/`afterRender` hooks.

---

## 2. Techniques catalogue

Relevance scale for our React DOM grid: **H** = do/verify now, **M** = worth it after baseline, **L** = not applicable or conflicts with density/a11y.

| Technique | Who uses it | What it fixes | Cost / complexity | Relevance |
|-----------|-------------|---------------|-------------------|-----------|
| Row virtualisation (render viewport + buffer) | All: AG Grid ([dom-virtualisation](https://www.ag-grid.com/react-data-grid/dom-virtualisation/)), HT, TanStack Virtual ([docs](https://tanstack.com/virtual)), RevoGrid ([repo](https://github.com/revolist/revogrid)) | DOM size ∝ rows | Low with a library | **H** — baseline requirement |
| Column virtualisation | AG Grid (no column buffer: "horizontal scrolling is less CPU-intensive") [dom-virtualisation](https://www.ag-grid.com/react-data-grid/dom-virtualisation/); TanStack two-virtualizer grid ([marko docs](https://github.com/tanstack/virtual/blob/main/docs/framework/marko/marko-virtual.md)); HT `viewportColumnRenderingOffset` | DOM size ∝ columns; 300-col benchmarks assume it | Medium (pinned cols, header sync, widths) | **H** for wide tables — density means many cols |
| Small/zero overscan; overscan only in scroll direction | TanStack `overscan` default 1 ([virtualizer.md](https://github.com/tanstack/virtual/blob/main/docs/api/virtualizer.md)); AG Grid `rowBuffer` 10 ([scrolling-performance](https://www.ag-grid.com/react-data-grid/scrolling-performance/)); HT directional pre-render (HT-blog) | Trades per-frame work vs blank flashes | Low | **H** — tune by measurement |
| Bounded, stable DOM: reuse row/cell elements, rewrite content only, zero insert/remove on scroll | HT 18 (HT-blog); Glide avoids DOM entirely ([repo](https://github.com/glideapps/glide-data-grid)) | Node churn, GC, detached-node leaks, layout | High in React (fights keyed reconciliation; would need index-keyed pool) | **M** — measure node insert/remove count first; React keys by row id create/destroy rows on scroll |
| Skip React re-render for scroll-only updates (write transforms directly to DOM) | TanStack Virtual `directDomUpdates` — re-renders only when visible range or `isScrolling` changes ([react-virtual.md](https://github.com/tanstack/virtual/blob/main/docs/framework/react/react-virtual.md)) | React commit on every scroll event | Low if on TanStack Virtual; item style constraints | **H** |
| Don't `flushSync` on scroll | TanStack `useFlushSync: false` ([react-virtual.md](https://github.com/tanstack/virtual/blob/main/docs/framework/react/react-virtual.md)) | Synchronous React render inside scroll handler | Trivial flag | **H** — check current setting |
| Fixed row heights / column widths; no auto-sizing | HT ([performance](https://handsontable.com/docs/react-data-grid/performance/)); AG Grid "avoid Auto Height" ([scrolling-performance](https://www.ag-grid.com/react-data-grid/scrolling-performance/)); 1771 fixes 20 px rows | Measurement layout, O(n) offset math | Low | **H** — also good for density |
| Prefix-sum / cached offsets for variable heights; incremental re-measure from first dirty index | HT 18 (HT-blog); TanStack `pendingMin` ([virtual-core](https://github.com/tanstack/virtual/blob/main/packages/virtual-core/src/index.ts)) | O(n) scroll-to-index, keyboard jumps | Medium | **M** (only if variable heights) |
| Batch DOM reads before writes; one layout per frame | HT geometry proxy (HT-blog); [web.dev layout thrashing](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing) | Forced sync layout; LoAF `forcedStyleAndLayoutDuration` exposes it ([LoAF](https://developer.chrome.com/docs/web-platform/long-animation-frames)) | Medium (audit `getBoundingClientRect`/`offsetWidth` in effects) | **H** |
| Batch mutations → one render/recompute | HT `batch()` ([batch-operations](https://handsontable.com/docs/react-data-grid/batch-operations)); AG Grid `applyTransactionAsync`, `asyncTransactionWaitMillis` default 50 ms ([high-frequency](https://www.ag-grid.com/react-data-grid/data-update-high-frequency/)) | Per-cell re-render during paste/fill/bulk edit | Low–Medium | **H** — paste, fill-down, bulk edit |
| Change detection: refresh only cells whose value changed (`===`, custom `equals`) | AG Grid: "Slowness comes when the DOM is updated many times" ([change-detection](https://www.ag-grid.com/react-data-grid/change-detection/)) | Whole-table re-render on one edit | Medium in React: per-cell memo + fine-grained store selectors | **H** — edit INP |
| Value cache for computed/formatted values | AG Grid `valueCache` (full invalidation on any data change) ([value-cache](https://www.ag-grid.com/react-data-grid/value-cache/)) | Repeated formatter/getter cost on scroll | Low | **M** |
| Formatter over renderer; no heavy components per cell | AG Grid ([scrolling-performance](https://www.ag-grid.com/react-data-grid/scrolling-performance/)) | DOM + CPU per cell | Low–Medium | **H** — audit cell components (tooltips, popovers, icons mounted per cell) |
| Defer expensive renderers while scrolling (skeleton until stop) | AG Grid `deferRender` ([scrolling-performance](https://www.ag-grid.com/react-data-grid/scrolling-performance/)); TanStack `isScrolling` | Heavy cells during fast scroll | Low–Medium | **M** |
| Avoid per-cell config callbacks evaluated every render | HT `cells` warning ([performance](https://handsontable.com/docs/react-data-grid/performance/)); HT `columns()` memo 26M→25k calls (HT-blog) | Hidden O(rows x cols) per render | Low | **H** — grep for per-cell `getCellProps`/closures |
| Lazy per-cell metadata; no eager O(rows x cols) allocation | HT 18 (HT-blog) | Heap, init time | Low–Medium | **H** — check annotations/validation state maps |
| Pre-compute sort keys (parse dates/numbers once) | HT 18 date sort 5.2 s → 1.1 s (HT-blog) | Sort latency | Low | **H** if client-side sort |
| Linear-time bulk ops (no `splice`/`indexOf` in loops) | HT 18 row removal ~10,000x (HT-blog) | Super-linear bulk edits | Low | **H** — static audit |
| Column widths as CSS variables on the table root | TanStack Table resize guide ([column-resizing](https://github.com/tanstack/table/blob/main/docs/framework/react/guide/column-resizing.md)) | Every cell re-rendering on resize drag | Low | **H** |
| Stable `data`/`columns` references | TanStack Table ([data guide](https://github.com/tanstack/table/blob/main/docs/guide/data.md)) | Full recompute on every parent render | Trivial | **H** |
| CSS containment (`contain: strict/content`) on cells/rows; `content-visibility: auto` for off-screen grids | [MDN contain](https://developer.mozilla.org/en-US/docs/Web/CSS/contain); AG Grid `enableContentVisibilityAuto` ([scrolling-performance](https://www.ag-grid.com/react-data-grid/scrolling-performance/)) | Layout/paint scope | Low | **H** (contain), **M** (content-visibility for drawer sub-tables) |
| Composite-only scroll path (transform, no layout props) | [web.dev rendering-performance](https://web.dev/articles/rendering-performance) | Paint/layout per frame | Low | **H** |
| Disable row hover highlight / animations | AG Grid `suppressRowHoverHighlight` ([scrolling-performance](https://www.ag-grid.com/react-data-grid/scrolling-performance/)); HT CSS tip | Style recalc on mousemove | Trivial | **M** — hover is a UX feature; measure first |
| Native scroll (don't emulate scrolling in JS) | LyteNyte ([1771](https://www.1771technologies.com/blog/performance-benchmarks)); Glide ([repo](https://github.com/glideapps/glide-data-grid)) | Main-thread-bound scroll | — | **H** — keep native |
| Canvas rendering | Glide ("virtualized DOM … loading/unloading hundreds of elements per frame" is the bottleneck) ([repo](https://github.com/glideapps/glide-data-grid)) | DOM cost entirely | Rewrite; a11y weaker (maintainers admit gaps); custom editors harder | **L** — not for us |
| Web components + VNode smart rendering | RevoGrid (StencilJS; no published numbers) ([repo](https://github.com/revolist/revogrid)) | — | Rewrite | **L** |
| Render cap safety valve | AG Grid max 500 rows unless `suppressMaxRenderedRowRestriction` ([dom-virtualisation](https://www.ag-grid.com/react-data-grid/dom-virtualisation/)) | Accidental "render all" | Trivial | **M** |
| Pagination | HT tip ([performance](https://handsontable.com/docs/react-data-grid/performance/)) | — | — | **L** — conflicts with density/spreadsheet feel |

---

## 3. Benchmark methodology

### 3.1 Metrics that matter for an editable grid

| Metric | Why | How to measure reliably |
|--------|-----|-------------------------|
| **Initial render** (mount → first grid paint with data) | HT's 3,444 → 110 ms headline (HT-blog) | `performance.mark` at mount start + in a `requestAnimationFrame`→`setTimeout(0)` after data commit (≈ next paint), or trace from click to Paint end as js-framework-benchmark does ([repo](https://github.com/krausest/js-framework-benchmark)) |
| **Scroll frame times**: p50 / p95 / p99, dropped-frame %, not just mean FPS | Mean FPS hides spikes; rAF cadence is capped by display refresh (1771 on a 60 Hz panel) so a fast grid saturates at 60 ([1771](https://www.1771technologies.com/blog/performance-benchmarks)) | Chrome trace `AnimationFrame` events (1771 method, [repo](https://github.com/1771-Technologies/react-data-grid-benchmarking)) or in-page rAF delta array; count frames > 16.7 ms and > 33 ms; DevTools Frames track classifies dropped / partially presented ([DevTools reference](https://developer.chrome.com/docs/devtools/performance/reference)); frame budget is ~10 ms of app work per 16.66 ms frame ([web.dev](https://web.dev/articles/rendering-performance)) |
| **Long Animation Frames** during scroll/edit | Attributes jank to scripts + forced layout | `PerformanceObserver({type:'long-animation-frame', buffered:true})`; fields `duration`, `blockingDuration`, `renderStart`, `styleAndLayoutStart`, `scripts[].forcedStyleAndLayoutDuration`/`invoker`/`sourceURL`; threshold 50 ms; Chrome 123+ ([LoAF](https://developer.chrome.com/docs/web-platform/long-animation-frames)) |
| **Time-to-edit / INP** (keypress/click → next paint): open editor, commit edit, move selection, Ctrl+End | Staff edit constantly; HT keypress 92 → 1.9 ms (HT-blog) | Event Timing API: `observe({type:'event', durationThreshold:16, buffered:true})`; phases = input delay `processingStart-startTime`, processing `processingEnd-processingStart`, presentation remainder; `duration` rounded to 8 ms ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming)). INP good ≤ 200 ms, poor > 500 ms ([web.dev INP](https://web.dev/articles/inp)). For sub-8 ms resolution use trace or mark→double-rAF |
| **Sort / filter latency** | 1771 times interaction → final frame commit, completion by asserting cell values ([repo](https://github.com/1771-Technologies/react-data-grid-benchmarking)) | Assert a known cell value, not a spinner disappearing |
| **Bulk ops**: paste N cells, fill-down, delete N rows, full data replace | HT's 280x / 10,000x wins were all here (HT-blog); js-framework-benchmark "replace all", "partial update every 10th row" ([repo](https://github.com/krausest/js-framework-benchmark)) | Same as sort; also count React commits |
| **Memory**: JS heap after forced GC; detached nodes | HT's 2.4M detached nodes (HT-blog); 1771 `JSHeapUsedSize` after forced major GC ([1771](https://www.1771technologies.com/blog/performance-benchmarks)) | CDP `HeapProfiler.collectGarbage` then `Performance.getMetrics` → `JSHeapUsedSize`; heap snapshot for detached nodes; measure **after** scrolling end-to-end, not just after mount |
| **DOM node count** & **structural mutations per scroll** | Density ⇒ many cells; HT's "0 insertions/removals over 120-step scroll" (HT-blog) | `Performance.getMetrics` → `Nodes`; `MutationObserver` counting `childList` adds/removes during scripted scroll |
| **Layout / style recalc counts & durations** | HT 185 → 57 layout passes (HT-blog) | `Performance.getMetrics` delta: `LayoutCount`, `RecalcStyleCount`, `LayoutDuration`, `RecalcStyleDuration`, `ScriptDuration`, `TaskDuration` ([metrics list](https://groups.google.com/g/google-chrome-developer-tools/c/_I4NfZCOK80), [chromedp cdproto](https://github.com/chromedp/cdproto/blob/master/performance/performance.go)) |
| **React commit / re-render counts** per interaction | Catches "one edit re-renders every cell" | `<Profiler onRender>` (`phase`, `actualDuration`, `baseDuration`, `commitTime`); disabled in prod builds unless a profiling build is used ([react.dev](https://react.dev/reference/react/Profiler)). Use counts as a diagnostic, timings from a prod build |

### 3.2 Reproducibility rules
- **Production build only**; dev React skews everything (AG Grid: "Test in React Production Mode" [scrolling-performance](https://www.ag-grid.com/react-data-grid/scrolling-performance/)). Profiler counts need a separate profiling build ([react.dev](https://react.dev/reference/react/Profiler)).
- **Headed Chrome with GPU** (HT and 1771 both headed). Headless Chromium on macOS rasterises in software, so frame numbers are not representative ([Krämer](https://michelkraemer.com/enable-gpu-for-slow-playwright-tests-in-headless-mode/), [testdino](https://github.com/testdino-hq/playwright-skill/blob/main/core/performance-testing.md)).
- **Warm-ups + N runs + robust stats**: 5 warm-ups, 20–50 runs, trim 5% tails (HT-blog, [1771](https://www.1771technologies.com/blog/performance-benchmarks)); js-framework-benchmark reports mean, median, stddev, weighted geometric mean and varies warm-ups per op ([repo](https://github.com/krausest/js-framework-benchmark)). Report median + p95 + spread; fail CI on regressions beyond noise, not a single-run delta.
- **Fresh browser per grid per iteration** (HT-blog) and 1 s cooldown between runs ([1771](https://www.1771technologies.com/blog/performance-benchmarks)).
- **Forced GC before memory reads** ([1771](https://www.1771technologies.com/blog/performance-benchmarks)).
- **CPU throttling** (`Emulation.setCPUThrottlingRate`, rate 4 = 4x slower) to approximate office laptops and amplify regressions ([testdino](https://github.com/testdino-hq/playwright-skill/blob/main/core/performance-testing.md)); throttling is relative to the host CPU — record host + Chrome version with every result ([DevTools reference](https://developer.chrome.com/docs/devtools/performance/reference)). Chromium-only (CDP) ([testdino](https://github.com/testdino-hq/playwright-skill/blob/main/core/performance-testing.md)).
- **Seeded, precomputed data**; identical renderers across variants; fixed viewport (1771: 1920x1080 grid, 20 px rows) ([repo](https://github.com/1771-Technologies/react-data-grid-benchmarking)).
- **Deterministic scroll driver**: fixed px step per rAF (1771: 500 px `scrollBy` per rAF) ([1771](https://www.1771technologies.com/blog/performance-benchmarks)); also a fling/jump case (drag scrollbar to end) since that exercises offset math.
- **Keep traces** as artifacts (1771 writes `traces/`) so a regression can be diagnosed after the fact ([repo](https://github.com/1771-Technologies/react-data-grid-benchmarking)).

### 3.3 Pitfalls that make numbers lie
1. **FPS saturates at refresh rate** — a 60 Hz display caps rAF cadence, so "60 FPS" hides headroom and hides differences between good variants; uncapping flags (`--disable-gpu-vsync --disable-frame-rate-limit`) are unreliable in current Chrome ([gist](https://gist.github.com/brunosimon/c15e7451a802fa8e34c0678620022f7d), [dev.to](https://dev.to/shadowdecoy/comment/152ig)). Use frame *work* time (script+style+layout per frame from trace / LoAF) and p95, not mean FPS.
2. **Mean FPS hides jank** — use p95/p99 frame time and dropped-frame count (DevTools frame classes: dropped vs partially presented) ([DevTools reference](https://developer.chrome.com/docs/devtools/performance/reference)).
3. **Overscan / buffer differences** make cross-config comparisons unfair — 1771 normalises to 0 ([repo](https://github.com/1771-Technologies/react-data-grid-benchmarking)). For our own before/after, keep it constant and report it.
4. **Blank-cell "fast" scroll** — a grid can hit high FPS by rendering nothing; add a check that the viewport's visible cells contain data at sampled frames (implied by 1771 using `toBeVisible`/value asserts for completion) ([repo](https://github.com/1771-Technologies/react-data-grid-benchmarking)).
5. **Measuring only after mount** misses leaks: HT's 2.4M detached nodes only appeared *after scrolling* (HT-blog). Measure heap and node count after the scroll run.
6. **Event Timing rounds to 8 ms and defaults to ≥104 ms** — set `durationThreshold: 16` and don't compare sub-8 ms differences from it ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming)).
7. **Synthetic uniform data** flatters the grid; HT explicitly warns results depend on data shape, renderers, plugins (HT-blog). Include a "realistic" dataset with our real column types (relations, dates, money, annotations, status pills).
8. **Background tab / occluded window** throttles rAF — keep the benchmark window in the foreground (headed runs) (inferred from 1771's headed choice, [1771](https://www.1771technologies.com/blog/performance-benchmarks)).
9. **Host noise** (other apps, thermal throttling on laptops) — cooldowns, many runs, trimmed stats, and record machine info ([1771](https://www.1771technologies.com/blog/performance-benchmarks)).
10. **Dev-mode React / Profiler overhead** — Profiler adds CPU/memory overhead ([react.dev](https://react.dev/reference/react/Profiler)); never mix profiling-build timings with prod-build timings.

---

## 4. Recommended benchmark scenarios for DynamicTable

Density-first: default fixture = our compact row height, 1920x1080 grid (matches 1771 for comparability) **and** a 1440x900 laptop viewport. Column counts reflect real logistics tables (wide), not toy 10-col tables. Two data profiles: `uniform` (seeded numbers/strings, 1771-style) and `realistic` (our real cell types incl. relation, date, money, select, annotation markers).

| ID | Scenario | Sizes | Primary metrics |
|----|----------|-------|-----------------|
| S1 | Initial render (mount with data) | 1k, 10k, 50k rows x 30 / 100 cols | mount→paint ms, DOM nodes, heap |
| S2 | Vertical scroll, fixed-step (500 px/rAF, top→bottom) | 10k, 50k, 100k rows x 30 / 100 cols | frame p50/p95/p99, dropped %, LoAF count + blockingDuration, Layout/RecalcStyle counts, node insert/remove count, heap after (post-GC) |
| S3 | Vertical jump (drag scrollbar / Ctrl+End / scrollTop to end) | 100k x 30 | time to populated paint |
| S4 | Horizontal scroll (left→right) | 10k rows x 100 / 300 cols | same as S2 |
| S5 | Diagonal scroll with pinned first cols + header | 10k x 100 | same as S2 |
| S6 | Keyboard navigation: 200 arrow-downs, 50 tab-rights, Ctrl+End | 10k & 100k x 30 | per-key INP (event timing + trace), commits per key |
| S7 | Cell edit: open editor → type → commit (Enter), for text, number, date, select, relation | 10k x 30 | open-editor latency, commit→paint latency, **React commits & rendered cells per edit** (should be O(1) cells) |
| S8 | Paste block (1x1000, 10x100, 30x100) | 10k x 30, with and without active filter | total latency, commits, LoAF |
| S9 | Fill-down / bulk edit 1,000 cells | 10k x 30 | total latency, commits |
| S10 | Insert / delete rows (1, 100, 1,000) | 10k & 100k | latency |
| S11 | Sort (string, number, date column) | 10k, 50k, 100k | click→sorted-value-visible ms |
| S12 | Filter (quick filter typing, per-character) | 10k, 50k, 100k | per-keystroke INP, final latency |
| S13 | Full data replace (refetch), 50 cycles (1771 cell-updates analogue) | 1k x 30 | FPS/frame p95, heap growth across cycles (leak check) |
| S14 | Column resize drag, column reorder | 10k x 100 | frame p95, commits per drag frame |
| S15 | Soak / leak: S2 x 10 then heap snapshot | 50k x 100 | detached DOM nodes, heap delta vs S1 |

Run matrix: each scenario x {CPU 1x, CPU 4x}; 5 warm-ups (skip for S1, per js-framework-benchmark cold ops), 20 measured runs, fresh browser context per run, trimmed-mean + median + p95 reported; record host, Chrome version, commit sha; keep one trace per scenario.

Targets to start from (derived from sources): scroll frame work ≤ ~10 ms (web.dev budget); INP per edit/keypress ≪ 200 ms, aim < 50 ms (web.dev INP, LoAF 50 ms threshold); **flat curve** across row counts for scroll & keyboard nav (HT-blog's headline property); 0 structural DOM mutations during pure scroll is the HT reference (HT-blog).
