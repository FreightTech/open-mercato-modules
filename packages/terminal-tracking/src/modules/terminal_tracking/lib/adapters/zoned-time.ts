/**
 * Terminal timestamp timezone handling.
 *
 * Every terminal we integrate (BCT Gdańsk via N4, GCT and BCT Gdynia) reports
 * event times as a naive wall-clock string — `2026-08-21 11:57`, with no offset.
 * Those are *terminal-local* times, not UTC. Reading them as UTC (the old
 * behaviour: append `Z`) shifted every displayed time by the zone's offset — in
 * summer Europe/Warsaw is CEST (+02:00), so a gate-out of 11:57 rendered as
 * 13:57 in the (Warsaw) UI.
 *
 * All current terminals sit in `Europe/Warsaw`; that is the default. When a
 * terminal outside Poland is onboarded, pass its IANA zone into the parsers
 * instead of relying on this constant.
 */
export const DEFAULT_TERMINAL_TIMEZONE = 'Europe/Warsaw'

/**
 * How far ahead of UTC `timeZone` is at the instant `utcMs`, in milliseconds.
 * Uses `Intl` so DST is honoured (CET/CEST for Europe/Warsaw) without any
 * external timezone library.
 */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const f: Record<string, number> = {}
  for (const p of parts) if (p.type !== 'literal') f[p.type] = Number(p.value)
  // Some engines render midnight as hour 24 rather than 0.
  const hour = f.hour === 24 ? 0 : f.hour
  const asIfUtc = Date.UTC(f.year, f.month - 1, f.day, hour, f.minute, f.second)
  return asIfUtc - utcMs
}

/**
 * Convert a naive wall-clock datetime — its components written in `timeZone`
 * with no offset — to the correct UTC instant.
 *
 * e.g. `(2026, 8, 21, 11, 57, 0, 'Europe/Warsaw')` during CEST (+02:00) yields
 * `2026-08-21T09:57:00.000Z`.
 *
 * `month` is 1-based (January = 1). Within a DST transition (the ~1h gap or
 * overlap twice a year) the result may be off by the DST delta — acceptable for
 * terminal event timestamps, which never land inside that window in practice.
 */
export function zonedNaiveToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  // First approximation: pretend the wall-clock components are already UTC,
  // then subtract the zone's offset at (approximately) that instant.
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  return new Date(asUtc - zoneOffsetMs(asUtc, timeZone))
}
