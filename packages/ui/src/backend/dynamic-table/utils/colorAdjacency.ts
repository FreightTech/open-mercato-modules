import type { ColumnDef } from '../types/index';
import type { AnnotationMap } from '../hooks/useAnnotations';

/**
 * Colour-block adjacency — the MODEL replacement for anchor Defect 7.
 *
 * A 2-D block of same-coloured annotated cells must read as ONE shape: rounded
 * only on its outer corners, with the inter-row gap painted through. CSS cannot
 * see across `<tr>`s, so each cell is told about its four neighbours via
 * `data-cb-{above,below,left,right}`.
 *
 * The old implementation discovered those neighbours by running
 * `querySelectorAll('td.hot-cell[...][class*="cell-color-"]')` over the grid on
 * every scroll event and comparing `data-row` / `data-col`. That is wrong twice:
 *
 *  1. It can only see MOUNTED cells. The row virtualizer already made the top
 *    and bottom rows of the window falsely report "no neighbour"; column
 *    virtualization adds the same lie on the left/right edges, mid-block, where
 *    users see it — a painted gap and a rounded corner in the middle of a
 *    colour run, moving as you scroll.
 *  2. It ran a full-grid DOM query inside the scroll handler, at the moment the
 *    browser is already committing a frame.
 *
 * Throttling would fix neither. Adjacency is a fact about the DATA, so it is
 * computed here from the annotation map, the row order and the column order,
 * and passed down as props (range-operation contract rule 7: an unmounted
 * neighbour is still a neighbour).
 *
 * Vertical adjacency is by DATA row index (`row ± 1`), which is what the DOM
 * scan compared too — a group header rendered between two data rows does not
 * break a colour block.
 */

export interface ColorAdjacency {
  above: boolean;
  below: boolean;
  left: boolean;
  right: boolean;
}

export const NO_COLOR_ADJACENCY: ColorAdjacency = {
  above: false,
  below: false,
  left: false,
  right: false,
};

/**
 * @param color       This cell's annotation colour (`null`/`undefined` = uncoloured).
 * @param row         Data row index.
 * @param col         Index into the FULL view-order column array.
 * @param cols        The full view-order column array — never a virtualization window.
 * @param annotations Map keyed `"<entityType>:<rowId>:<columnKey>"`.
 * @param keyAt       Builds that key for a (data row index, column). Returns
 *                    `null` when the cell has no annotation target — a row that
 *                    does not exist, or a column outside the scope. Supplied by
 *                    the grid so adjacency uses the SAME target resolver the
 *                    fetch and the dialog use (workshop B8a).
 */
export function computeColorAdjacency(
  color: string | null | undefined,
  row: number,
  col: number,
  cols: ColumnDef[],
  annotations: AnnotationMap | undefined,
  keyAt: (row: number, column: ColumnDef) => string | null,
): ColorAdjacency {
  // An uncoloured cell has no block to join, so it never needs the four
  // attributes. Bailing here keeps the whole thing free for the overwhelming
  // majority of cells.
  if (!color || !annotations || annotations.size === 0) return NO_COLOR_ADJACENCY;

  const sameColorAt = (r: number, c: number): boolean => {
    const column = cols[c];
    if (!column) return false;
    const key = keyAt(r, column);
    if (key == null) return false;
    return annotations.get(key)?.color === color;
  };

  return {
    above: sameColorAt(row - 1, col),
    below: sameColorAt(row + 1, col),
    left: sameColorAt(row, col - 1),
    right: sameColorAt(row, col + 1),
  };
}
