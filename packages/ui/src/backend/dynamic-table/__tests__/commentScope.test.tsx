import * as React from 'react'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import type { ColumnDef } from '../types/index'

/**
 * B8a — A COMMENT BELONGS TO A RECORD, NOT TO A ROW.
 * B9  — A COMMENT MUST BE FINDABLE.
 *
 * The transport list shows one row per unit-LEG but keys the table on the
 * container. A note left on the truck plate of the road leg therefore surfaced
 * on the sea leg of the same container too: *"on się teraz powiela w innych
 * miejscach."* Nothing was being copied — both rows were asking the annotations
 * API for the same id.
 *
 * B9's finding was equally blunt: the only way into the comment feature was
 * `Shift`+click, and the product owner could not find his own feature —
 * *"Ja sam tego nie znalazłem."*
 *
 * These tests read the grid the way a user does: two rows of the same
 * container, a leg column and a container column, and a look at what each cell
 * actually shows.
 */

const columns: ColumnDef[] = [
  { data: 'containerNumber', title: 'Container' },
  { data: 'truckPlate', title: 'Truck plate' },
]

/** Two legs of ONE container: same `unitId`, different unit-leg `id`. */
const makeRows = () => [
  { id: 'leg-sea', unitId: 'unit-1', containerNumber: 'MSCU1', truckPlate: '' },
  { id: 'leg-road', unitId: 'unit-1', containerNumber: 'MSCU1', truckPlate: 'WX 1234' },
]

/** The transport page's scope map, in miniature. */
const cellTarget = (row: Record<string, any>, col: ColumnDef) =>
  col.data === 'truckPlate'
    ? { entityType: 'folder_unit_leg', rowId: String(row.id) }
    : { entityType: 'folder_unit', rowId: String(row.unitId) }

type Requested = { entityType: string; rowIds: string[] }
let requested: Requested[] = []
/** entityType:rowId:columnKey → number of comments the server reports. */
let serverComments: Record<string, number> = {}

jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(async (url: string) => {
    const parsed = new URL(url, 'http://localhost')
    // Only the annotations read is of interest — the grid makes other calls.
    if (!parsed.pathname.startsWith('/api/annotations/annotations')) return { ok: true, result: {} }
    const entityType = parsed.searchParams.get('entityType') ?? ''
    const rowIds = (parsed.searchParams.get('rowIds') ?? '').split(',').filter(Boolean)
    requested.push({ entityType, rowIds })
    const items: any[] = []
    for (const rowId of rowIds) {
      for (const col of ['containerNumber', 'truckPlate']) {
        const count = serverComments[`${entityType}:${rowId}:${col}`] ?? 0
        if (!count) continue
        items.push({
          id: `${entityType}-${rowId}-${col}`,
          entityType,
          rowId,
          columnKey: col,
          color: null,
          comments: Array.from({ length: count }, (_, i) => ({
            id: `c${i}`,
            content: 'note',
            audience: 'internal',
          })),
          assignees: [],
        })
      }
    }
    return { ok: true, result: { items } }
  }),
}))

function Harness(props: Record<string, unknown>) {
  const tableRef = React.useRef<HTMLDivElement | null>(null)
  const [data] = React.useState(makeRows)
  return React.createElement(
    I18nProvider as any,
    { locale: 'en', dict: {} },
    React.createElement(DynamicTable as any, {
      data,
      columns,
      tableRef,
      rowHeaders: true,
      height: 400,
      idColumnName: 'unitId',
      enableComments: true,
      commentsEntityType: 'folder_unit',
      ...props,
    }),
  )
}

beforeAll(() => {
  const rect = {
    width: 1200, height: 600, top: 0, left: 0, right: 1200, bottom: 600, x: 0, y: 0,
    toJSON() {},
  }
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  })
  for (const [prop, value] of [
    ['clientHeight', 600],
    ['offsetHeight', 600],
    ['clientWidth', 1200],
    ['offsetWidth', 1200],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value })
  }
})

beforeEach(() => {
  requested = []
  serverComments = {}
})

const cell = (row: number, col: number) =>
  document.querySelector(`td.hot-cell[data-row="${row}"][data-col="${col}"]`) as HTMLElement | null

const indicatorIn = (row: number, col: number) =>
  cell(row, col)?.querySelector('.cell-comment-indicator:not(.cell-comment-indicator-ghost)') ?? null

describe('cell comments — scope (B8a)', () => {
  it('asks for BOTH scopes on screen, each with the ids that belong to it', async () => {
    render(React.createElement(Harness, { commentsCellTarget: cellTarget }))
    // One request per SCOPE. Asserted as a set rather than a count: a settling
    // render may repeat a request, and what matters is which ids each scope is
    // asked for, never how many times.
    await waitFor(() => expect(new Set(requested.map((r) => r.entityType)).size).toBe(2))
    const byType = Object.fromEntries(requested.map((r) => [r.entityType, r.rowIds.slice().sort()]))
    expect(byType['folder_unit']).toEqual(['unit-1'])
    expect(byType['folder_unit_leg']).toEqual(['leg-road', 'leg-sea'])
  })

  it('shows a leg-scoped comment on that leg ONLY — the duplication defect', async () => {
    serverComments['folder_unit_leg:leg-road:truckPlate'] = 1
    render(React.createElement(Harness, { commentsCellTarget: cellTarget }))
    // Row 1 is the road leg; row 0 is the sea leg of the SAME container.
    await waitFor(() => expect(indicatorIn(1, 1)).not.toBeNull())
    expect(indicatorIn(0, 1)).toBeNull()
  })

  it('still shows a container-scoped comment on both rows — it IS the same cell', async () => {
    serverComments['folder_unit:unit-1:containerNumber'] = 1
    render(React.createElement(Harness, { commentsCellTarget: cellTarget }))
    await waitFor(() => expect(indicatorIn(0, 0)).not.toBeNull())
    expect(indicatorIn(1, 0)).not.toBeNull()
  })

  it('without a target resolver, behaves exactly as before: one scope, keyed on the id column', async () => {
    serverComments['folder_unit:unit-1:truckPlate'] = 1
    render(React.createElement(Harness, {}))
    await waitFor(() => expect(requested.length).toBeGreaterThan(0))
    // ONE scope, and the id is the table's id column — today's behaviour, byte
    // for byte, for the 50-odd consumers that declare no resolver.
    expect(new Set(requested.map((r) => r.entityType))).toEqual(new Set(['folder_unit']))
    expect(requested[0].rowIds).toEqual(['unit-1'])
    // …including the duplication, which is the historical behaviour every other
    // consumer of this component still relies on.
    await waitFor(() => expect(indicatorIn(0, 1)).not.toBeNull())
    expect(indicatorIn(1, 1)).not.toBeNull()
  })
})

describe('cell comments — discoverability (B9)', () => {
  it('shows no ghost affordance on a cell nobody has selected', () => {
    render(React.createElement(Harness, {}))
    expect(document.querySelector('.cell-comment-indicator-ghost')).toBeNull()
  })

  it('offers a ghost affordance on the focused cell, and only there', () => {
    render(React.createElement(Harness, {}))
    fireEvent.mouseDown(cell(1, 1)!)
    const ghosts = document.querySelectorAll('.cell-comment-indicator-ghost')
    expect(ghosts.length).toBe(1)
    expect(ghosts[0].closest('td')?.getAttribute('data-row')).toBe('1')
    expect(ghosts[0].getAttribute('aria-label')).toMatch(/add a comment/i)
  })

  it('does not double up on a cell that already has a real comment', async () => {
    serverComments['folder_unit:unit-1:truckPlate'] = 1
    render(React.createElement(Harness, {}))
    await waitFor(() => expect(indicatorIn(1, 1)).not.toBeNull())
    fireEvent.mouseDown(cell(1, 1)!)
    expect(cell(1, 1)!.querySelectorAll('.cell-comment-indicator').length).toBe(1)
  })

  it('opens the comment dialog when the ghost affordance is clicked', async () => {
    render(React.createElement(Harness, {}))
    fireEvent.mouseDown(cell(1, 1)!)
    const ghost = document.querySelector('.cell-comment-indicator-ghost')!
    fireEvent.mouseDown(ghost, { bubbles: true })
    await waitFor(() =>
      expect(document.querySelector('.hot-comment-popover')).not.toBeNull(),
    )
  })

  it('opens the comment dialog on Shift+F2 — Excel’s own chord', async () => {
    const { container } = render(React.createElement(Harness, {}))
    fireEvent.mouseDown(cell(1, 1)!)
    const grid = container.querySelector('.hot-virtual-container') as HTMLElement
    fireEvent.keyDown(grid, { key: 'F2', shiftKey: true })
    await waitFor(() =>
      expect(document.querySelector('.hot-comment-popover')).not.toBeNull(),
    )
  })
})
