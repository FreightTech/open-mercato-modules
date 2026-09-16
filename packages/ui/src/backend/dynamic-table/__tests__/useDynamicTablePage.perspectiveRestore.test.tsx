/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall } from '../../utils/apiCall'
import { useDynamicTablePage } from '../hooks/useDynamicTablePage'
import type { ColumnDef } from '../types/index'

/**
 * Ledger 7.8 — a saved view's SORT (and its filters, rollups and aggregations)
 * must reach the LIST REQUEST on first load, not only after the user clicks the
 * tab a second time.
 *
 * The grid applies the view to itself and announces it with PERSPECTIVE_CHANGE,
 * but on mount that dispatch races this hook's own listener registration and
 * loses — child passive effects run before the parent's. So the hook reads the
 * restored view's config directly. These tests pin the request, which is the
 * only thing the user can actually see.
 */

jest.mock('../../utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('../../FlashMessages', () => ({ flash: jest.fn() }))

const columns: ColumnDef[] = [
  { data: 'name', title: 'Name' },
  { data: 'reference', title: 'Reference' },
  { data: 'status', title: 'Status' },
]

const SAVED_VIEW = {
  id: 'view-1',
  name: 'Sea imports',
  isDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  settings: {
    columnOrder: ['name', 'reference', 'status'],
    columnVisibility: { name: true, reference: true, status: true },
    sorting: [{ id: 'reference', desc: true }],
    filters: {
      v: 2,
      rows: [{ id: 'f1', field: 'status', operator: 'is_any_of', values: ['PRE_ARRIVAL'] }],
    },
  },
}

/** Every list URL the hook asked for, in order. */
function listCalls(): string[] {
  return (apiCall as jest.Mock).mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith('/api/things?'))
}

function setupApi(perspectives: unknown[]) {
  ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
    if (url.startsWith('/api/perspectives')) {
      return { ok: true, result: { perspectives, defaultPerspectiveId: 'view-1' } }
    }
    return { ok: true, result: { items: [], total: 0, totalPages: 1 } }
  })
}

function renderTablePage(config: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
  return renderHook(
    () =>
      useDynamicTablePage({
        source: '/api/things',
        columns,
        tableName: 'Things',
        perspectives: 'things',
        defaultSort: { field: 'name', direction: 'asc' },
        ...config,
      } as Parameters<typeof useDynamicTablePage>[0]),
    { wrapper },
  )
}

beforeEach(() => {
  ;(apiCall as jest.Mock).mockReset()
  // sessionStorage remembers the last view across tests otherwise.
  window.sessionStorage.clear()
})

describe('a restored view reaches the list request on first load', () => {
  it('applies the saved sort without a second tab click', async () => {
    setupApi([SAVED_VIEW])
    const { result } = renderTablePage()

    await waitFor(() => expect(result.current.state.sortField).toBe('reference'))
    expect(result.current.state.sortDir).toBe('desc')
    await waitFor(() =>
      expect(listCalls().some((u) => u.includes('sortField=reference&sortDir=desc'))).toBe(true),
    )
  })

  it('applies the saved filters', async () => {
    setupApi([SAVED_VIEW])
    const { result } = renderTablePage()

    await waitFor(() => expect(result.current.state.filters).toHaveLength(1))
    expect(result.current.state.filters[0].field).toBe('status')
  })

  it('leaves URL-seeded filters alone when the view carries none', async () => {
    setupApi([{ ...SAVED_VIEW, settings: { ...SAVED_VIEW.settings, filters: { v: 2, rows: [] } } }])
    const seeded = [{ id: 'url', field: 'name', operator: 'contains', values: ['acme'] }]
    const { result } = renderTablePage({ initialFilters: seeded })

    await waitFor(() => expect(result.current.state.sortField).toBe('reference'))
    expect(result.current.state.filters).toEqual(seeded)
  })

  it('keeps the table default sort when the view has none', async () => {
    setupApi([{ ...SAVED_VIEW, settings: { ...SAVED_VIEW.settings, sorting: [] } }])
    const { result } = renderTablePage()

    await waitFor(() => expect(result.current.props.savedPerspectives).toHaveLength(1))
    expect(result.current.state.sortField).toBe('name')
    expect(result.current.state.sortDir).toBe('asc')
  })
})
