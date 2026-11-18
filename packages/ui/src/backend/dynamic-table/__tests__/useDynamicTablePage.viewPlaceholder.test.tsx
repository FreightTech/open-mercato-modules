/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '../../utils/apiCall'
import { useDynamicTablePage } from '../hooks/useDynamicTablePage'
import DynamicTable from '../DynamicTable'
import { dispatch } from '../events/events'
import { TableEvents } from '../types/index'
import type { ColumnDef, FilterRow } from '../types/index'

/**
 * P2 (GT RFS board, 17.11): switching the board to another view ("Bez planu
 * dostawy") showed the PREVIOUS view's boxes — with nothing loading — for as long
 * as the new request took, and they read as that view's answer.
 *
 * Cause: `placeholderData: (previous) => previous` on the list query keeps the
 * last response on screen for ANY new request. Right for a page or a sort (the
 * same rows, another window onto them); wrong for another view or filter set.
 * Now, while the rows held answer another question, the grid gets none and
 * `rowsLoading`; a page, a sort or a search keystroke keeps the rows as before;
 * `isLoading` (hosts swap the whole table for a skeleton on it) is untouched.
 */

jest.mock('../../utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('../../FlashMessages', () => ({ flash: jest.fn() }))

const columns: ColumnDef[] = [
  { data: 'name', title: 'Name' },
  { data: 'status', title: 'Status' },
]

/** List requests answered by hand, in order: `answer(i, items)`. */
let pending: Array<{ url: string; resolve: (v: unknown) => void }> = []
function answer(match: (url: string) => boolean, items: Array<Record<string, unknown>>) {
  const i = pending.findIndex((p) => match(p.url))
  if (i < 0) throw new Error(`no pending request matches; pending: ${pending.map((p) => p.url).join(' | ')}`)
  const [p] = pending.splice(i, 1)
  p!.resolve({ ok: true, result: { items, total: 40, totalPages: 2 } })
}

beforeEach(() => {
  pending = []
  ;(apiCall as jest.Mock).mockReset()
  ;(apiCall as jest.Mock).mockImplementation((url: string) => new Promise((resolve) => pending.push({ url, resolve })))
  window.sessionStorage.clear()
})

const VIEW_A: FilterRow[] = [{ id: 'a', field: 'status', operator: 'is_any_of', values: ['PLANNED'] } as FilterRow]
const VIEW_B: FilterRow[] = [{ id: 'b', field: 'status', operator: 'is_empty', values: [] } as FilterRow]
const ROWS_A = [{ id: 'a1', name: 'MSKU1234565', status: 'PLANNED' }]
const ROWS_B = [{ id: 'b1', name: 'NLTU4829134', status: null }]
const hasFilter = (rows: FilterRow[]) => (url: string) => decodeURIComponent(url).includes(`"id":"${rows[0]!.id}"`)

type PageProps = { filters: FilterRow[]; search?: string; scope?: string; views?: boolean }
function renderPage(initial: PageProps = { filters: VIEW_A }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children)
  return renderHook(
    ({ filters, search, scope, views }: PageProps) =>
      useDynamicTablePage({
        source: '/api/boxes',
        columns,
        tableName: 'Boxes',
        defaultSort: { field: 'name', direction: 'asc' },
        sharedFilters: filters,
        ...(search !== undefined ? { sharedSearch: search } : {}),
        // A host's scope (an organization / tenant switch): part of the question, as the organization scope is.
        ...(scope !== undefined ? { queryKeyDeps: [scope] } : {}),
        // A table with saved views: the grid's column changes (PERSPECTIVE_CHANGE) reach the hook only then.
        ...(views ? { perspectives: 'boxes' } : {}),
      } as Parameters<typeof useDynamicTablePage>[0]),
    { wrapper, initialProps: initial },
  )
}

const shown = (r: { current: ReturnType<typeof useDynamicTablePage> }) => (r.current.props.data as Array<{ id: string }>).map((x) => x.id)

describe('the rows on screen answer the view asked for (P2)', () => {
  it('another view: the previous view\'s rows are not shown while it loads — the body loads, the table stays', async () => {
    const { result, rerender } = renderPage()
    await waitFor(() => expect(pending).toHaveLength(1))
    act(() => answer(hasFilter(VIEW_A), ROWS_A))
    await waitFor(() => expect(shown(result)).toEqual(['a1']))
    expect(result.current.props.rowsLoading).toBe(false)

    rerender({ filters: VIEW_B })
    await waitFor(() => expect(pending.some((p) => hasFilter(VIEW_B)(p.url))).toBe(true))
    // The regression: the previous view's box stayed, nothing loading.
    expect(shown(result)).toEqual([])
    expect(result.current.props.rowsLoading).toBe(true)
    expect(result.current.rowsLoading).toBe(true)
    // The host keeps the table (its toolbar, tabs and filters): this is no first load.
    expect(result.current.isLoading).toBe(false)

    act(() => answer(hasFilter(VIEW_B), ROWS_B))
    await waitFor(() => expect(shown(result)).toEqual(['b1']))
    expect(result.current.props.rowsLoading).toBe(false)
  })

  it('another page of the same view keeps the rows until it arrives, as before', async () => {
    const { result } = renderPage()
    await waitFor(() => expect(pending).toHaveLength(1))
    act(() => answer(() => true, ROWS_A))
    await waitFor(() => expect(shown(result)).toEqual(['a1']))
    act(() => result.current.props.pagination!.onPageChange(2))
    await waitFor(() => expect(pending.some((p) => p.url.includes('page=2'))).toBe(true))
    expect(shown(result)).toEqual(['a1'])
    expect(result.current.props.rowsLoading).toBe(false)
  })

  it('a search keystroke keeps the rows until its answer, as before', async () => {
    const { result, rerender } = renderPage()
    await waitFor(() => expect(pending).toHaveLength(1))
    act(() => answer(() => true, ROWS_A))
    await waitFor(() => expect(shown(result)).toEqual(['a1']))
    rerender({ filters: VIEW_A, search: 'MSKU' })
    await waitFor(() => expect(pending.some((p) => p.url.includes('q=MSKU'))).toBe(true))
    expect(shown(result)).toEqual(['a1'])
    expect(result.current.props.rowsLoading).toBe(false)
  })

  it('back to a view already loaded: its rows from the cache, nothing loading', async () => {
    const { result, rerender } = renderPage()
    await waitFor(() => expect(pending).toHaveLength(1))
    act(() => answer(hasFilter(VIEW_A), ROWS_A))
    await waitFor(() => expect(shown(result)).toEqual(['a1']))
    rerender({ filters: VIEW_B })
    await waitFor(() => expect(pending.some((p) => hasFilter(VIEW_B)(p.url))).toBe(true))
    act(() => answer(hasFilter(VIEW_B), ROWS_B))
    await waitFor(() => expect(shown(result)).toEqual(['b1']))
    rerender({ filters: VIEW_A })
    await waitFor(() => expect(shown(result)).toEqual(['a1']))
    expect(result.current.props.rowsLoading).toBe(false)
  })
})

/**
 * CHECK-OMM52 (omm #52): two mutants of the question survived the tests above —
 *   M5: the scope deps (`queryKeyDeps`, the organization) left out of it: another organization's rows stayed on screen
 *       as this one's while its list loaded;
 *   M6: lookups / rollups put into it: adding a column to the rows on screen blanked them.
 */
describe('the scope and the extra columns (CHECK-OMM52 M5, M6)', () => {
  it('another scope (organization): its rows are another question — the previous scope\'s are not shown while it loads', async () => {
    const { result, rerender } = renderPage({ filters: VIEW_A, scope: 'org-a' })
    await waitFor(() => expect(pending).toHaveLength(1))
    act(() => answer(() => true, ROWS_A))
    await waitFor(() => expect(shown(result)).toEqual(['a1']))

    rerender({ filters: VIEW_A, scope: 'org-b' })
    await waitFor(() => expect(pending.length).toBeGreaterThan(0))
    expect(shown(result)).toEqual([])
    expect(result.current.props.rowsLoading).toBe(true)
    act(() => answer(() => true, ROWS_B))
    await waitFor(() => expect(shown(result)).toEqual(['b1']))
    expect(result.current.props.rowsLoading).toBe(false)
  })

  it('a lookup or rollup column added: the same rows with one more column — kept until the answer, nothing loading', async () => {
    const props: PageProps = { filters: VIEW_A, views: true }
    const { result, rerender } = renderPage(props)
    // The saved views first (the list waits for them), none.
    await waitFor(() => expect(pending.some((p) => p.url.startsWith('/api/perspectives'))).toBe(true))
    act(() => {
      const i = pending.findIndex((p) => p.url.startsWith('/api/perspectives'))
      pending.splice(i, 1)[0]!.resolve({ ok: true, result: { perspectives: [], defaultPerspectiveId: null } })
    })
    await waitFor(() => expect(pending.some((p) => p.url.startsWith('/api/boxes'))).toBe(true))
    act(() => answer((u) => u.startsWith('/api/boxes'), ROWS_A))
    await waitFor(() => expect(shown(result)).toEqual(['a1']))
    // The grid announces its column changes as PERSPECTIVE_CHANGE on its element.
    const el = document.createElement('div')
    document.body.appendChild(el)
    ;(result.current.props.tableRef as { current: HTMLElement | null }).current = el
    await act(async () => { rerender(props) })
    await act(async () => { rerender(props) })

    act(() => { dispatch(el, TableEvents.PERSPECTIVE_CHANGE, { config: { rollupColumns: [{ source: 'lines', field: 'grossWeight', fn: 'sum', label: 'Lines · Sum of Gross weight' }] } } as never) })
    await waitFor(() => expect(pending.some((p) => p.url.includes('rollups='))).toBe(true))
    expect(shown(result)).toEqual(['a1'])
    expect(result.current.props.rowsLoading).toBe(false)
    act(() => answer((u) => u.includes('rollups='), ROWS_A))
    await waitFor(() => expect(pending.some((p) => p.url.includes('rollups='))).toBe(false))

    act(() => { dispatch(el, TableEvents.PERSPECTIVE_CHANGE, { config: { lookupColumns: [{ source: 'contractor', field: 'name', label: 'Contractor · Name' }] } } as never) })
    await waitFor(() => expect(pending.some((p) => p.url.includes('lookups='))).toBe(true))
    expect(shown(result)).toEqual(['a1'])
    expect(result.current.props.rowsLoading).toBe(false)
  })
})

describe('DynamicTable — rowsLoading', () => {
  function renderTable(props: Record<string, unknown>) {
    function Harness() {
      const tableRef = React.useRef<HTMLDivElement | null>(null)
      return React.createElement(
        I18nProvider as any,
        { locale: 'en', dict: {} },
        React.createElement(DynamicTable as any, { data: [], columns, tableRef, tableName: 'Boxes', height: 400, loadError: false, ...props }),
      )
    }
    return render(React.createElement(Harness))
  }

  it('with no rows, the body loads — never "Nothing here yet" for a view still on its way', () => {
    const { container } = renderTable({ rowsLoading: true })
    expect(container.querySelector('[data-rows-loading]')).not.toBeNull()
    expect(screen.queryByText(/nothing here yet/i)).not.toBeInTheDocument()
  })

  it('without it, an empty answer is still the empty state', () => {
    const { container } = renderTable({})
    expect(container.querySelector('[data-rows-loading]')).toBeNull()
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument()
  })
})
