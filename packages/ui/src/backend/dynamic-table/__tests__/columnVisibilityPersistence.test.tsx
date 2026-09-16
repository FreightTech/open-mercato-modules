import * as React from 'react'
import { render, act } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import { TableEvents } from '../types/index'
import type { ColumnDef } from '../types/index'
import type { PerspectiveConfig, PerspectiveSaveEvent } from '../types/perspective'
import { BASE_VIEW_PERSPECTIVE_NAME } from '../types/perspective'

/**
 * HEDGE-7 — HIDING A COLUMN MUST SURVIVE A RELOAD.
 *
 * The reported defect, and the reason it was so convincing: "Hide field" in the
 * column menu moved `visibleColumns`/`hiddenColumns` and stopped there. No
 * request left the browser, no dirty marker appeared, no Save button existed —
 * so the change looked done, and the reload that undid it read as the app
 * forgetting rather than as the user not saving. The client described it as
 * "it went back to the earlier settings", not "I didn't save".
 *
 * The mechanism was never missing: a header drag has written through to the
 * user's view since ledger 7.11 (see `columnReorderPersistence.test.tsx`). One
 * of the three callers simply did not call it. These tests pin the CALL, and
 * they pin the same shape the reorder test does — because the whole point is
 * that there is one writer, not two that drift.
 */

const columns: ColumnDef[] = [
  { data: 'client', title: 'Client' },
  { data: 'amount', title: 'Amount' },
  { data: 'status', title: 'Status' },
]

const rows = [{ id: '1', client: 'Acme', amount: 100, status: 'draft' }]

function renderGrid(props: Record<string, unknown>) {
  const saves: PerspectiveSaveEvent[] = []
  function Harness() {
    const tableRef = React.useRef<HTMLDivElement | null>(null)
    React.useEffect(() => {
      const el = tableRef.current
      if (!el) return
      const onSave = (e: Event) => saves.push((e as CustomEvent<PerspectiveSaveEvent>).detail)
      el.addEventListener(TableEvents.PERSPECTIVE_SAVE, onSave)
      return () => el.removeEventListener(TableEvents.PERSPECTIVE_SAVE, onSave)
    }, [])
    return React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(DynamicTable as any, {
        data: rows,
        columns,
        tableRef,
        height: 400,
        ...props,
      }),
    )
  }
  const utils = render(React.createElement(Harness))
  return { ...utils, saves }
}

/** Drive the hide through the real menu action, not a hand-rolled copy of it. */
function hideColumn(container: HTMLElement, colIndex: number) {
  const th = container.querySelector<HTMLElement>(`th.hot-col-header[data-col="${colIndex}"]`)
  if (!th) throw new Error(`no header at ${colIndex}`)
  const kebab = th.querySelector<HTMLElement>('.hot-col-kebab')
  if (!kebab) throw new Error('no column menu trigger')
  act(() => { kebab.click() })
  const item = [...document.querySelectorAll('.hot-col-menu-item')].find((b) =>
    /hide field/i.test(b.textContent ?? ''),
  ) as HTMLElement | undefined
  if (!item) throw new Error('no hide action in the column menu')
  act(() => { item.click() })
}

const savedView: PerspectiveConfig = {
  id: 'view-1',
  name: 'Mine',
  columns: { visible: ['client', 'amount', 'status'], hidden: [] },
  // The saved view has NO filters; the live grid may.
  filters: [],
  sorting: [{ id: 's', field: 'client', direction: 'asc' }],
  grouping: [],
}

it('writes the new column set into the active view, silently', () => {
  const { container, saves } = renderGrid({
    savedPerspectives: [savedView],
    activePerspectiveId: 'view-1',
  })

  hideColumn(container, 1) // Amount

  expect(saves).toHaveLength(1)
  expect(saves[0].silent).toBe(true)
  expect(saves[0].perspective.id).toBe('view-1')
  expect(saves[0].perspective.columns.visible).toEqual(['client', 'status'])
  expect(saves[0].perspective.columns.hidden).toEqual(['amount'])
  // Untouched fields come from the SAVED row, not from live grid state — an
  // ad-hoc quick filter must not ride along on a hide.
  expect(saves[0].perspective.sorting).toEqual(savedView.sorting)
})

it('mints the base-view row when the Default tab has none yet', () => {
  const { container, saves } = renderGrid({
    savedPerspectives: [],
    activePerspectiveId: null,
  })

  hideColumn(container, 0) // Client

  expect(saves).toHaveLength(1)
  expect(saves[0].silent).toBe(true)
  expect(saves[0].perspective.isBaseView).toBe(true)
  expect(saves[0].perspective.name).toBe(BASE_VIEW_PERSPECTIVE_NAME)
  expect(saves[0].perspective.columns.visible).toEqual(['amount', 'status'])
  expect(saves[0].perspective.columns.hidden).toEqual(['client'])
})

it('an uncontrolled grid (no perspective host) writes nothing', () => {
  const { container, saves } = renderGrid({})
  hideColumn(container, 0)
  expect(saves).toHaveLength(0)
})

it('does not invent a base row for a named view whose row has not loaded', () => {
  // The host knows which view is active but has not delivered the row yet.
  // Minting `__base__` here would write the user\'s named-view column set into
  // a different row and then apply it on the next load.
  const { container, saves } = renderGrid({
    savedPerspectives: [],
    activePerspectiveId: 'view-1',
  })
  hideColumn(container, 0)
  expect(saves).toHaveLength(0)
})
