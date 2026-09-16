/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall } from '../../utils/apiCall'
import { useDynamicTablePage } from '../hooks/useDynamicTablePage'
import { dispatch } from '../events/events'
import { TableEvents } from '../types/index'
import type { ColumnDef } from '../types/index'
import type { PerspectiveConfig } from '../types/perspective'

/**
 * Ledger 7.13 — duplicating a SHARED view must produce a PRIVATE one.
 *
 * `publication` rides the settings blob as `_published`, so a straight copy of
 * the source's settings produced a second view that reported itself as a
 * published template (its `⋯` menu offered "Update shared template…") while no
 * role rows existed for it at all — duplicate never calls `applyToRoles`.
 */

jest.mock('../../utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('../../FlashMessages', () => ({ flash: jest.fn() }))

const columns: ColumnDef[] = [{ data: 'name', title: 'Name' }]

const PUBLISHED_VIEW: PerspectiveConfig = {
  id: 'view-1',
  name: 'Sea imports',
  columns: { visible: ['name'], hidden: [] },
  filters: [],
  sorting: [],
  grouping: [],
  aggregations: [],
  isDefault: true,
  isBaseView: false,
  publication: { roleIds: ['role-a'], publishedAt: '2026-01-01T00:00:00.000Z' },
}

function renderTablePage() {
  ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
    if (url.startsWith('/api/perspectives')) {
      return { ok: true, result: { perspectives: [] } }
    }
    return { ok: true, result: { items: [], total: 0, totalPages: 1, perspective: { id: 'new-1' } } }
  })
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
      }),
    { wrapper },
  )
}

/** The body of the last POST to /api/perspectives. */
function lastPerspectivePost(): any {
  const call = [...(apiCall as jest.Mock).mock.calls]
    .reverse()
    .find((c) => String(c[0]).startsWith('/api/perspectives') && c[1]?.method === 'POST')
  return call ? JSON.parse(call[1].body) : null
}

it('a duplicate of a published view is not itself published', async () => {
  const { result, rerender } = renderTablePage()
  const el = document.createElement('div')
  document.body.appendChild(el)
  ;(result.current.props.tableRef as any).current = el
  // `useEventHandlers` notices the ref in a LAYOUT effect and only attaches on
  // the render after that, so a bare assignment is not enough.
  await act(async () => { rerender() })
  await act(async () => { rerender() })

  await act(async () => {
    dispatch(el, TableEvents.PERSPECTIVE_DUPLICATE, {
      id: 'view-1',
      newName: 'Sea imports (copy)',
      perspective: PUBLISHED_VIEW,
    })
  })

  await waitFor(() => expect(lastPerspectivePost()).not.toBeNull())
  const body = lastPerspectivePost()
  expect(body.name).toBe('Sea imports (copy)')
  expect(body.isDefault).toBe(false)
  // `_published` is how the tab menu decides to say "Update shared template…".
  expect(body.settings.filters._published).toBeUndefined()
  expect(body.settings.filters._baseView).toBeUndefined()
  // Not an update of the source row.
  expect(body.perspectiveId).toBeUndefined()
})
