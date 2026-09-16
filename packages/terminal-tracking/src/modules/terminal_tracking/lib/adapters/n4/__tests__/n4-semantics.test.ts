import { mapRowToEvent, buildSourceEventId, parseCargoCategory, parseN4DateTime, pickVesselVisit } from '../n4-semantics'
import type { N4UnitRow } from '../types'
import type { ResolvedTerminalConfig } from '../../../terminal-adapter'

const config: ResolvedTerminalConfig = {
  terminalCode: 'bct',
  adapterType: 'n4',
  displayName: 'Baltic Hub',
  baseUrl: 'https://api2.baltichub.com/V1/',
  endpoints: { unit: '/unit' },
  authType: 'oauth2_password',
  rateLimitRequests: 200,
  rateLimitWindowSeconds: 60,
  unlocode: 'PLGDN',
  facilityCode: 'GDNBCT',
  facilityCodeListProvider: 'SMDG',
}

function row(partial: Partial<N4UnitRow>): N4UnitRow {
  return { ufvGkey: '1', unitNbr: 'GCXU5598460', raw: {}, ...partial }
}

describe('mapRowToEvent', () => {
  it('maps an inbound export leg to an EQUIPMENT/GTIN actual event', () => {
    const ev = mapRowToEvent(
      row({ ufvGkey: '11412344487', tState: 'Inbound', ibActualVisit: 'GEN_TRUCK', obActualVisit: '26WIKI624', vgmWeight: 28300 }),
      config,
    )
    expect(ev).not.toBeNull()
    expect(ev!.source).toBe('terminal')
    expect(ev!.eventType).toBe('EQUIPMENT')
    expect(ev!.eventCode).toBe('GTIN')
    expect(ev!.eventClassifierCode).toBe('ACT')
    expect(ev!.transitState).toBe('S20_INBOUND')
    expect(ev!.sourceEventId).toBe('bct:11412344487:GTIN')
    expect(ev!.containerNumber).toBe('GCXU5598460')
    expect(ev!.facilityCode).toBe('GDNBCT')
    expect(ev!.facilityCodeListProvider).toBe('SMDG')
    expect(ev!.unlocode).toBe('PLGDN')
    expect(ev!.vgmWeightKg).toBe(28300)
  })

  it('maps a departed leg to a TRANSPORT/DEPA event dated from Time Out', () => {
    const ev = mapRowToEvent(
      row({ ufvGkey: '11341499051', tState: 'Departed', timeIn: '2026-05-27 23:41', timeOut: '2026-06-03 01:58', loaded: '2026-06-03 01:47' }),
      config,
    )
    expect(ev!.eventType).toBe('TRANSPORT')
    expect(ev!.eventCode).toBe('DEPA')
    expect(ev!.transitState).toBe('S70_DEPARTED')
    expect(ev!.sourceEventId).toBe('bct:11341499051:DEPA')
    // Terminal-local (Europe/Warsaw, CEST +02:00 in June) → UTC.
    expect(ev!.eventDateTime.toISOString()).toBe('2026-06-02T23:58:00.000Z')
    // loadedAt is parsed from `Loaded` even though this row is Departed (not
    // S60_LOADED) — independent of the event timestamp (which came from Time Out).
    expect(ev!.loadedAt?.toISOString()).toBe('2026-06-02T23:47:00.000Z')
  })

  it('leaves loadedAt null when the row has no Loaded value', () => {
    const ev = mapRowToEvent(row({ tState: 'Inbound', ibActualVisit: 'GEN_TRUCK' }), config)
    expect(ev!.loadedAt).toBeNull()
  })

  it('returns null for an unmapped transit state', () => {
    expect(mapRowToEvent(row({ tState: 'Advised' }), config)).toBeNull()
    expect(mapRowToEvent(row({ tState: null }), config)).toBeNull()
  })

  it('infers mode of transport from the visit refs', () => {
    expect(mapRowToEvent(row({ tState: 'Inbound', ibActualVisit: 'GEN_TRUCK', obActualVisit: null }), config)!.modeOfTransport).toBe('TRUCK')
    expect(mapRowToEvent(row({ tState: 'Departed', obActualVisit: 'TUX3W31-25_IMP' }), config)!.modeOfTransport).toBe('RAIL')
    expect(mapRowToEvent(row({ tState: 'Departed', obActualVisit: '25CHAM531' }), config)!.modeOfTransport).toBe('VESSEL')
  })

  it('produces a stable sourceEventId (idempotent across polls)', () => {
    const r = row({ ufvGkey: '777', tState: 'Loaded' })
    const a = mapRowToEvent(r, config)!
    const b = mapRowToEvent(r, config)!
    expect(a.sourceEventId).toBe(b.sourceEventId)
    expect(a.sourceEventId).toBe('bct:777:LOAD')
  })
})

describe('buildSourceEventId', () => {
  it('joins terminalCode, gkey and eventCode', () => {
    expect(buildSourceEventId('bct', '123', 'GTIN')).toBe('bct:123:GTIN')
  })
})

describe('parseCargoCategory', () => {
  it('normalizes the N4 Category column to a direction', () => {
    expect(parseCargoCategory({ Category: 'Import' })).toBe('import')
    expect(parseCargoCategory({ Category: ' export ' })).toBe('export')
  })

  it('is null for non-directional or missing categories', () => {
    expect(parseCargoCategory({ Category: 'Storage' })).toBeNull() // empties
    expect(parseCargoCategory({})).toBeNull()
    expect(parseCargoCategory(null)).toBeNull()
  })
})

describe('pickVesselVisit', () => {
  it('picks the I/B visit for an import leg', () => {
    expect(
      pickVesselVisit({ visitRefIn: '26JAPA038', visitRefOut: 'POS75955', rawData: { Category: 'Import' } }),
    ).toEqual({ ref: '26JAPA038', dir: 'in' })
  })

  it('picks the O/B visit for an export leg (vessel on the outbound side)', () => {
    expect(
      pickVesselVisit({ visitRefIn: 'GDA56850', visitRefOut: '26OOFX010', rawData: { Category: 'Export' } }),
    ).toEqual({ ref: '26OOFX010', dir: 'out' })
  })

  it('returns null for an unknown category or missing rawData', () => {
    expect(pickVesselVisit({ visitRefIn: '26X', visitRefOut: '26Y', rawData: { Category: 'Storage' } })).toBeNull()
    expect(pickVesselVisit({ visitRefIn: '26X', visitRefOut: '26Y', rawData: null })).toBeNull()
  })

  it('returns null when the relevant side is missing', () => {
    expect(pickVesselVisit({ visitRefIn: null, visitRefOut: '26Y', rawData: { Category: 'Import' } })).toBeNull()
  })
})

describe('parseN4DateTime', () => {
  it('parses "yyyy-mm-dd hh:mm" as terminal-local (Europe/Warsaw) → UTC', () => {
    // 23:41 CEST (+02:00) on 2026-05-27 is 21:41 UTC.
    expect(parseN4DateTime('2026-05-27 23:41')!.toISOString()).toBe('2026-05-27T21:41:00.000Z')
  })
  it('honours an explicit timezone argument', () => {
    // Same wall-clock, read as UTC when the terminal's zone is UTC.
    expect(parseN4DateTime('2026-05-27 23:41', 'UTC')!.toISOString()).toBe('2026-05-27T23:41:00.000Z')
  })
  it('returns null for empty / invalid input', () => {
    expect(parseN4DateTime(null)).toBeNull()
    expect(parseN4DateTime('')).toBeNull()
    expect(parseN4DateTime('not a date')).toBeNull()
  })
})
