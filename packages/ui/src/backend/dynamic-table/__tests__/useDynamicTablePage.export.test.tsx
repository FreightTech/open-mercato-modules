/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall } from '../../utils/apiCall'
import { useDynamicTablePage } from '../hooks/useDynamicTablePage'
import type { ColumnDef, ExportAllResult } from '../types/index'

// onExportAll powers the toolbar whole-table export: it must page through every
// row of `source`, drop the active perspective's filters/search, keep
// extraParams (tab/category scope), and map rows through mapApiItem.

jest.mock('../../utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('../../FlashMessages', () => ({ flash: jest.fn() }))

const TOTAL = 250
const columns: ColumnDef[] = [
  { data: 'name', title: 'Name' },
  { data: 'role', title: 'Role' },
]

function setupApi() {
  ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
    const u = new URL(url, 'http://test.local')
    if (u.pathname.startsWith('/api/perspectives')) {
      return { ok: true, result: { perspectives: [] } }
    }
    const page = Number(u.searchParams.get('page') || '1')
    const limit = Number(u.searchParams.get('limit') || '50')
    const start = (page - 1) * limit
    const count = Math.max(0, Math.min(limit, TOTAL - start))
    const items = Array.from({ length: count }, (_, k) => ({
      id: `row-${start + k}`,
      name: `Name ${start + k}`,
      role: `Role ${start + k}`,
      _secret: 'internal',
    }))
    return { ok: true, result: { items, total: TOTAL, totalPages: Math.ceil(TOTAL / limit) } }
  })
}

function renderTablePage(config: Partial<Parameters<typeof useDynamicTablePage>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
  return renderHook(
    () =>
      useDynamicTablePage({
        source: '/api/things',
        columns,
        tableName: 'Things',
        mapApiItem: (item: any) => ({ id: item.id, name: item.name, role: item.role }),
        ...config,
      }),
    { wrapper },
  )
}

/** All export-time fetches use limit=100; the initial live query uses limit=50. */
function exportCallUrls(): URL[] {
  return (apiCall as jest.Mock).mock.calls
    .map((c) => new URL(c[0] as string, 'http://test.local'))
    .filter((u) => u.searchParams.get('limit') === '100')
}

describe('useDynamicTablePage — onExportAll (whole-table export)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setupApi()
  })

  it('pages through the entire dataset and maps every row', async () => {
    const { result } = renderTablePage()
    await waitFor(() => expect(result.current.props.onExportAll).toBeDefined())

    // HEDGE-123: the result now carries its own counts, so a partial export can
    // never be mistaken for a complete one. A clean walk is `complete: true`.
    const outcome = (await result.current.props.onExportAll!()) as ExportAllResult
    expect(outcome.complete).toBe(true)
    expect(outcome.expected).toBe(TOTAL)
    const rows = outcome.rows
    expect(rows).toHaveLength(TOTAL)
    expect(rows[0]).toEqual({ id: 'row-0', name: 'Name 0', role: 'Role 0' })
    expect(rows[TOTAL - 1]).toEqual({ id: 'row-249', name: 'Name 249', role: 'Role 249' })
    // mapApiItem dropped the internal field
    expect(rows[0]).not.toHaveProperty('_secret')
    // 250 rows / 100 per page → 3 export fetches
    expect(exportCallUrls()).toHaveLength(3)
  })

  it('drops the active filters and search so the export is the whole table', async () => {
    const { result } = renderTablePage({
      initialFilters: [{ id: 'f1', field: 'role', operator: 'is_any_of', values: ['Role 1'] }],
    })
    await waitFor(() => expect(result.current.props.onExportAll).toBeDefined())

    await result.current.props.onExportAll!()
    const urls = exportCallUrls()
    expect(urls.length).toBeGreaterThan(0)
    for (const u of urls) {
      expect(u.searchParams.has('filters')).toBe(false)
      expect(u.searchParams.has('q')).toBe(false)
      expect(u.searchParams.has('search')).toBe(false)
    }
  })

  it('keeps extraParams (tab/category scope) on every export fetch', async () => {
    const { result } = renderTablePage({ extraParams: { tab: 'customer' } })
    await waitFor(() => expect(result.current.props.onExportAll).toBeDefined())

    await result.current.props.onExportAll!()
    const urls = exportCallUrls()
    expect(urls.length).toBeGreaterThan(0)
    for (const u of urls) {
      expect(u.searchParams.get('tab')).toBe('customer')
    }
  })
})

/**
 * HEDGE-123 — the export must ABORT, not shorten.
 *
 * Every case below used to produce the same thing: a shorter array, returned as
 * though the walk had finished. The user got a CSV that opened, had headers,
 * had rows, and was missing the rest — with no error anywhere to notice.
 *
 * This is the CSV mirror of HEDGE-119. There a failed fetch rendered as "no
 * invoices"; here it writes a file that reads as "these are all the invoices",
 * which is worse, because a file looks like an answer. A failure is visible and
 * can be retried; a short export goes into a reconciliation unquestioned.
 */

/** A paging mock with injectable faults. `limit=100` requests are the export. */
function setupPagedApi(opts: {
  total: number
  /** Server-declared page count; defaults to ceil(total/limit). */
  totalPages?: number
  /** Rows returned per export page; defaults to filling the limit. */
  itemsPerPage?: number
  /** This export page answers with an HTTP error. */
  failPage?: number
  /** This export page answers 200 with a body that would not parse. */
  junkPage?: number
}) {
  ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
    const u = new URL(url, 'http://test.local')
    if (u.pathname.startsWith('/api/perspectives')) {
      return { ok: true, result: { perspectives: [] } }
    }
    const page = Number(u.searchParams.get('page') || '1')
    const limit = Number(u.searchParams.get('limit') || '50')
    const isExport = limit === 100

    if (isExport && opts.failPage === page) {
      // A route that threw before serialising — exactly HEDGE-119's shape.
      return { ok: false, status: 500, result: null }
    }
    if (isExport && opts.junkPage === page) {
      // 200, but the body did not parse. `apiCall` reports ok WITH result null,
      // which is why `!call.ok` alone was never enough to catch this.
      return { ok: true, status: 200, result: null }
    }

    const declaredPages = opts.totalPages ?? Math.ceil(opts.total / limit)
    const perPage = opts.itemsPerPage ?? limit
    const start = (page - 1) * perPage
    const count = isExport
      ? Math.max(0, Math.min(perPage, opts.total - start))
      : Math.max(0, Math.min(limit, opts.total - start))
    const items = Array.from({ length: count }, (_, k) => ({ id: `row-${start + k}` }))
    return {
      ok: true,
      status: 200,
      result: { items, total: opts.total, totalPages: isExport ? declaredPages : undefined },
    }
  })
}

async function exportOf(config: Record<string, unknown> = {}) {
  const { result } = renderTablePage({ mapApiItem: undefined, ...config } as never)
  await waitFor(() => expect(result.current.props.onExportAll).toBeDefined())
  return result.current.props.onExportAll!
}

describe('useDynamicTablePage — onExportAll must not truncate silently (HEDGE-123)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('REJECTS when a page fails mid-pagination — page 3 of 5', async () => {
    setupPagedApi({ total: 500, failPage: 3 })
    const run = await exportOf()

    // The user must get an error they can see and retry, NOT a 200-row file.
    await expect(run()).rejects.toThrow(/page 3/)
  })

  it('names the HTTP status and how far it got, so the failure is diagnosable', async () => {
    setupPagedApi({ total: 500, failPage: 3 })
    const run = await exportOf()

    // "Could not export" alone left a user unable to tell a filter problem from
    // a server problem.
    await expect(run()).rejects.toThrow(/HTTP 500/)
    await expect(run()).rejects.toThrow(/200 row\(s\)/)
  })

  it('REJECTS on a 200 whose body will not parse — the case !call.ok misses', async () => {
    setupPagedApi({ total: 500, junkPage: 3 })
    const run = await exportOf()

    await expect(run()).rejects.toThrow(/no readable body/)
    await expect(run()).rejects.toThrow(/page 3/)
  })

  it('never resolves with a short array when a page failed', async () => {
    // The regression stated literally: the old code returned `collected` here.
    setupPagedApi({ total: 500, failPage: 3 })
    const run = await exportOf()

    let resolved: unknown = 'did-not-resolve'
    await run().then(
      (v) => { resolved = v },
      () => { /* expected */ },
    )
    expect(resolved).toBe('did-not-resolve')
  })

  it('walks PAST the old 1000-iteration ceiling instead of stopping at it', async () => {
    // `while (guard++ < 1000)` at limit 100 was a silent 100,000-row cap — a
    // truncation for a reason that had nothing to do with failure. 1100 pages
    // proves the bound now comes from the server, not from a constant.
    setupPagedApi({ total: 1100, totalPages: 1100, itemsPerPage: 1 })
    const run = await exportOf()

    const outcome = (await run()) as ExportAllResult
    expect(outcome.complete).toBe(true)
    expect(outcome.rows).toHaveLength(1100)
    expect(exportCallUrls().length).toBeGreaterThan(1000)
  })

  it('reports a count shortfall with BOTH numbers rather than hiding it', async () => {
    // Server says 500 exist but only serves 300. Rows were fetched, so this is
    // not a throw — but it must never look complete.
    setupPagedApi({ total: 500, totalPages: 3 })
    const run = await exportOf()

    const outcome = (await run()) as ExportAllResult
    expect(outcome.complete).toBe(false)
    expect(outcome.expected).toBe(500)
    expect(outcome.rows).toHaveLength(300)
    expect(outcome.reason).toMatch(/300 of 500/)
  })

  it('marks a clean walk complete, so the honest case still yields a file', async () => {
    setupPagedApi({ total: 250 })
    const run = await exportOf()

    const outcome = (await run()) as ExportAllResult
    expect(outcome.complete).toBe(true)
    expect(outcome.reason).toBeUndefined()
    expect(outcome.rows).toHaveLength(250)
  })

  it('is complete for an empty table — zero rows is a real answer', async () => {
    setupPagedApi({ total: 0 })
    const run = await exportOf()

    const outcome = (await run()) as ExportAllResult
    expect(outcome.complete).toBe(true)
    expect(outcome.rows).toHaveLength(0)
  })

  it('REJECTS when the very first page fails — nothing to hand over at all', async () => {
    setupPagedApi({ total: 500, failPage: 1 })
    const run = await exportOf()

    await expect(run()).rejects.toThrow(/page 1/)
  })
})
