/**
 * Placement maths for every portal-rendered dropdown in the grid.
 *
 * Extracted because three of them (`ColumnFilterPopover`, `SelectMenu`,
 * `PerspectiveTabMenu`) had each hand-rolled it, and two of the three got the
 * flip wrong in the same way:
 *
 *     top: flipAbove ? Math.max(8, rect.top - 4) : rect.bottom + 4
 *     ...
 *     transform: flipAbove ? 'translateY(-100%)' : undefined
 *
 * The `Math.max(8, …)` reads like a clamp against the top edge, but the
 * `translateY(-100%)` is applied AFTERWARDS and shifts the panel up by its own
 * full height — so the clamp protects nothing. Measured on the real transport
 * list at a 560px-tall viewport, the column-filter popover landed at
 * `top: -156`, hiding its search box, "Select all" and first two options above
 * the top of the window. A filter you cannot search or select-all in.
 *
 * The fix is not a bigger clamp, it is capping the HEIGHT. `maxHeight` is
 * bounded by the space actually available on the chosen side, which makes
 * `translateY(-100%)` exact and safe: a panel that can never be taller than the
 * gap above the anchor can never be pushed past the top of the viewport. The
 * transform stays because it is self-measuring — it needs no second render pass
 * to learn the panel's real height.
 *
 * Horizontal clamping is unconditional. `SelectMenu` sets `minWidth` (not
 * `width`), so a long option label grows the menu past the trigger; in the
 * Configure View drawer the triggers already sit near the right edge, so the
 * overflow direction is the one that goes off-screen.
 */

export interface AnchoredPlacement {
  /** Viewport coordinate for `position: fixed`. */
  top: number;
  left: number;
  /**
   * Hard cap. Apply it — it is what makes `flipAbove` safe. Panels that would
   * rather scroll than be cut off should pair it with `overflow: auto`.
   */
  maxHeight: number;
  /** True ⇒ the caller must apply `transform: translateY(-100%)`. */
  flipAbove: boolean;
}

export interface AnchoredPositionOptions {
  /** Rendered width of the panel, used for the horizontal clamp. */
  width: number;
  /** Height the panel wants when nothing is in its way. */
  preferredHeight: number;
  /** Which anchor edge the panel's left edge lines up with. */
  align?: 'start' | 'end';
  /** Gap between anchor and panel. */
  gap?: number;
  /** Keep-out band at every viewport edge. */
  margin?: number;
  /**
   * Never shrink below this, even in a very short viewport. A 40px-tall
   * dropdown is not a usable dropdown; better to overlap the anchor slightly
   * and stay operable than to collapse into a sliver.
   */
  minHeight?: number;
}

/**
 * Place a panel against an anchor rect, flipping and clamping so it is always
 * fully inside the viewport.
 *
 * Flips above only when that genuinely buys room: if there is no space either
 * way it stays below, where the clamp still keeps it on screen. Comparing the
 * two sides (rather than "does it fit below? no ⇒ flip") is what stops a menu
 * near the top of the window flipping into the space it hasn't got.
 */
export function computeAnchoredPosition(
  anchor: { top: number; bottom: number; left: number; right: number },
  viewport: { width: number; height: number },
  options: AnchoredPositionOptions,
): AnchoredPlacement {
  const { width, preferredHeight, align = 'start', gap = 4, margin = 8, minHeight = 120 } = options;

  const spaceBelow = viewport.height - anchor.bottom - gap - margin;
  const spaceAbove = anchor.top - gap - margin;

  // Only flip when above is genuinely roomier. `spaceBelow < preferredHeight`
  // alone would flip a panel anchored near the TOP of the window into an even
  // smaller gap — which is exactly how the popover ended up at top: -156.
  const flipAbove = spaceBelow < preferredHeight && spaceAbove > spaceBelow;

  const available = flipAbove ? spaceAbove : spaceBelow;
  // `minHeight` wins over `available` on purpose: in a viewport too short for
  // either side we accept a little overlap rather than an unusable sliver. The
  // horizontal clamp and `overflow: auto` keep it reachable.
  const maxHeight = Math.max(minHeight, Math.min(preferredHeight, available));

  const preferredLeft = align === 'end' ? anchor.right - width : anchor.left;
  const maxLeft = viewport.width - width - margin;
  // `Math.max(margin, …)` last so a panel wider than the viewport pins to the
  // left edge rather than hanging off it on the right.
  const left = Math.max(margin, Math.min(preferredLeft, maxLeft));

  return {
    top: flipAbove ? anchor.top - gap : anchor.bottom + gap,
    left,
    maxHeight,
    flipAbove,
  };
}
