/**
 * @jest-environment jsdom
 *
 * AN APP WHOSE EVERY LIST IS ONE FLAT TABLE.
 *
 * acporath (the customs agency app, 02.11) opens every list flat: no saved-view row ('Widok domyślny ··· + Dodaj
 * widok') on any table. It said so once, through a module-level setter in a yarn patch of this package; the app-wide
 * defaults context (0.14.29) now carries it. A table's own `uiConfig.hidePerspectiveTabs` still wins, and an app that
 * sets nothing keeps the table's own rule: the row shows when the table has saved views.
 */

import * as React from 'react'
import { render } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import { DynamicTableDefaultsProvider, type DynamicTableDefaults } from '../index'
import { apiCall } from '@freighttech/ui/backend/utils/apiCall'
import type { ColumnDef } from '../types/index'

jest.mock('@freighttech/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))
const mockApiCall = apiCall as unknown as jest.Mock

const columns: ColumnDef[] = [{ data: 'name', title: 'Name', width: 200 }]
const view = (id: string) => ({ id, name: id, columns: { visible: ['name'], hidden: [] }, filters: [], sorting: [] })

function Table({ ui }: { ui: Record<string, unknown> }) {
  const tableRef = React.useRef<HTMLDivElement | null>(null)
  const [data] = React.useState(() => [{ id: 'r1', name: 'AMICA' }])
  return React.createElement(DynamicTable as any, { data, columns, tableRef, height: 400, savedPerspectives: [view('mine')], uiConfig: ui })
}

function mount(ui: Record<string, unknown> = {}, defaults?: DynamicTableDefaults) {
  const table = React.createElement(Table, { ui })
  const tree = defaults ? React.createElement(DynamicTableDefaultsProvider, { value: defaults }, table) : table
  return render(React.createElement(I18nProvider as any, { locale: 'en', dict: {} }, tree))
}

const savedViewRow = () => document.querySelector('.hot-top-tabs-v2')

beforeEach(() => {
  mockApiCall.mockReset()
  mockApiCall.mockResolvedValue({ ok: false })
})

describe('the saved-view row under an app default', () => {
  it('shows for a table with saved views when the app sets nothing', () => {
    mount()
    expect(savedViewRow()).not.toBeNull()
  })

  it('is hidden on every table when the app says its lists are flat', () => {
    mount({}, { hidePerspectiveTabs: true })
    expect(savedViewRow()).toBeNull()
  })

  it('shows where the table itself asks for it, whatever the app default', () => {
    mount({ hidePerspectiveTabs: false }, { hidePerspectiveTabs: true })
    expect(savedViewRow()).not.toBeNull()
  })
})
