/**
 * The trailing Actions column appears only when a row actually has an action.
 *
 * A table that defines `rowActions` but returns nothing for most rows (the
 * transport list offers one only on tracked sea legs) used to reserve a wide,
 * empty "Actions" column on every page. The design's trailing column is the
 * row kebab alone: narrow, no visible label.
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import DynamicTable from '../DynamicTable'
import type { ColumnDef } from '../types/index'

jest.mock('@freighttech/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn().mockResolvedValue({ ok: false }),
}))

const columns: ColumnDef[] = [
  { data: 'name', title: 'Name', width: 160 },
  { data: 'kind', title: 'Kind', width: 120 },
]
const rows = [
  { id: 'a', name: 'Alpha', kind: 'road' },
  { id: 'b', name: 'Beta', kind: 'sea' },
]

function Harness(props: Record<string, unknown>) {
  const tableRef = React.useRef<HTMLDivElement | null>(null)
  return React.createElement(
    I18nProvider as any,
    { locale: 'en', dict: {} },
    React.createElement(DynamicTable as any, { data: rows, columns, tableRef, height: 400, ...props }),
  )
}

beforeAll(() => {
  const rect = { width: 1200, height: 600, top: 0, left: 0, right: 1200, bottom: 600, x: 0, y: 0, toJSON() {} }
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
  for (const [prop, value] of [
    ['clientHeight', 600],
    ['offsetHeight', 600],
    ['clientWidth', 1200],
    ['offsetWidth', 1200],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value })
  }
})

const actionsHeader = () => document.querySelector('th[data-actions-cell="true"]') as HTMLElement | null

describe('Actions column', () => {
  it('is absent when rowActions returns nothing for every row', () => {
    render(React.createElement(Harness, { rowActions: () => [] }))
    expect(actionsHeader()).toBeNull()
  })

  it('appears when at least one row has an action — narrow, kebab only, no visible label', () => {
    render(
      React.createElement(Harness, {
        rowActions: (row: { kind: string }) => (row.kind === 'sea' ? [{ id: 'track', label: 'Track' }] : []),
      }),
    )
    const header = actionsHeader()
    expect(header).not.toBeNull()
    expect(header!.textContent).toBe('')
    expect(header!.getAttribute('aria-label')).toBe('Actions')
    expect(header!.style.width).toBe('44px')
  })

  it('keeps an explicit width when the table asks for one', () => {
    render(
      React.createElement(Harness, {
        rowActions: () => [{ id: 'x', label: 'X' }],
        actionsColumnWidth: 96,
      }),
    )
    expect(actionsHeader()!.style.width).toBe('96px')
  })
})
