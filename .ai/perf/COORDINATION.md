# DynamicTable performance — coordination board

Two agents work on this. Claim a row before you start it; mark done with the result.
Branch: `dynamictables-performance` in BOTH repos
(`open-mercato-modules` = DynamicTable source, `freight-management-system` = host app).

| # | Work item | Owner | Status |
|---|-----------|-------|--------|
| 1 | Research: Handsontable perf approach (blog, docs via context7) + other grids (AG Grid, Glide, TanStack Virtual, RevoGrid) → `.ai/perf/research.md` | fms-20 (subagent) | done |
| 2 | Code audit: DynamicTable render path, virtualization, memo boundaries, store subscriptions → `.ai/perf/audit.md` | fms-20 | in progress |
| 3 | Benchmark framework: synthetic-data fixture page + Playwright/CDP runner, scenarios, metrics, JSON results, baseline compare → `packages/ui/perf/` | fms-20 | runner done; compare.mjs + baseline in progress |
| 4 | Baseline run + first optimisation loop | unclaimed | — |
| 5 | Split view / widget workspace iteration (designer recording + Figma): grid overflow, no-loss grid switch, rename/share/default layouts, per-widget settings, table display toggles, widget styling. Worktree `../open-mercato-modules-splitview`, branch `dynamictables-split-view`; merges into `dynamictables-performance` before PR | fms-email | in progress |

## Rules
- Every optimisation lands with a before/after benchmark result in `.ai/perf/results/`. No numbers, no merge.
- Density is non-negotiable: never trade rows-per-screen for speed.
- Browser work: `agent-browser` CLI only.
- Don't edit a file another agent has claimed here without messaging them first.

## Findings log (newest last)
- 2026-09-23 fms-20 — first numbers, 100x30 @ 4x CPU: fast vertical scroll ≈ 60 ms main-thread per frame (budget 16.7): script 22, **style recalc 16**, layout 6. Horizontal scroll ≈ 2 ms/frame (fine). ~2 React commits per scroll frame. Rows are keyed by row index → every row entering the viewport is a full mount (30 cells + subscriptions).
- Suspects, to be tested one at a time with the bench: (a) container-level `:has()` selectors in DynamicTable.v2.css (`.hot-container:has(.hot-card)`, `:not(:has(.hot-toolbar))`) invalidating style on every row insert; (b) row mount/unmount instead of recycling; (c) 2 commits/frame; (d) whole DynamicTable re-render per scroll frame.

## Planned edits to shared files (announce here BEFORE editing)
- fms-20: `styles/DynamicTable.v2.css`, `styles/density.css` — replace container-level `:has()` with data attributes set from React (suspect a). Pending measurement.
- 2026-09-23 fms-20 — **framework calibrated**: A/A run (HEAD vs identical tree, interleaved) → 0 better / 0 worse at load avg 14. Continuous metrics (`*.taskMsPerFrame`) are stable to ±2–5%; `keyNav.p95` is coarse (8 ms Event-Timing quantisation) — treat as indicative only.
- New hot spot: `app-transport` (120 cols, 2 frozen, column virtualisation ON — how FMS configures transport/folder/invoice) — **horizontal scroll ≈ 34 ms/frame, 163/180 frames dropped; keyNav p95 ≈ 96 ms**. The non-virtualised 30-col table scrolls horizontally at ≈ 2 ms/frame. Suspect: every column-window change re-renders all mounted rows.
- 2026-09-23 fms-20 — experiment ledger started: `.ai/perf/EXPERIMENTS.md` (kept AND rejected hypotheses with evidence). Row recycling (slot keys) measured and REJECTED (12 worse). Render counters: vertical scroll memo holds (only entering rows render); horizontal pan with column virtualisation re-renders ALL mounted rows every frame. Now testing column-window hysteresis (hooks/useColumnVirtualizer.ts).
