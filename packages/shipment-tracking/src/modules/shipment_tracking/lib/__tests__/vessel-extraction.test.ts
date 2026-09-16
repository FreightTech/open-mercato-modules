import { findLatestVesselInfo } from '../vessel-extraction'

describe('findLatestVesselInfo', () => {
  it('should return null for empty array', () => {
    expect(findLatestVesselInfo([])).toBeNull()
  })

  it('should return null when no events have vessel info', () => {
    const events = [
      { vesselName: null, vesselImo: null, voyageNumber: null },
      { vesselName: undefined, vesselImo: undefined, voyageNumber: undefined },
    ]
    expect(findLatestVesselInfo(events)).toBeNull()
  })

  it('should return vessel info from the latest event with data', () => {
    const events = [
      { vesselName: 'VESSEL A', vesselImo: '1234567', voyageNumber: '001N' },
      { vesselName: 'VESSEL B', vesselImo: '7654321', voyageNumber: '002N' },
      { vesselName: null, vesselImo: null, voyageNumber: null }, // Gate operation
    ]
    expect(findLatestVesselInfo(events)).toEqual({
      vesselName: 'VESSEL B',
      vesselImo: '7654321',
      voyageNumber: '002N',
    })
  })

  it('should find vessel by vesselName only', () => {
    const events = [
      { vesselName: 'VESSEL A', vesselImo: null, voyageNumber: null },
      { vesselName: null, vesselImo: null, voyageNumber: null },
    ]
    expect(findLatestVesselInfo(events)).toEqual({
      vesselName: 'VESSEL A',
      vesselImo: null,
      voyageNumber: null,
    })
  })

  it('should find vessel by vesselImo only', () => {
    const events = [
      { vesselName: null, vesselImo: '1234567', voyageNumber: null },
      { vesselName: null, vesselImo: null, voyageNumber: null },
    ]
    expect(findLatestVesselInfo(events)).toEqual({
      vesselName: null,
      vesselImo: '1234567',
      voyageNumber: null,
    })
  })

  it('should find vessel by voyageNumber only', () => {
    const events = [
      { vesselName: null, vesselImo: null, voyageNumber: '001N' },
      { vesselName: null, vesselImo: null, voyageNumber: null },
    ]
    expect(findLatestVesselInfo(events)).toEqual({
      vesselName: null,
      vesselImo: null,
      voyageNumber: '001N',
    })
  })

  it('should handle transshipment (multiple vessels)', () => {
    const events = [
      { vesselName: 'EXAMPLE VESSEL 07', vesselImo: '8000007', voyageNumber: '101N' },
      { vesselName: 'EXAMPLE VESSEL 08', vesselImo: '8000008', voyageNumber: '102N' },
      { vesselName: 'EXAMPLE VESSEL 06', vesselImo: '8000006', voyageNumber: '603N' },
      { vesselName: null, vesselImo: null, voyageNumber: null }, // GTOT
      { vesselName: null, vesselImo: null, voyageNumber: null }, // GTIN
    ]
    // Should return the last vessel (EXAMPLE VESSEL 06)
    expect(findLatestVesselInfo(events)).toEqual({
      vesselName: 'EXAMPLE VESSEL 06',
      vesselImo: '8000006',
      voyageNumber: '603N',
    })
  })

  it('should handle partial vessel info', () => {
    const events = [
      { vesselName: 'VESSEL A', vesselImo: '1234567', voyageNumber: '001N' },
      { vesselName: 'VESSEL B', vesselImo: null, voyageNumber: null }, // Only name
      { vesselName: null, vesselImo: null, voyageNumber: null },
    ]
    // Should return VESSEL B with partial info
    expect(findLatestVesselInfo(events)).toEqual({
      vesselName: 'VESSEL B',
      vesselImo: null,
      voyageNumber: null,
    })
  })

  it('should return first event vessel info when only one event has data', () => {
    const events = [
      { vesselName: 'FIRST VESSEL', vesselImo: '1111111', voyageNumber: '001N' },
      { vesselName: null, vesselImo: null, voyageNumber: null },
      { vesselName: null, vesselImo: null, voyageNumber: null },
      { vesselName: null, vesselImo: null, voyageNumber: null },
    ]
    expect(findLatestVesselInfo(events)).toEqual({
      vesselName: 'FIRST VESSEL',
      vesselImo: '1111111',
      voyageNumber: '001N',
    })
  })
})
