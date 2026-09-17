import { describe, it, expect } from 'vitest'
import {
  mapContainerToEvents,
  directionFromStatus,
  parseGctDateTime,
  isLandTransport,
} from '../gct-semantics'
import type { GctContainer } from '../types'
import type { ResolvedTerminalConfig } from '../../../terminal-adapter'

const config: ResolvedTerminalConfig = {
  terminalCode: 'gct',
  adapterType: 'gct',
  displayName: 'Gdynia Container Terminal',
  baseUrl: 'https://api.gct.example',
  endpoints: { unit: '/gctapi/GetContainerDetails' },
  authType: 'gct_token',
  rateLimitRequests: 60,
  rateLimitWindowSeconds: 60,
  unlocode: 'PLGDY',
}

function container(partial: Partial<GctContainer>): GctContainer {
  return { CntrID: 'GCTU1234567', VisitNo: 'V-001', ...partial }
}

describe('directionFromStatus', () => {
  it('maps X* to export and I* to import', () => {
    expect(directionFromStatus('XF')).toBe('export')
    expect(directionFromStatus('XM')).toBe('export')
    expect(directionFromStatus('IF')).toBe('import')
  })
  it('returns null for empty-no-purpose, unknown, and blank', () => {
    expect(directionFromStatus('EM')).toBeNull()
    expect(directionFromStatus('ZZ')).toBeNull()
    expect(directionFromStatus('')).toBeNull()
    expect(directionFromStatus(null)).toBeNull()
  })
  it('does not crash on the undocumented XI status', () => {
    expect(directionFromStatus('XI')).toBe('export')
  })
})

describe('isLandTransport', () => {
  it('detects the TLO sentinel in VesselName or GCTVoyage', () => {
    expect(isLandTransport(container({ VesselName: 'Transport lądowy wym. odprawy (TLO)' }))).toBe(true)
    expect(isLandTransport(container({ GCTVoyage: 'GCT-TLO-2023' }))).toBe(true)
    expect(isLandTransport(container({ VesselName: 'transport lądowy' }))).toBe(true)
  })
  it('is false for a real vessel visit', () => {
    expect(isLandTransport(container({ VesselName: 'MSC ISABELLA', GCTVoyage: 'V123' }))).toBe(false)
    expect(isLandTransport(container({}))).toBe(false)
  })
})

describe('parseGctDateTime', () => {
  it('parses ISO-8601', () => {
    expect(parseGctDateTime('2026-08-10T09:30:00Z')?.toISOString()).toBe('2026-08-10T09:30:00.000Z')
  })
  it('parses the N4-style "yyyy-mm-dd hh:mm" as terminal-local (Europe/Warsaw) → UTC', () => {
    // 09:30 CEST (+02:00) on 2026-08-10 is 07:30 UTC.
    expect(parseGctDateTime('2026-08-10 09:30')?.toISOString()).toBe('2026-08-10T07:30:00.000Z')
  })
  it('returns null for empty/garbage', () => {
    expect(parseGctDateTime(null)).toBeNull()
    expect(parseGctDateTime('  ')).toBeNull()
    expect(parseGctDateTime('not-a-date')).toBeNull()
  })
})

describe('mapContainerToEvents', () => {
  // TC-TRACK-302
  it('emits one gate_in (GTIN) event from GroundingDateTime, keyed on VisitNo', () => {
    const events = mapContainerToEvents(
      container({ GroundingDateTime: '2026-08-10T09:30:00Z', CntrStatus: 'IF', VGMWeight: 24000 }),
      config,
    )
    expect(events).toHaveLength(1)
    const ev = events[0]
    expect(ev.eventType).toBe('EQUIPMENT')
    expect(ev.eventCode).toBe('GTIN')
    expect(ev.eventClassifierCode).toBe('ACT')
    expect(ev.ufvGkey).toBe('V-001')
    expect(ev.sourceEventId).toBe('gct:V-001:GTIN')
    expect(ev.containerNumber).toBe('GCTU1234567')
    expect(ev.unlocode).toBe('PLGDY')
    expect(ev.vgmWeightKg).toBe(24000)
    expect(ev.transitState).toBe('IF')
    expect(ev.eventDateTime.toISOString()).toBe('2026-08-10T09:30:00.000Z')
  })

  // TC-TRACK-303
  it('adds a departed (DEPA) event when PickupDateTime is present', () => {
    const events = mapContainerToEvents(
      container({ GroundingDateTime: '2026-08-10T09:30:00Z', PickupDateTime: '2026-08-12T14:00:00Z' }),
      config,
    )
    expect(events.map((e) => e.eventCode)).toEqual(['GTIN', 'DEPA'])
    const dep = events.find((e) => e.eventCode === 'DEPA')!
    expect(dep.eventType).toBe('TRANSPORT')
    expect(dep.sourceEventId).toBe('gct:V-001:DEPA')
    expect(dep.eventDateTime.toISOString()).toBe('2026-08-12T14:00:00.000Z')
  })

  it('emits no events when neither timestamp is present', () => {
    expect(mapContainerToEvents(container({ CntrStatus: 'XF' }), config)).toEqual([])
  })

  // TC-TRACK-304
  it('passes HoldCodesList through as impediments (dropping blanks)', () => {
    const events = mapContainerToEvents(
      container({ GroundingDateTime: '2026-08-10T09:30:00Z', HoldCodesList: ['CUSTOMS', '', '  ', 'VGM'] }),
      config,
    )
    expect(events[0].impediments).toEqual(['CUSTOMS', 'VGM'])
  })

  it('maps SealList to seal objects and preserves the full snapshot in rawData', () => {
    const events = mapContainerToEvents(
      container({
        GroundingDateTime: '2026-08-10T09:30:00Z',
        SealList: ['SEAL1'],
        CntrStatus: 'XF',
        VesselName: 'MSC ISABELLA',
        GCTVoyage: 'V123',
      }),
      config,
    )
    const ev = events[0]
    expect(ev.seals).toEqual([{ number: 'SEAL1', source: 'gct' }])
    expect(ev.vesselName).toBe('MSC ISABELLA')
    expect(ev.voyageNumber).toBe('V123')
    expect(ev.modeOfTransport).toBe('VESSEL')
    expect((ev.rawData as Record<string, unknown>).Category).toBe('export')
    expect((ev.rawData as Record<string, unknown>).CntrID).toBe('GCTU1234567')
  })

  // TC-TRACK-305: real GCT test-env row — a land (TLO) import gate-in.
  it('maps a land-transport (TLO) box to a TRUCK gate-in and drops the placeholder vessel/voyage', () => {
    const events = mapContainerToEvents(
      container({
        CntrID: 'BMOU1419729',
        VisitNo: '23460014',
        CntrStatus: 'IF',
        GroundingDateTime: '2023-11-19 21:20',
        PickupDateTime: null,
        VesselName: 'Transport lądowy wym. odprawy (TLO)',
        GCTVoyage: 'GCT-TLO-2023',
        OwnerVoyage: '2023',
        HoldCodesList: ['DT'],
        SealList: ['PCC0392160', 'UCP1015'],
        VGMWeight: null,
      }),
      config,
    )
    expect(events.map((e) => e.eventCode)).toEqual(['GTIN'])
    const ev = events[0]
    expect(ev.modeOfTransport).toBe('TRUCK')
    // The TLO sentinel must not leak downstream as a real vessel/voyage…
    expect(ev.vesselName).toBeNull()
    expect(ev.voyageNumber).toBeNull()
    // …but the verbatim snapshot still carries the original value.
    expect((ev.rawData as Record<string, unknown>).VesselName).toBe(
      'Transport lądowy wym. odprawy (TLO)',
    )
    expect((ev.rawData as Record<string, unknown>).Category).toBe('import')
    expect(ev.impediments).toEqual(['DT'])
    expect(ev.seals).toEqual([
      { number: 'PCC0392160', source: 'gct' },
      { number: 'UCP1015', source: 'gct' },
    ])
    expect(ev.vgmWeightKg).toBeNull()
    // naive terminal-local "yyyy-mm-dd hh:mm" → 21:20 CET (+01:00) in November.
    expect(ev.eventDateTime.toISOString()).toBe('2023-11-19T20:20:00.000Z')
  })

  it('falls back to CntrID for the dedup key when VisitNo is missing', () => {
    const events = mapContainerToEvents(
      container({ VisitNo: null, GroundingDateTime: '2026-08-10T09:30:00Z' }),
      config,
    )
    expect(events[0].ufvGkey).toBe('GCTU1234567')
    expect(events[0].sourceEventId).toBe('gct:GCTU1234567:GTIN')
  })

  it('returns [] for a container with no CntrID', () => {
    expect(mapContainerToEvents({ CntrID: '' } as GctContainer, config)).toEqual([])
  })
})
