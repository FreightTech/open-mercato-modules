/**
 * FILL THE CONTAINER — the arithmetic behind "a narrow table has no dead strip
 * to its right".
 *
 * Two regimes, and only two:
 *
 *   declared total  <  container → EXPAND the flexible columns until the row
 *                                  ends exactly at the container's right edge.
 *   declared total  >= container → nothing to do; the grid scrolls horizontally
 *                                  at its declared widths.
 *
 * WHY THIS IS ARITHMETIC AND NOT `width: 100%`.
 *
 * Handing the row to the layout engine (`table { width: 100% }` + `flex-grow`)
 * fills the strip, but a stretched column's PAINTED width stops being its
 * DECLARED width — and column virtualization is built on declared widths: the
 * spacer that stands in for a run of unmounted columns has to be exactly as
 * wide as they would have been, or every mounted column lands at the wrong x.
 * That is why stretching used to force virtualization off, which made "fills
 * the width" and "virtualized" mutually exclusive on the widest lists — the
 * precise complaint this module answers.
 *
 * Resolving the surplus to PIXELS keeps every column's declared width honest,
 * so the spacers stay correct and both properties hold at once.
 *
 * WHAT IS RIGID (never touched):
 *  • pinned / frozen columns and the sticky checkbox + Actions columns — their
 *    widths are load-bearing for `position: sticky` offsets;
 *  • any column the user has resized by hand. Their number is their answer;
 *    growing it would silently overrule them.
 */

export interface ColumnFillInput {
  /** DECLARED width of every column, in view order. Never a painted width. */
  widths: readonly number[];
  /** Indices that must keep their declared width exactly. */
  rigid: ReadonlySet<number>;
  /** Row furniture outside `widths`: the row-header gutter + Actions column. */
  furnitureWidth: number;
  /** The scroll container's inner width (`clientWidth`). */
  containerWidth: number;
}

/**
 * Surplus pixels per column index. Only positive entries appear; an empty map
 * means "declared widths already fill (or overflow) the container".
 */
export function computeColumnFill({
  widths,
  rigid,
  furnitureWidth,
  containerWidth,
}: ColumnFillInput): Map<number, number> {
  const result = new Map<number, number>();
  if (!(containerWidth > 0) || widths.length === 0) return result;

  let declaredTotal = furnitureWidth;
  for (const w of widths) declaredTotal += w;

  // Floor the container: a fractional target would leave a sub-pixel sliver of
  // dead strip or provoke a 1px horizontal scrollbar, and both read as a bug.
  const surplus = Math.floor(containerWidth) - declaredTotal;
  if (surplus < 1) return result;

  const flexible: number[] = [];
  let flexibleTotal = 0;
  for (let i = 0; i < widths.length; i++) {
    if (rigid.has(i)) continue;
    flexible.push(i);
    flexibleTotal += widths[i];
  }
  // Every column is pinned or hand-sized: there is nothing we are allowed to
  // grow, so the strip stays. Deliberate — the alternative is overruling the
  // user's own widths to win back some pixels.
  if (flexible.length === 0 || flexibleTotal <= 0) return result;

  // Proportional to declared width, so a wide description column takes more of
  // the surplus than a narrow date one and the row keeps its rhythm.
  let assigned = 0;
  for (let n = 0; n < flexible.length - 1; n++) {
    const idx = flexible[n];
    const extra = Math.floor((surplus * widths[idx]) / flexibleTotal);
    if (extra > 0) result.set(idx, extra);
    assigned += extra;
  }
  // The last flexible column absorbs the rounding remainder, so the row lands
  // on the container's edge to the pixel rather than 1–3px short of it.
  const last = flexible[flexible.length - 1];
  const remainder = surplus - assigned;
  if (remainder > 0) result.set(last, remainder);

  return result;
}
