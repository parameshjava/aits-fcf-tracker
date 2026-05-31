/**
 * Curated IANA timezones offered when scheduling a meeting. IST is first and is
 * the default. The set is intentionally small (the fund's members' likely
 * zones) — extend as needed. `isValidMeetingTz` gates server-side validation so
 * we only ever store a zone we render correctly.
 */
export const MEETING_TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'America/New_York', label: 'US Eastern' },
  { value: 'America/Chicago', label: 'US Central' },
  { value: 'America/Los_Angeles', label: 'US Pacific' },
  { value: 'Europe/London', label: 'UK' },
  { value: 'Asia/Dubai', label: 'Gulf (GST)' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Australia/Sydney', label: 'Australia (Sydney)' },
] as const

export const DEFAULT_MEETING_TZ = 'Asia/Kolkata'

const VALUES: ReadonlySet<string> = new Set(MEETING_TIMEZONES.map((t) => t.value))

export function isValidMeetingTz(tz: unknown): tz is string {
  return typeof tz === 'string' && VALUES.has(tz)
}
