/**
 * The split view is edited with the shared view grid (`backend/view-grid`):
 * the layout document goes through `gridFromSplit` / `splitFromGrid`, and the
 * shared search row is opt-in.
 */
import { gridFromSplit, splitFromGrid } from '../../view-grid/split-layout'
import { addWidget, setColumns } from '../../view-grid/model'
import { searchSwitchesOf } from '../split-view/SplitViewCustomizeSheet'
import type { SplitLayout } from '../split-view/types'

const table = (id: string, tableId: string) => ({ kind: 'pane' as const, id, content: { kind: 'table' as const, tableId } })

const twoColumns: SplitLayout = {
  version: 2,
  root: { kind: 'split', direction: 'row', sizes: [0.7, 0.3], children: [table('p0', 'offers'), table('p1', 'folders')] },
}

describe('split view ↔ view grid', () => {
  it('reads a two-column split as one section of two slots, pane ids kept', () => {
    const [section, ...rest] = gridFromSplit(twoColumns)
    expect(rest).toHaveLength(0)
    expect(section.columns).toBe(2)
    expect(section.widgets.map((w) => w.id)).toEqual(['p0', 'p1'])
  })

  it('keeps the divider shares when the editor leaves the column count alone', () => {
    const grid = gridFromSplit(twoColumns)
    const next = splitFromGrid(grid, twoColumns)
    expect(next.root).toMatchObject({ kind: 'split', direction: 'row', sizes: [0.7, 0.3] })
  })

  it('evens the shares out when a column is added', () => {
    const grid = setColumns(gridFromSplit(twoColumns), 'root', 3)
    const withThird = addWidget(grid, 'root', { id: 'p2', content: { kind: 'table', tableId: 'tasks' } }, 2)
    const next = splitFromGrid(withThird, twoColumns)
    expect(next.root).toMatchObject({ kind: 'split', direction: 'row', sizes: [1 / 3, 1 / 3, 1 / 3] })
  })

  it('keeps everything else on the layout (search switches, version)', () => {
    const base: SplitLayout = { ...twoColumns, workspaceSearch: true, paneSearch: false }
    const next = splitFromGrid(gridFromSplit(base), base)
    expect(next.workspaceSearch).toBe(true)
    expect(next.paneSearch).toBe(false)
    expect(next.version).toBe(2)
  })

  it('writes a second section as a box below the main grid', () => {
    const grid = [...gridFromSplit(twoColumns), { id: 'box-a', columns: 1 as const, widgets: [{ id: 'p9', content: { kind: 'table' as const, tableId: 'tasks' } }], slots: [0] }]
    const next = splitFromGrid(grid, twoColumns)
    expect(next.boxes).toEqual([{ id: 'box-a', root: table('p9', 'tasks') }])
  })
})

describe('split view search switches', () => {
  it('has no shared search row unless it is switched on (owner 12.10)', () => {
    expect(searchSwitchesOf({})).toEqual({ workspaceSearch: false, paneSearch: true })
  })

  it('a layout that turned the shared row on keeps it, and its tables lose their own box by default', () => {
    expect(searchSwitchesOf({ workspaceSearch: true })).toEqual({ workspaceSearch: true, paneSearch: false })
    expect(searchSwitchesOf({ workspaceSearch: true, paneSearch: true })).toEqual({ workspaceSearch: true, paneSearch: true })
  })
})
