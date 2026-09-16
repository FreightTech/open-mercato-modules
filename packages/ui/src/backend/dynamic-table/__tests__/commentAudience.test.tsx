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
 * The rules pinned here:
 *   • `internal` is the default, always — a note never escapes to a carrier
 *     because someone forgot to look at a control;
 *   • the choice is two visible options, never a closed dropdown, so it is
 *     legible while the note is being written (house rule: no native selects);
 *   • the flag reaches the server with the comment, in single-cell and bulk
 *     mode alike;
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

describe('CellCommentDialog — note audience (B8c)', () => {
  it('offers both audiences as visible options, with internal preselected', () => {
    renderDialog()
    const internal = screen.getByRole('radio', { name: /internal note/i })
    const carrier = screen.getByRole('radio', { name: /for the carrier/i })
    expect(internal).toHaveAttribute('aria-checked', 'true')
    expect(carrier).toHaveAttribute('aria-checked', 'false')
    // House rule: never a native <select>.
    expect(document.querySelector('select')).toBeNull()
  })

  it('sends the chosen audience with a single-cell comment', async () => {
    renderDialog()
    fireEvent.click(screen.getByRole('radio', { name: /for the carrier/i }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Load through gate 4' } })
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }))
    await waitFor(() => expect(lastPost('/comments')).toBeTruthy())
    expect(lastPost('/comments')!.body).toMatchObject({
      content: 'Load through gate 4',
      audience: 'carrier',
    })
  })

  it('defaults to internal when the writer touches nothing', async () => {
    renderDialog()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Szymon, sprawdź proszę' } })
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }))
    await waitFor(() => expect(lastPost('/comments')).toBeTruthy())
    expect(lastPost('/comments')!.body.audience).toBe('internal')
  })

  it('marks an existing carrier-facing note in the thread', async () => {
    renderDialog()
    await waitFor(() => expect(screen.getByText(/gate 4, bring the seal/)).toBeInTheDocument())
    expect(screen.getByTitle(/printed on the carrier document/i)).toBeInTheDocument()
  })

  it('carries the audience through a bulk comment, one request per scope', async () => {
    renderDialog({
      bulkCells: [
        { entityType: 'folder_unit', rowId: 'u1', columnKey: 'containerNumber' },
        { entityType: 'folder_unit_leg', rowId: 'leg-1', columnKey: 'truckPlate' },
      ],
    })
    fireEvent.click(screen.getByRole('radio', { name: /for the carrier/i }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Seal check on arrival' } })
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }))
    await waitFor(() =>
      expect(calls.filter((c) => c.body?.comment === 'Seal check on arrival').length).toBe(2),
    )
    const posted = calls.filter((c) => c.body?.comment === 'Seal check on arrival')
    expect(posted.every((c) => c.body.audience === 'carrier')).toBe(true)
    // A range can span two scopes; each goes to its own batch call.
    expect(new Set(posted.map((c) => c.body.entityType))).toEqual(
      new Set(['folder_unit', 'folder_unit_leg']),
    )
  })
})
