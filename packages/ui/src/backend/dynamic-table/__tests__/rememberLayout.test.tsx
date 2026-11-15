/**
 * @jest-environment jsdom
 *
 * EVERY TABLE REMEMBERS THE PERSON'S LAYOUT — AND NO TABLE GROWS A VIEWS BAR FOR IT (0.14.32).
 *
 * GT, Air Export feedback 13.11 [00:21:08] — "czy każdy indywidualnie może zapisywać widok?": a column hidden in a
 * folder's flights came back on every visit, because that table's page keeps no saved views, and the grid only ever
 * wrote a hidden column through a host that does. The first fix (GEPARD-283, in one host) also brought that host's
 * views bar back as the only way to show the column again; the owner (15.11) wants neither: every table, in the grid
 * itself, nothing written until the person changes something, no views bar, and one small "changed view" button as
 * the way back.
 */

import * as React from 'react'
import { render, act, waitFor, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import { TableEvents } from '../types/index'
import type { ColumnDef } from '../types/index'
import type { PerspectiveConfig, PerspectiveSaveEvent } from '../types/perspective'
import { BASE_VIEW_PERSPECTIVE_NAME } from '../types/perspective'
import { __resetOwnBaseViewCache } from '../hooks/useOwnBaseView'
import { apiCall } from '@freighttech/ui/backend/utils/apiCall'

jest.mock('@freighttech/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('@freighttech/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
const mockApiCall = apiCall as unknown as jest.Mock

const columns: ColumnDef[] = [
  { data: 'leg', title: 'Odcinek' },
  { data: 'from', title: 'Z' },
  { data: 'carrier', title: 'Przewoźnik' },
  { data: 'etd', title: 'ETD' },
]
const rows = [
  { id: '1', leg: '1', from: 'KTW', carrier: 'LO', etd: '2026-11-20' },
  { id: '2', leg: '2', from: 'WAW', carrier: 'AF', etd: '2026-11-18' },
]

type Call = { url: string; method: string; body?: any }
let calls: Call[] = []
let serverRows: Array<{ id: string; name: string; settings: any }> = []

function serve() {
  mockApiCall.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) : undefined
    // Only the perspectives route is this test's business (the grid also asks /api/auth/feature-check).
    if (!url.startsWith('/api/perspectives')) return { ok: false, result: null }
    calls.push({ url, method, body })
    if (method === 'GET') return { ok: true, result: { perspectives: serverRows, rolePerspectives: [], defaultPerspectiveId: null } }
    return { ok: true, result: { perspective: { id: body?.perspectiveId ?? 'srv-1' } } }
  })
}

const writes = () => calls.filter((c) => c.method === 'POST')

function Grid(props: Record<string, unknown>) {
  const tableRef = React.useRef<HTMLDivElement | null>(null)
  const onEvent = props.onEvent as ((name: string, detail: unknown) => void) | undefined
  React.useEffect(() => {
    const el = tableRef.current
    if (!el || !onEvent) return
    const names = [TableEvents.PERSPECTIVE_SAVE, TableEvents.PERSPECTIVE_CHANGE]
    const listeners = names.map((name) => {
      const l = (e: Event) => onEvent(name, (e as CustomEvent).detail)
      el.addEventListener(name, l)
      return [name, l] as const
    })
    return () => listeners.forEach(([n, l]) => el.removeEventListener(n, l))
  }, [onEvent])
  return React.createElement(DynamicTable as any, { data: rows, columns, tableRef, height: 400, ...props })
}

function mount(props: Record<string, unknown> = {}) {
  return render(React.createElement(I18nProvider as any, { locale: 'en', dict: {} }, React.createElement(Grid, props)))
}

const headers = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('th.hot-col-header')].map((th) => th.getAttribute('data-col-key') ?? th.textContent?.trim())
const headerText = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('th.hot-col-header')].map((th) => th.textContent ?? '').join('|')

function openColumnMenu(container: HTMLElement, title: string) {
  const th = [...container.querySelectorAll<HTMLElement>('th.hot-col-header')].find((h) => (h.textContent ?? '').includes(title))
  if (!th) throw new Error(`no header ${title}`)
  const kebab = th.querySelector<HTMLElement>('.hot-col-kebab')
  if (!kebab) throw new Error('no column menu trigger')
  act(() => { kebab.click() })
}
function hide(container: HTMLElement, title: string) {
  openColumnMenu(container, title)
  const item = [...document.querySelectorAll<HTMLElement>('.hot-col-menu-item')].find((b) => /hide field/i.test(b.textContent ?? ''))
  if (!item) throw new Error('no hide action')
  act(() => { item.click() })
}
function sortAsc(container: HTMLElement, title: string) {
  openColumnMenu(container, title)
  const item = [...document.querySelectorAll<HTMLElement>('.hot-col-menu-item')].filter((b) => /^\s*sort/i.test(b.textContent ?? ''))[0]
  if (!item) throw new Error('no sort action')
  act(() => { item.click() })
}

const viewsBar = () => document.querySelector('.hot-top-tabs-v2')
const changedButton = () => document.querySelector<HTMLElement>('[data-view-changed]')

beforeEach(() => {
  calls = []
  serverRows = []
  __resetOwnBaseViewCache()
  mockApiCall.mockReset()
  serve()
})

describe('a table whose page keeps no views', () => {
  it('reads the person\'s row once and writes nothing on load', async () => {
    mount({ tableId: 'folders.teczka.flights' })
    await waitFor(() => expect(calls.some((c) => c.method === 'GET')).toBe(true))
    expect(calls[0].url).toBe('/api/perspectives/folders.teczka.flights')
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(writes()).toHaveLength(0)
    expect(changedButton()).toBeNull()
  })

  it('writes the person\'s __base__ row the first time they hide a column', async () => {
    const { container } = mount({ tableId: 'folders.teczka.flights' })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    hide(container, 'Przewoźnik')
    await waitFor(() => expect(writes()).toHaveLength(1))
    const body = writes()[0].body
    expect(writes()[0].url).toBe('/api/perspectives/folders.teczka.flights')
    expect(body.name).toBe(BASE_VIEW_PERSPECTIVE_NAME)
    expect(body.isDefault).toBe(false)
    expect(body.settings.columnVisibility.carrier).toBe(false)
    expect(headerText(container)).not.toContain('Przewoźnik')
  })

  it('opens the next time with the columns the person hid, still writing nothing', async () => {
    serverRows = [{
      id: 'row-7',
      name: BASE_VIEW_PERSPECTIVE_NAME,
      settings: { columnOrder: ['from', 'etd', 'leg', 'carrier'], columnVisibility: { from: true, etd: true, leg: false, carrier: false }, filters: { _baseView: true } },
    }]
    const { container } = mount({ tableId: 'folders.teczka.flights' })
    await waitFor(() => expect(headerText(container)).not.toContain('Odcinek'))
    expect(headerText(container)).not.toContain('Przewoźnik')
    expect(headerText(container)).toContain('ETD')
    expect(writes()).toHaveLength(0)
  })

  it('keeps a sort chosen on the default tab, and tells the host the restored sort', async () => {
    const { container } = mount({ tableId: 't.sort' })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    sortAsc(container, 'ETD')
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0].body.settings.sorting).toEqual([{ id: 'etd', desc: false }])

    // Next visit: the row carries the sort, and a host that sorts the rows itself hears it.
    serverRows = [{ id: 'srv-1', name: BASE_VIEW_PERSPECTIVE_NAME, settings: writes()[0].body.settings }]
    __resetOwnBaseViewCache()
    const events: Array<{ name: string; detail: any }> = []
    mount({ tableId: 't.sort', onEvent: (name: string, detail: unknown) => events.push({ name, detail }) })
    await waitFor(() =>
      expect(events.some((e) => e.name === TableEvents.PERSPECTIVE_CHANGE && e.detail?.config?.sorting?.[0]?.field === 'etd')).toBe(true),
    )
  })

  it('never shows the views bar for the person\'s own row', async () => {
    serverRows = [{ id: 'row-7', name: BASE_VIEW_PERSPECTIVE_NAME, settings: { columnOrder: ['leg', 'from', 'etd'], columnVisibility: { carrier: false }, filters: { _baseView: true } } }]
    const { container } = mount({ tableId: 'folders.teczka.flights' })
    await waitFor(() => expect(headerText(container)).not.toContain('Przewoźnik'))
    expect(viewsBar()).toBeNull()
  })

  it('shows the changed-view button only while the layout differs, and "Show" brings the column back and keeps it', async () => {
    const { container } = mount({ tableId: 'folders.teczka.flights' })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(changedButton()).toBeNull()

    hide(container, 'Przewoźnik')
    await waitFor(() => expect(changedButton()).not.toBeNull())
    expect(changedButton()!.getAttribute('data-view-changed-hidden')).toBe('1')

    act(() => { changedButton()!.click() })
    const show = document.querySelector<HTMLElement>('[data-view-changed-show="carrier"]')
    expect(show).not.toBeNull()
    act(() => { show!.click() })

    expect(headerText(container)).toContain('Przewoźnik')
    // Back where the table declares it: after "Z", before "ETD".
    expect(headerText(container).indexOf('Przewoźnik')).toBeGreaterThan(headerText(container).indexOf('Z'))
    expect(headerText(container).indexOf('Przewoźnik')).toBeLessThan(headerText(container).indexOf('ETD'))
    await waitFor(() => expect(writes()).toHaveLength(2))
    expect(writes()[1].body.settings.columnVisibility.carrier).toBe(true)
    expect(writes()[1].body.perspectiveId).toBe('srv-1')
    await waitFor(() => expect(changedButton()).toBeNull())
  })

  it('"Restore default" empties the person\'s row (never deletes it) and shows every column again', async () => {
    serverRows = [{ id: 'row-7', name: BASE_VIEW_PERSPECTIVE_NAME, settings: { columnOrder: ['leg', 'from', 'etd'], columnVisibility: { carrier: false }, filters: { _baseView: true } } }]
    const { container } = mount({ tableId: 'folders.teczka.flights' })
    await waitFor(() => expect(changedButton()).not.toBeNull())
    act(() => { changedButton()!.click() })
    act(() => { document.querySelector<HTMLElement>('[data-view-changed-reset]')!.click() })
    const confirm = [...document.querySelectorAll<HTMLElement>('button')].find((b) => /restore|reset/i.test(b.textContent ?? '') && !b.hasAttribute('data-view-changed-reset'))
    expect(confirm).toBeTruthy()
    act(() => { fireEvent.click(confirm!) })
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0].body.perspectiveId).toBe('row-7')
    expect(writes()[0].body.settings.columnOrder ?? []).toEqual([])
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(headerText(container)).toContain('Przewoźnik')
    await waitFor(() => expect(changedButton()).toBeNull())
  })

  it('`rememberLayout: false` reads and writes nothing', async () => {
    const { container } = mount({ tableId: 'x', uiConfig: { rememberLayout: false } })
    hide(container, 'Przewoźnik')
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(calls).toHaveLength(0)
    // The way back is there all the same.
    expect(changedButton()).not.toBeNull()
  })

  it('a table without a tableId reads and writes nothing', async () => {
    const { container } = mount({})
    hide(container, 'Przewoźnik')
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(calls).toHaveLength(0)
  })
})

describe('a table whose host keeps views', () => {
  const base: PerspectiveConfig = {
    id: 'base-1',
    name: BASE_VIEW_PERSPECTIVE_NAME,
    isBaseView: true,
    columns: { visible: ['leg', 'from', 'etd'], hidden: ['carrier'] },
    filters: [],
    sorting: [],
  }
  const named: PerspectiveConfig = { id: 'v-1', name: 'Moje', columns: { visible: ['leg'], hidden: ['from', 'carrier', 'etd'] }, filters: [], sorting: [] }

  it('still saves through the host, never by itself', () => {
    const saves: PerspectiveSaveEvent[] = []
    const { container } = mount({
      tableId: 'host.table',
      savedPerspectives: [],
      activePerspectiveId: null,
      onEvent: (name: string, detail: unknown) => { if (name === TableEvents.PERSPECTIVE_SAVE) saves.push(detail as PerspectiveSaveEvent) },
    })
    hide(container, 'Przewoźnik')
    expect(saves).toHaveLength(1)
    expect(saves[0].perspective.isBaseView).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('shows no views bar when the person has only their own default view, and the changed-view button instead', () => {
    mount({ tableId: 'host.table', savedPerspectives: [base], activePerspectiveId: 'base-1' })
    expect(viewsBar()).toBeNull()
    expect(changedButton()).not.toBeNull()
  })

  it('shows the views bar when there is a named view to switch to', () => {
    mount({ tableId: 'host.table', savedPerspectives: [base, named], activePerspectiveId: 'base-1' })
    expect(viewsBar()).not.toBeNull()
    expect(changedButton()).toBeNull()
  })

  it('writes a sort chosen on the default tab into the person\'s default view', () => {
    const saves: PerspectiveSaveEvent[] = []
    const { container } = mount({
      tableId: 'host.table',
      savedPerspectives: [base],
      activePerspectiveId: 'base-1',
      onEvent: (name: string, detail: unknown) => { if (name === TableEvents.PERSPECTIVE_SAVE) saves.push(detail as PerspectiveSaveEvent) },
    })
    sortAsc(container, 'ETD')
    expect(saves).toHaveLength(1)
    expect(saves[0].silent).toBe(true)
    expect(saves[0].perspective.id).toBe('base-1')
    expect(saves[0].perspective.sorting).toEqual([expect.objectContaining({ field: 'etd', direction: 'asc' })])
  })

  it('leaves a named view\'s saved sort alone', () => {
    const saves: PerspectiveSaveEvent[] = []
    const { container } = mount({
      tableId: 'host.table',
      columns: columns,
      savedPerspectives: [base, { ...named, columns: { visible: ['leg', 'etd'], hidden: ['from', 'carrier'] } }],
      activePerspectiveId: 'v-1',
      onEvent: (name: string, detail: unknown) => { if (name === TableEvents.PERSPECTIVE_SAVE) saves.push(detail as PerspectiveSaveEvent) },
    })
    sortAsc(container, 'ETD')
    expect(saves).toHaveLength(0)
  })
})
