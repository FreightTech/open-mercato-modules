import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
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
jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(async (url: string) => {
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
})
