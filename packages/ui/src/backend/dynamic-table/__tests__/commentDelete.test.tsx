import * as React from 'react'
import { render, fireEvent, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import CellCommentDialog from '../components/CellCommentDialog'
import { flash } from '../../FlashMessages'

/**
 * GEPARD-307 (GT RFS feedback 17.11): the RFS desk clicked the bin on its own comment and read "Insufficient
 * permissions. Redirecting to login…"; the page reloaded and the comment stayed. Pinned here:
 *   • the bin shows only on a comment the server says this person may delete (`canDelete`), and still shows when a
 *     server that predates the flag says nothing;
 *   • a delete asks for no login redirect (`x-om-forbidden-redirect: 0`): a refusal is a message, the comment stays;
 *   • "Delete all" on a range shows only when every comment in it may be deleted.
 */

type Call = { url: string; init?: { method?: string; headers?: Record<string, string> } }
const calls: Call[] = []
let comments: Array<Record<string, unknown>> = []
let deleteReply: { ok: boolean; status: number; result: unknown } = { ok: true, status: 200, result: { ok: true } }

jest.mock('../../FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(async (url: string, init?: Call['init']) => {
    calls.push({ url, init })
    if (url.startsWith('/api/annotations/annotations?')) {
      return {
        ok: true,
        status: 200,
        result: { items: [{ id: 'ann-1', entityType: 'folder_unit', rowId: 'u1', columnKey: 'rate', color: null, comments, assignees: [] }] },
      }
    }
    if (init?.method === 'DELETE') return deleteReply
    return { ok: true, status: 200, result: {} }
  }),
}))

const note = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  userId: `user-${id}`,
  userName: id === 'c-own' ? 'Dawid Lass' : 'Sebastian Wrobel',
  content: `note ${id}`,
  audience: 'internal',
  createdAt: '2026-11-17T10:00:00.000Z',
  ...extra,
})

function renderDialog(props: Record<string, unknown> = {}) {
  return render(
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(CellCommentDialog as any, {
        isOpen: true,
        onClose: () => {},
        entityType: 'folder_unit',
        rowId: 'u1',
        columnKey: 'rate',
        columnTitle: 'Stawka',
        annotationId: 'ann-1',
        ...props,
      }),
    ),
  )
}

const bins = () => Array.from(document.querySelectorAll('.hot-comment-delete')) as HTMLButtonElement[]

beforeEach(() => {
  calls.length = 0
  comments = []
  deleteReply = { ok: true, status: 200, result: { ok: true } }
  ;(flash as jest.Mock).mockClear()
})

describe('CellCommentDialog — deleting a comment (GEPARD-307)', () => {
  it("shows the bin only on the comments the server lets this person delete", async () => {
    comments = [note('c-own', { canDelete: true }), note('c-other', { canDelete: false })]
    renderDialog()
    await screen.findByText('note c-other')
    expect(bins()).toHaveLength(1)
    expect(bins()[0].closest('.hot-comment-item')?.textContent).toContain('note c-own')
  })

  it('still shows the bin when the server says nothing about it', async () => {
    comments = [note('c-own'), note('c-other')]
    renderDialog()
    await screen.findByText('note c-other')
    expect(bins()).toHaveLength(2)
  })

  it('deletes without the login redirect, and a refusal is a message — the comment stays', async () => {
    comments = [note('c-own')]
    deleteReply = { ok: false, status: 403, result: { error: 'Ten komentarz może usunąć tylko jego autor.' } }
    renderDialog()
    await screen.findByText('note c-own')
    fireEvent.click(bins()[0])
    await waitFor(() => expect(flash).toHaveBeenCalledWith('Ten komentarz może usunąć tylko jego autor.', 'error'))
    const del = calls.find((c) => c.init?.method === 'DELETE')
    expect(del?.url).toBe('/api/annotations/annotations/ann-1/comments?commentId=c-own')
    expect(del?.init?.headers?.['x-om-forbidden-redirect']).toBe('0')
    expect(screen.getByText('note c-own')).toBeTruthy()
  })

  it('removes the comment when the delete goes through', async () => {
    comments = [note('c-own', { canDelete: true })]
    renderDialog()
    await screen.findByText('note c-own')
    fireEvent.click(bins()[0])
    await waitFor(() => expect(screen.queryByText('note c-own')).toBeNull())
    expect(flash).not.toHaveBeenCalled()
  })

  it('offers "Delete all" on a range only when every comment in it may be deleted', async () => {
    const bulkCells = [
      { entityType: 'folder_unit', rowId: 'u1', columnKey: 'rate' },
      { entityType: 'folder_unit', rowId: 'u2', columnKey: 'rate' },
    ]
    comments = [note('c-own', { canDelete: true }), note('c-other', { canDelete: false })]
    const first = renderDialog({ bulkCells })
    await screen.findByText('note c-other')
    expect(screen.queryByText('Delete all comments')).toBeNull()
    first.unmount()

    comments = [note('c-own', { canDelete: true })]
    renderDialog({ bulkCells })
    await screen.findByText('note c-own')
    expect(screen.getByText('Delete all comments')).toBeTruthy()
  })
})
