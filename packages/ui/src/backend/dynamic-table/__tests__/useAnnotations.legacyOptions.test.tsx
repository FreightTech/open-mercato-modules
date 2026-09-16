import { renderHook, waitFor } from '@testing-library/react'
import { useAnnotations } from '../hooks/useAnnotations'
import { apiCall } from '../../utils/apiCall'

jest.mock('../../utils/apiCall', () => ({ apiCall: jest.fn() }))

const apiCallMock = apiCall as unknown as jest.Mock

/**
 * REGRESSION — walkthrough 2026-08-27 bug 27.
 *
 * `useAnnotations` used to require `targets` and dereference it unguarded
 * (`targets.map(...)`) in a memo that runs on the FIRST render. When
 * `@freighttech/invoicing` 0.13.2 — built against the older
 * `{ entityType, data, idColumnName }` signature — was installed next to
 * `@freighttech/ui` 0.13.15 (its peer range is `0.13.0`, so npm allowed it),
 * `targets` arrived `undefined` and the hook threw a TypeError before any
 * request was made. Next answered `/backend/invoicing/<id>/allocate` with a
 * 500 for EVERY id, including ids matching no invoice, and cost allocation was
 * unreachable on the INF deployment.
 *
 * These two tests pin the contract that a missing or renamed option costs the
 * annotations, never the page.
 */
describe('useAnnotations — option-shape tolerance', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [] } })
  })

  it('renders instead of throwing when no targets are supplied at all', () => {
    // The exact crash: an option the caller does not know it has to pass.
    const { result } = renderHook(() =>
      useAnnotations({ enabled: true } as unknown as { enabled: boolean }),
    )
    expect(result.current.annotations.size).toBe(0)
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('maps the deprecated { entityType, data, idColumnName } shape forward', async () => {
    const { result } = renderHook(() =>
      useAnnotations({
        enabled: true,
        entityType: 'invoicing:invoice_line_item',
        data: [{ id: 'line-a' }, { id: 'line-b' }],
        idColumnName: 'id',
      }),
    )

    // Not merely "did not throw": the legacy caller still gets its comments,
    // which is the whole point of keeping the bridge rather than ignoring it.
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    const url = String(apiCallMock.mock.calls[0][0])
    expect(url).toContain('entityType=invoicing%3Ainvoice_line_item')
    expect(url).toContain('rowIds=line-a%2Cline-b')
    expect(result.current.annotations.size).toBe(0)
  })
})
