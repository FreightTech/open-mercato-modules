import * as React from 'react'
import { render, fireEvent, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import CellCommentDialog from '../components/CellCommentDialog'
import { CommentMarkdown, taskCount, toggleTaskInContent } from '../components/commentMarkdown'
import { flash } from '../../FlashMessages'

/**
 * GEPARD-319 (owner 17.11, after the RFS feedback session): "oni chcą widzieć dużo na raz, a ten dymek jest strasznie
 * rozległy… niesie niewiele treści"; "to musi zniknąć z notatka wewnętrznego do przewoźnika"; the colours must not take
 * so much room; "prosty markdown, żeby dodać checkboxy". Fixed in DynamicTable for every table. Pinned here:
 *   • the bubble: one-line header, no audience switch, the palette behind one dot, one row of controls;
 *   • the markdown: tasks, bullets, bold, italic, mentions — as React nodes, never HTML;
 *   • a task is ticked in place (PATCH, no login redirect); a refusal puts it back and says so.
 */

type Call = { url: string; init?: { method?: string; body?: string; headers?: Record<string, string> } }
const calls: Call[] = []
let patchReply: { ok: boolean; status: number; result: unknown } = { ok: true, status: 200, result: {} }
let deferPatch = false
const deferred: Array<(reply: unknown) => void> = []

jest.mock('../../FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(async (url: string, init?: Call['init']) => {
    calls.push({ url, init })
    if (url.startsWith('/api/annotations/annotations?')) {
      return {
        ok: true,
        status: 200,
        result: {
          items: [{
            id: 'ann-1', entityType: 'folder_unit', rowId: 'u1', columnKey: 'rate', color: null, assignees: [],
            comments: [{ id: 'c1', userId: 'u', userName: 'Dawid Lass', content: 'Do zrobienia:\n- [ ] zamówić auto\n- [x] wysłać zlecenie', audience: 'internal', createdAt: '2026-11-17T10:00:00.000Z', canDelete: true }],
          }],
        },
      }
    }
    if (init?.method === 'PATCH') return deferPatch ? new Promise((resolve) => deferred.push(resolve)) : patchReply
    return { ok: true, status: 201, result: { id: 'new' } }
  }),
}))

const withI18n = (el: React.ReactElement) => React.createElement(I18nProvider as any, { locale: 'en', dict: {} }, el)
const dialog = () => render(withI18n(React.createElement(CellCommentDialog as any, {
  isOpen: true, onClose: () => {}, entityType: 'folder_unit', rowId: 'u1', columnKey: 'rate', columnTitle: 'Stawka', annotationId: 'ann-1',
})))

beforeEach(() => {
  calls.length = 0
  patchReply = { ok: true, status: 200, result: { content: 'Do zrobienia:\n- [x] zamówić auto\n- [x] wysłać zlecenie' } }
  ;(flash as jest.Mock).mockClear()
  deferPatch = false
  deferred.length = 0
})

describe('GEPARD-319 — the markdown of a comment', () => {
  it('reads tasks, bullets, bold, italic and mentions', () => {
    const { container } = render(React.createElement(CommentMarkdown, {
      content: 'Plan:\n- [ ] auto\n- [x] zlecenie\n- punkt\n**pilne** i _jutro_ @[Dawid Lass](u-1)',
    }))
    const boxes = container.querySelectorAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    expect((boxes[0] as HTMLInputElement).checked).toBe(false)
    expect((boxes[1] as HTMLInputElement).checked).toBe(true)
    expect((boxes[0] as HTMLInputElement).disabled).toBe(true)
    expect(container.querySelector('.hot-comment-md-bullet')?.textContent).toContain('punkt')
    expect(container.querySelector('strong')?.textContent).toBe('pilne')
    expect(container.querySelector('em')?.textContent).toBe('jutro')
    expect(container.querySelector('.hot-comment-mention')?.textContent).toBe('@Dawid Lass')
  })

  it('never turns text into markup', () => {
    const { container } = render(React.createElement(CommentMarkdown, { content: '<img src=x onerror=alert(1)> <b>x</b>' }))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<b>x</b>')
  })

  it('ticks the n-th task only, and counts them', () => {
    const text = 'a\n- [ ] one\n  - [ ] two\n- [x] three'
    expect(toggleTaskInContent(text, 1, true)).toBe('a\n- [ ] one\n  - [x] two\n- [x] three')
    expect(toggleTaskInContent(text, 2, false)).toBe('a\n- [ ] one\n  - [ ] two\n- [ ] three')
    expect(taskCount(text)).toEqual({ total: 3, done: 1 })
  })
})

describe('GEPARD-319 — the bubble', () => {
  it('has a one-line header, no audience switch, and the palette behind one dot', async () => {
    dialog()
    await screen.findByText('zamówić auto')
    expect(document.querySelector('.hot-comment-popover-header')?.textContent).toBe('Stawka')
    expect(screen.queryByText(/internal note/i)).toBeNull()
    expect(screen.queryByText(/for the carrier/i)).toBeNull()
    expect(document.querySelectorAll('.hot-comment-color-btn')).toHaveLength(0)
    fireEvent.click(document.querySelector('[data-comment-colour]')!)
    expect(document.querySelectorAll('.hot-comment-color-btn')).toHaveLength(8) // none + 7 colours
    fireEvent.click(document.querySelector('.hot-comment-color-btn[data-color="green"]')!)
    expect(document.querySelectorAll('.hot-comment-color-btn')).toHaveLength(0)
    expect(document.querySelector('.hot-comment-color-dot')?.getAttribute('data-color')).toBe('green')
    // One row of controls under the field: task, colour, send.
    const footer = document.querySelector('.hot-comment-input-footer')!
    expect(footer.querySelector('[data-comment-add-task]')).not.toBeNull()
    expect(footer.querySelector('.hot-comment-send-btn')).not.toBeNull()
    expect(document.querySelector('.hot-comment-hint')).toBeNull()
  })

  it('adds a task line from its button', async () => {
    dialog()
    const field = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.click(document.querySelector('[data-comment-add-task]')!)
    expect(field.value).toBe('- [ ] ')
    fireEvent.change(field, { target: { value: '- [ ] auto' } })
    field.setSelectionRange(10, 10)
    fireEvent.click(document.querySelector('[data-comment-add-task]')!)
    expect(field.value).toBe('- [ ] auto\n- [ ] ')
  })

  it('ticks a task in place, without the login redirect', async () => {
    dialog()
    await screen.findByText('zamówić auto')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Task 1' }))
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(true))
    const patch = calls.find((c) => c.init?.method === 'PATCH')!
    expect(patch.url).toBe('/api/annotations/annotations/ann-1/comments?commentId=c1')
    expect(JSON.parse(patch.init!.body!)).toEqual({ task: 0, done: true })
    expect(patch.init!.headers!['x-om-forbidden-redirect']).toBe('0')
    expect((screen.getByRole('checkbox', { name: 'Task 1' }) as HTMLInputElement).checked).toBe(true)
  })

  it('puts a refused tick back, and says so', async () => {
    patchReply = { ok: false, status: 403, result: { error: 'Brak uprawnień' } }
    dialog()
    await screen.findByText('zamówić auto')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Task 1' }))
    await waitFor(() => expect(flash).toHaveBeenCalledWith('Brak uprawnień', 'error'))
    expect((screen.getByRole('checkbox', { name: 'Task 1' }) as HTMLInputElement).checked).toBe(false)
  })

  it('keeps two quick ticks when the first answer comes back last (GEPARD-308, CHECK #3238)', async () => {
    deferPatch = true
    dialog()
    await screen.findByText('zamówić auto')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Task 1' }))
    await waitFor(() => expect(deferred).toHaveLength(1))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Task 2' }))
    await waitFor(() => expect(deferred).toHaveLength(2))
    // The server queued them on the row: the second answer carries both ticks, the first only its own — and arrives last.
    deferred[1]({ ok: true, status: 200, result: { content: 'Do zrobienia:\n- [x] zamówić auto\n- [ ] wysłać zlecenie' } })
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Task 2' }) as HTMLInputElement).checked).toBe(false))
    deferred[0]({ ok: true, status: 200, result: { content: 'Do zrobienia:\n- [x] zamówić auto\n- [x] wysłać zlecenie' } })
    await new Promise((r) => setTimeout(r, 20))
    expect((screen.getByRole('checkbox', { name: 'Task 1' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Task 2' }) as HTMLInputElement).checked).toBe(false)
  })
})
