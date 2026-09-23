# DynamicTable performance — experiment ledger

Every hypothesis, kept or rejected, with the A/B that decided it. Results JSON
in `results/<label>.{base,head}.json`. Numbers are medians of 5 interleaved
runs at 4x CPU throttle unless stated. "style/frame" etc. = main-thread ms per
fast-scroll frame from Chrome's own counters.

| # | Hypothesis | Change | Verdict | Evidence (label) |
|---|---|---|---|---|
| 1 | Container-level `:has(.hot-toolbar/.hot-card)` invalidates style on every row insert | data-has-toolbar / data-has-card attributes | **KEPT** (a1b75a8) — style/frame −20–21%, slow-scroll dropped frames −26–34%, pixel-identical | `css-has` |
| 2 | Keying rows by data index = full mount per row entering the viewport; recycle slots (`index % pool`) like Handsontable | slot keys in the non-grouped row map | **REJECTED** — 0 better / 12 worse: slow scroll 22.9 → 48.3 ms/frame, style +50%, layout +46%. A recycled row re-renders ALL its cells with new `row` props (every attribute + text rewritten, cell subscriptions re-bound) which costs more than mounting the 2 genuinely new rows. Don't retry without first making a row-prop change cheap. | `row-recycle` |
| 3 | Horizontal pan re-renders every mounted row once per column crossing the edge; quantise the column range to 4-column blocks | `quantizeColumnRange` in useColumnVirtualizer | **REJECTED as a trade** — app-transport scrollX 24.2 → 14.6 ms/frame (−39%), dropped 88 → 34, BUT +17% DOM nodes (always mounts up to 3 extra columns per side) → vertical style/layout +12%. Violates "never trade density budget". Superseded by #4. | `colwin-q4` |
| 4 | Same as #3 but TRUE hysteresis: hold the window while the visible columns stay inside its overscan margin; rebuild only on escape — no extra columns ever mounted | `holdColumnRange` in useColumnVirtualizer | **KEPT** — app-transport scrollX 24.2 → 12.8 ms/frame (−47%), dropped 88 → 26 (−70%); DOM nodes, vertical scroll, blank frames unchanged. 3 better / 0 worse. 1796 unit tests green. | `colwin-hold` |
| 5 | Every arrow key re-renders all ~29 mounted rows because `VirtualRow` subscribes to the whole selection (it only needs its own row-range slice) | `useRowRangeState(row)` returns a primitive; rows whose slice is unchanged bail out | **KEPT** — script per key press, 100x30: ArrowDown 8.3 → 5.0 ms (−40%), ArrowRight 7.9 → 3.1 ms (−60%); 0 worse. First judged on Event-Timing p95 and looked like a no-op: that metric is quantised and, with ~16 reported events, is just the max — `scriptMsPerPress` was added to the bench because of this. | `row-range-slice2` |
| 6 | ArrowRight rebuilds the column window on every press: the caret column is always in `forcedIndices`, and the window memo keyed on the raw list — even when the caret is inside the mounted range | force only columns OUTSIDE (range ± overscan) | **KEPT** — app-transport ArrowRight script/press 15.7 → 9.8 ms (−37.5%), task/press 31.1 → 24.6 ms (−21%); 0 worse. Regression test pins window identity. | `forced-outside` |

## Diagnostic facts (not experiments)
- Column virtualisation is decisive at 120 cols: vertical fast scroll 168 → 38 ms/frame, heap 19.5 → 9.3 MB, DOM 9.7k → 1.4k nodes. Frozen columns cost little. (`diag-x120`)
- Horizontal scroll WITH column virtualisation: ~29 ms/frame, ~2 React commits/frame vs ~6 ms and 5 commits total without it. (`diag-x120`)
- All scroll-time React work enters via TanStack Virtual `onChange → flushSync` (range change). Scheduler-task commits ≈ 5%. (`perf/why-render.mjs` on the profiles)

## Cumulative (branch head vs original main)
`cumulative-1` — 7e4ee1b vs 8da590f, all 5 workloads, 5 interleaved runs, 4x CPU: **31 better, 0 worse**.
Highlights: app-transport horizontal pan 36.7 → 16.1 ms/frame (−56%, dropped 169 → 46); arrow-key script per press −45…−68% on every shape; 100x80 slow scroll 47.4 → 30.1 ms/frame (−36%); fast-scroll style recalc −15…−27%. DOM nodes and heap unchanged — no density traded.

## Merged with split-view (dynamictables-split-view)
`merged-split-view` — 6355150 vs a4ccc44 (100x30, 100x80, app-transport; 5 interleaved runs): **0 better, 0 worse, no page errors** — the split-view work (Cell null guard, SearchBar initialValue, zebra/display host) is performance-neutral on the grid.
