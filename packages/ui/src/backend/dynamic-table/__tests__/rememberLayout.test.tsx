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
import { flash } from '@freighttech/ui/backend/FlashMessages'

jest.mock('@freighttech/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('@freighttech/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
const mockApiCall = apiCall as unknown as jest.Mock
const mockFlash = flash as unknown as jest.Mock

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

type Call = { url: string; method: string; body?: any; headers?: Record<string, string> }
let calls: Call[] = []
let serverRows: Array<{ id: string; name: string; settings: any }> = []

function serve() {
  mockApiCall.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) : undefined
    // Only the perspectives route is this test's business (the grid also asks /api/auth/feature-check).
    if (!url.startsWith('/api/perspectives')) return { ok: false, result: null }
    calls.push({ url, method, body, headers: (init as { headers?: Record<string, string> } | undefined)?.headers })
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

const tree = (props: Record<string, unknown>) =>
  React.createElement(I18nProvider as any, { locale: 'en', dict: {} }, React.createElement(Grid, props))
function mount(props: Record<string, unknown> = {}) {
  return render(tree(props))
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
  mockFlash.mockReset()
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

  it('"Configure view" opens the full panel on the person\'s default view, without a name for a view nothing could keep', async () => {
    const { container } = mount({ tableId: 'folders.teczka.flights' })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    hide(container, 'Przewoźnik')
    await waitFor(() => expect(changedButton()).not.toBeNull())
    act(() => { changedButton()!.click() })
    act(() => { document.querySelector<HTMLElement>('[data-view-changed-configure]')!.click() })
    await waitFor(() => expect(document.querySelector('.hot-config-panel')).not.toBeNull())
    expect(document.querySelector('[data-config-view-name]')).toBeNull()
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

describe('review 15.11 (pc2 w1:p6)', () => {
  const twoFa: ColumnDef = { data: 'twofa', title: 'Weryfikacja 2FA' }

  it('a column the page adds after the first render is shown, in its place, with no button and no write', async () => {
    const { container, rerender } = mount({ tableId: 'back-office-roles' })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    rerender(tree({ tableId: 'back-office-roles', columns: [...columns.slice(0, 2), twoFa, ...columns.slice(2)] }))
    await waitFor(() => expect(headerText(container)).toContain('Weryfikacja 2FA'))
    expect(headerText(container).indexOf('Weryfikacja 2FA')).toBeLessThan(headerText(container).indexOf('Przewoźnik'))
    expect(changedButton()).toBeNull()
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(writes()).toHaveLength(0)
  })

  it('…also for a person with a saved row: the new column shows, the one they hid stays hidden', async () => {
    serverRows = [{ id: 'row-7', name: BASE_VIEW_PERSPECTIVE_NAME, settings: { columnOrder: ['leg', 'from', 'carrier', 'etd'], columnVisibility: { leg: true, from: true, carrier: false, etd: true }, filters: { _baseView: true } } }]
    const { container, rerender } = mount({ tableId: 'back-office-roles' })
    await waitFor(() => expect(headerText(container)).not.toContain('Przewoźnik'))
    rerender(tree({ tableId: 'back-office-roles', columns: [...columns, twoFa] }))
    await waitFor(() => expect(headerText(container)).toContain('Weryfikacja 2FA'))
    expect(headerText(container)).not.toContain('Przewoźnik')
    expect(changedButton()!.getAttribute('data-view-changed-hidden')).toBe('1')
  })

  it('…but not a column the table hides by default', async () => {
    const { container, rerender } = mount({ tableId: 'back-office-roles', defaultHiddenColumns: ['twofa'] })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    rerender(tree({ tableId: 'back-office-roles', defaultHiddenColumns: ['twofa'], columns: [...columns, twoFa] }))
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(headerText(container)).not.toContain('Weryfikacja 2FA')
    expect(changedButton()).toBeNull()
  })

  it('Configure view renders no view-name field at all on a table that keeps only the default view', async () => {
    const { container } = mount({ tableId: 'folders.teczka.flights' })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    hide(container, 'Przewoźnik')
    await waitFor(() => expect(changedButton()).not.toBeNull())
    act(() => { changedButton()!.click() })
    act(() => { document.querySelector<HTMLElement>('[data-view-changed-configure]')!.click() })
    await waitFor(() => expect(document.querySelector('.hot-config-panel')).not.toBeNull())
    expect(document.querySelector('[data-config-view-name]')).toBeNull()
    expect(document.querySelector('.hot-config-panel input[aria-label="View name"]')).toBeNull()
  })

  it('reads and writes without the 403 → login redirect, and a refusal leaves the table working quietly', async () => {
    mockApiCall.mockImplementation(async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      if (!url.startsWith('/api/perspectives')) return { ok: false, result: null }
      calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers })
      return { ok: false, status: 403, result: { error: 'Forbidden' } }
    })
    const { container } = mount({ tableId: 'no.perspectives.use' })
    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0].headers?.['x-om-forbidden-redirect']).toBe('0')
    hide(container, 'Przewoźnik')
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(headerText(container)).not.toContain('Przewoźnik')
    expect(changedButton()).not.toBeNull()
    expect(writes()).toHaveLength(0)
    expect(mockFlash).not.toHaveBeenCalled()
  })

  it('a refused write is quiet too, and a write carries the same no-redirect header', async () => {
    mockApiCall.mockImplementation(async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      if (!url.startsWith('/api/perspectives')) return { ok: false, result: null }
      const method = init?.method ?? 'GET'
      calls.push({ url, method, headers: init?.headers, body: init?.body ? JSON.parse(init.body) : undefined })
      if (method === 'GET') return { ok: true, status: 200, result: { perspectives: [], rolePerspectives: [] } }
      return { ok: false, status: 403, result: { error: 'Forbidden' } }
    })
    const { container } = mount({ tableId: 'write.refused' })
    await waitFor(() => expect(calls.length).toBe(1))
    hide(container, 'Przewoźnik')
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0].headers?.['x-om-forbidden-redirect']).toBe('0')
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(mockFlash).not.toHaveBeenCalled()
  })

  it('two quick changes: the second write waits for the first and updates the row it created', async () => {
    let releaseFirst: (() => void) | null = null
    mockApiCall.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (!url.startsWith('/api/perspectives')) return { ok: false, result: null }
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(init.body) : undefined
      calls.push({ url, method, body })
      if (method === 'GET') return { ok: true, status: 200, result: { perspectives: [], rolePerspectives: [] } }
      if (!body.perspectiveId) {
        await new Promise<void>((r) => { releaseFirst = r })
        return { ok: true, status: 200, result: { perspective: { id: 'created-1' } } }
      }
      return { ok: true, status: 200, result: { perspective: { id: body.perspectiveId } } }
    })
    const { container } = mount({ tableId: 'quick.writes' })
    await waitFor(() => expect(calls.length).toBe(1))
    hide(container, 'Przewoźnik')
    hide(container, 'Odcinek')
    await waitFor(() => expect(writes()).toHaveLength(1))
    // The second change is not sent while the first (the create) is unanswered.
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(writes()).toHaveLength(1)
    await act(async () => { releaseFirst!() })
    await waitFor(() => expect(writes()).toHaveLength(2))
    expect(writes()[1].body.perspectiveId).toBe('created-1')
    expect(writes()[1].body.settings.columnVisibility.leg).toBe(false)
    expect(mockFlash).not.toHaveBeenCalled()
  })
})

describe('0.14.33 — a table without a toolbar has its way back too', () => {
  const ui = { hideToolbar: true }

  it('the column menu offers hidden columns back, and "Show" shows and keeps the column', async () => {
    const { container } = mount({ tableId: 'folders-teczka-activity', uiConfig: ui })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    openColumnMenu(container, 'Z')
    expect(document.querySelector('[data-col-menu-show-hidden]')).toBeNull()
    act(() => { fireEvent.mouseDown(document.body) }) // close it: nothing to offer yet
    hide(container, 'Przewoźnik')
    await waitFor(() => expect(writes()).toHaveLength(1))
    openColumnMenu(container, 'Z')
    const entry = document.querySelector<HTMLElement>('[data-col-menu-show-hidden]')
    expect(entry).not.toBeNull()
    expect(entry!.textContent).toContain('(1)')
    act(() => { entry!.click() })
    act(() => { document.querySelector<HTMLElement>('[data-col-menu-show="carrier"]')!.click() })
    expect(headerText(container)).toContain('Przewoźnik')
    await waitFor(() => expect(writes().at(-1)!.body.settings.columnVisibility.carrier).toBe(true))
  })

  it('shows the "changed view" button in a header cell of its own after the last column — covering nothing', async () => {
    const { container } = mount({ tableId: 'folders-teczka-activity', uiConfig: ui })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(document.querySelector('.hot-toolbar')).toBeNull()
    expect(changedButton()).toBeNull()
    expect(container.querySelector('[data-header-end-slot]')).toBeNull()
    const rowWidthBefore = parseFloat((container.querySelector('.hot-headers-sticky tr') as HTMLElement).style.width)
    hide(container, 'Przewoźnik')
    await waitFor(() => expect(changedButton()).not.toBeNull())
    expect(changedButton()!.getAttribute('data-view-changed-hidden')).toBe('1')
    // The button is IN the header row, in the last cell — not an overlay on top of a column's header.
    const cells = [...container.querySelectorAll<HTMLElement>('.hot-headers-sticky tr > th')]
    const slot = cells.at(-1)!
    expect(slot.hasAttribute('data-header-end-slot')).toBe(true)
    expect(slot.contains(changedButton())).toBe(true)
    expect(slot.style.width).toBe('40px')
    // The last data column keeps its own funnel and ⋮, outside the slot.
    const lastColumn = cells.at(-2)!
    expect(lastColumn.querySelector('.hot-col-kebab')).not.toBeNull()
    expect(lastColumn.contains(changedButton())).toBe(false)
    // The row is wider by the slot (one column hidden, one 40 px slot added): the columns leave it free.
    const rowWidthAfter = parseFloat((container.querySelector('.hot-headers-sticky tr') as HTMLElement).style.width)
    const hiddenWidth = rowWidthBefore - rowWidthAfter + 40
    expect(hiddenWidth).toBeGreaterThan(0)
    expect(container.querySelector('.hot-pane-float-actions [data-view-changed]')).toBeNull()
  })

  it('…and in the actions column\'s header when the table has one (it is empty there)', async () => {
    const { container } = mount({
      tableId: 'folders-teczka-activity-actions',
      uiConfig: ui,
      actionsRenderer: () => React.createElement('span', null, '⋮'),
    })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    hide(container, 'Przewoźnik')
    await waitFor(() => expect(changedButton()).not.toBeNull())
    const actionsHeader = container.querySelector<HTMLElement>('.hot-headers-sticky th[data-actions-cell="true"]')!
    expect(actionsHeader.contains(changedButton())).toBe(true)
    expect(container.querySelectorAll('.hot-headers-sticky th[data-header-end-slot]')).toHaveLength(0)
  })

  it('"Restore default…" in the column menu asks, then empties the person\'s row', async () => {
    serverRows = [{ id: 'row-9', name: BASE_VIEW_PERSPECTIVE_NAME, settings: { columnOrder: ['leg', 'from', 'etd'], columnVisibility: { carrier: false }, filters: { _baseView: true } } }]
    const { container } = mount({ tableId: 'folders-teczka-activity', uiConfig: ui })
    await waitFor(() => expect(headerText(container)).not.toContain('Przewoźnik'))
    openColumnMenu(container, 'Z')
    act(() => { document.querySelector<HTMLElement>('[data-col-menu-reset-layout]')!.click() })
    const confirm = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((b) => /reset view|przywróć widok/i.test(b.textContent ?? ''))
    expect(confirm).toBeTruthy()
    act(() => { fireEvent.click(confirm!) })
    await waitFor(() => expect(headerText(container)).toContain('Przewoźnik'))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0].body.perspectiveId).toBe('row-9')
    expect(writes()[0].body.settings.columnOrder ?? []).toEqual([])
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

  it('0.14.36 — a host that leaves the id null on its default tab still opens it the way the person left it', () => {
    // split-view's useSavedViews (Księgowość › Zamknięcie, payables, batches…) keeps null for "Widok domyślny" (G14).
    // GEPARD-283 sweep, pc2 w1:p1: Oddział hidden there was written to __base__ and came back after a reload.
    const { container } = mount({ tableId: 'host.table', savedPerspectives: [base, named], activePerspectiveId: null })
    expect(headerText(container)).not.toContain('Przewoźnik')
    expect(headerText(container)).toContain('ETD')
  })

  it('…also when the base row arrives after the table is on screen', () => {
    const { container, rerender } = mount({ tableId: 'host.table', savedPerspectives: [], activePerspectiveId: null })
    expect(headerText(container)).toContain('Przewoźnik')
    rerender(tree({ tableId: 'host.table', savedPerspectives: [base, named], activePerspectiveId: null }))
    expect(headerText(container)).not.toContain('Przewoźnik')
  })

  it('…and the base row the grid just wrote is taken as applied: no re-apply, no second write', () => {
    const saves: PerspectiveSaveEvent[] = []
    const props = {
      tableId: 'host.table',
      activePerspectiveId: null,
      onEvent: (name: string, detail: unknown) => { if (name === TableEvents.PERSPECTIVE_SAVE) saves.push(detail as PerspectiveSaveEvent) },
    }
    const { container, rerender } = mount({ ...props, savedPerspectives: [] })
    hide(container, 'Przewoźnik')
    expect(saves).toHaveLength(1)
    // The host stores it and hands it back with a server id — same columns as on screen.
    const written = { ...saves[0].perspective, id: 'srv-base' }
    rerender(tree({ ...props, savedPerspectives: [written] }))
    expect(headerText(container)).not.toContain('Przewoźnik')
    expect(saves).toHaveLength(1)
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

describe('the table menu (⋯) without a views bar', () => {
  const openMenu = () => {
    const trigger = document.querySelector<HTMLElement>('[data-toolbar-overflow]')
    if (!trigger) throw new Error('no table menu')
    act(() => { trigger.click() })
  }

  it('offers "Configure view…" on a table that keeps the layout by itself, and no "Add view…" nothing could keep', async () => {
    mount({ tableId: 'own.table' })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    openMenu()
    expect(document.querySelector('[data-toolbar-configure-view]')).not.toBeNull()
    expect(document.querySelector('[data-toolbar-add-view]')).toBeNull()
  })

  it('offers "Add view…" too where the host keeps named views', () => {
    mount({ tableId: 'host.table', savedPerspectives: [], activePerspectiveId: null })
    openMenu()
    expect(document.querySelector('[data-toolbar-configure-view]')).not.toBeNull()
    act(() => { document.querySelector<HTMLElement>('[data-toolbar-add-view]')!.click() })
    expect(document.querySelector('.hot-config-panel')).not.toBeNull()
    expect(document.querySelector('[data-config-view-name]')).not.toBeNull()
  })
})

describe('a table in a split-view pane', () => {
  it('lets the table decide about the views bar unless the pane switched it off or on', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { paneHideViews } = require('../split-view/SplitViewHost') as typeof import('../split-view/SplitViewHost')
    expect(paneHideViews(undefined)).toBeUndefined()
    expect(paneHideViews({})).toBeUndefined()
    expect(paneHideViews({ viewsBar: false })).toBe(true)
    expect(paneHideViews({ tabs: false })).toBe(true)
    expect(paneHideViews({ viewsBar: true })).toBe(false)
  })
})

describe('0.14.36 — a table with the built-in column menu off can still hide, remember and give back a column', () => {
  // Small edit grids (folder lines, cost/revenue lines, flight paste, bundle editor…) set disableBuiltinColumnMenu to
  // keep their headers plain. Owner 15.11 (GEPARD-283): every DynamicTable has the layout options.
  const ui = { hideToolbar: true, disableBuiltinColumnMenu: true }
  const items = () => [...document.querySelectorAll<HTMLElement>('.hot-col-menu-item')].map((b) => (b.textContent ?? '').trim())

  it('keeps the classic header (⇅ button, no funnel) and adds a ⋮ with sort, hide — no filter, freeze or move', async () => {
    // Wide columns: a narrow one gives up its ⇅ for the ⋮ (0.14.37, below).
    const { container } = mount({ tableId: 'folders-edit-grid', uiConfig: ui, columns: columns.map((c) => ({ ...c, width: 200 })) })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    const th = [...container.querySelectorAll<HTMLElement>('th.hot-col-header')].find((h) => (h.textContent ?? '').includes('Przewoźnik'))!
    expect(th.querySelector('.hot-col-sort-btn')).not.toBeNull()
    expect(th.querySelector('.hot-col-funnel')).toBeNull()
    expect(th.classList.contains('hot-col-header-modern')).toBe(false)
    openColumnMenu(container, 'Przewoźnik')
    const labels = items()
    expect(labels.some((l) => /^sort/i.test(l))).toBe(true)
    expect(labels.some((l) => /hide field/i.test(l))).toBe(true)
    expect(labels.some((l) => /filter/i.test(l))).toBe(false)
    expect(labels.some((l) => /freeze/i.test(l))).toBe(false)
    expect(labels.some((l) => /move (left|right)/i.test(l))).toBe(false)
  })

  it('hides a column, remembers it, shows the changed-view button, and gives the column back from the menu', async () => {
    const { container, unmount } = mount({ tableId: 'folders-edit-grid', uiConfig: ui })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(writes()).toHaveLength(0)
    hide(container, 'Przewoźnik')
    expect(headerText(container)).not.toContain('Przewoźnik')
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0].body.settings.columnVisibility.carrier).toBe(false)
    await waitFor(() => expect(changedButton()).not.toBeNull())
    unmount()

    // Next visit: the person's row comes back with the column hidden.
    serverRows = [{ id: 'srv-1', name: BASE_VIEW_PERSPECTIVE_NAME, settings: writes()[0].body.settings }]
    __resetOwnBaseViewCache()
    const again = mount({ tableId: 'folders-edit-grid', uiConfig: ui })
    await waitFor(() => expect(headerText(again.container)).not.toContain('Przewoźnik'))
    openColumnMenu(again.container, 'Z')
    const entry = document.querySelector<HTMLElement>('[data-col-menu-show-hidden]')
    expect(entry!.textContent).toContain('(1)')
    act(() => { entry!.click() })
    act(() => { document.querySelector<HTMLElement>('[data-col-menu-show="carrier"]')!.click() })
    expect(headerText(again.container)).toContain('Przewoźnik')
  })

  it('a double-click on the header still opens the host\'s own column actions, not the menu', async () => {
    const { container } = mount({
      tableId: 'folders-edit-grid',
      uiConfig: ui,
      columnActions: () => [{ id: 'host-x', label: 'Host action' }],
    })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    const th = [...container.querySelectorAll<HTMLElement>('th.hot-col-header')].find((h) => (h.textContent ?? '').includes('Z'))!
    act(() => { fireEvent.doubleClick(th) })
    // The host's context menu, as before the change — not the ⋮ layout menu.
    expect(items()).toEqual(['Host action'])
  })
})

describe('0.14.36 — "Restore default" on a table with default groups keeps them after the next visit', () => {
  // GEPARD-283 sweep, pc2 w1:p6: offer › Wycena › Sprzedaż reset, reload → no groups and "Widok zmieniony".
  const grouping = [{ id: 'g-leg', field: 'leg', direction: 'asc' as const }]
  it('writes the table\'s default grouping, and the next visit opens grouped with no changed-view button', async () => {
    serverRows = [{ id: 'row-g', name: BASE_VIEW_PERSPECTIVE_NAME, settings: { columnOrder: ['leg', 'from', 'etd'], columnVisibility: { carrier: false }, filters: { _baseView: true } } }]
    const { container, unmount } = mount({ tableId: 'offers.pricing.sell-lines', uiConfig: { hideToolbar: true }, defaultGrouping: grouping })
    await waitFor(() => expect(headerText(container)).not.toContain('Przewoźnik'))
    openColumnMenu(container, 'Z')
    act(() => { document.querySelector<HTMLElement>('[data-col-menu-reset-layout]')!.click() })
    const confirm = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((b) => /reset view|przywróć widok/i.test(b.textContent ?? ''))
    act(() => { fireEvent.click(confirm!) })
    await waitFor(() => expect(writes()).toHaveLength(1))
    const written = writes()[0].body.settings
    // The row says "grouped the table's way", so no reading of it (own row, host's row, unseen columns or not) can take
    // the empty list for "the person ungrouped it".
    expect(written.grouping).toEqual([expect.objectContaining({ field: 'leg', desc: false })])
    unmount()

    serverRows = [{ id: 'row-g', name: BASE_VIEW_PERSPECTIVE_NAME, settings: written }]
    __resetOwnBaseViewCache()
    calls = []
    const again = mount({ tableId: 'offers.pricing.sell-lines', uiConfig: { hideToolbar: true }, defaultGrouping: grouping })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(headerText(again.container)).toContain('Przewoźnik')
    expect(changedButton()).toBeNull()
  })
})

describe('0.14.37 — the minimal ⋮ is visible on narrow columns, and absent on a column with no title', () => {
  const ui = { hideToolbar: true, disableBuiltinColumnMenu: true }
  const narrowColumns: ColumnDef[] = [
    { data: 'grip', title: '', width: 28 },
    { data: 'leg', title: 'Odcinek', width: 70 },
    { data: 'from', title: 'Z', width: 200 },
  ]
  it('a narrow column keeps its ⋮ (not collapsed) and gives up the ⇅ button instead', async () => {
    const { container } = mount({ tableId: 'folders-edit-grid-narrow', uiConfig: ui, columns: narrowColumns })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    const ths = [...container.querySelectorAll<HTMLElement>('th.hot-col-header')]
    const leg = ths.find((h) => (h.textContent ?? '').includes('Odcinek'))!
    expect(leg.hasAttribute('data-narrow')).toBe(false)
    expect(leg.querySelector('.hot-col-kebab')).not.toBeNull()
    expect(leg.querySelector('.hot-col-sort-btn')).toBeNull()
    const wide = ths.find((h) => (h.textContent ?? '').trim().startsWith('Z'))!
    expect(wide.querySelector('.hot-col-sort-btn')).not.toBeNull()
    expect(wide.querySelector('.hot-col-kebab')).not.toBeNull()
  })
  it('a column with no title (drag grip) has no ⋮', async () => {
    const { container } = mount({ tableId: 'folders-edit-grid-narrow', uiConfig: ui, columns: narrowColumns })
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    const grip = container.querySelector<HTMLElement>('th.hot-col-header[data-col="0"]')!
    expect(grip.querySelector('.hot-col-kebab')).toBeNull()
  })
})
