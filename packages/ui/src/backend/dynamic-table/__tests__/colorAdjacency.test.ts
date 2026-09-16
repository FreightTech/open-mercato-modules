import { computeColorAdjacency, NO_COLOR_ADJACENCY } from '../utils/colorAdjacency'
import type { AnnotationMap } from '../hooks/useAnnotations'
import type { ColumnDef } from '../types/index'

/**
 * Anchor Defect 7 — colour-block adjacency must be MODEL-driven.
 *
 * The old implementation built its neighbour map from `querySelectorAll` over
 * the rendered cells, on every scroll event. Under row virtualization that
 * already lied at the top and bottom of the mounted window; column
 * virtualization adds the same lie mid-block on the left and right, where users
 * see it — a rounded corner and a painted gap in the middle of a colour run,
 * moving as you scroll. Throttling would not have fixed it.
 *
 * The decisive test below is "an UNMOUNTED neighbour is still a neighbour":
 * these functions never touch the DOM, so mounting cannot change the answer.
 */

const cols: ColumnDef[] = [
  { data: 'a' },
  { data: 'b' },
  { data: 'c' },
]

const rowIds = ['r0', 'r1', 'r2']
/**
 * The key builder the grid supplies (workshop B8a). Returning `null` for a row
 * that does not exist is what makes an out-of-range neighbour a non-neighbour.
 */
const getRowId = (row: number, column: ColumnDef): string | null =>
  rowIds[row] == null ? null : `unit:${rowIds[row]}:${column.data}`

function annotate(entries: Array<[number, number, string]>): AnnotationMap {
  const map: AnnotationMap = new Map()
  for (const [row, col, color] of entries) {
    map.set(`unit:${rowIds[row]}:${cols[col].data}`, {
      id: `${row}-${col}`,
      color,
      commentCount: 0,
      comments: [],
      assignees: [],
    })
  }
  return map
}

describe('computeColorAdjacency', () => {
  it('reports nothing for an uncoloured cell', () => {
    const map = annotate([[0, 0, 'yellow']])
    expect(computeColorAdjacency(null, 1, 1, cols, map, getRowId)).toBe(NO_COLOR_ADJACENCY)
    expect(computeColorAdjacency(undefined, 1, 1, cols, map, getRowId)).toBe(NO_COLOR_ADJACENCY)
  })

  it('reports nothing when there are no annotations at all', () => {
    expect(computeColorAdjacency('yellow', 1, 1, cols, undefined, getRowId)).toBe(
      NO_COLOR_ADJACENCY,
    )
    expect(computeColorAdjacency('yellow', 1, 1, cols, new Map(), getRowId)).toBe(
      NO_COLOR_ADJACENCY,
    )
  })

  it('finds a vertical neighbour of the same colour', () => {
    const map = annotate([
      [0, 1, 'yellow'],
      [1, 1, 'yellow'],
    ])
    expect(computeColorAdjacency('yellow', 1, 1, cols, map, getRowId)).toEqual({
      above: true,
      below: false,
      left: false,
      right: false,
    })
  })

  it('finds a horizontal neighbour of the same colour', () => {
    const map = annotate([
      [1, 0, 'yellow'],
      [1, 1, 'yellow'],
      [1, 2, 'yellow'],
    ])
    expect(computeColorAdjacency('yellow', 1, 1, cols, map, getRowId)).toEqual({
      above: false,
      below: false,
      left: true,
      right: true,
    })
  })

  it('does NOT join a neighbour of a different colour', () => {
    const map = annotate([
      [1, 0, 'green'],
      [1, 1, 'yellow'],
    ])
    expect(computeColorAdjacency('yellow', 1, 1, cols, map, getRowId).left).toBe(false)
  })

  it('treats the grid edges as having no neighbour', () => {
    const map = annotate([
      [0, 0, 'yellow'],
      [0, 1, 'yellow'],
      [1, 0, 'yellow'],
    ])
    expect(computeColorAdjacency('yellow', 0, 0, cols, map, getRowId)).toEqual({
      above: false, // row -1
      below: true,
      left: false, // col -1
      right: true,
    })
  })

  it('does not walk past the last column', () => {
    const map = annotate([[1, 2, 'yellow']])
    expect(computeColorAdjacency('yellow', 1, 2, cols, map, getRowId).right).toBe(false)
  })

  it('tolerates a row index with no id (outside the loaded page)', () => {
    const map = annotate([[2, 0, 'yellow']])
    // Row 3 is not loaded — `getRowId` returns undefined, not a crash.
    expect(computeColorAdjacency('yellow', 2, 0, cols, map, getRowId).below).toBe(false)
  })

  it('AN UNMOUNTED NEIGHBOUR IS STILL A NEIGHBOUR — no DOM is consulted', () => {
    // Simulate a virtualization window that mounts only column 1: the model
    // still knows columns 0 and 2 are coloured, so the block stays whole.
    const map = annotate([
      [1, 0, 'yellow'],
      [1, 1, 'yellow'],
      [1, 2, 'yellow'],
    ])
    // No document, no elements, no `data-col` — the answer is identical.
    expect(document.querySelectorAll('td').length).toBe(0)
    expect(computeColorAdjacency('yellow', 1, 1, cols, map, getRowId)).toEqual({
      above: false,
      below: false,
      left: true,
      right: true,
    })
  })

  it('follows the column ORDER, so a reorder re-forms the block correctly', () => {
    const map = annotate([
      [1, 0, 'yellow'], // key "r1:a"
      [1, 2, 'yellow'], // key "r1:c"
    ])
    // Perspective reorder puts 'a' and 'c' side by side: a, c, b.
    const reordered: ColumnDef[] = [cols[0], cols[2], cols[1]]
    expect(computeColorAdjacency('yellow', 1, 0, reordered, map, getRowId).right).toBe(true)
    expect(computeColorAdjacency('yellow', 1, 1, reordered, map, getRowId).left).toBe(true)
  })
})
