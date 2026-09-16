import type { ShipmentStatusEnum, TrackingEventClassifierCode } from '../data/entities'

export type ShipmentStatus = ShipmentStatusEnum

type EventInput = {
  eventCode: string
  eventClassifierCode?: TrackingEventClassifierCode | null
  locationUnlocode?: string | null
}

type ShipmentContext = {
  originUnlocode?: string | null
  destinationUnlocode?: string | null
}

type TimeContext = {
  eta?: Date | null
  ata?: Date | null
}

/**
 * Number of days before ETA when a shipment transitions to PRE_ARRIVAL status.
 * Shipment becomes PRE_ARRIVAL when: ETA is within this many days AND no ATA yet.
 */
export const PRE_ARRIVAL_DAYS_THRESHOLD = 7

const STATUS_ORDER: ShipmentStatus[] = [
  'PENDING',
  'BOOKED',
  'DEPARTED',
  'IN_TRANSIT',
  'PRE_ARRIVAL',
  'ARRIVED',
  'DELIVERED',
]

function statusRank(status: ShipmentStatus): number {
  return STATUS_ORDER.indexOf(status)
}

function isAtDestination(eventLocation: string | null | undefined, destination: string | null | undefined): boolean {
  if (!eventLocation || !destination) return false
  return eventLocation.toUpperCase() === destination.toUpperCase()
}

function isAtOrigin(eventLocation: string | null | undefined, origin: string | null | undefined): boolean {
  if (!eventLocation || !origin) return false
  return eventLocation.toUpperCase() === origin.toUpperCase()
}

function deriveStatusFromEvent(event: EventInput, context: ShipmentContext): ShipmentStatus | null {
  const code = event.eventCode.toUpperCase()
  const classifierCode = event.eventClassifierCode

  // DEPA at origin = DEPARTED
  if (code === 'DEPA') {
    if (classifierCode === 'ACT') {
      return 'DEPARTED'
    }
    if (classifierCode === 'PLN' || classifierCode === 'EST') {
      return 'BOOKED'
    }
  }

  // ARRI at destination = ARRIVED (actual) or IN_TRANSIT (planned/estimated approaching)
  if (code === 'ARRI' && isAtDestination(event.locationUnlocode, context.destinationUnlocode)) {
    if (classifierCode === 'ACT') {
      return 'ARRIVED'
    }
    return 'IN_TRANSIT'
  }

  // ARRI at non-destination with actual = IN_TRANSIT (transshipment)
  if (code === 'ARRI' && classifierCode === 'ACT') {
    return 'IN_TRANSIT'
  }

  // DISC (discharge) at destination = ARRIVED
  if (code === 'DISC' && isAtDestination(event.locationUnlocode, context.destinationUnlocode)) {
    if (classifierCode === 'ACT') {
      return 'ARRIVED'
    }
  }

  // LOAD at origin = BOOKED (loaded onto vessel)
  if (code === 'LOAD' && isAtOrigin(event.locationUnlocode, context.originUnlocode)) {
    if (classifierCode === 'ACT') {
      return 'BOOKED'
    }
  }

  // Gate out at destination = DELIVERED (GTOT = Gate Out Terminal, PICK = Pick-up)
  if ((code === 'GTOT' || code === 'PICK') && isAtDestination(event.locationUnlocode, context.destinationUnlocode)) {
    if (classifierCode === 'ACT') {
      return 'DELIVERED'
    }
  }

  // Gate in at destination = DELIVERED (empty return means cargo was delivered)
  if (code === 'GTIN' && isAtDestination(event.locationUnlocode, context.destinationUnlocode)) {
    if (classifierCode === 'ACT') {
      return 'DELIVERED'
    }
  }

  // Available for pick-up at destination = ARRIVED
  if (code === 'AVPU' && isAtDestination(event.locationUnlocode, context.destinationUnlocode)) {
    if (classifierCode === 'ACT') {
      return 'ARRIVED'
    }
  }

  // Customs released at destination = ARRIVED
  if (code === 'CUSR' && isAtDestination(event.locationUnlocode, context.destinationUnlocode)) {
    if (classifierCode === 'ACT') {
      return 'ARRIVED'
    }
  }

  // Delivery event = DELIVERED
  if (code === 'DLVR' && classifierCode === 'ACT') {
    return 'DELIVERED'
  }

  return null
}

/**
 * Checks if a shipment qualifies for PRE_ARRIVAL status based on time.
 * PRE_ARRIVAL = ETA is within threshold days AND no ATA yet.
 */
function shouldUpgradeToPreArrival(timeContext: TimeContext | undefined): boolean {
  if (!timeContext?.eta || timeContext.ata) {
    return false
  }

  const now = new Date()
  const daysUntilEta = (timeContext.eta.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)

  return daysUntilEta <= PRE_ARRIVAL_DAYS_THRESHOLD && daysUntilEta >= 0
}

/**
 * Derives the highest-priority shipment status from a set of tracking events.
 * Status only moves forward (never downgrades), based on DCSA event codes.
 *
 * @param events - Array of tracking events to evaluate
 * @param context - Location context (origin/destination UNLOCODEs)
 * @param currentStatus - Current shipment status (defaults to PENDING)
 * @param timeContext - Optional time context for PRE_ARRIVAL evaluation (ETA/ATA)
 */
export function deriveShipmentStatus(
  events: EventInput[],
  context: ShipmentContext,
  currentStatus: ShipmentStatus = 'PENDING',
  timeContext?: TimeContext,
): ShipmentStatus {
  let best = currentStatus

  for (const event of events) {
    const derived = deriveStatusFromEvent(event, context)
    if (derived && statusRank(derived) > statusRank(best)) {
      best = derived
    }
  }

  // Time-based PRE_ARRIVAL upgrade:
  // If event-derived status is IN_TRANSIT (or lower) and time conditions are met,
  // upgrade to PRE_ARRIVAL
  if (statusRank(best) <= statusRank('IN_TRANSIT') && shouldUpgradeToPreArrival(timeContext)) {
    const preArrivalRank = statusRank('PRE_ARRIVAL')
    if (preArrivalRank > statusRank(best)) {
      best = 'PRE_ARRIVAL'
    }
  }

  return best
}

/**
 * ShipsGo air top-level status → internal ShipmentStatusEnum.
 * Air has no container/vessel movement model, so status is driven by ShipsGo's
 * aggregate `status` field rather than event-location matching:
 *   NEW/UNTRACKED → PENDING, BOOKED → BOOKED, EN_ROUTE → IN_TRANSIT,
 *   LANDED → ARRIVED, DELIVERED → DELIVERED. (INPROGRESS ≈ BOOKED.)
 * Monotonic: never downgrades below the current status.
 */
const AIR_STATUS_MAP: Record<string, ShipmentStatus> = {
  NEW: 'PENDING',
  UNTRACKED: 'PENDING',
  INPROGRESS: 'BOOKED',
  BOOKED: 'BOOKED',
  EN_ROUTE: 'IN_TRANSIT',
  LANDED: 'ARRIVED',
  DELIVERED: 'DELIVERED',
}

export function deriveAirShipmentStatus(
  airStatus: string | null | undefined,
  currentStatus: ShipmentStatus = 'PENDING',
): ShipmentStatus {
  if (!airStatus) return currentStatus
  const mapped = AIR_STATUS_MAP[airStatus.toUpperCase()]
  if (!mapped) return currentStatus
  return statusRank(mapped) > statusRank(currentStatus) ? mapped : currentStatus
}

/**
 * Evaluates if a shipment should be upgraded to PRE_ARRIVAL status.
 * Used by the scheduled job to check IN_TRANSIT shipments.
 *
 * @param currentStatus - Current shipment status
 * @param timeContext - Time context with ETA and ATA
 * @returns The new status (PRE_ARRIVAL if conditions met, otherwise currentStatus)
 */
export function evaluatePreArrivalUpgrade(
  currentStatus: ShipmentStatus,
  timeContext: TimeContext,
): ShipmentStatus {
  // Only upgrade from IN_TRANSIT to PRE_ARRIVAL
  if (currentStatus !== 'IN_TRANSIT') {
    return currentStatus
  }

  if (shouldUpgradeToPreArrival(timeContext)) {
    return 'PRE_ARRIVAL'
  }

  return currentStatus
}
