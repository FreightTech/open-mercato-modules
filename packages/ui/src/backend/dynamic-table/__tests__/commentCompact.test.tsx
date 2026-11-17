import * as React from 'react'
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import CellCommentDialog, { COMMENT_REREAD_TIMEOUT_MS } from '../components/CellCommentDialog'
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

type Call = { url: string; init?: { method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal } }
const calls: Call[] = []
let patchReply: { ok: boolean; status: number; result: unknown } = { ok: true, status: 200, result: {} }
let deferPatch = false
const deferred: Array<(reply: unknown) => void> = []
const START = 'Do zrobienia:\n- [ ] zamówić auto\n- [x] wysłać zlecenie'
/** What the row holds — the thread read returns it; an immediate PATCH stores its answer. */
let stored = START
/** The thread reads after the first (the re-reads after ticks): 'ok', 'fail' (an error answer) or 'hang' (no answer). */
let reread: 'ok' | 'fail' | 'hang' = 'ok'
let threadReads = 0

jest.mock('../../FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(async (url: string, init?: Call['init']) => {
    calls.push({ url, init })
    if (url.startsWith('/api/annotations/annotations?')) {
      threadReads += 1
      if (threadReads > 1 && reread === 'fail') return { ok: false, status: 500, result: { error: 'boom' } }
      if (threadReads > 1 && reread === 'hang') {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        })
      }
      return {
        ok: true,
        status: 200,
        result: {
          items: [{
            id: 'ann-1', entityType: 'folder_unit', rowId: 'u1', columnKey: 'rate', color: null, assignees: [],
            comments: [{ id: 'c1', userId: 'u', userName: 'Dawid Lass', content: stored, audience: 'internal', createdAt: '2026-11-17T10:00:00.000Z', canDelete: true }],
          }],
        },
      }
    }
    if (init?.method === 'PATCH') {
      if (deferPatch) return new Promise((resolve) => deferred.push(resolve))
      const reply = patchReply as { ok: boolean; result: { content?: string } }
      if (reply.ok && typeof reply.result?.content === 'string') stored = reply.result.content
      return patchReply
    }
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
  stored = START
  reread = 'ok'
  threadReads = 0
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

  const box = (n: number) => screen.getByRole('checkbox', { name: `Task ${n}` }) as HTMLInputElement
  const twoQuickTicks = async () => {
    deferPatch = true
    dialog()
    await screen.findByText('zamówić auto')
    fireEvent.click(box(1)) // tick task 1
    await waitFor(() => expect(deferred).toHaveLength(1))
    fireEvent.click(box(2)) // untick task 2
    await waitFor(() => expect(deferred).toHaveLength(2))
  }
  const BOTH = 'Do zrobienia:\n- [x] zamówić auto\n- [ ] wysłać zlecenie'

  it('two quick ticks: the server ran them in click order, the first answer comes back last (GEPARD-308, CHECK #3238)', async () => {
    await twoQuickTicks()
    stored = BOTH
    deferred[1]({ ok: true, status: 200, result: { content: BOTH } })
    await new Promise((r) => setTimeout(r, 20))
    // The first tick is still out: nothing is applied — the marks stay as clicked.
    expect([box(1).checked, box(2).checked]).toEqual([true, false])
    deferred[0]({ ok: true, status: 200, result: { content: 'Do zrobienia:\n- [x] zamówić auto\n- [x] wysłać zlecenie' } })
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith('/api/annotations/annotations?')).length).toBe(2))
    await new Promise((r) => setTimeout(r, 20))
    expect([box(1).checked, box(2).checked]).toEqual([true, false])
  })

  it('two quick ticks: the newer click got the row lock first — the stored text wins, not the newest answer (p2B probe)', async () => {
    await twoQuickTicks()
    // Server: click 2 first (its answer lacks tick 1), then click 1 (its answer is what the row holds).
    deferred[1]({ ok: true, status: 200, result: { content: 'Do zrobienia:\n- [ ] zamówić auto\n- [ ] wysłać zlecenie' } })
    await new Promise((r) => setTimeout(r, 20))
    expect([box(1).checked, box(2).checked]).toEqual([true, false])
    stored = BOTH
    deferred[0]({ ok: true, status: 200, result: { content: BOTH } })
    await new Promise((r) => setTimeout(r, 30))
    expect([box(1).checked, box(2).checked]).toEqual([true, false])
  })

  it('reads the thread again once, and refreshes the grid once, after a burst of ticks', async () => {
    const onAnnotationChange = jest.fn()
    deferPatch = true
    render(withI18n(React.createElement(CellCommentDialog as any, {
      isOpen: true, onClose: () => {}, entityType: 'folder_unit', rowId: 'u1', columnKey: 'rate', columnTitle: 'Stawka', annotationId: 'ann-1', onAnnotationChange,
    })))
    await screen.findByText('zamówić auto')
    fireEvent.click(box(1))
    fireEvent.click(box(2))
    await waitFor(() => expect(deferred).toHaveLength(2))
    stored = BOTH
    deferred[0]({ ok: true, status: 200, result: { content: 'Do zrobienia:\n- [x] zamówić auto\n- [x] wysłać zlecenie' } })
    deferred[1]({ ok: true, status: 200, result: { content: BOTH } })
    await waitFor(() => expect(onAnnotationChange).toHaveBeenCalledTimes(1))
    expect(calls.filter((c) => c.url.startsWith('/api/annotations/annotations?'))).toHaveLength(2) // open + one re-read
  })
  it('a re-read that fails shows the last answer the server gave', async () => {
    reread = 'fail'
    // Meanwhile someone unticked task 2: the server's answer differs from what this bubble clicked.
    patchReply = { ok: true, status: 200, result: { content: 'Do zrobienia:\n- [x] zamówić auto\n- [ ] wysłać zlecenie' } }
    dialog()
    await screen.findByText('zamówić auto')
    fireEvent.click(box(1))
    await waitFor(() => expect(threadReads).toBe(2))
    await new Promise((r) => setTimeout(r, 20))
    expect([box(1).checked, box(2).checked]).toEqual([true, false])
  })

  it('every tick refused and the re-read failing: the text before the ticks', async () => {
    reread = 'fail'
    patchReply = { ok: false, status: 403, result: { error: 'Brak uprawnień' } }
    dialog()
    await screen.findByText('zamówić auto')
    fireEvent.click(box(1))
    await waitFor(() => expect(threadReads).toBe(2))
    await new Promise((r) => setTimeout(r, 20))
    expect([box(1).checked, box(2).checked]).toEqual([false, true])
  })

  it('a re-read that hangs is cut at the time limit and falls back', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] })
    try {
      reread = 'hang'
      // Meanwhile someone unticked task 2: the server's answer differs from what this bubble clicked.
      patchReply = { ok: true, status: 200, result: { content: 'Do zrobienia:\n- [x] zamówić auto\n- [ ] wysłać zlecenie' } }
      dialog()
      await act(async () => { await jest.advanceTimersByTimeAsync(50) })
      fireEvent.click(box(1))
      await act(async () => { await jest.advanceTimersByTimeAsync(50) })
      expect(threadReads).toBe(2)
      // Still waiting on the read: the marks as clicked.
      expect([box(1).checked, box(2).checked]).toEqual([true, true])
      await act(async () => { await jest.advanceTimersByTimeAsync(COMMENT_REREAD_TIMEOUT_MS + 100) })
      expect([box(1).checked, box(2).checked]).toEqual([true, false])
    } finally {
      jest.useRealTimers()
    }
  })
})
