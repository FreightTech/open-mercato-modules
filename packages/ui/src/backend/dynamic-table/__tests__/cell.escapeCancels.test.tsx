import React from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import Cell from '../components/Cell'
import { createCellStore } from '../store/index'
import { CellStoreContext } from '../hooks/index'
import type { ColumnDef } from '../types/index'

// Escape must CANCEL an edit. It did not, reliably: `handleCancel` clears the
// editing state and moves focus back to the grid in the same tick, while the
// editor is still mounted — so the editor's own `onBlur={() => onSave(...)}`
// fired and committed the text the user had just abandoned. Found by driving
// the FMS transport table in a browser (vessel cell, Escape → value saved).
// Timing-dependent in a browser, so this test forces the exact order.

const columns: ColumnDef[] = [{ data: 'vessel', title: 'Vessel' } as ColumnDef]

function setup() {
  const store = createCellStore([{ vessel: 'MSC Bari' }], columns)
  const onCellSave = jest.fn()
  const utils = render(
    <CellStoreContext.Provider value={store}>
      <table>
        <tbody>
          <tr>
            <Cell row={0} col={0} colConfig={columns[0]} onCellSave={onCellSave} />
          </tr>
        </tbody>
      </table>
    </CellStoreContext.Provider>,
  )
  act(() => store.setEditingCell(0, 0))
  const editor = utils.container.querySelector('textarea') as HTMLTextAreaElement
  return { store, onCellSave, editor, utils }
}

describe('Cell — Escape cancels the edit', () => {
  it('does not save when the editor blurs as part of the Escape', () => {
    const { onCellSave, editor } = setup()
    expect(editor).not.toBeNull()
    fireEvent.change(editor, { target: { value: 'MSC BariPERFTEST' } })
    // The browser's order: keydown(Escape) → cancel → focus moves → blur,
    // all before React has unmounted the editor.
    act(() => {
      fireEvent.keyDown(editor, { key: 'Escape' })
      fireEvent.blur(editor)
    })
    expect(onCellSave).not.toHaveBeenCalled()
  })

  it('still saves on blur when the user clicks away without Escape', () => {
    const { onCellSave, editor } = setup()
    fireEvent.change(editor, { target: { value: 'MSC Bari 2' } })
    act(() => {
      fireEvent.blur(editor)
    })
    expect(onCellSave).toHaveBeenCalledWith(0, 0, 'MSC Bari 2', true)
  })

  it('saves normally on the NEXT edit after a cancelled one', () => {
    const { store, onCellSave, utils } = setup()
    let editor = utils.container.querySelector('textarea') as HTMLTextAreaElement
    act(() => {
      fireEvent.keyDown(editor, { key: 'Escape' })
      fireEvent.blur(editor)
    })
    act(() => store.setEditingCell(0, 0))
    editor = utils.container.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'EVER GIVEN' } })
    act(() => {
      fireEvent.blur(editor)
    })
    expect(onCellSave).toHaveBeenCalledWith(0, 0, 'EVER GIVEN', true)
  })
})
