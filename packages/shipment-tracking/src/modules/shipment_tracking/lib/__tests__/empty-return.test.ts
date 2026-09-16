import {
  allContainersComplete,
  destinationArrivedBefore,
  isContainerComplete,
  isDestinationArrival,
  isEmptyGateIn,
  isFinalDelivery,
  type EmptyReturnEvent,
} from '../empty-return'

const DEST = 'PLGDN'

const arrivalAtDest = (code: 'ARRI' | 'DISC', at: string, daysAgo: number): EmptyReturnEvent => ({
  eventType: code === 'ARRI' ? 'TRANSPORT' : 'EQUIPMENT',
  eventCode: code,
  eventClassifierCode: 'ACT',
  locationUnlocode: at,
  eventDateTime: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
})

const emptyGateIn = (container: string): EmptyReturnEvent => ({
  eventType: 'EQUIPMENT',
  eventCode: 'GTIN',
  eventClassifierCode: 'ACT',
  emptyIndicatorCode: 'EMPTY',
  equipmentReference: container,
})

const delivered = (container: string): EmptyReturnEvent => ({
  eventType: 'EQUIPMENT',
  eventCode: 'DLVR',
  eventClassifierCode: 'ACT',
  equipmentReference: container,
})

const ladenGateOutAtDest = (container: string): EmptyReturnEvent => ({
  eventType: 'EQUIPMENT',
  eventCode: 'GTOT',
  eventClassifierCode: 'ACT',
  emptyIndicatorCode: 'LADEN',
  equipmentReference: container,
})

describe('empty-return', () => {
  describe('isEmptyGateIn', () => {
    it('matches an actual empty gate-in', () => {
      expect(isEmptyGateIn(emptyGateIn('C1'))).toBe(true)
    })

    it('rejects a laden gate-in (export origin)', () => {
      expect(isEmptyGateIn({ ...emptyGateIn('C1'), emptyIndicatorCode: 'LADEN' })).toBe(false)
    })

    it('rejects a planned/estimated empty gate-in', () => {
      expect(isEmptyGateIn({ ...emptyGateIn('C1'), eventClassifierCode: 'PLN' })).toBe(false)
      expect(isEmptyGateIn({ ...emptyGateIn('C1'), eventClassifierCode: 'EST' })).toBe(false)
    })

    it('rejects a non-gate-in equipment event', () => {
      expect(isEmptyGateIn({ ...emptyGateIn('C1'), eventCode: 'GTOT' })).toBe(false)
    })

    it('rejects a transport event', () => {
      expect(isEmptyGateIn({ ...emptyGateIn('C1'), eventType: 'TRANSPORT' })).toBe(false)
    })
  })

  describe('isFinalDelivery', () => {
    it('matches an actual DLVR (COSCO delivery to consignee)', () => {
      expect(isFinalDelivery(delivered('C1'))).toBe(true)
    })

    it('rejects a planned/estimated DLVR', () => {
      expect(isFinalDelivery({ ...delivered('C1'), eventClassifierCode: 'EST' })).toBe(false)
    })

    it('rejects a non-DLVR equipment event', () => {
      expect(isFinalDelivery(emptyGateIn('C1'))).toBe(false)
      expect(isFinalDelivery(ladenGateOutAtDest('C1'))).toBe(false)
    })
  })

  describe('isContainerComplete', () => {
    it('is true for empty gate-in or delivery', () => {
      expect(isContainerComplete(emptyGateIn('C1'))).toBe(true)
      expect(isContainerComplete(delivered('C1'))).toBe(true)
    })

    it('is false for a laden gate-out at destination (DCSA pickup, not empty return)', () => {
      expect(isContainerComplete(ladenGateOutAtDest('C1'))).toBe(false)
    })
  })

  describe('allContainersComplete', () => {
    it('is true when every tracked container has an empty gate-in', () => {
      const containers = new Set(['C1', 'C2'])
      const events = [emptyGateIn('C1'), emptyGateIn('C2')]
      expect(allContainersComplete(events, containers)).toBe(true)
    })

    it('is true for a mixed job: one empty return, one COSCO delivery', () => {
      const containers = new Set(['C1', 'C2'])
      const events = [emptyGateIn('C1'), delivered('C2')]
      expect(allContainersComplete(events, containers)).toBe(true)
    })

    it('is false when one container is missing its completion event', () => {
      const containers = new Set(['C1', 'C2'])
      const events = [emptyGateIn('C1')]
      expect(allContainersComplete(events, containers)).toBe(false)
    })

    it('is false with only laden gate-outs at destination (DCSA not stopped by pickup)', () => {
      const containers = new Set(['C1'])
      const events = [ladenGateOutAtDest('C1')]
      expect(allContainersComplete(events, containers)).toBe(false)
    })

    it('is false with a planned (non-ACT) empty gate-in', () => {
      const containers = new Set(['C1'])
      const events = [{ ...emptyGateIn('C1'), eventClassifierCode: 'EST' as const }]
      expect(allContainersComplete(events, containers)).toBe(false)
    })

    it('is false for an empty container set (nothing discovered yet)', () => {
      expect(allContainersComplete([emptyGateIn('C1')], new Set())).toBe(false)
    })

    it('ignores completion events for containers not in the tracked set', () => {
      const containers = new Set(['C1'])
      const events = [emptyGateIn('C1'), delivered('C9')]
      expect(allContainersComplete(events, containers)).toBe(true)
    })
  })

  describe('isDestinationArrival', () => {
    it('matches ARRI/DISC ACT at the destination', () => {
      expect(isDestinationArrival(arrivalAtDest('ARRI', DEST, 5), DEST)).toBe(true)
      expect(isDestinationArrival(arrivalAtDest('DISC', DEST, 5), DEST)).toBe(true)
    })

    it('rejects arrival at a non-destination (transshipment)', () => {
      expect(isDestinationArrival(arrivalAtDest('ARRI', 'DEHAM', 5), DEST)).toBe(false)
    })

    it('rejects a planned/estimated arrival', () => {
      expect(isDestinationArrival({ ...arrivalAtDest('ARRI', DEST, 5), eventClassifierCode: 'EST' }, DEST)).toBe(false)
    })

    it('rejects when the destination is unknown (null)', () => {
      expect(isDestinationArrival(arrivalAtDest('ARRI', DEST, 5), null)).toBe(false)
    })
  })

  describe('destinationArrivedBefore', () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    it('is true when a destination arrival is older than the cutoff', () => {
      expect(destinationArrivedBefore([arrivalAtDest('DISC', DEST, 31)], DEST, cutoff)).toBe(true)
    })

    it('is false when the destination arrival is more recent than the cutoff', () => {
      expect(destinationArrivedBefore([arrivalAtDest('DISC', DEST, 20)], DEST, cutoff)).toBe(false)
    })

    it('is false for an old arrival at a non-destination UNLOCODE', () => {
      expect(destinationArrivedBefore([arrivalAtDest('DISC', 'DEHAM', 40)], DEST, cutoff)).toBe(false)
    })

    it('is false when the destination is unknown', () => {
      expect(destinationArrivedBefore([arrivalAtDest('DISC', DEST, 40)], null, cutoff)).toBe(false)
    })
  })
})
