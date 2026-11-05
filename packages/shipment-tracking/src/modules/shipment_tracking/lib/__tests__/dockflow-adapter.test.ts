import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DockflowAdapter } from '../adapters/dockflow'

const authConfig = { api_key: 'uat_acme_secret' }

const UPSTREAM_RECORD = {
  tradeflow_reference: 'om-container-MSCU1234567',
  events: [
    {
      eventID: '5d1c9a6e-0b7f-5c4e-9f3a-2a8e1c0d4b11',
      eventCreatedDateTime: '2026-10-20T08:00:00+00:00',
      eventType: 'EQUIPMENT',
      eventClassifierCode: 'ACT',
      eventDateTime: '2026-10-19T14:30:00+00:00',
      equipmentEventTypeCode: 'LOAD',
      equipmentReference: 'MSCU1234567',
      ISOEquipmentCode: '45G1',
      emptyIndicatorCode: 'LADEN',
      eventLocation: { locationName: 'Antwerp', UNLocationCode: 'BEANR', latitude: '51.263900', longitude: '4.399700' },
      transportCall: {
        transportCallID: '0f6b2d1e-7d0c-5a49-8c1f-6e2b9a3d7c55',
        exportVoyageNumber: '442W',
        UNLocationCode: 'BEANR',
        facilityTypeCode: 'POTE',
        modeOfTransport: 'VESSEL',
        vessel: { vesselIMONumber: '9839131', vesselName: 'MSC LORETO' },
      },
      documentReferences: [
        { documentReferenceType: 'BKG', documentReferenceValue: 'EBKG01234567' },
        { documentReferenceType: 'TRD', documentReferenceValue: 'MEDUAB123456' },
      ],
      references: [{ referenceType: 'CR', referenceValue: 'om-container-MSCU1234567' }],
    },
  ],
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DockflowAdapter.fetchEvents', () => {
  it('polls upstream in DCSA 2.2 format and parses the events of a tracked tradeflow', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [UPSTREAM_RECORD], next_cursor: null }))

    const result = await new DockflowAdapter().fetchEvents({
      referenceType: 'container',
      referenceValue: 'MSCU1234567',
      authConfig,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://api.dockflow.com/v3/upstream?format=dcsa-tnt-2.2&tradeflow=om-container-MSCU1234567&fields=events',
    )
    expect(init.headers.Authorization).toBe('Bearer uat_acme_secret')

    expect(result.bookingNumber).toBe('EBKG01234567')
    expect(result.bolNumber).toBe('MEDUAB123456')
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({
      source: 'dcsa',
      sourceEventId: '5d1c9a6e-0b7f-5c4e-9f3a-2a8e1c0d4b11',
      eventType: 'EQUIPMENT',
      eventCode: 'LOAD',
      equipmentReference: 'MSCU1234567',
      locationUnlocode: 'BEANR',
      vesselImo: '9839131',
      vesselName: 'MSC LORETO',
      carrierExportVoyageNumber: '442W',
      publisherName: 'Dockflow',
    })
  })

  it('registers an untracked reference downstream and reports it as known with no events yet', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [], next_cursor: null }))
      .mockResolvedValueOnce(jsonResponse({ status: 'queued' }, 202))

    const result = await new DockflowAdapter().fetchEvents({
      referenceType: 'booking',
      referenceValue: 'EBKG01234567',
      apiEndpoint: 'https://uat.dockflow.com/v3',
      authConfig,
    })

    expect(result.events).toEqual([])
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://uat.dockflow.com/v3/downstream/tradeflows')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      tradeflow_reference: 'om-booking-EBKG01234567',
      booking_reference: 'EBKG01234567',
    })
  })

  it('surfaces an API error with its status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('"Token lacks the upstream scope"', { status: 403 }))

    await expect(
      new DockflowAdapter().fetchEvents({ referenceType: 'container', referenceValue: 'MSCU1234567', authConfig }),
    ).rejects.toThrow('Dockflow API error (403)')
  })

  it('requires an api_key', async () => {
    await expect(
      new DockflowAdapter().fetchEvents({ referenceType: 'container', referenceValue: 'MSCU1234567', authConfig: {} }),
    ).rejects.toThrow('Dockflow authConfig requires api_key')
  })
})
