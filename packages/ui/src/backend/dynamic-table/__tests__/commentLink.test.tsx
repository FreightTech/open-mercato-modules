import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import CellCommentDialog from '../components/CellCommentDialog'
import { readCommentLink, withoutCommentLink } from '../utils/commentLink'
import type { ColumnDef } from '../types/index'

/**
 * GEPARD-309 (GT RFS feedback 17.11). Dawid Lass: "jak… kliknę w ten komentarz, i on mnie… od razu mi suwak
 * przesunie i… to się mignie, to pole". Owner: whoever is notified lands in the DynamicTable exactly where the comment
 * was added. The notification's link names the table, the cell and the row; the table that is that table:
 *   • opens the comments of that cell on the row the comment was written on (not the container's other leg);
 *   • marks and blinks the cell;
 *   • takes the link's parameters out of the address; another table ignores the link.
 */

const columns: ColumnDef[] = [
  { data: 'containerNumber', title: 'Container' },
  { data: 'rate', title: 'Stawka' },
]
const rows = [
  { id: 'leg-sea', unitId: 'unit-1', containerNumber: 'MSCU1', rate: '100' },
  { id: 'leg-road', unitId: 'unit-1', containerNumber: 'MSCU1', rate: '200' },
]

jest.mock('../../FlashMessages', () => ({ flash: jest.fn() }))
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { flash } = require('../../FlashMessages') as { flash: jest.Mock }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { apiCall } = require('../../utils/apiCall') as { apiCall: jest.Mock }
const answers = apiCall.getMockImplementation()!
jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(async (url: string, _init?: { signal?: AbortSignal }) => {
    const parsed = new URL(url, 'http://localhost')
    if (parsed.pathname !== '/api/annotations/annotations') return { ok: false, status: 404, result: null }
    if (parsed.searchParams.get('entityType') !== 'folder_unit') return { ok: true, status: 200, result: { items: [] } }
    return {
      ok: true,
      status: 200,
      result: {
        items: [{
          id: 'ann-rate', entityType: 'folder_unit', rowId: 'unit-1', columnKey: 'rate', color: null, assignees: [],
          comments: [{ id: 'c1', userId: 'u', userName: 'Sebastian Wrobel', content: '@[Dawid Lass](d) sprzedać jak najtaniej', audience: 'internal', visibility: 'everywhere', createdAt: '2026-11-17T10:00:00.000Z' }],
        }],
      },
    }
  }),
}))

const LINK = '/backend/rfs?fileId=f1&commentTable=rfs&commentEntity=folder_unit&commentRow=unit-1&commentColumn=rate&commentAt=leg-road&comment=c1'

function Grid({ table }: { table: string }) {
  const tableRef = React.useRef<HTMLDivElement | null>(null)
  return React.createElement(I18nProvider as any, { locale: 'en', dict: {} }, React.createElement(DynamicTable as any, {
    data: rows, columns, tableRef, rowHeaders: true, height: 400,
    idColumnName: 'unitId', rowKeyColumn: 'id',
    enableComments: true, commentsEntityType: 'folder_unit', commentsViewContext: table,
  }))
}

beforeAll(() => {
  const rect = { width: 1200, height: 600, top: 0, left: 0, right: 1200, bottom: 600, x: 0, y: 0, toJSON() {} }
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
  for (const [prop, value] of [['clientHeight', 600], ['offsetHeight', 600], ['clientWidth', 1200], ['offsetWidth', 1200]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value })
  }
})

beforeEach(() => {
  window.history.replaceState(null, '', LINK)
})

describe('GEPARD-309 — the link reads and leaves', () => {
  it('reads the cell, the row and the comment, and leaves the rest of the address', () => {
    expect(readCommentLink(new URL(LINK, 'http://fms.test').search)).toMatchObject({
      table: 'rfs', entityType: 'folder_unit', rowId: 'unit-1', columnKey: 'rate', at: 'leg-road', commentId: 'c1',
    })
    expect(readCommentLink('?fileId=f1')).toBeNull()
    expect(withoutCommentLink(`http://fms.test${LINK}`)).toBe('http://fms.test/backend/rfs?fileId=f1')
  })
})

describe('GEPARD-309 — the table the link names', () => {
  it("opens the comments at the road leg's Stawka, marks and blinks that cell, and clears the address", async () => {
    render(React.createElement(Grid, { table: 'rfs' }))
    await waitFor(() => expect(document.querySelector('.hot-comment-popover')).not.toBeNull())
    await waitFor(() => expect(document.body.textContent).toContain('sprzedać jak najtaniej'))
    // Row 1 is the road leg — the row the comment was written on; row 0 is the sea leg of the same container.
    expect(document.querySelector('td.hot-cell-flash')?.getAttribute('data-row')).toBe('1')
    expect(document.querySelector('td.hot-cell-flash')?.getAttribute('data-col')).toBe('1')
    expect(window.location.search).toBe('?fileId=f1')
  })

  it('another table leaves the link alone', async () => {
    render(React.createElement(Grid, { table: 'transport' }))
    await new Promise((r) => setTimeout(r, 300))
    expect(document.querySelector('.hot-comment-popover')).toBeNull()
    expect(window.location.search).toContain('commentTable=rfs')
  })

  it("says so when the commented row is not in this view, and leaves the address clean (CHECK #3223 P2)", async () => {
    window.history.replaceState(null, '', LINK.replace('commentRow=unit-1', 'commentRow=unit-gone'))
    flash.mockClear()
    render(React.createElement(Grid, { table: 'rfs' }))
    await waitFor(() => expect(flash).toHaveBeenCalledWith(expect.stringMatching(/not in this view/), 'info'))
    expect(window.location.search).toBe('?fileId=f1')
    expect(document.querySelector('.hot-comment-popover')).toBeNull()
  })

  it('clears the opening timer when the table goes away before it fires (CHECK #3223 P5)', async () => {
    const set = jest.spyOn(window, 'setTimeout')
    const clear = jest.spyOn(window, 'clearTimeout')
    try {
      const view = render(React.createElement(Grid, { table: 'rfs' }))
      await waitFor(() => expect(set.mock.calls.some((c) => c[1] === 120)).toBe(true))
      const index = set.mock.calls.findIndex((c) => c[1] === 120)
      const id = set.mock.results[index].value
      view.unmount()
      expect(clear).toHaveBeenCalledWith(id)
    } finally {
      set.mockRestore()
      clear.mockRestore()
    }
  })
})

/**
 * V-MENTIONS 3 (RFS 17.11): the comments opened seconds after the table — sometimes not at all. The link waited for the
 * table's own read of the comments; RFS reads four kinds of record at once and the link waited for every one. Now the
 * rows are enough: the dialog finds the cell's comments itself, with one read.
 */
describe('GEPARD-309 — the link does not wait for the table\'s read of the comments', () => {
  afterEach(() => apiCall.mockImplementation(answers))

  it("opens the cell's comments while the table's own read has not answered", async () => {
    // The table reads with an AbortSignal (useAnnotations) and that read never answers; the dialog's own read does.
    apiCall.mockImplementation((url: string, init?: { signal?: AbortSignal }) => (init?.signal ? new Promise(() => {}) : answers(url, init)))
    render(React.createElement(Grid, { table: 'rfs' }))
    await waitFor(() => expect(document.querySelector('.hot-comment-popover')).not.toBeNull())
    await waitFor(() => expect(document.body.textContent).toContain('sprzedać jak najtaniej'))
    expect(document.querySelector('td.hot-cell-flash')?.getAttribute('data-row')).toBe('1')
    expect(window.location.search).toBe('?fileId=f1')
  })
})

describe('GEPARD-309 — rows that do not resolve yet', () => {
  afterEach(() => apiCall.mockImplementation(answers))

  it('the first rows do not name their record yet (RFS re-renders them): it waits, then opens — no "not in this view"', async () => {
    apiCall.mockImplementation((url: string, init?: { signal?: AbortSignal }) => (init?.signal ? new Promise(() => {}) : answers(url, init)))
    flash.mockClear()
    // The page's first rows, before they carry the container they belong to.
    const early = rows.map(({ unitId: _unitId, ...row }) => row)
    function Changing({ data }: { data: Array<Record<string, unknown>> }) {
      const tableRef = React.useRef<HTMLDivElement | null>(null)
      return React.createElement(I18nProvider as any, { locale: 'en', dict: {} }, React.createElement(DynamicTable as any, {
        data, columns, tableRef, rowHeaders: true, height: 400,
        idColumnName: 'unitId', rowKeyColumn: 'id',
        enableComments: true, commentsEntityType: 'folder_unit', commentsViewContext: 'rfs',
      }))
    }
    const view = render(React.createElement(Changing, { data: early }))
    await new Promise((r) => setTimeout(r, 200))
    expect(document.querySelector('.hot-comment-popover')).toBeNull()
    expect(flash).not.toHaveBeenCalled()
    expect(window.location.search).toContain('commentTable=rfs')
    view.rerender(React.createElement(Changing, { data: rows }))
    await waitFor(() => expect(document.querySelector('.hot-comment-popover')).not.toBeNull())
    await waitFor(() => expect(document.body.textContent).toContain('sprzedać jak najtaniej'))
    expect(flash).not.toHaveBeenCalled()
  })
})

describe('GEPARD-309 — a table mounted again before the comments open', () => {
  it('V-MENTIONS 3: the page mounts its table again right after the first rows — the second table opens the comments', async () => {
    const view = render(React.createElement(Grid, { table: 'rfs' }))
    // The first table found the row and scheduled the opening; it goes away before the opening runs (P5 cancels it).
    await waitFor(() => expect(document.querySelector('td.hot-cell')).not.toBeNull())
    view.unmount()
    expect(window.location.search).toContain('commentTable=rfs')
    render(React.createElement(Grid, { table: 'rfs' }))
    await waitFor(() => expect(document.querySelector('.hot-comment-popover')).not.toBeNull())
    await waitFor(() => expect(document.body.textContent).toContain('sprzedać jak najtaniej'))
    expect(window.location.search).toBe('?fileId=f1')
  })
})

describe('GEPARD-309 — React StrictMode (development)', () => {
  it('V-MENTIONS 3: a table mounted with its rows already in, unmounted and mounted again by StrictMode, opens the comments', async () => {
    render(React.createElement(React.StrictMode, null, React.createElement(Grid, { table: 'rfs' })))
    await waitFor(() => expect(document.querySelector('.hot-comment-popover')).not.toBeNull())
    await waitFor(() => expect(document.body.textContent).toContain('sprzedać jak najtaniej'))
    expect(window.location.search).toBe('?fileId=f1')
  })
})

describe('CellCommentDialog — finding its own annotation', () => {
  const dialog = (props: Record<string, unknown>) => React.createElement(I18nProvider as any, { locale: 'en', dict: {} }, React.createElement(CellCommentDialog as any, {
    isOpen: true, onClose: () => {}, entityType: 'folder_unit', viewContext: 'rfs', rowId: 'unit-1', columnKey: 'rate', columnTitle: 'Stawka', originRowId: 'leg-road', ...props,
  }))
  const reads = () => apiCall.mock.calls.filter(([url]) => String(url).startsWith('/api/annotations/annotations?')).length

  beforeEach(() => apiCall.mockClear())

  it('asked to (findAnnotation), it reads the cell once and shows its thread', async () => {
    render(dialog({ annotationId: null, findAnnotation: true }))
    await waitFor(() => expect(document.body.textContent).toContain('sprzedać jak najtaniej'))
    // Found, it does not read the same thread again.
    await new Promise((r) => setTimeout(r, 50))
    expect(reads()).toBe(1)
  })

  it('not asked, a cell with no comments yet is not read (opening an empty cell costs no request)', async () => {
    render(dialog({ annotationId: null }))
    await new Promise((r) => setTimeout(r, 50))
    expect(reads()).toBe(0)
  })
})
