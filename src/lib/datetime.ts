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

/**
 * Decompose an instant into its wall-clock date ('YYYY-MM-DD') and time
 * ('HH:MM', 24-hour) in the given IANA zone. The inverse of
 * `zonedWallTimeToInstant` — used to prefill date/time form inputs from a
 * stored instant so the admin edits in the meeting's own zone.
 */
export function instantToZonedParts(iso: string, tz: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  // en-GB hour can render '24' at midnight in some ICU builds; normalise.
  const hh = (Number(get('hour')) % 24).toString().padStart(2, '0')
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hh}:${get('minute')}`,
  }
}

/**
 * True if the given wall-clock time actually exists in `tz`. Returns false for
 * times that fall in a DST spring-forward gap (e.g. 02:30 on a US "spring
 * forward" night), which `zonedWallTimeToInstant` would otherwise silently
 * resolve to the wrong side of the transition. Works by round-tripping: convert
 * to an instant, read it back in `tz`, and confirm the wall-clock is unchanged.
 */
export function wallTimeExistsInZone(dateISO: string, timeHHMM: string, tz: string): boolean {
  const instant = zonedWallTimeToInstant(dateISO, timeHHMM, tz)
  const { date, time } = instantToZonedParts(instant.toISOString(), tz)
  return date === dateISO && time === timeHHMM
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
 * Collapse the narrow / no-break spaces ICU emits (e.g. U+202F before "pm") to
 * a regular space. Node and the browser ship different ICU versions, so the
 * same instant can format with different invisible whitespace — which trips
 * React hydration. Normalising makes SSR and client output byte-identical.
 */
function normalizeSpaces(s: string): string {
  return s.replace(/[  ]/g, ' ')
}

/**
 * Format an ISO instant for display. Pass `tz` to render in a specific IANA
 * zone (e.g. the scheduling zone); omit it to render in the runtime's zone
 * (the browser's, in a client component). Locale is pinned to en-IN to match
 * the rest of the app and keep SSR output deterministic.
 */
export function formatInstant(iso: string, tz?: string): string {
  return normalizeSpaces(meetingDtf(tz).format(new Date(iso)))
}

/**
 * Format a start→end instant range, collapsing shared parts (date, meridiem)
 * the way Google/Outlook do (e.g. "31 May 2026, 7:00 – 8:00 pm IST"). Pass `tz`
 * to render in a specific zone; omit it for the runtime's zone.
 */
export function formatInstantRange(startIso: string, endIso: string, tz?: string): string {
  return normalizeSpaces(meetingDtf(tz).formatRange(new Date(startIso), new Date(endIso)))
}
