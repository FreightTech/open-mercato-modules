/**
 * Synthetic Test Fixtures for Consecutive Polling Scenarios
 *
 * These fixtures use flat DCSA event arrays (same format as real API responses).
 * Events are ordered by poll sequence (not chronologically by eventDateTime).
 * Use simple .slice() for incremental polling tests - do NOT sort by eventDateTime.
 */

import type { RawDcsaEvent } from '../index'

// Import flat DCSA event arrays
import voyageProgressionRaw from '../synthetic-voyage-progression.json'
import etaUpdatesRaw from '../synthetic-eta-updates.json'
import routeInferenceRaw from '../synthetic-route-inference.json'

/**
 * Full voyage progression fixture.
 * Route: CRMOB (Costa Rica) → BEANR (Antwerp, transship) → PLGDY (Gdynia)
 * Container: MSNU2138133
 * Booking: TEST-VOYAGE-001
 *
 * 12 events covering full voyage lifecycle:
 * 1. GTOT - Empty pickup at inland depot (CRCAR)
 * 2. GTIN - Gate in at origin port (CRMOB)
 * 3. LOAD - Loaded at origin
 * 4. DEPA - Departed origin
 * 5. ARRI - Arrived transship (BEANR)
 * 6. DISC - Discharged at transship
 * 7. LOAD - Loaded at transship
 * 8. DEPA - Departed transship
 * 9. ARRI - Arrived destination (PLGDY)
 * 10. DISC - Discharged at destination
 * 11. GTOT - Delivered (gate out)
 * 12. GTIN - Empty return
 */
export const voyageProgressionFixture = {
  metadata: {
    booking: 'TEST-VOYAGE-001',
    container: 'MSNU2138133',
    origin: 'CRMOB',
    inlandDepot: 'CRCAR',
    transshipPort: 'BEANR',
    destination: 'PLGDY',
  },
  events: voyageProgressionRaw as RawDcsaEvent[],

  /** Get events up to specified stage (1-12) */
  getEventsUpTo(stage: number): RawDcsaEvent[] {
    // Simple slice - fixture is already ordered by poll sequence, not chronologically
    return (this.events as RawDcsaEvent[]).slice(0, stage)
  },

  // Stage indices for readability
  stages: {
    emptyPickup: 1,
    gateInOrigin: 2,
    loadedAtOrigin: 3,
    departedOrigin: 4,
    arrivedTransship: 5,
    dischargedTransship: 6,
    loadedTransship: 7,
    departedTransship: 8,
    arrivedDestination: 9,
    dischargedDestination: 10,
    delivered: 11,
    emptyReturn: 12,
  },
}

/**
 * ETA/ETD update fixture.
 * Route: CNYTN (Yantian) → PLGDN (Gdansk)
 * Container: TEST1234567
 * Booking: TEST-ETA-001
 *
 * 9 events simulating schedule changes:
 * Poll 1 (events 1-3): Initial EST DEPA/ARRI + GTIN
 * Poll 2 (event 4): ETA delayed (new EST ARRI)
 * Poll 3 (events 5-6): Actual departure (LOAD + ACT DEPA)
 * Poll 4 (event 7): ETA moved earlier (new EST ARRI)
 * Poll 5 (events 8-9): Actual arrival (ACT ARRI + DISC)
 */
export const etaUpdateFixture = {
  metadata: {
    booking: 'TEST-ETA-001',
    container: 'TEST1234567',
    origin: 'CNYTN',
    destination: 'PLGDN',
  },
  events: etaUpdatesRaw as RawDcsaEvent[],

  /** Get events for specified poll number (1-5) */
  getEventsUpToPoll(poll: 1 | 2 | 3 | 4 | 5): RawDcsaEvent[] {
    const pollEndIndices = { 1: 3, 2: 4, 3: 6, 4: 7, 5: 9 }
    // Simple slice - fixture is already ordered by poll sequence, not chronologically
    return (this.events as RawDcsaEvent[]).slice(0, pollEndIndices[poll])
  },

  expectedTimes: {
    poll1: { eta: '2026-02-20T06:00:00+01:00', etd: '2026-01-15T10:00:00+08:00' },
    poll2: { eta: '2026-02-25T08:00:00+01:00', etd: '2026-01-15T10:00:00+08:00' },
    poll3: { eta: '2026-02-25T08:00:00+01:00', atd: '2026-01-16T10:30:00+08:00' },
    poll4: { eta: '2026-02-22T14:00:00+01:00', atd: '2026-01-16T10:30:00+08:00' },
    poll5: { eta: '2026-02-22T14:00:00+01:00', ata: '2026-02-21T18:30:00+01:00' },
  },
}

/**
 * Route inference fixture.
 * Route: CNYTN (Yantian) → PLGDN (Gdansk)
 * Container: TEST7654321
 * Booking: TEST-ROUTE-001
 *
 * 6 events testing route inference:
 * Poll 1 (events 1-2): Equipment events at inland depot (CNSZX) - route cannot be inferred
 * Poll 2 (events 3-6): Transport events reveal actual route (CNYTN → PLGDN)
 */
export const routeInferenceFixture = {
  metadata: {
    booking: 'TEST-ROUTE-001',
    container: 'TEST7654321',
    origin: 'CNYTN',
    inlandDepot: 'CNSZX',
    destination: 'PLGDN',
  },
  events: routeInferenceRaw as RawDcsaEvent[],

  /** Get events for poll 1 (only inland depot events) */
  getEventsForPoll1(): RawDcsaEvent[] {
    // Simple slice - fixture is already ordered by poll sequence
    return (this.events as RawDcsaEvent[]).slice(0, 2)
  },

  /** Get events for poll 2 (includes transport events) */
  getEventsForPoll2(): RawDcsaEvent[] {
    return this.events as RawDcsaEvent[]
  },
}
