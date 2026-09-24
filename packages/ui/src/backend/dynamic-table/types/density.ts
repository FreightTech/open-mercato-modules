/**
 * DynamicTable density scale — the USER-SETTABLE row/type density preference.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Logistics users read a whole working picture off one screen. The 3 Aug 2026
 * INF workshops recorded the complaint verbatim (A16): "on a normal monitor
 * roughly half the needed columns fit". The same workshops recorded the exact
 * opposite need — two users (Agnieszka, Klaudiusz) work completely differently
 * and both asked for their own defaults, and the product owner has repeatedly
 * flagged FMS tables as "fonts too small".
 *
 * Those two facts do not reconcile into one number. They reconcile into a
 * PREFERENCE. So:
 *
 *   - `comfortable` is the DEFAULT and is pixel-identical to how the grid
 *     renders today. Opting out of the feature is a no-op.
 *   - `compact` and `dense` are opt-in, per user, and persist for that user.
 *   - Nothing here shrinks type globally. There is no global default change.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS AN ATTRIBUTE, NOT A PROP THREADED INTO CELLS
 *
 * The grid virtualizes ROWS ONLY (one `useVirtualizer`, `overscan: 10`, no
 * `horizontal: true`). `VirtualRow` does a plain `columns.map`, so EVERY column
 * of EVERY mounted row renders. Denser tables mount MORE cells, so anything
 * per-cell gets multiplied by thousands.
 *
 * Therefore density is delivered as ONE attribute on the container
 * (`data-density-level`) which flips a block of CSS custom properties consumed
 * by existing selectors in `styles/density.css`. Switching density re-styles
 * the entire grid with:
 *
 *   - zero per-cell React work,
 *   - zero cell re-renders,
 *   - zero extra props threaded through `Cell` / `VirtualRow`.
 *
 * The browser recalculates style for the subtree; React does nothing.
 *
 * THE ONE EXCEPTION, stated honestly: ROW HEIGHT cannot be CSS-only. Rows are
 * absolutely positioned by the virtualizer (`transform: translateY(...)`, plus
 * an inline `height`), so the height must be a number JS knows. That is what
 * `DENSITY_METRICS[level].rowHeight` is for — the virtualizer's `estimateSize`
 * reads it, and `density.css` restates the SAME number for the box model.
 * Changing density therefore costs exactly one virtualizer re-measure, not a
 * per-cell pass. Do NOT try to force row height from CSS with `!important`:
 * it would win over the inline style and immediately desynchronise the fill
 * from the `translateY` offsets, overlapping the rows.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NAMING TRAP — `data-density-level`, NOT `data-density`
 *
 * `data-density` is ALREADY TAKEN. `DynamicTable.tsx` emits it from a legacy
 * DEVELOPER-facing prop (`density?: 'sm' | 'md'` → 36px / 44px rows), and
 * `DynamicTable.v2.css` carries rules keyed on `:not([data-density])` that
 * define part of today's default rendering. Reusing the attribute would
 * silently switch those rules off the moment a user picked `comfortable` —
 * which is precisely the "opting out must be a no-op" guarantee, broken.
 *
 * So this scale uses a distinct attribute. The two are orthogonal today; see
 * the migration note at the bottom of this file.
 */

/**
 * The three density levels, coarsest to tightest — the designer's
 * Roomy / Medium / Tight (gt-demo TableSettingsMenu). Same type at every
 * level; only the row height and cell padding change.
 *
 * - `comfortable` — Roomy, 48px rows.
 * - `compact`     — Medium, 44px rows.
 * - `dense`       — Tight, 34px rows. THE DEFAULT.
 *
 * The ids predate the designer's labels and are persisted, so they stay.
 */
export type DensityLevel = 'comfortable' | 'compact' | 'dense'

/** Every level, in scale order. Safe to render as a picker. */
export const DENSITY_LEVELS: readonly DensityLevel[] = ['comfortable', 'compact', 'dense'] as const

/**
 * The default: Tight. "default działów = Tight" — the designer's decision of
 * 02.09, recorded in the prototype's TableSettingsMenu.
 */
export const DEFAULT_DENSITY: DensityLevel = 'dense'

/**
 * The container attribute that carries the level.
 *
 * Deliberately NOT `data-density` — see the naming trap above.
 */
export const DENSITY_ATTRIBUTE = 'data-density-level' as const

/**
 * Geometry each level needs on the JS side.
 *
 * ONLY the numbers that CSS cannot own live here. Padding, borders, and the
 * type ramp are pure CSS (`styles/density.css`) and are intentionally absent —
 * duplicating them in TS would create two sources of truth for values nothing
 * in JS reads.
 *
 * `rowHeight` MUST equal `--dt-row-height` for the same level in
 * `styles/density.css`. They are asserted equal by the unit test
 * `__tests__/density.test.ts`, which parses the stylesheet.
 */
export type DensityMetrics = {
  /**
   * Data-row height in px, border-box, INCLUDING the inter-row gap borders.
   * Feeds the virtualizer's `estimateSize`.
   */
  rowHeight: number
  /**
   * Column-header row height in px, border-box. `null` = content-driven
   * (`height: auto`), which is what today's grid does — pinning a number for
   * `comfortable` would be a 1–2px visual change, and `comfortable` is not
   * allowed to change anything.
   */
  headerHeight: number | null
}

export const DENSITY_METRICS: Readonly<Record<DensityLevel, DensityMetrics>> = {
  // The designer's scale (gt-demo tokens/material.css): Roomy 48 / Medium 44
  // / Tight 34, Tight the default. Headers stay content-driven at every level.
  comfortable: { rowHeight: 48, headerHeight: null },
  compact: { rowHeight: 44, headerHeight: null },
  dense: { rowHeight: 34, headerHeight: null },
}

/**
 * Narrow an untrusted value (localStorage, an API response, a URL param) to a
 * `DensityLevel`. Pure; no allocation.
 */
export function isDensityLevel(value: unknown): value is DensityLevel {
  return value === 'comfortable' || value === 'compact' || value === 'dense'
}

/**
 * Resolve a density level to the value of the container's density attribute.
 *
 * Pure, total, allocation-free — it returns one of three interned string
 * literals, so it is safe to call inside a render body.
 *
 * TOTAL BY DESIGN: an absent, `null`, or corrupt input (a stale localStorage
 * value, a hand-edited URL param) resolves to `DEFAULT_DENSITY` rather than
 * `null` or a throw. A broken preference must degrade to today's rendering,
 * never to an unstyled or missing grid.
 *
 * NOTE: `comfortable` DOES emit its attribute value rather than dropping the
 * attribute. That is deliberate. Every consuming rule in `density.css` is
 * guarded by `:not([data-density-level="comfortable"])`, so the attribute's
 * presence at the default level changes nothing — and having it always present
 * means the level is inspectable in DevTools and assertable from `GridHarness`
 * without a special "absent means comfortable" case in every test.
 */
export function resolveDensityAttribute(level: DensityLevel | null | undefined): DensityLevel {
  return isDensityLevel(level) ? level : DEFAULT_DENSITY
}

/**
 * Row height for a level. Falls back to the default for unknown input rather
 * than throwing — a corrupt stored preference must never break the grid.
 */
export function resolveDensityRowHeight(level: DensityLevel | null | undefined): number {
  return DENSITY_METRICS[isDensityLevel(level) ? level : DEFAULT_DENSITY].rowHeight
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LEGACY `density?: 'sm' | 'md'` PROP no longer sets the row height:
 * the user's level always does (DynamicTable `dataRowHeight`). It still emits
 * `data-density`, which a few v2 rules key on, and is otherwise inert.
 * ─────────────────────────────────────────────────────────────────────────────
 */
