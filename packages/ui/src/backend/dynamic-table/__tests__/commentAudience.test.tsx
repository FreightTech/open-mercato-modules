import * as React from 'react'
import { render, fireEvent, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import CellCommentDialog from '../components/CellCommentDialog'

/**
 * B8c — WHO IS THIS NOTE FOR?
 *
 * Two kinds of note share the grid and read identically today: the remark that
 * ends up printed on the carrier's waybill, and the internal aside ("Szymon,
 * sprawdź proszę coś"). Nobody can select the printed set without re-reading
 * every thread by hand.
 *
 * The rules pinned here (GEPARD-319, owner 17.11, removed the choice from the bubble — it took too much room):
 *   • `internal` is the default, always — a note never escapes to a carrier;
 *   • the bubble offers no audience control, and no native select;
 *   • a new note, single cell or range, is written without an audience (the server's `internal`);
 *   • an existing carrier-facing note is marked as such in the thread.
 */

const calls: Array<{ url: string; body: any }> = []

jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ url, body })
    if (url.startsWith('/api/annotations/annotations?')) {
      return {
        ok: true,
        result: {
          items: [
            {
              id: 'ann-1',
              entityType: 'folder_unit',
              rowId: 'u1',
              columnKey: 'truckPlate',
              color: null,
              comments: [
                { id: 'c1', userId: 'u', content: 'gate 4, bring the seal', audience: 'carrier' },
              ],
              assignees: [],
            },
          ],
        },
      }
    }
    return { ok: true, result: { id: 'new-id' } }
  }),
}))

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
        columnKey: 'truckPlate',
        columnTitle: 'Truck plate',
        annotationId: 'ann-1',
        ...props,
      }),
    ),
  )
}

beforeEach(() => {
  calls.length = 0
})

const lastPost = (match: string) =>
  [...calls].reverse().find((c) => c.url.includes(match) && c.body)

describe('CellCommentDialog — note audience (B8c, as changed by GEPARD-319)', () => {
  // Owner 17.11 (GEPARD-319): "to musi zniknąć z notatka wewnętrznego do przewoźnika, to zajmuje za dużo miejsca".
  // The bubble offers no audience any more: a new note is internal (the server's default). A carrier-facing note
  // written before keeps its mark in the thread.
  it('offers no audience choice — and still no native <select>', () => {
    renderDialog()
    expect(screen.queryByRole('radio', { name: /internal note/i })).toBeNull()
    expect(screen.queryByRole('radio', { name: /for the carrier/i })).toBeNull()
    expect(document.querySelector('select')).toBeNull()
  })

  it('writes a new note without an audience — internal, as the server defaults', async () => {
    renderDialog()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Szymon, sprawdź proszę' } })
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }))
    await waitFor(() => expect(lastPost('/comments')).toBeTruthy())
    expect(lastPost('/comments')!.body.content).toBe('Szymon, sprawdź proszę')
    expect(lastPost('/comments')!.body).not.toHaveProperty('audience')
  })

  it('marks an existing carrier-facing note in the thread', async () => {
    renderDialog()
    await waitFor(() => expect(screen.getByText(/gate 4, bring the seal/)).toBeInTheDocument())
    expect(screen.getByTitle(/printed on the carrier document/i)).toBeInTheDocument()
  })

  it('sends a bulk comment without an audience, one request per scope', async () => {
    renderDialog({
      bulkCells: [
        { entityType: 'folder_unit', rowId: 'u1', columnKey: 'containerNumber' },
        { entityType: 'folder_unit_leg', rowId: 'leg-1', columnKey: 'truckPlate' },
      ],
    })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Seal check on arrival' } })
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }))
    await waitFor(() =>
      expect(calls.filter((c) => c.body?.comment === 'Seal check on arrival').length).toBe(2),
    )
    const posted = calls.filter((c) => c.body?.comment === 'Seal check on arrival')
    expect(posted.every((c) => !('audience' in c.body))).toBe(true)
    // A range can span two scopes; each goes to its own batch call.
    expect(new Set(posted.map((c) => c.body.entityType))).toEqual(
      new Set(['folder_unit', 'folder_unit_leg']),
    )
  })
})
