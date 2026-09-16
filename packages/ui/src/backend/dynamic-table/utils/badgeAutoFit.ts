import type { ColumnDef } from '../types/index';

/**
 * Badge auto-fit — the MODEL half.
 *
 * Status/type pills must never be clipped (unlike text, which ellipses), so a
 * badge column grows to fit its widest pill. The measurement itself has to
 * touch the DOM — a consumer's custom renderer can emit any label it likes, so
 * there is no string in the model to measure — but the *decision* must not.
 *
 * Why this module exists (anchor Defect 6 / range-operation contract rule 6):
 * the original effect compared `badge.scrollWidth` against `td.clientWidth` and
 * wrote `store.setColumnWidth` for whatever happened to be mounted. Two things
 * are wrong with that under column virtualization:
 *
 *  1. It is *geometry-coupled*: the answer depended on how wide the cell
 *     currently is, so widening a column could change what the next pass
 *     decided — a column widening as it scrolls into view shifts every later
 *     offset, changes the mounted window, and mounts another badge column.
 *     That is a scroll-coupled layout feedback loop, and it visibly jitters.
 *  2. It was *index-keyed and mount-scoped*: a column that was not mounted had
 *     no fit at all, and a perspective reorder moved a fitted width onto a
 *     different column.
 *
 * The fix, in two halves:
 *
 *  - Measurement is INTRINSIC and one-shot per pill: `badge.scrollWidth` is the
 *    pill's own content width, which does not depend on the cell's width, the
 *    scroll position or the mounted window. It is never re-derived from the
 *    column's current width.
 *  - The result is cached by the STABLE `col.data` key (never the index, same
 *    rule as `frozenColumns` and width persistence) and re-applied to whatever
 *    index that key currently occupies. So `store.getColumnWidth(i)` answers
 *    for every `i`, mounted or not, and survives reorder/hide/show.
 *
 * The cache is grow-only, which makes the whole thing idempotent: a column that
 * is already wide enough produces no write, so no write can trigger another
 * measurement pass.
 */

/** Hard cap so one freak value cannot blow out the layout. */
export const BADGE_FIT_MAX_WIDTH = 360;

/**
 * Horizontal padding to reserve around a pill. A commented cell keeps 28px on
 * the right for the comment indicator; without counting that the column fits
 * the pill alone and the pill ends up sitting under the icon.
 */
export const BADGE_FIT_PADDING = 16;
export const BADGE_FIT_PADDING_WITH_COMMENT = 36;

/**
 * Stored width that shows a pill of `contentWidth` in full: intrinsic content
 * + padding + a 2px buffer, capped. Depends on nothing but the pill itself —
 * no cell width, no scroll offset, no mounted window.
 */
export function badgeFitWidth(contentWidth: number, hasComment: boolean): number {
  const pad = hasComment ? BADGE_FIT_PADDING_WITH_COMMENT : BADGE_FIT_PADDING;
  return Math.min(Math.ceil(contentWidth) + pad + 2, BADGE_FIT_MAX_WIDTH);
}

/**
 * Record a measurement against the stable column key, grow-only.
 * Returns true when the cache actually changed.
 */
export function recordBadgeFit(
  cache: Map<string, number>,
  columnKey: string,
  width: number,
): boolean {
  if (!Number.isFinite(width) || width <= 0) return false;
  const current = cache.get(columnKey);
  if (current != null && current >= width) return false;
  cache.set(columnKey, width);
  return true;
}

export interface BadgeWidthWrite {
  /** Index into the CURRENT view-order column array. */
  col: number;
  width: number;
}

/**
 * Turn the key-keyed cache into the set of width writes to apply, for the
 * column order as it stands now. Every cached key is considered — including
 * columns that are not mounted — so a fitted width follows its column through
 * a reorder and is already correct when the column scrolls back into view.
 *
 * Grow-only, and never fights a width the user set by hand.
 */
export function planBadgeWidths(
  cache: Map<string, number>,
  cols: ColumnDef[],
  getColumnWidth: (col: number) => number,
  isUserResized: (col: number) => boolean,
): BadgeWidthWrite[] {
  if (cache.size === 0) return [];
  const writes: BadgeWidthWrite[] = [];
  for (let col = 0; col < cols.length; col++) {
    const fit = cache.get(cols[col].data);
    if (fit == null) continue;
    if (isUserResized(col)) continue;
    if (getColumnWidth(col) >= fit) continue;
    writes.push({ col, width: fit });
  }
  return writes;
}
