import { describe, it, expect } from 'vitest'
import {
  mapContainerToEvents,
  directionFromCategory,
  modeFromYardType,
  parseIncosDateTime,
  parseIncosVesselDateTime,
  combinedVisitRef,
  splitVisitRef,
  normalizeIncosVesselVisit,
} from '../incos-semantics'
import type { IncosContainer } from '../types'
import type { ResolvedTerminalConfig } from '../../../terminal-adapter'
import { isKnownHoldCode, getHoldInfo } from '../../../holds'

const config: ResolvedTerminalConfig = {
  terminalCode: 'bct',
  adapterType: 'bct',
  displayName: 'Bałtycki Terminal Kontenerowy',
  baseUrl: 'https://incos.pl',
  endpoints: { unit: '/rest-container/container' },
  authType: 'basic',
  rateLimitRequests: 60,
  rateLimitWindowSeconds: 60,
  unlocode: 'PLBCT',
}

function container(partial: Partial<IncosContainer>): IncosContainer {
  return { container_nbr: 'MEDU1221231', ...partial }
}

describe('directionFromCategory', () => {
  it('maps E to export and I/X to import', () => {
    expect(directionFromCategory('E')).toBe('export')
    expect(directionFromCategory('I')).toBe('import')
    expect(directionFromCategory('X')).toBe('import')
    expect(directionFromCategory('e')).toBe('export')
  })
  it('returns null for blank/unknown', () => {
    expect(directionFromCategory('')).toBeNull()
    expect(directionFromCategory('Z')).toBeNull()
    expect(directionFromCategory(null)).toBeNull()
  })
})

describe('modeFromYardType', () => {
  it('maps T/V/R to TRUCK/VESSEL/RAIL', () => {
    expect(modeFromYardType('T')).toBe('TRUCK')
    expect(modeFromYardType('V')).toBe('VESSEL')
    expect(modeFromYardType('R')).toBe('RAIL')
  })
  it('returns null for blank/unknown', () => {
    expect(modeFromYardType('')).toBeNull()
    expect(modeFromYardType('Q')).toBeNull()
    expect(modeFromYardType(null)).toBeNull()
  })
})

describe('parseIncosDateTime', () => {
  it('parses DD-MM-YYYY HH:MI as terminal-local → UTC (day-first, not month-first)', () => {
    // 03:28 CEST (+02:00) on 2020-05-03 is 01:28 UTC.
    expect(parseIncosDateTime('03-05-2020 03:28')?.toISOString()).toBe('2020-05-03T01:28:00.000Z')
    // 13 could not be a month — proves day-first parsing.
    expect(parseIncosDateTime('13-07-2020 10:00')?.toISOString()).toBe('2020-07-13T08:00:00.000Z')
  })
  it('tolerates an optional seconds component', () => {
    expect(parseIncosDateTime('03-05-2020 03:28:45')?.toISOString()).toBe('2020-05-03T01:28:45.000Z')
  })
  it('returns null for empty/garbage/ISO-shaped input', () => {
    expect(parseIncosDateTime(null)).toBeNull()
    expect(parseIncosDateTime('   ')).toBeNull()
    expect(parseIncosDateTime('not-a-date')).toBeNull()
    expect(parseIncosDateTime('2020-05-03T03:28:00Z')).toBeNull()
  })
})

describe('mapContainerToEvents', () => {
  // TC-TRACK-311
  it('emits one gate_in (GTIN) from in_yard_date, keyed on container_nbr', () => {
    const events = mapContainerToEvents(
      container({ in_yard_date: '03-05-2020 03:28', in_yard_type: 'T', category: 'I', vgm_weight: 24000 }),
      config,
    )
    expect(events).toHaveLength(1)
    const ev = events[0]
    expect(ev.eventType).toBe('EQUIPMENT')
    expect(ev.eventCode).toBe('GTIN')
    expect(ev.eventClassifierCode).toBe('ACT')
    expect(ev.ufvGkey).toBe('MEDU1221231')
    expect(ev.sourceEventId).toBe('bct:MEDU1221231:GTIN')
    expect(ev.containerNumber).toBe('MEDU1221231')
    expect(ev.unlocode).toBe('PLBCT')
    expect(ev.vgmWeightKg).toBe(24000)
    expect(ev.modeOfTransport).toBe('TRUCK')
    expect(ev.eventDateTime.toISOString()).toBe('2020-05-03T01:28:00.000Z')
    // `Category` (not `direction`) so the service's parseCargoCategory picks the vessel side.
    expect((ev.rawData as Record<string, unknown>).Category).toBe('import')
  })

  // TC-TRACK-318
  it('emits a discharge (DISC) — not gate_in — when the arrival is by vessel', () => {
    const events = mapContainerToEvents(
      container({ in_yard_date: '14-08-2026 04:03', in_yard_type: 'V', category: 'I' }),
      config,
    )
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('EQUIPMENT')
    expect(events[0].eventCode).toBe('DISC')
    expect(events[0].sourceEventId).toBe('bct:MEDU1221231:DISC')
    expect(events[0].modeOfTransport).toBe('VESSEL')
  })

  it('emits gate_in (GTIN) when the arrival is by rail (R), like truck', () => {
    const events = mapContainerToEvents(
      container({ in_yard_date: '14-08-2026 04:03', in_yard_type: 'R' }),
      config,
    )
    expect(events[0].eventCode).toBe('GTIN')
    expect(events[0].modeOfTransport).toBe('RAIL')
  })

  // TC-TRACK-312
  it('emits ONLY DEPA (current state) once departed, dropping the historical arrival', () => {
    const events = mapContainerToEvents(
      container({
        in_yard_date: '03-05-2020 03:28',
        in_yard_type: 'T',
        out_yard_date: '05-05-2020 14:00',
        out_yard_type: 'V',
        vessel_name_out: 'AILA',
        vessel_visit_outvoy: '66-1E',
      }),
      config,
    )
    // Not [GTIN, DEPA] — the arrival was already persisted while in-yard; keeping
    // it here would stop the job from ever reaching 'completed'.
    expect(events.map((e) => e.eventCode)).toEqual(['DEPA'])
    const dep = events[0]
    expect(dep.eventType).toBe('TRANSPORT')
    expect(dep.sourceEventId).toBe('bct:MEDU1221231:DEPA')
    expect(dep.eventDateTime.toISOString()).toBe('2020-05-05T12:00:00.000Z')
    expect(dep.modeOfTransport).toBe('VESSEL')
    expect(dep.vesselName).toBe('AILA')
    expect(dep.voyageNumber).toBe('66-1E')
  })

  it('emits DEPA from out_yard_date even when no in_yard_date was ever seen', () => {
    const events = mapContainerToEvents(
      container({ out_yard_date: '05-05-2020 14:00', out_yard_type: 'T' }),
      config,
    )
    expect(events.map((e) => e.eventCode)).toEqual(['DEPA'])
    expect(events[0].modeOfTransport).toBe('TRUCK')
  })

  it('emits no events when neither yard timestamp is present', () => {
    expect(mapContainerToEvents(container({ status: 'E', category: 'E' }), config)).toEqual([])
  })

  // TC-TRACK-313
  it('maps a customs HOLD to the direction-specific catalogue code + passes constraint codes through', () => {
    const imp = mapContainerToEvents(
      container({ in_yard_date: '03-05-2020 03:28', category: 'I', customs_status: 'HOLD', constraint: 'STOPUC; STOPLINE ;' }),
      config,
    )
    expect(imp[0].impediments).toEqual(['CUSTOMS IMPORT HOLD', 'STOPUC', 'STOPLINE'])

    const exp = mapContainerToEvents(
      container({ in_yard_date: '03-05-2020 03:28', category: 'E', customs_status: 'HOLD' }),
      config,
    )
    expect(exp[0].impediments).toEqual(['CUSTOMS EXPORT HOLD'])
  })

  // TC-TRACK-319: the mapped customs code must resolve in the shared holds
  // catalogue (critical), not fall to the "unknown" fallback.
  it('emits a customs-hold code that the holds catalogue classifies as critical', () => {
    const events = mapContainerToEvents(
      container({ in_yard_date: '03-05-2020 03:28', category: 'I', customs_status: 'HOLD' }),
      config,
    )
    const code = events[0].impediments![0]
    expect(isKnownHoldCode(code)).toBe(true)
    expect(getHoldInfo(code).severity).toBe('critical')
    expect(getHoldInfo(code).unknown).toBe(false)
  })

  it('defaults an unknown-direction customs HOLD to the import code', () => {
    const events = mapContainerToEvents(
      container({ in_yard_date: '03-05-2020 03:28', customs_status: 'HOLD' }),
      config,
    )
    expect(events[0].impediments).toEqual(['CUSTOMS IMPORT HOLD'])
  })

  it('omits impediments when there is no hold and no constraint', () => {
    const events = mapContainerToEvents(
      container({ in_yard_date: '03-05-2020 03:28', customs_status: '', constraint: null }),
      config,
    )
    expect(events[0].impediments).toBeNull()
  })

  // TC-TRACK-314
  it('maps seal1..seal4 to seal objects (dropping blanks) and preserves the snapshot', () => {
    const events = mapContainerToEvents(
      container({
        in_yard_date: '03-05-2020 03:28',
        in_yard_type: 'V',
        seal1: '123',
        seal2: '  ',
        seal3: '456',
        seal4: null,
        actual_location: 'YARD',
        vessel_code_in: 'CSAILA',
        vessel_name_in: 'AILA',
        vessel_visit_invoy: '66-1I',
      }),
      config,
    )
    const ev = events[0]
    expect(ev.seals).toEqual([
      { number: '123', source: 'bct' },
      { number: '456', source: 'bct' },
    ])
    expect(ev.transitState).toBe('YARD')
    expect(ev.vesselName).toBe('AILA')
    expect(ev.voyageNumber).toBe('66-1I')
    // visitRef packs vesselCode + voyage as CODE/VOY for the vessel lookup.
    expect(ev.visitRefIn).toBe('CSAILA/66-1I')
    expect((ev.rawData as Record<string, unknown>).container_nbr).toBe('MEDU1221231')
  })

  it('returns [] for a container with no container_nbr', () => {
    expect(mapContainerToEvents({ container_nbr: '' } as IncosContainer, config)).toEqual([])
    expect(mapContainerToEvents({ container_nbr: null } as IncosContainer, config)).toEqual([])
  })
})

// ── Vessel visit (Phase 2) ──────────────────────────────────────────────────

describe('combinedVisitRef / splitVisitRef', () => {
  it('packs code + voyage and splits them back', () => {
    expect(combinedVisitRef('MSADMIR', 'EO630R')).toBe('MSADMIR/EO630R')
    expect(splitVisitRef('MSADMIR/EO630R')).toEqual({ vesselCode: 'MSADMIR', voyage: 'EO630R' })
  })
  it('needs both parts, trims, and rejects malformed refs', () => {
    expect(combinedVisitRef('MSADMIR', '')).toBeNull()
    expect(combinedVisitRef('', 'EO630R')).toBeNull()
    expect(combinedVisitRef(null, null)).toBeNull()
    expect(combinedVisitRef('  MSADMIR ', ' EO630R ')).toBe('MSADMIR/EO630R')
    expect(splitVisitRef('EO630R')).toBeNull()
    expect(splitVisitRef('/EO630R')).toBeNull()
    expect(splitVisitRef('MSADMIR/')).toBeNull()
  })
})

describe('parseIncosVesselDateTime', () => {
  it('parses the vessel YYYY-MM-DD HH:MM:SS form as terminal-local → UTC', () => {
    // 18:00 CEST (+02:00) on 2026-08-13 is 16:00 UTC.
    expect(parseIncosVesselDateTime('2026-08-13 18:00:00')?.toISOString()).toBe('2026-08-13T16:00:00.000Z')
    expect(parseIncosVesselDateTime('2026-08-13 18:00')?.toISOString()).toBe('2026-08-13T16:00:00.000Z')
  })
  it('rejects the container day-first form and garbage', () => {
    // Container uses DD-MM-YYYY — must NOT be accepted here.
    expect(parseIncosVesselDateTime('13-08-2026 18:00')).toBeNull()
    expect(parseIncosVesselDateTime(null)).toBeNull()
    expect(parseIncosVesselDateTime('not-a-date')).toBeNull()
  })
})

describe('normalizeIncosVesselVisit', () => {
  // TC-TRACK-320: maps the live vessel payload to the shared NormalizedVesselVisit.
  it('maps vessel fields + ETA/ATA and nulls the N4-only fields', () => {
    const v = normalizeIncosVesselVisit(
      {
        vessel_code: 'MSADMIR',
        vessel_name: 'ADMIRAL NEPTUNE (MSC)',
        in_voy: 'EO630R',
        out_voy: 'EO630R',
        line_code: 'MSC',
        eta: '2026-08-13 18:00:00',
        etd: '2026-08-14 18:00:00',
        ata: '2026-08-13 18:55:00',
        atd: '2026-08-14 19:30:00',
      },
      'MSADMIR/EO630R',
    )
    expect(v.visitRef).toBe('MSADMIR/EO630R')
    expect(v.vesselName).toBe('ADMIRAL NEPTUNE (MSC)')
    expect(v.ibVoyage).toBe('EO630R')
    expect(v.obVoyage).toBe('EO630R')
    expect(v.line).toBe('MSC')
    // Terminal-local (Europe/Warsaw, CEST +02:00 in August) → UTC.
    expect(v.eta?.toISOString()).toBe('2026-08-13T16:00:00.000Z')
    expect(v.ata?.toISOString()).toBe('2026-08-13T16:55:00.000Z')
    expect(v.atd?.toISOString()).toBe('2026-08-14T17:30:00.000Z')
    // INCOS has none of these.
    expect(v.phase).toBeNull()
    expect(v.beginReceive).toBeNull()
    expect(v.dryCutoff).toBeNull()
  })
})
