import fs from 'node:fs'
import path from 'node:path'

/**
 * Anchor Defect 5 — `VirtualRow`'s `React.memo` only holds if every prop it
 * receives keeps its identity between renders. Four of those props come from
 * the handler factories in `handlers/index.ts` (`onCellSave`, `onSaveNewRow`,
 * `onCancelNewRow`, `onRowHeaderDoubleClick`). For a long time they were
 * constructed in `DynamicTable`'s render body, which handed every mounted row a
 * fresh callback on EVERY render — so a keystroke in the filter box re-rendered
 * every mounted row and therefore every mounted cell.
 *
 * The failure is invisible in a behaviour test (everything still works, it is
 * merely 50× more expensive) and a render-count check needs a browser and the
 * perf harness. So the invariant is mechanised here instead: a factory call
 * that is not wrapped in `useMemo` fails the build. Precedent in this package:
 * `formula.noEval.test.ts`.
 *
 * If you need to move one of these out of a `useMemo`, you are re-opening
 * Defect 5 — measure it with `apps/web/.ai/qa/perf/dt-perf.mjs` first.
 */

const SOURCE = path.join(__dirname, '..', 'DynamicTable.tsx')

const FACTORIES = [
  'createCellHandlers',
  'createRowHandlers',
  'createDragHandlers',
  'createMouseHandlers',
  'createPerspectiveHandlers',
  'createColumnHeaderHandlers',
  'createRowHeaderHandlers',
  'createContextMenuHandlers',
  'createResizeHandlers',
]

const source = fs.readFileSync(SOURCE, 'utf8')

/**
 * True when this call site sits inside a `useMemo(...)` — i.e. walking back
 * from the call to the start of its statement passes a `useMemo(`.
 */
function isMemoized(callIndex: number): boolean {
  const statementStart = source.lastIndexOf(';', callIndex)
  const prefix = source.slice(statementStart + 1, callIndex)
  return prefix.includes('useMemo(')
}

describe('DynamicTable — handler factory identity', () => {
  it.each(FACTORIES)('%s is called, and only inside useMemo', (factory) => {
    // The import line is not a call site.
    const callSites: number[] = []
    const re = new RegExp(`\\b${factory}\\s*\\(`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(source)) !== null) callSites.push(m.index)

    expect(callSites.length).toBeGreaterThan(0)
    for (const index of callSites) {
      const line = source.slice(0, index).split('\n').length
      expect({ factory, line, memoized: isMemoized(index) }).toEqual({
        factory,
        line,
        memoized: true,
      })
    }
  })

  it('does not discover colour adjacency from the DOM', () => {
    // Anchor Defect 7: the scroll-coupled `querySelectorAll('… cell-color-…')`
    // that wrote `data-cb-*` is gone for good. Adjacency now comes from
    // `utils/colorAdjacency.ts` and reaches the cell as props. (The remaining
    // scroll listener in this file drives the frozen-column shadow, which is a
    // legitimate pixels→state read on an always-mounted pinned element.)
    expect(source).not.toContain('cell-color-')
    expect(source).not.toMatch(/(set|remove)Attribute\(\s*['"`]data-cb-/)
  })
})
