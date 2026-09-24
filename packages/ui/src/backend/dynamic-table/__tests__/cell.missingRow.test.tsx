import React from 'react'
import { render } from '@testing-library/react'
import Cell from '../components/Cell'
import { createCellStore } from '../store/index'
import { CellStoreContext } from '../hooks/index'
import type { ColumnDef } from '../types/index'

// A cell subscribed to a row index the dataset no longer has — the transient
// frame after a search narrows the rows and before that row unmounts — must not
// hand `undefined` to the column's own renderer. Documents' name renderer reads
// `rowData.sectionCount`, and that call took the whole page down in a
// workspace (TC-APP-613). The cell shell must still render, so pointer
// hit-testing (data-row / data-col) keeps working for that frame.

const columns: ColumnDef[] = [
  {
    data: 'name',
    title: 'Name',
    // A renderer written for real rows: it dereferences rowData.
    renderer: (_value: unknown, rowData: { name: string; sectionCount: number }) =>
      `${rowData.name} (${rowData.sectionCount})`,
    cellClassName: (_value: unknown, rowData: { sectionCount: number }) =>
      rowData.sectionCount > 1 ? 'is-bundle' : '',
  } as unknown as ColumnDef,
]

function renderCell(row: number) {
  const store = createCellStore([{ name: 'invoice.pdf', sectionCount: 2 }], columns)
  return render(
    <CellStoreContext.Provider value={store}>
      <table>
        <tbody>
          <tr>
            <Cell row={row} col={0} colConfig={columns[0]} onCellSave={jest.fn()} />
          </tr>
        </tbody>
      </table>
    </CellStoreContext.Provider>,
  )
}

describe('Cell — a row index the data no longer has', () => {
  it('renders a real row through the column renderer', () => {
    const { container } = renderCell(0)
    expect(container.textContent).toContain('invoice.pdf (2)')
  })

  it('does not call the column renderer or its cellClassName with an undefined row', () => {
    expect(() => renderCell(5)).not.toThrow()
  })

  it('still renders the cell shell for that frame', () => {
    const { container } = renderCell(5)
    expect(container.querySelector('td')).not.toBeNull()
    expect(container.textContent).not.toContain('undefined')
  })
})
