/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import { toCsv } from '../utils/exportTable'
import type { ColumnDef } from '../types/index'

/**
 * G23.38 (GT 23.10 [01:27:03]–[01:28:05]): "Eksportuj" writes THE VIEW — "ten widok, który widzicie, to to powinno być
 * eksport" — its columns in its order, and only the ticked rows when some are ticked ("żeby tam się dało zaznaczyć,
 * które chcemy konkretnie"). It wrote every column of the whole table, filters ignored. Synthetic rows.
 */

jest.mock('../utils/exportTable', () => {
  const actual = jest.requireActual('../utils/exportTable')
  return { ...actual, downloadBlob: jest.fn(), toCsv: jest.fn(actual.toCsv) }
})
jest.mock('../../FlashMessages', () => ({ flash: jest.fn() }))

const columns: ColumnDef[] = [
  { data: 'invoiceNumber', title: 'Invoice' },
  { data: 'client', title: 'Client' },
  { data: 'grossAmount', title: 'Gross' },
]
const rows = [
  { id: '1', invoiceNumber: 'FV/2026/001', client: 'Acme', grossAmount: '1230.00' },
  { id: '2', invoiceNumber: 'FV/2026/002', client: 'Beta', grossAmount: '984.00' },
  { id: '3', invoiceNumber: 'FV/2026/003', client: 'Gamma', grossAmount: '50.00' },
]

function renderTable(props: Record<string, unknown>) {
  function Harness() {
    const tableRef = React.useRef<HTMLDivElement | null>(null)
    return React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(DynamicTable as any, {
        data: rows,
        columns,
        tableRef,
        tableName: 'Invoices',
        height: 400,
        rowHeaders: true,
        rowSelection: true,
        // The view hides "Client".
        defaultHiddenColumns: ['client'],
        ...props,
      }),
    )
  }
  return render(React.createElement(Harness))
}

beforeAll(() => {
  const rect = { width: 1200, height: 600, top: 0, left: 0, right: 1200, bottom: 600, x: 0, y: 0, toJSON() {} }
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
  for (const [prop, value] of [['clientHeight', 600], ['offsetHeight', 600], ['clientWidth', 1200], ['offsetWidth', 1200]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value })
  }
})

async function clickExportCsv() {
  fireEvent.click(await screen.findByRole('button', { name: /more table actions/i }))
  fireEvent.click(document.querySelector('[data-toolbar-export]') as HTMLElement)
  fireEvent.click(document.querySelector('[data-toolbar-export-format="csv"]') as HTMLElement)
}
const exported = () => (toCsv as jest.Mock).mock.calls.at(-1)?.[0] as { headers: string[]; rows: string[][] } | undefined
const rowCheckboxes = () => Array.from(document.querySelectorAll<HTMLInputElement>('td.hot-row-header input.hot-row-select'))

describe('Eksportuj writes the view (G23.38)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('only the ticked rows, in the view\'s columns', async () => {
    const onExportView = jest.fn(async () => rows)
    renderTable({ onExportView })
    await waitFor(() => expect(rowCheckboxes().length).toBe(3))
    fireEvent.click(rowCheckboxes()[1])
    await clickExportCsv()
    await waitFor(() => expect(exported()).toBeDefined())
    expect(exported()).toMatchObject({ headers: ['Invoice', 'Gross'], rows: [['FV/2026/002', '984.00']] })
    expect(onExportView).not.toHaveBeenCalled()
  })

  it('nothing ticked: every row of the view, read through the view fetch (not the whole-table one)', async () => {
    const onExportView = jest.fn(async () => [rows[0], rows[2]])
    const onExportAll = jest.fn(async () => rows)
    renderTable({ onExportView, onExportAll })
    await clickExportCsv()
    await waitFor(() => expect(exported()).toBeDefined())
    expect(onExportView).toHaveBeenCalledTimes(1)
    expect(onExportAll).not.toHaveBeenCalled()
    expect(exported()).toMatchObject({ headers: ['Invoice', 'Gross'], rows: [['FV/2026/001', '1230.00'], ['FV/2026/003', '50.00']] })
  })

  it('a table with no fetch exports the rows it holds, in the view\'s columns', async () => {
    renderTable({})
    await clickExportCsv()
    await waitFor(() => expect(exported()).toBeDefined())
    expect(exported()!.headers).toEqual(['Invoice', 'Gross'])
    expect(exported()!.rows.map((r) => r[0])).toEqual(['FV/2026/001', 'FV/2026/002', 'FV/2026/003'])
  })
})
