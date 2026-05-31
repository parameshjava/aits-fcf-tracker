# Meeting time + timezone support — design

**Date:** 2026-05-31
**Status:** Approved, ready for implementation plan

## Problem

Meetings currently store only a date (`meetings.meeting_date date`, migration 026) and
render it as a raw `YYYY-MM-DD` string. There is no time of day, and no timezone
awareness. Members in different timezones cannot tell *when* a meeting actually starts.

We want the Google/Outlook Calendar model: an admin schedules a meeting at a specific
moment in a chosen timezone, and every viewer sees that moment converted to *their own
browser's* timezone.

## Decisions (locked)

| Decision                | Choice                                                                                                               |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------- |
| Existing date-only rows | **Replace** `meeting_date` with an absolute instant; backfill existing rows to **7:00 PM IST** on their stored date. |
| Time on new meetings    | **Required** (date + time both mandatory).                                                                           |
| Admin timezone input    | Timezone **dropdown, default `Asia/Kolkata` (IST)**.                                                                 |
| Viewer display          | Browser-local time **+ short zone label**; the **originally-scheduled time + zone shown on hover**.                  |
| Conversion location     | **Tested JS utility** using `Intl` (Option A), not a Postgres trigger.                                               |

## Schema change

Replace the single `meeting_date date` column on `public.meetings` with two columns:

- `meeting_at timestamptz NOT NULL` — the absolute instant. **Source of truth** for
  sorting, querying, and all display.
- `meeting_tz text NOT NULL` — the IANA timezone name the meeting was scheduled in
  (e.g. `Asia/Kolkata`, `America/New_York`). Used **only** to render the "original"
  time on hover. Validated against a known IANA list.

This mirrors exactly what Google/Outlook persist: an instant plus its originating zone.
We do **not** store the local wall-clock date/time separately — the "original" display
is derived by formatting `meeting_at` in `meeting_tz` via `Intl`, keeping the two-column
schema and avoiding redundant derived data.

### Migration (new file, next number after 034)

`scripts/prod/migrations/035_meetings_datetime.sql`:

1. Add `meeting_at timestamptz` and `meeting_tz text` (nullable at first).
2. Backfill: `meeting_at = (meeting_date + time '19:00') AT TIME ZONE 'Asia/Kolkata'`,
   `meeting_tz = 'Asia/Kolkata'` for every existing row.
3. Set both columns `NOT NULL`.
4. Drop the `meetings_status_date_idx` index and recreate it on
   `(status, meeting_at desc)`.
5. Drop the old `meeting_date` column.

### Downstream SQL touch points

- **View `meetings_with_progress` (029)** — replace `meeting_date` with `meeting_at`,
  `meeting_tz`; recreate the view.
- **Lock-when-closed trigger (027)** — confirm it references row columns generically;
  update if it names `meeting_date` explicitly.
- **RLS policies (028)** — no change expected (column rename only); verify none reference
  `meeting_date`.

## Conversion utility (Option A)

New module `src/lib/datetime.ts` (or extend `src/lib/format.ts`):

```ts
// Interpret a wall-clock (date + time) as being in `tz`, return the absolute instant.
export function zonedWallTimeToInstant(
  dateISO: string,   // 'YYYY-MM-DD'
  timeHHMM: string,  // 'HH:MM'
  tz: string,        // IANA, e.g. 'Asia/Kolkata'
): Date
```

Implementation: the standard two-pass `Intl` offset algorithm —
1. Build a naive UTC timestamp from the wall-clock parts via `Date.UTC(...)`.
2. Format that instant in `tz` with `Intl.DateTimeFormat` to discover the zone's offset
   at that moment (correctly handling DST).
3. Subtract the offset to get the true instant. (One refinement pass handles the rare
   DST-boundary off-by-one.)

`Intl` ships full ICU in both Node (server actions) and the browser, so no new
dependency is needed.

### Tests (`src/lib/datetime.test.ts`, Vitest — required by CI)

- IST (no DST): `2026-05-31 19:00 Asia/Kolkata` → `2026-05-31T13:30:00Z`.
- US zone in DST: `2026-07-01 09:00 America/New_York` → `2026-07-01T13:00:00Z`.
- US zone in standard time: `2026-01-01 09:00 America/New_York` → `2026-01-01T14:00:00Z`.
- UTC passthrough: `2026-05-31 12:00 UTC` → `2026-05-31T12:00:00Z`.
- Round-trip: formatting the result back in the source zone returns the input wall-clock.

## Server actions (`src/lib/actions/meetings.ts` + `meetings-validation.ts`)

- **`createMeeting` / `updateMeeting`**: read `meeting_date` (YYYY-MM-DD),
  `meeting_time` (HH:MM), and `meeting_tz` from FormData. Validate all three
  (date regex, time regex `^\d{2}:\d{2}$`, tz against the allowed IANA list). Compute
  `meeting_at = zonedWallTimeToInstant(...).toISOString()` and persist `meeting_at` +
  `meeting_tz`. Keep the `runAction` wrapper + `ActionResult` return contract.
- **Reads (`meetings-reads.ts`)**: type changes — `meeting_date: string` becomes
  `meeting_at: string` (ISO 8601) + `meeting_tz: string`. Update `ORDER BY meeting_date`
  → `ORDER BY meeting_at`.

## Admin form (`admin/meetings/new/new-meeting-form.tsx` + the edit form)

- Replace the single `<input type="date">` with: `<input type="date">` +
  `<input type="time">` + a timezone `<select>`.
- Timezone select: a curated IANA list (IST first/selected by default, plus common
  member zones — US East/Central/Pacific, UK, Gulf, Singapore/AU as needed). Default
  value `Asia/Kolkata`. Editing an existing meeting preselects its stored `meeting_tz`
  and prefills the date/time by formatting `meeting_at` in that zone.

## Viewer display

New **client** component `MeetingTime` (`src/components/meeting-time.tsx`):

- Props: `meetingAt` (ISO string), `meetingTz` (IANA string).
- Renders the local time:
  `new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZoneName: 'short' }).format(new Date(meetingAt))`
  → uses the browser's zone automatically, e.g. `31 May 2026, 7:00 PM GMT+5:30`.
- `title` / tooltip shows the original: the same instant formatted with
  `timeZone: meetingTz`, prefixed `Scheduled: …` (e.g. `Scheduled: 31 May 2026, 7:00 PM IST`).
- Must be a client component so it reads the viewer's browser zone. Guard against
  hydration mismatch: render a stable server fallback (the instant formatted in
  `meeting_tz`, matching the tooltip) and switch to browser-local after mount, OR mark
  the dynamic text `suppressHydrationWarning`. Decide in the plan; prefer the
  mount-swap so SSR output is deterministic.

Replace the raw `{m.meeting_date}` interpolations on:
- `src/app/(app)/meetings/page.tsx`
- `src/app/(app)/admin/meetings/page.tsx`
- `src/app/(app)/admin/meetings/[id]/page.tsx`

## End time (added 2026-05-31, post-initial-design)

Meetings carry a **start and an end time**, like Google/Outlook. The admin
chooses the duration by picking the end time.

- Schema: add `meeting_ends_at timestamptz NOT NULL`. It shares the meeting's
  `meeting_tz` (end is scheduled in the same zone as start). Folded into the
  same migration `035` (not yet applied to the DB).
- Both start and end are **required** on new meetings. The form prefills the end
  to start + 1 hour as a convenience; the admin can change it.
- Existing rows backfill to **start + 1 hour** (7:00–8:00 PM IST).
- Validation: end must be **strictly after** start (compared as instants).
- Display: a **range** in the viewer's browser zone, collapsing shared parts via
  `Intl.DateTimeFormat.prototype.formatRange` (e.g. `31 May 2026, 7:00 – 8:00 PM
  IST`), with the originally-scheduled range on hover.

## Out of scope

- Per-member saved timezone preferences (we use the browser zone, like Google).
- Recurring meetings.
- Calendar invites / .ics export.

## Verification

- `npm test` — datetime utility tests pass.
- `npm run build` + `npm run lint` pass.
- Manual: create a meeting at 7 PM IST; confirm a browser set to a US zone shows the
  correct converted local time and the IST original on hover.
