/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import { downloadBlob } from '../utils/exportTable'
import { flash } from '../../FlashMessages'
import type { ColumnDef, ExportAllResult } from '../types/index'

/**
 * HEDGE-123 — the half of the fix the hook cannot enforce: NO FILE IS WRITTEN.
 *
 * `exportAllRows` rejecting is only useful if the caller refuses to hand over a
 * download. These tests assert the thing the user actually experiences — an
 * error instead of a file — by watching `downloadBlob`, which is the single
 * point where a file reaches the browser.
 *
 * The distinction matters because a short CSV is worse than a failed one. A
 * failure is visible and can be retried; a file that opens, has headers and has
 * rows looks like an answer and goes into a reconciliation unquestioned.
 */

jest.mock('../utils/exportTable', () => {
  const actual = jest.requireActual('../utils/exportTable')
  return { ...actual, downloadBlob: jest.fn() }
})
jest.mock('../../FlashMessages', () => ({ flash: jest.fn() }))

const columns: ColumnDef[] = [
  { data: 'invoiceNumber', title: 'Invoice' },
  { data: 'grossAmount', title: 'Gross' },
]

const rows = [
  { id: '1', invoiceNumber: 'FV/2026/001', grossAmount: '1230.00' },
  { id: '2', invoiceNumber: 'FV/2026/002', grossAmount: '984.00' },
]

function renderTable(onExportAll: (() => Promise<any[] | ExportAllResult>) | undefined) {
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
        onExportAll,
      }),
    )
  }
  return render(React.createElement(Harness))
}

/**
 * Drive the export the way a user does. jsdom reports every box as 0x0, so the
 * toolbar always collapses its actions into the "More" overflow — the same menu
 * a narrow real window produces. Open that, then pick CSV.
 */
async function clickExportCsv() {
  fireEvent.click(await screen.findByRole('button', { name: /more table actions/i }))
  fireEvent.click(document.querySelector('[data-toolbar-export]') as HTMLElement)
  fireEvent.click(document.querySelector('[data-toolbar-export-format="csv"]') as HTMLElement)
}

function flashCalls(): string[] {
  return (flash as jest.Mock).mock.calls.map((c) => String(c[0]))
}

describe('DynamicTable export — a failed walk yields an error, not a file (HEDGE-123)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('writes NO file when the export fetch rejects', async () => {
    renderTable(async () => {
      throw new Error('Export failed on page 3 (HTTP 500) after 200 row(s)')
    })
    await clickExportCsv()

    await waitFor(() => expect(flash as jest.Mock).toHaveBeenCalled())
    // The assertion that matters: nothing reached the browser.
    expect(downloadBlob as jest.Mock).not.toHaveBeenCalled()
  })

  it('surfaces WHY it failed, not a bare "Could not export"', async () => {
    renderTable(async () => {
      throw new Error('Export failed on page 3 (HTTP 500) after 200 row(s)')
    })
    await clickExportCsv()

    await waitFor(() => expect(flash as jest.Mock).toHaveBeenCalled())
    // A user could not previously tell a filter problem from a server problem.
    expect(flashCalls().join(' ')).toMatch(/page 3/)
    expect((flash as jest.Mock).mock.calls.some((c) => c[1] === 'error')).toBe(true)
  })

  it('writes NO file when the walk could not be proven complete', async () => {
    renderTable(async () => ({
      rows: [{ id: '1', invoiceNumber: 'FV/2026/001', grossAmount: '1230.00' }],
      expected: 500,
      complete: false,
      reason: 'fetched 300 of 500 row(s)',
    }))
    await clickExportCsv()

    await waitFor(() => expect(flash as jest.Mock).toHaveBeenCalled())
    expect(downloadBlob as jest.Mock).not.toHaveBeenCalled()
  })

  it('tells the user BOTH counts when it refuses an incomplete export', async () => {
    renderTable(async () => ({
      rows: [{ id: '1', invoiceNumber: 'FV/2026/001', grossAmount: '1230.00' }],
      expected: 500,
      complete: false,
      reason: 'fetched 300 of 500 row(s)',
    }))
    await clickExportCsv()

    await waitFor(() => expect(flash as jest.Mock).toHaveBeenCalled())
    const said = flashCalls().join(' ')
    expect(said).toMatch(/300 of 500/)
    // And it must say the file was not saved, so nobody goes looking for one.
    expect(said).toMatch(/not saved|NOT saved/i)
  })

  it('DOES write the file when the walk completed — the honest path still works', async () => {
    renderTable(async () => ({ rows, expected: rows.length, complete: true }))
    await clickExportCsv()

    await waitFor(() => expect(downloadBlob as jest.Mock).toHaveBeenCalled())
  })

  it('still accepts a bare array as complete, for hosts predating the counts', async () => {
    // Backwards compatibility is load-bearing: `onExportAll` is a public prop.
    renderTable(async () => rows)
    await clickExportCsv()

    await waitFor(() => expect(downloadBlob as jest.Mock).toHaveBeenCalled())
  })
})
