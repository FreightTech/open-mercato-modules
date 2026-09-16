const DEFAULT_WINDOW_DAYS = 120 // 4 months
const JITTER_RANGE_HOURS = 4

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function addHours(date: Date, hours: number): Date {
  const result = new Date(date)
  result.setTime(result.getTime() + hours * 60 * 60 * 1000)
  return result
}

function randomJitter(): number {
  return Math.random() * JITTER_RANGE_HOURS - JITTER_RANGE_HOURS / 2
}

/**
 * Generates a list of daily poll dates with random time jitter.
 *
 * - If ETD and ETA are provided, generates dates from ETD - 7 days to ETA + 14 days.
 * - If only ETD is provided, generates from ETD - 7 days for the default window.
 * - If nothing is provided, starts from now for the default window.
 * - Jitter is +/- 2 hours to spread API load.
 */
export function generatePollSchedule(input?: {
  etd?: Date | null
  eta?: Date | null
  atd?: Date | null
  ata?: Date | null
}): string[] {
  const now = new Date()

  // If already delivered (ATA present), no more polling needed
  if (input?.ata) {
    return []
  }

  let startDate: Date
  let endDate: Date

  if (input?.etd) {
    startDate = addDays(input.etd, -7)
  } else if (input?.atd) {
    startDate = input.atd
  } else {
    startDate = now
  }

  if (input?.eta) {
    endDate = addDays(input.eta, 14)
  } else {
    endDate = addDays(startDate, DEFAULT_WINDOW_DAYS)
  }

  // Ensure start is not in the past
  if (startDate < now) {
    startDate = now
  }

  const dates: string[] = []
  let current = new Date(startDate)

  while (current <= endDate) {
    const withJitter = addHours(current, randomJitter())
    // Only include future dates
    if (withJitter > now) {
      dates.push(withJitter.toISOString())
    }
    current = addDays(current, 1)
  }

  return dates
}

/**
 * Given a schedule (array of ISO date strings), returns the next poll date after now.
 */
export function getNextPollDate(schedule: string[]): Date | null {
  const now = Date.now()

  for (const dateStr of schedule) {
    const date = new Date(dateStr)
    if (date.getTime() > now) {
      return date
    }
  }

  return null
}
