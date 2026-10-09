/**
 * Saved widget instances, offered by name in the split-view pickers.
 *
 * A widget module may carry `instances: { list }`. The picker lists every
 * instance under its widget, search finds it by name or description, picking
 * one hands the host the widget WITH the instance's settings, and a widget that
 * cannot list (no module, no source, a throwing list, junk rows) costs the
 * picker nothing but its own rows.
 */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { invalidateWidgetInstances, listWidgetInstances } from '../widgetInstances'
import { ContentCatalogList, isSameInstance, useInstanceTitle } from '../../dynamic-table/split-view/ContentPicker'
import { ContentRegistryProvider } from '../../dynamic-table/registry/ContentRegistryContext'
import type { WidgetCatalogEntry } from '../../dynamic-table/registry/widgetCatalog'

jest.mock('../widgetRegistry', () => ({
  loadDashboardWidgetModule: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadDashboardWidgetModule } = require('../widgetRegistry') as { loadDashboardWidgetModule: jest.Mock }

const entry = (id: string, title: string): WidgetCatalogEntry => ({
  id,
  title,
  description: null,
  loaderKey: `${id}:widget`,
  icon: null,
  features: [],
  moduleId: id.split('.')[0],
  defaultSettings: null,
  defaultSize: 'md',
  supportsRefresh: false,
})

const DATA = entry('workflows.data_widget', 'Data widget')
const INFLOWS = entry('invoicing.inflows', 'Inflows')

const dataModule = {
  metadata: { id: DATA.id, title: DATA.title },
  Widget: () => null,
  instances: {
    list: jest.fn(async () => [
      { key: 'w2', title: 'Revenue by carrier', description: 'shipments · Supabase', settings: { widgetId: 'w2' } },
      { key: 'w1', title: 'On-time delivery', description: 'shipments', settings: { widgetId: 'w1' } },
    ]),
  },
}
const plainModule = { metadata: { id: INFLOWS.id, title: INFLOWS.title }, Widget: () => null }

beforeEach(() => {
  invalidateWidgetInstances()
  loadDashboardWidgetModule.mockReset()
  loadDashboardWidgetModule.mockImplementation(async (key: string) => (key === DATA.loaderKey ? dataModule : key === INFLOWS.loaderKey ? plainModule : null))
})

describe('listWidgetInstances', () => {
  it('lists each instance of each widget that offers some, with its widget and loader key', async () => {
    const items = await listWidgetInstances([DATA, INFLOWS])
    expect(items).toEqual([
      { widgetId: DATA.id, loaderKey: DATA.loaderKey, instance: { key: 'w2', title: 'Revenue by carrier', description: 'shipments · Supabase', settings: { widgetId: 'w2' } } },
      { widgetId: DATA.id, loaderKey: DATA.loaderKey, instance: { key: 'w1', title: 'On-time delivery', description: 'shipments', settings: { widgetId: 'w1' } } },
    ])
  })

  it('a missing module, a throwing list, junk rows and duplicate keys cost only their own rows', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const load = async (key: string) => {
      if (key === 'a') return null
      if (key === 'b') return { instances: { list: async () => { throw new Error('offline') } } }
      if (key === 'c') return { instances: 'not a source' }
      return {
        instances: {
          list: async () => [
            { key: 'k', title: 'Kept', settings: { id: 1 } },
            { key: 'k', title: 'Duplicate key', settings: { id: 2 } },
            { key: '', title: 'No key' },
            { key: 'blank', title: '   ' },
            null,
            'junk',
          ],
        },
      }
    }
    const items = await listWidgetInstances(
      [
        { id: 'a', loaderKey: 'a' },
        { id: 'b', loaderKey: 'b' },
        { id: 'c', loaderKey: 'c' },
        { id: 'd', loaderKey: 'd' },
      ],
      load,
    )
    expect(items.map((i) => [i.widgetId, i.instance.key, i.instance.title])).toEqual([['d', 'k', 'Kept']])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('isSameInstance', () => {
  const item = { widgetId: DATA.id, loaderKey: DATA.loaderKey, instance: { key: 'w1', title: 'x', settings: { widgetId: 'w1' } } }
  it('a slot showing the instance is it, even with the viewer’s own state beside its settings', () => {
    expect(isSameInstance(item, { kind: 'widget', widgetId: DATA.id, loaderKey: DATA.loaderKey, settings: { widgetId: 'w1', filterValues: { f1: 'x' } } })).toBe(true)
  })
  it('another instance, another widget, a table or nothing is not', () => {
    expect(isSameInstance(item, { kind: 'widget', widgetId: DATA.id, loaderKey: DATA.loaderKey, settings: { widgetId: 'w2' } })).toBe(false)
    expect(isSameInstance(item, { kind: 'widget', widgetId: 'other', loaderKey: 'x', settings: { widgetId: 'w1' } })).toBe(false)
    expect(isSameInstance(item, { kind: 'widget', widgetId: DATA.id, loaderKey: DATA.loaderKey })).toBe(false)
    expect(isSameInstance(item, { kind: 'table', tableId: 't' })).toBe(false)
    expect(isSameInstance(item, null)).toBe(false)
  })
})

function renderList(onPick = jest.fn(), exclude?: Parameters<typeof ContentCatalogList>[0]['exclude']) {
  render(
    <I18nProvider locale="en" dict={{ 'splitView.widgetInstances.workflows.data_widget': 'Data widgets' }}>
      <ContentRegistryProvider value={{ widgets: [DATA, INFLOWS], context: null, ready: true }}>
        <ContentCatalogList onPick={onPick} exclude={exclude} autoFocus={false} />
      </ContentRegistryProvider>
    </I18nProvider>,
  )
  return onPick
}

describe('ContentCatalogList — saved instances', () => {
  it('lists the instances by name under their widget (the group named in the module’s words), the widget types still listed', async () => {
    renderList()
    await screen.findByText('Revenue by carrier')
    const group = document.querySelector('[data-split-picker-group="instances:workflows.data_widget"]')!
    expect(group.getAttribute('data-split-picker-kind')).toBe('widget-instance')
    expect(group.textContent).toContain('Data widgets')
    // alphabetical inside the group
    expect([...group.querySelectorAll('[data-split-picker-instance]')].map((b) => b.textContent)).toEqual(['On-time delivery', 'Revenue by carrier'])
    // the widget types are still offered
    expect(screen.getByText('Data widget')).toBeTruthy()
    expect(screen.getByText('Inflows')).toBeTruthy()
  })

  it('picking an instance hands the host the widget with the instance’s settings', async () => {
    const onPick = renderList()
    fireEvent.click(await screen.findByText('Revenue by carrier'))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][0]).toEqual({ kind: 'widget', widgetId: DATA.id, loaderKey: DATA.loaderKey, settings: { widgetId: 'w2' } })
    expect(onPick.mock.calls[0][1]).toMatchObject({ kind: 'widget', id: DATA.id })
  })

  it('search finds an instance by its name or its description', async () => {
    renderList()
    await screen.findByText('Revenue by carrier')
    const search = screen.getByRole('textbox')
    fireEvent.change(search, { target: { value: 'on-time' } })
    expect(screen.queryByText('Revenue by carrier')).toBeNull()
    expect(screen.getByText('On-time delivery')).toBeTruthy()
    fireEvent.change(search, { target: { value: 'supabase' } })
    expect(screen.getByText('Revenue by carrier')).toBeTruthy()
    expect(screen.queryByText('On-time delivery')).toBeNull()
  })

  it('the pane being swapped leaves its own instance out', async () => {
    renderList(jest.fn(), { kind: 'widget', widgetId: DATA.id, loaderKey: DATA.loaderKey, settings: { widgetId: 'w2', filterValues: {} } })
    await screen.findByText('On-time delivery')
    expect(screen.queryByText('Revenue by carrier')).toBeNull()
  })

  it('asks each widget module once while the list is fresh', async () => {
    renderList()
    await screen.findByText('Revenue by carrier')
    const calls = dataModule.instances.list.mock.calls.length
    await act(async () => {
      renderList()
    })
    await waitFor(() => expect(screen.getAllByText('Revenue by carrier').length).toBe(2))
    expect(dataModule.instances.list.mock.calls.length).toBe(calls)
  })
})

describe('useInstanceTitle', () => {
  function Label({ content }: { content: Parameters<typeof useInstanceTitle>[0] }) {
    return <span data-testid="label">{useInstanceTitle(content) ?? '(type)'}</span>
  }
  const show = (content: Parameters<typeof useInstanceTitle>[0]) =>
    render(
      <I18nProvider locale="en" dict={{}}>
        <Label content={content} />
      </I18nProvider>,
    )

  it('names a slot by the instance it shows, viewer state and all', async () => {
    show({ kind: 'widget', widgetId: DATA.id, loaderKey: DATA.loaderKey, settings: { widgetId: 'w1', filterValues: { p: 'x' } } })
    await waitFor(() => expect(screen.getByTestId('label').textContent).toBe('On-time delivery'))
  })

  it('a widget without settings, a table, or an unknown instance keeps the type’s name', async () => {
    show({ kind: 'widget', widgetId: DATA.id, loaderKey: DATA.loaderKey, settings: { widgetId: 'gone' } })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(screen.getByTestId('label').textContent).toBe('(type)')
    expect(loadDashboardWidgetModule).toHaveBeenCalledWith(DATA.loaderKey)
    loadDashboardWidgetModule.mockClear()
    show({ kind: 'widget', widgetId: DATA.id, loaderKey: DATA.loaderKey })
    show({ kind: 'table', tableId: 't' })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    // nothing to name: no module is asked
    expect(loadDashboardWidgetModule).not.toHaveBeenCalled()
  })
})
