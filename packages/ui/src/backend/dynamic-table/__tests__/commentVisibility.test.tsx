import * as React from 'react'
import { render, fireEvent, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import CellCommentDialog from '../components/CellCommentDialog'
import { CommentVisibilityMenu } from '../components/CommentVisibilityMenu'
import { annotationForRow, rowAnnotationKey } from '../hooks/useAnnotations'
import type { ColumnDef } from '../types/index'

/**
 * GEPARD-310 (GT RFS feedback 17.11, Dawid Lass: "ten komentarz załączył się jednocześnie na odcinku morskim i odcinku
 * drogowym, a miał on dotyczyć tylko odcinka drogowego"). Owner 17.11: "everywhere" stays the default; a table (or the
 * system) can keep a comment to the table and row it was written on. The server stamps the comment; the grid:
 *   • asks with its table id, and shows a comment kept to a row on THAT row only — not on the container's other leg;
 *   • writes the table and the row with every comment (single cell and range);
 *   • offers the table's own setting in its ⋮ menu, read-only without the right.
 */

const columns: ColumnDef[] = [
  { data: 'containerNumber', title: 'Container' },
  { data: 'rate', title: 'Stawka' },
]

/** Two legs of ONE container: same `unitId`, different unit-leg `id` — RFS's rows. */
const rows = [
  { id: 'leg-sea', unitId: 'unit-1', containerNumber: 'MSCU1', rate: '100' },
  { id: 'leg-road', unitId: 'unit-1', containerNumber: 'MSCU1', rate: '200' },
]

type Call = { url: string; init?: { method?: string; body?: string; headers?: Record<string, string> } }
const calls: Call[] = []
let threads: Record<string, Array<Record<string, unknown>>> = {}
let setting: Record<string, unknown> | null = null

const kept = (id: string, rowKey: string, tableId = 'rfs') => ({
  id, content: `kept ${id}`, audience: 'internal', visibility: 'where_added', originTableId: tableId, originRowId: rowKey, createdAt: '2026-11-17T10:00:00.000Z',
})
const shared = (id: string) => ({
  id, content: `shared ${id}`, audience: 'internal', visibility: 'everywhere', originTableId: null, originRowId: null, createdAt: '2026-11-17T09:00:00.000Z',
})

jest.mock('../../FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(async (url: string, init?: Call['init']) => {
    calls.push({ url, init })
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname === '/api/annotations/settings') {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body ?? '{}')
        setting = { ...setting!, table: body.visibility, effective: body.visibility ?? setting!.system }
      }
      return setting ? { ok: true, status: 200, result: setting } : { ok: false, status: 404, result: null }
    }
    if (parsed.pathname === '/api/annotations/annotations' && !init?.method) {
      const entityType = parsed.searchParams.get('entityType') ?? ''
      const ids = (parsed.searchParams.get('rowIds') ?? '').split(',').filter(Boolean)
      const items = ids.flatMap((rowId) =>
        ['containerNumber', 'rate']
          .filter((col) => threads[`${entityType}:${rowId}:${col}`])
          .map((col) => ({ id: `ann-${rowId}-${col}`, entityType, rowId, columnKey: col, color: null, comments: threads[`${entityType}:${rowId}:${col}`], assignees: [] })),
      )
      return { ok: true, status: 200, result: { items } }
    }
    return { ok: true, status: 201, result: { id: 'new-id', visibility: 'where_added' } }
  }),
}))

const withI18n = (el: React.ReactElement) => React.createElement(I18nProvider as any, { locale: 'en', dict: {} }, el)

function Grid() {
  const tableRef = React.useRef<HTMLDivElement | null>(null)
  return withI18n(
    React.createElement(DynamicTable as any, {
      data: rows,
      columns,
      tableRef,
      rowHeaders: true,
      height: 400,
      idColumnName: 'unitId',
      rowKeyColumn: 'id',
      enableComments: true,
      commentsEntityType: 'folder_unit',
      commentsViewContext: 'rfs',
    }),
  )
}

beforeAll(() => {
  const rect = { width: 1200, height: 600, top: 0, left: 0, right: 1200, bottom: 600, x: 0, y: 0, toJSON() {} }
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
  for (const [prop, value] of [['clientHeight', 600], ['offsetHeight', 600], ['clientWidth', 1200], ['offsetWidth', 1200]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value })
  }
})

beforeEach(() => {
  calls.length = 0
  threads = {}
  setting = null
})

const indicatorIn = (row: number, col: number) =>
  document.querySelector(`td.hot-cell[data-row="${row}"][data-col="${col}"]`)?.querySelector('.cell-comment-indicator:not(.cell-comment-indicator-ghost)') ?? null

describe('GEPARD-310 — the grid', () => {
  it("asks with its table id, and shows a comment kept to the road leg on the road leg only", async () => {
    threads['folder_unit:unit-1:rate'] = [kept('k1', 'leg-road')]
    render(React.createElement(Grid))
    await waitFor(() => expect(indicatorIn(1, 1)).not.toBeNull())
    expect(indicatorIn(0, 1)).toBeNull()
    const read = calls.find((c) => c.url.startsWith('/api/annotations/annotations?'))
    expect(new URL(read!.url, 'http://x').searchParams.get('tableId')).toBe('rfs')
  })

  it('still shows a comment that shows everywhere on both legs', async () => {
    threads['folder_unit:unit-1:containerNumber'] = [shared('s1')]
    render(React.createElement(Grid))
    await waitFor(() => expect(indicatorIn(0, 0)).not.toBeNull())
    expect(indicatorIn(1, 0)).not.toBeNull()
  })

  it("leaves out a kept comment of another table, should a server send it", async () => {
    threads['folder_unit:unit-1:rate'] = [kept('k1', 'leg-road', 'transport')]
    render(React.createElement(Grid))
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/annotations/annotations?'))).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(indicatorIn(1, 1)).toBeNull()
  })

  it("a row reads its own entry, every other row the cell's shared one", () => {
    const map = new Map([['k', 'shared'], [rowAnnotationKey('k', 'leg-road'), 'own']])
    expect(annotationForRow(map, 'k', 'leg-road')).toBe('own')
    expect(annotationForRow(map, 'k', 'leg-sea')).toBe('shared')
    expect(annotationForRow(map, 'k', undefined)).toBe('shared')
  })
})

function dialog(props: Record<string, unknown>) {
  return render(withI18n(React.createElement(CellCommentDialog as any, {
    isOpen: true,
    onClose: () => {},
    entityType: 'folder_unit',
    viewContext: 'rfs',
    rowId: 'unit-1',
    columnKey: 'rate',
    columnTitle: 'Stawka',
    annotationId: 'ann-unit-1-rate',
    ...props,
  })))
}

describe('GEPARD-310 — the comment dialog', () => {
  it("shows the road leg's kept comment on the road leg, marked 'only here', and not on the sea leg", async () => {
    threads['folder_unit:unit-1:rate'] = [shared('s1'), kept('k1', 'leg-road')]
    const road = dialog({ originRowId: 'leg-road' })
    await screen.findByText('kept k1')
    expect(document.querySelector('[data-comment-where-added]')?.textContent).toContain('only here')
    road.unmount()
    dialog({ originRowId: 'leg-sea' })
    await screen.findByText('shared s1')
    expect(screen.queryByText('kept k1')).toBeNull()
  })

  it('writes the table and the row with a comment', async () => {
    dialog({ originRowId: 'leg-road', annotationId: 'ann-1' })
    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'sprzedać jak najtaniej' } })
    fireEvent.keyDown(document.querySelector('textarea')!, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST' && c.url.includes('/comments'))).toBe(true))
    const post = calls.find((c) => c.init?.method === 'POST' && c.url.includes('/comments'))!
    expect(JSON.parse(post.init!.body!)).toMatchObject({ content: 'sprzedać jak najtaniej', originTableId: 'rfs', originRowId: 'leg-road' })
  })

  it('writes each cell of a range with its own row', async () => {
    dialog({
      bulkCells: [
        { entityType: 'folder_unit', rowId: 'unit-1', columnKey: 'rate', originRowId: 'leg-a' },
        { entityType: 'folder_unit', rowId: 'unit-2', columnKey: 'rate', originRowId: 'leg-b' },
      ],
    })
    await waitFor(() => expect(document.querySelector('textarea')).not.toBeNull())
    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'pilne' } })
    fireEvent.keyDown(document.querySelector('textarea')!, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT' && c.init.body?.includes('pilne'))).toBe(true))
    const put = JSON.parse(calls.find((c) => c.init?.method === 'PUT' && c.init.body?.includes('pilne'))!.init!.body!)
    expect(put.originTableId).toBe('rfs')
    expect(put.cells).toEqual([
      { rowId: 'unit-1', columnKey: 'rate', originRowId: 'leg-a' },
      { rowId: 'unit-2', columnKey: 'rate', originRowId: 'leg-b' },
    ])
  })
})

describe("GEPARD-310 — the table menu's Comments section", () => {
  const menu = () => render(withI18n(React.createElement(CommentVisibilityMenu, { tableId: 'rfs', rowClassName: 'row', gutterClassName: 'g' })))
  const option = (v: string) => document.querySelector(`[data-comment-visibility-option="${v}"]`) as HTMLButtonElement

  it("shows the table's value, and an admin keeps comments to RFS with one click", async () => {
    setting = { system: 'everywhere', table: null, effective: 'everywhere', canManage: true }
    menu()
    await waitFor(() => expect(option('system')).toBeTruthy())
    expect(option('system').getAttribute('aria-checked')).toBe('true')
    expect(option('system').textContent).toContain('Shown everywhere')
    fireEvent.click(option('where_added'))
    await waitFor(() => expect(option('where_added').getAttribute('aria-checked')).toBe('true'))
    const put = calls.find((c) => c.init?.method === 'PUT')!
    expect(JSON.parse(put.init!.body!)).toEqual({ tableId: 'rfs', visibility: 'where_added' })
    expect(put.init!.headers!['x-om-forbidden-redirect']).toBe('0')
  })

  it('is read-only without the right, and absent where the server has no such setting', async () => {
    setting = { system: 'everywhere', table: 'where_added', effective: 'where_added', canManage: false }
    const first = menu()
    await waitFor(() => expect(option('where_added')).toBeTruthy())
    expect(option('where_added').getAttribute('aria-checked')).toBe('true')
    expect(option('everywhere').disabled).toBe(true)
    first.unmount()
    setting = null
    menu()
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith('/api/annotations/settings')).length).toBe(2))
    expect(document.querySelector('[data-comment-visibility-menu]')).toBeNull()
  })
})
