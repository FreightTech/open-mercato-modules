/**
 * FMS acc-v17 D2.05 (p7's GT walk 26.10): a Polish desk read the comment button "Add a comment", the comment count
 * "3 comments" and the palette "None / Pink / Orange…" — the texts were written in English, past the translations.
 * They go through `t()` now, with the English as the fallback; a comment count takes its Polish plural form.
 */
import * as React from 'react'
import { fireEvent, render } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import Cell, { commentCountForm } from '../components/Cell'
import CellCommentDialog from '../components/CellCommentDialog'
import { createCellStore } from '../store/index'
import { CellStoreContext } from '../hooks/index'
import type { ColumnDef } from '../types/index'

jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: { items: [] } })),
}))

const Provider = I18nProvider as unknown as React.FC<{ locale: string; dict: Record<string, string>; children: React.ReactNode }>
const PL = {
  'dynamicTable.comment.count.few': '{count} komentarze',
  'dynamicTable.palette.none': 'Brak',
  'dynamicTable.palette.pink': 'Różowy',
  'dynamicTable.palette.orange': 'Pomarańczowy',
}

describe('D2.05 — the comment texts in the screen language', () => {
  it("a cell's comment count reads in Polish, with its plural form", () => {
    const columns = [{ data: 'number', title: 'Numer' } as unknown as ColumnDef]
    const store = createCellStore([{ number: 'FV/1/2026' }], columns)
    const { container } = render(
      <Provider locale="pl" dict={PL}>
        <CellStoreContext.Provider value={store}>
          <table>
            <tbody>
              <tr>
                <Cell row={0} col={0} colConfig={columns[0]} onCellSave={jest.fn()} commentsEnabled commentCount={3} />
              </tr>
            </tbody>
          </table>
        </CellStoreContext.Provider>
      </Provider>,
    )
    expect(container.querySelector('.cell-comment-indicator')?.getAttribute('title')).toBe('3 komentarze')
  })

  it('the palette names its colours in Polish', () => {
    const { container } = render(
      <Provider locale="pl" dict={PL}>
        <CellCommentDialog
          {...({ isOpen: true, onClose: () => {}, entityType: 'invoice', rowId: 'r1', columnKey: 'number', columnTitle: 'Numer' } as never)}
        />
      </Provider>,
    )
    // GEPARD-319 — the palette opens from the colour dot.
    fireEvent.click(document.body.querySelector('[data-comment-colour]')!)
    const titles = [...document.body.querySelectorAll('[title]')].map((e) => e.getAttribute('title'))
    expect(titles).toEqual(expect.arrayContaining(['Brak', 'Różowy', 'Pomarańczowy']))
    expect(titles).not.toContain('Pink')
    expect(container).toBeTruthy()
  })

  it('a count takes one, few or many', () => {
    expect([1, 2, 4, 5, 12, 14, 22, 25, 101].map(commentCountForm)).toEqual(['one', 'few', 'few', 'many', 'many', 'many', 'few', 'many', 'many'])
  })
})
