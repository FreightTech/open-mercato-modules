import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import type { ColumnDef } from '../types/index'

/**
 * GEPARD-308 (owner 17.11): GT uses cell comments as things to do — "zaznaczone = komórka przestaje się wyróżniać,
 * historia zostaje". A comment's "- [ ] …" lines are tasks; the cell's comment mark is lit (a dot) while one is open and
 * muted once all are done. A comment without tasks marks the cell as before.
 */

const columns: ColumnDef[] = [
  { data: 'a', title: 'A' },
  { data: 'b', title: 'B' },
  { data: 'c', title: 'C' },
]
const rows = [{ id: 'r1', a: '1', b: '2', c: '3' }]
const threads: Record<string, string[]> = {
  a: ['Plan:\n- [ ] zamówić auto\n- [x] wysłać zlecenie'],
  b: ['- [x] zamówić auto', 'potwierdzone\n- [x] wysłać zlecenie'],
  c: ['zwykła uwaga [ ] w zdaniu'],
}

jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(async (url: string) => {
    if (!url.startsWith('/api/annotations/annotations?')) return { ok: false, status: 404, result: null }
    return {
      ok: true,
      status: 200,
      result: {
        items: Object.entries(threads).map(([col, contents]) => ({
          id: `ann-${col}`, entityType: 'thing', rowId: 'r1', columnKey: col, color: null, assignees: [],
          comments: contents.map((content, i) => ({ id: `${col}${i}`, userId: 'u', content, audience: 'internal' })),
        })),
      },
    }
  }),
}))

beforeAll(() => {
  const rect = { width: 1200, height: 600, top: 0, left: 0, right: 1200, bottom: 600, x: 0, y: 0, toJSON() {} }
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
  for (const [prop, value] of [['clientHeight', 600], ['offsetHeight', 600], ['clientWidth', 1200], ['offsetWidth', 1200]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value })
  }
})

function Grid() {
  const tableRef = React.useRef<HTMLDivElement | null>(null)
  return React.createElement(I18nProvider as any, { locale: 'en', dict: {} }, React.createElement(DynamicTable as any, {
    data: rows, columns, tableRef, rowHeaders: true, height: 300, idColumnName: 'id', enableComments: true, commentsEntityType: 'thing',
  }))
}

const mark = (col: number) =>
  document.querySelector(`td.hot-cell[data-row="0"][data-col="${col}"] .cell-comment-indicator:not(.cell-comment-indicator-ghost)`) as HTMLElement | null

describe('GEPARD-308 — a comment as a to-do list', () => {
  it('keeps the mark lit while a task is open, and says how many', async () => {
    render(React.createElement(Grid))
    await waitFor(() => expect(mark(0)).not.toBeNull())
    expect(mark(0)!.getAttribute('data-tasks')).toBe('open')
    expect(mark(0)!.getAttribute('title')).toContain('1 of 2 tasks open')
  })

  it('mutes the mark once every task of the cell is done — the comments stay', async () => {
    render(React.createElement(Grid))
    await waitFor(() => expect(mark(1)).not.toBeNull())
    expect(mark(1)!.getAttribute('data-tasks')).toBe('done')
    expect(mark(1)!.getAttribute('title')).toContain('2 comments')
    expect(mark(1)!.getAttribute('title')).toContain('all tasks done')
  })

  it('marks a comment without tasks as before — a "[ ]" inside a sentence is not a task', async () => {
    render(React.createElement(Grid))
    await waitFor(() => expect(mark(2)).not.toBeNull())
    expect(mark(2)!.hasAttribute('data-tasks')).toBe(false)
    expect(mark(2)!.getAttribute('title')).toBe('1 comment')
  })
})
