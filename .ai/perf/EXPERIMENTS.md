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

## Diagnostic facts (not experiments)
- Column virtualisation is decisive at 120 cols: vertical fast scroll 168 → 38 ms/frame, heap 19.5 → 9.3 MB, DOM 9.7k → 1.4k nodes. Frozen columns cost little. (`diag-x120`)
- Horizontal scroll WITH column virtualisation: ~29 ms/frame, ~2 React commits/frame vs ~6 ms and 5 commits total without it. (`diag-x120`)
- All scroll-time React work enters via TanStack Virtual `onChange → flushSync` (range change). Scheduler-task commits ≈ 5%. (`perf/why-render.mjs` on the profiles)
