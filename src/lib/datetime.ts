/**
 * Timezone-aware datetime helpers for meetings. Uses Intl (full ICU in both
 * Node and the browser) — no external dependency. The DST/offset logic is the
 * standard two-pass algorithm: guess the instant by treating the wall-clock as
 * UTC, measure the zone's offset at that guess, correct, then re-measure once
 * to settle DST-boundary cases.
 */

function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const map: Record<string, number> = {}
  for (const p of dtf.formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') map[p.type] = Number(p.value)
  }
  // Some ICU builds emit hour '24' at midnight; normalise to 0.
  const asUTC = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour % 24,
    map.minute,
    map.second,
  )
  return asUTC - utcMs
}

/**
 * Interpret a wall-clock (`dateISO` = 'YYYY-MM-DD', `timeHHMM` = 'HH:MM') as
 * being in IANA zone `tz`, and return the absolute instant.
 */
export function zonedWallTimeToInstant(
  dateISO: string,
  timeHHMM: string,
  tz: string,
): Date {
  const [y, mo, d] = dateISO.split('-').map(Number)
  const [h, mi] = timeHHMM.split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const offset1 = tzOffsetMs(guess, tz)
  const offset2 = tzOffsetMs(guess - offset1, tz)
  return new Date(guess - offset2)
}

/** Shared formatter options for meeting date/time display. */
function meetingDtf(tz?: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
    ...(tz ? { timeZone: tz } : {}),
  })
}

/**
 * Format an ISO instant for display. Pass `tz` to render in a specific IANA
 * zone (e.g. the scheduling zone); omit it to render in the runtime's zone
 * (the browser's, in a client component). Locale is pinned to en-IN to match
 * the rest of the app and keep SSR output deterministic.
 */
export function formatInstant(iso: string, tz?: string): string {
  return meetingDtf(tz).format(new Date(iso))
}

/**
 * Format a start→end instant range, collapsing shared parts (date, meridiem)
 * the way Google/Outlook do (e.g. "31 May 2026, 7:00 – 8:00 pm IST"). Pass `tz`
 * to render in a specific zone; omit it for the runtime's zone.
 */
export function formatInstantRange(startIso: string, endIso: string, tz?: string): string {
  return meetingDtf(tz).formatRange(new Date(startIso), new Date(endIso))
}
