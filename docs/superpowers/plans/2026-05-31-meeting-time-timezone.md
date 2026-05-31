# Meeting Time + Timezone Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give meetings a precise start time scheduled in a chosen timezone, stored as an absolute instant, and shown to every viewer in their own browser's timezone (with the originally-scheduled time on hover) — the Google/Outlook Calendar model.

**Architecture:** Replace `meetings.meeting_date date` with `meeting_at timestamptz` (the absolute instant, source of truth) + `meeting_tz text` (the IANA zone it was scheduled in, for the "original" hover display). The admin enters date + time + timezone; a tested `Intl`-based JS utility (`zonedWallTimeToInstant`) converts that wall-clock to a UTC instant on the server. A client `MeetingTime` component renders the instant in the viewer's browser zone, falling back to the scheduling zone for SSR to avoid hydration mismatch.

**Tech Stack:** Next.js 16 (App Router, Cache Components), Supabase/Postgres, TypeScript strict, Vitest, Tailwind v4, `Intl.DateTimeFormat` (full ICU in Node + browser — no new dependency).

---

## File Structure

| File | Responsibility | Action |
| :-- | :-- | :-- |
| `scripts/prod/migrations/035_meetings_datetime.sql` | Schema swap, backfill, rebuild view + lock trigger + index | Create |
| `src/lib/datetime.ts` | `zonedWallTimeToInstant()` + `formatInstant()` — all timezone math/formatting | Create |
| `src/lib/datetime.test.ts` | Vitest for the two functions above | Create |
| `src/lib/timezones.ts` | Curated IANA timezone list + `isValidMeetingTz()` guard | Create |
| `src/lib/timezones.test.ts` | Vitest for the guard | Create |
| `src/components/meeting-time.tsx` | Client component: browser-local time + original-on-hover | Create |
| `src/lib/meetings-validation.ts` | Validate date + time + tz on create | Modify |
| `src/lib/meetings-validation.test.ts` | Update fixtures for new fields | Modify |
| `src/lib/actions/meetings.ts` | `createMeeting`/`updateMeeting` build `meeting_at` | Modify |
| `src/lib/actions/meetings-reads.ts` | `MeetingRow` type + order by `meeting_at` | Modify |
| `src/app/(app)/admin/meetings/new/new-meeting-form.tsx` | Add time input + tz select | Modify |
| `src/app/(app)/admin/meetings/new/page.tsx` | Pass default date/time/tz | Modify |
| `src/app/(app)/meetings/page.tsx` | Render `<MeetingTime>` | Modify |
| `src/app/(app)/admin/meetings/page.tsx` | Render `<MeetingTime>` | Modify |
| `src/app/(app)/admin/meetings/[id]/page.tsx` | Render `<MeetingTime>` | Modify |
| `src/app/(app)/meetings/[id]/page.tsx` | Render `<MeetingTime>` | Modify |

---

## Task 1: Conversion + formatting utility (`src/lib/datetime.ts`)

Pure, dependency-free timezone functions. TDD — tests first.

**Files:**
- Create: `src/lib/datetime.ts`
- Test: `src/lib/datetime.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/datetime.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { zonedWallTimeToInstant, formatInstant } from './datetime'

describe('zonedWallTimeToInstant', () => {
  it('converts an IST wall-clock to the correct UTC instant', () => {
    const d = zonedWallTimeToInstant('2026-05-31', '19:00', 'Asia/Kolkata')
    expect(d.toISOString()).toBe('2026-05-31T13:30:00.000Z')
  })

  it('handles a US zone in daylight saving time', () => {
    const d = zonedWallTimeToInstant('2026-07-01', '09:00', 'America/New_York')
    expect(d.toISOString()).toBe('2026-07-01T13:00:00.000Z')
  })

  it('handles a US zone in standard time', () => {
    const d = zonedWallTimeToInstant('2026-01-01', '09:00', 'America/New_York')
    expect(d.toISOString()).toBe('2026-01-01T14:00:00.000Z')
  })

  it('passes UTC wall-clock through unchanged', () => {
    const d = zonedWallTimeToInstant('2026-05-31', '12:00', 'UTC')
    expect(d.toISOString()).toBe('2026-05-31T12:00:00.000Z')
  })

  it('round-trips: the instant formatted back in its source zone equals the input', () => {
    const d = zonedWallTimeToInstant('2026-03-15', '14:45', 'Asia/Kolkata')
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(d)
    const get = (t: string) => parts.find((p) => p.type === t)?.value
    expect(`${get('year')}-${get('month')}-${get('day')}`).toBe('2026-03-15')
    expect(`${get('hour')}:${get('minute')}`).toBe('14:45')
  })
})

describe('formatInstant', () => {
  it('formats in an explicit zone with date, time and zone label', () => {
    const out = formatInstant('2026-05-31T13:30:00.000Z', 'Asia/Kolkata')
    // 13:30 UTC === 19:00 IST
    expect(out).toMatch(/7:00/)      // 12-hour clock shows 7:00 PM
    expect(out).toMatch(/2026/)
  })

  it('formats the same instant differently in a different zone', () => {
    const ist = formatInstant('2026-05-31T13:30:00.000Z', 'Asia/Kolkata')
    const ny = formatInstant('2026-05-31T13:30:00.000Z', 'America/New_York')
    expect(ist).not.toBe(ny)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/datetime.test.ts`
Expected: FAIL — `Failed to resolve import "./datetime"` / functions not defined.

- [ ] **Step 3: Implement the utility**

Create `src/lib/datetime.ts`:

```ts
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
 * Format an ISO instant for display. Pass `tz` to render in a specific IANA
 * zone (e.g. the scheduling zone); omit it to render in the runtime's zone
 * (the browser's, in a client component). Locale is pinned to en-IN to match
 * the rest of the app and keep SSR output deterministic.
 */
export function formatInstant(iso: string, tz?: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZoneName: 'short',
    ...(tz ? { timeZone: tz } : {}),
  }).format(new Date(iso))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/datetime.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/datetime.ts src/lib/datetime.test.ts
git commit -m "feat: add timezone-aware datetime utility for meetings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Timezone list + validator (`src/lib/timezones.ts`)

**Files:**
- Create: `src/lib/timezones.ts`
- Test: `src/lib/timezones.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/timezones.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MEETING_TIMEZONES, isValidMeetingTz } from './timezones'

describe('meeting timezones', () => {
  it('lists IST first as the default', () => {
    expect(MEETING_TIMEZONES[0].value).toBe('Asia/Kolkata')
  })

  it('accepts a known IANA zone', () => {
    expect(isValidMeetingTz('America/New_York')).toBe(true)
  })

  it('rejects an unknown or non-string value', () => {
    expect(isValidMeetingTz('Mars/Olympus')).toBe(false)
    expect(isValidMeetingTz(null)).toBe(false)
    expect(isValidMeetingTz(123)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/timezones.test.ts`
Expected: FAIL — cannot resolve `./timezones`.

- [ ] **Step 3: Implement**

Create `src/lib/timezones.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/timezones.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/timezones.ts src/lib/timezones.test.ts
git commit -m "feat: add curated meeting timezone list + validator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Database migration (`035_meetings_datetime.sql`)

Replaces `meeting_date` with `meeting_at` + `meeting_tz`, backfills existing
rows to 7:00 PM IST, and rebuilds the dependent index, view (current def is in
031), and lock trigger (current def is in 034 — references `meeting_date` in
**two** branches).

**Files:**
- Create: `scripts/prod/migrations/035_meetings_datetime.sql`

- [ ] **Step 1: Write the migration**

Create `scripts/prod/migrations/035_meetings_datetime.sql`:

```sql
-- =============================================================================
-- 035 — Meetings: replace date-only meeting_date with a precise instant.
--
-- meetings.meeting_date (date) is replaced by:
--   meeting_at  timestamptz  — the absolute instant (source of truth)
--   meeting_tz  text         — IANA zone it was scheduled in (for "original"
--                              display; the app shows each viewer their own zone)
--
-- Existing rows are backfilled to 7:00 PM IST on their stored date.
--
-- Dependent objects rebuilt here:
--   - index meetings_status_date_idx   (was on meeting_date)
--   - view  meetings_with_progress     (current def: migration 031)
--   - func  fn_meetings_lock_closed     (current def: migration 034 — referenced
--                                         meeting_date in BOTH guard branches)
-- =============================================================================

begin;

-- 1. Add the new columns (nullable while we backfill).
alter table public.meetings
  add column if not exists meeting_at timestamptz,
  add column if not exists meeting_tz text;

-- 2. Backfill existing rows: 7:00 PM IST on the stored date.
update public.meetings
set
  meeting_at = (meeting_date + time '19:00') at time zone 'Asia/Kolkata',
  meeting_tz = 'Asia/Kolkata'
where meeting_at is null;

-- 3. Enforce NOT NULL now that every row has values.
alter table public.meetings
  alter column meeting_at set not null,
  alter column meeting_tz set not null;

-- 4. Drop the view (depends on meeting_date) before dropping the column.
drop view if exists public.meetings_with_progress;

-- 5. Drop the old index, then the old column.
drop index if exists public.meetings_status_date_idx;
alter table public.meetings drop column meeting_date;

-- 6. Recreate the index on the new instant.
create index if not exists meetings_status_date_idx
  on public.meetings (status, meeting_at desc);

-- 7. Recreate the view (031's definition, with meeting_date -> meeting_at + meeting_tz).
create view public.meetings_with_progress
with (security_invoker = true)
as
select
  m.id,
  m.title,
  m.meeting_at,
  m.meeting_tz,
  m.status,
  m.linked_poll_id,
  m.action_items_md,
  m.created_by,
  m.created_at,
  m.closed_at,
  m.closed_by,
  coalesce(a.attendee_count, 0)                                            as attendee_count,
  coalesce(a.captured_count, 0)                                            as captured_count,
  m.agenda_md,
  coalesce(a.present_count,  0)                                            as present_count
from public.meetings m
left join lateral (
  select
    count(*)::int                                                          as attendee_count,
    (count(*) filter (where ma.attended))::int                             as present_count,
    (count(*) filter (where ma.notes_md is not null and ma.attended))::int as captured_count
  from public.meeting_attendees ma
  where ma.meeting_id = m.id
) a on true;

-- 8. Recreate the close-lock trigger (034's definition). Both guard branches
--    compared new.meeting_date = old.meeting_date; swap to meeting_at + meeting_tz.
create or replace function public.fn_meetings_lock_closed()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'closed' then
    -- allow a clean transition back to 'open'
    if new.status = 'open'
       and new.closed_at is null
       and new.closed_by is null
       and new.title = old.title
       and new.meeting_at = old.meeting_at
       and new.meeting_tz = old.meeting_tz
       and new.linked_poll_id is not distinct from old.linked_poll_id
    then
      return new;
    end if;

    -- allow editing the action-items list while the meeting stays closed;
    -- every other column must be unchanged
    if new.status = 'closed'
       and new.id            =  old.id
       and new.title         =  old.title
       and new.meeting_at    =  old.meeting_at
       and new.meeting_tz    =  old.meeting_tz
       and new.random_seed   =  old.random_seed
       and new.linked_poll_id is not distinct from old.linked_poll_id
       and new.agenda_md      is not distinct from old.agenda_md
       and new.created_by    =  old.created_by
       and new.created_at    =  old.created_at
       and new.closed_at      is not distinct from old.closed_at
       and new.closed_by      is not distinct from old.closed_by
    then
      return new;
    end if;

    raise exception 'meeting is closed; reopen it before editing';
  end if;
  return new;
end
$$;

commit;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Self-review the SQL**

Re-read the file and confirm:
- The view is `DROP` + `CREATE` (not `CREATE OR REPLACE`) — required because we removed `meeting_date` and added two columns, which `CREATE OR REPLACE VIEW` cannot do.
- The lock trigger has **no** remaining `meeting_date` reference (run `grep -n meeting_date scripts/prod/migrations/035_meetings_datetime.sql` → expect **zero** matches).
- Column drop happens *after* the view is dropped.

Run: `grep -n "meeting_date" scripts/prod/migrations/035_meetings_datetime.sql`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add scripts/prod/migrations/035_meetings_datetime.sql
git commit -m "feat(db): replace meeting_date with meeting_at + meeting_tz

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Note for executor:** This migration runs against Supabase out-of-band (the
> repo applies SQL migrations manually — see AGENTS.md). Do **not** attempt to
> run it from CI. Apply it to the staging project (docs/staging-setup.md) and
> verify `select meeting_at, meeting_tz from public.meetings limit 5;` before
> production. The code tasks below assume the column exists.

---

## Task 4: Validation (`src/lib/meetings-validation.ts`)

**Files:**
- Modify: `src/lib/meetings-validation.ts`
- Test: `src/lib/meetings-validation.test.ts`

- [ ] **Step 1: Update the test fixtures to require the new fields (failing first)**

In `src/lib/meetings-validation.test.ts`, every object passed to
`validateMeetingCreate` currently has `meeting_date: '2026-05-27'` (and the
invalid-date case has `meeting_date: 'nope'`). For each **valid** fixture, add
the two new fields right after `meeting_date`:

```ts
      meeting_date: '2026-05-27',
      meeting_time: '19:00',
      meeting_tz: 'Asia/Kolkata',
```

Then add two new test cases inside the existing `describe` block:

```ts
  it('rejects a malformed time', () => {
    const r = validateMeetingCreate({
      title: 'Quarterly review',
      meeting_date: '2026-05-27',
      meeting_time: '7pm',
      meeting_tz: 'Asia/Kolkata',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('meeting_time')
  })

  it('rejects an unknown timezone', () => {
    const r = validateMeetingCreate({
      title: 'Quarterly review',
      meeting_date: '2026-05-27',
      meeting_time: '19:00',
      meeting_tz: 'Mars/Olympus',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('meeting_tz')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/meetings-validation.test.ts`
Expected: FAIL — new fields not on `MeetingCreateInput` / no time+tz validation yet.

- [ ] **Step 3: Update the validator**

In `src/lib/meetings-validation.ts`:

Add the import at the top (after the existing type declarations, before `UUID_RE`):

```ts
import { isValidMeetingTz } from '@/lib/timezones'
```

Replace the `MeetingCreateInput` type:

```ts
export type MeetingCreateInput = {
  title: string
  meeting_date: string
  meeting_time: string
  meeting_tz: string
  linked_poll_id: string | null
  agenda_md: string | null
}
```

In `validateMeetingCreate`, after the existing `meeting_date` block (the one
returning `'Pick a valid date'`), insert time + tz validation:

```ts
  const meeting_time = String(r.meeting_time ?? '').trim()
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(meeting_time)) {
    return { ok: false, error: 'Pick a valid time', field: 'meeting_time' }
  }

  const meeting_tz = String(r.meeting_tz ?? '').trim()
  if (!isValidMeetingTz(meeting_tz)) {
    return { ok: false, error: 'Pick a valid timezone', field: 'meeting_tz' }
  }
```

Update the success return to include the new fields:

```ts
  return { ok: true, value: { title, meeting_date, meeting_time, meeting_tz, linked_poll_id, agenda_md } }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/meetings-validation.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meetings-validation.ts src/lib/meetings-validation.test.ts
git commit -m "feat: validate meeting time + timezone

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Server actions (`src/lib/actions/meetings.ts`)

**Files:**
- Modify: `src/lib/actions/meetings.ts` (`createMeeting` lines 43–102, `updateMeeting` lines 104–141)

- [ ] **Step 1: Add the import**

At the top of `src/lib/actions/meetings.ts`, after the `seededShuffle` import (line 19), add:

```ts
import { zonedWallTimeToInstant } from '@/lib/datetime'
```

- [ ] **Step 2: Update `createMeeting` to read time/tz and build the instant**

Replace the `validateMeetingCreate({...})` call (lines 52–57) so it forwards the new fields:

```ts
    const v = validateMeetingCreate({
      title: formData.get('title'),
      meeting_date: formData.get('meeting_date'),
      meeting_time: formData.get('meeting_time'),
      meeting_tz: formData.get('meeting_tz'),
      linked_poll_id: formData.get('linked_poll_id'),
      agenda_md: formData.get('agenda_md'),
    })
    if (!v.ok) return actionError(v.error, v.field)

    const meetingAt = zonedWallTimeToInstant(
      v.value.meeting_date,
      v.value.meeting_time,
      v.value.meeting_tz,
    ).toISOString()
```

Then in the `.insert({...})` object (lines 75–82) replace the `meeting_date` line:

```ts
      .insert({
        title: v.value.title,
        meeting_at: meetingAt,
        meeting_tz: v.value.meeting_tz,
        random_seed,
        linked_poll_id: v.value.linked_poll_id,
        agenda_md: v.value.agenda_md,
        created_by: memberId,
      })
```

- [ ] **Step 3: Update `updateMeeting` to handle date+time+tz together**

Replace the `meeting_date` patch block (lines 121–126) with:

```ts
    const meeting_date = formData.get('meeting_date')
    if (typeof meeting_date === 'string' && meeting_date.trim()) {
      const d = meeting_date.trim()
      const t = String(formData.get('meeting_time') ?? '').trim()
      const tz = String(formData.get('meeting_tz') ?? '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return actionError('Pick a valid date', 'meeting_date')
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return actionError('Pick a valid time', 'meeting_time')
      if (!isValidMeetingTz(tz)) return actionError('Pick a valid timezone', 'meeting_tz')
      patch.meeting_at = zonedWallTimeToInstant(d, t, tz).toISOString()
      patch.meeting_tz = tz
    }
```

And add `isValidMeetingTz` to the imports (the `@/lib/meetings-validation` import block lines 13–18 doesn't export it — import from timezones):

```ts
import { isValidMeetingTz } from '@/lib/timezones'
```

- [ ] **Step 4: Verify it type-checks and tests still pass**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/meetings.ts
git commit -m "feat: persist meeting_at + meeting_tz in create/update actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Reads (`src/lib/actions/meetings-reads.ts`)

**Files:**
- Modify: `src/lib/actions/meetings-reads.ts` (`MeetingRow` lines 20–35, `getMeetings` order lines 46–47)

- [ ] **Step 1: Update the `MeetingRow` type**

Replace `meeting_date: string` (line 23) with:

```ts
  meeting_at: string
  meeting_tz: string
```

- [ ] **Step 2: Update the ordering in `getMeetings`**

Replace `.order('meeting_date', { ascending: false })` (line 46) with:

```ts
    .order('meeting_at', { ascending: false })
```

(Leave the secondary `.order('created_at', …)` untouched.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: FAIL — the four page components still read `meeting_date`. That's
expected; Tasks 7–9 fix them. Confirm the *only* errors are in those page files.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/meetings-reads.ts
git commit -m "feat: expose meeting_at + meeting_tz from meeting reads

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Viewer display component (`src/components/meeting-time.tsx`)

A client component so it can read the viewer's browser timezone. To avoid a
hydration mismatch, the first (server + initial client) render uses the
meeting's own zone — deterministic across server and client — then swaps to the
browser zone after mount.

**Files:**
- Create: `src/components/meeting-time.tsx`

- [ ] **Step 1: Implement the component**

Create `src/components/meeting-time.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { formatInstant } from '@/lib/datetime'

type Props = {
  meetingAt: string
  meetingTz: string
}

/**
 * Renders a meeting's start time in the viewer's browser timezone, with the
 * originally-scheduled time + zone available on hover.
 *
 * Hydration: server and the first client render both format in `meetingTz`
 * (deterministic), so the markup matches. After mount we flip to the browser's
 * zone — the only differing factor, and it only changes post-hydration.
 */
export function MeetingTime({ meetingAt, meetingTz }: Props) {
  const [local, setLocal] = useState(false)
  useEffect(() => setLocal(true), [])

  const scheduled = formatInstant(meetingAt, meetingTz)
  const display = local ? formatInstant(meetingAt) : scheduled

  return (
    <time dateTime={meetingAt} title={`Scheduled: ${scheduled}`}>
      {display}
    </time>
  )
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: still only the page-file `meeting_date` errors from Task 6 (this file
adds none).

- [ ] **Step 3: Commit**

```bash
git add src/components/meeting-time.tsx
git commit -m "feat: MeetingTime component — browser-local time, original on hover

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Render `<MeetingTime>` in the four display pages

**Files:**
- Modify: `src/app/(app)/meetings/page.tsx:30`
- Modify: `src/app/(app)/admin/meetings/page.tsx:40`
- Modify: `src/app/(app)/admin/meetings/[id]/page.tsx:27`
- Modify: `src/app/(app)/meetings/[id]/page.tsx:53`

- [ ] **Step 1: Public list — `src/app/(app)/meetings/page.tsx`**

Add the import after the existing imports:

```tsx
import { MeetingTime } from '@/components/meeting-time'
```

Replace `{m.meeting_date} · {m.captured_count} / {m.attendee_count} captured` (line 30) with:

```tsx
<MeetingTime meetingAt={m.meeting_at} meetingTz={m.meeting_tz} /> · {m.captured_count} / {m.attendee_count} captured
```

- [ ] **Step 2: Admin list — `src/app/(app)/admin/meetings/page.tsx`**

Add the import:

```tsx
import { MeetingTime } from '@/components/meeting-time'
```

Replace `<td className="px-4 py-2 whitespace-nowrap">{m.meeting_date}</td>` (line 40) with:

```tsx
<td className="px-4 py-2 whitespace-nowrap"><MeetingTime meetingAt={m.meeting_at} meetingTz={m.meeting_tz} /></td>
```

- [ ] **Step 3: Admin detail — `src/app/(app)/admin/meetings/[id]/page.tsx`**

Add the import:

```tsx
import { MeetingTime } from '@/components/meeting-time'
```

Replace `{meeting.meeting_date} · {meeting.attendee_count} attendees` (line 27) with:

```tsx
<MeetingTime meetingAt={meeting.meeting_at} meetingTz={meeting.meeting_tz} /> · {meeting.attendee_count} attendees
```

- [ ] **Step 4: Public detail — `src/app/(app)/meetings/[id]/page.tsx`**

Add the import (after the `MarkdownView` import, line 7):

```tsx
import { MeetingTime } from '@/components/meeting-time'
```

Replace `{meeting.meeting_date}` (line 53) with:

```tsx
<MeetingTime meetingAt={meeting.meeting_at} meetingTz={meeting.meeting_tz} />
```

- [ ] **Step 5: Verify the `meeting_date` references are gone from pages**

Run: `grep -rn "meeting_date" src/app`
Expected: only `src/app/(app)/admin/meetings/new/new-meeting-form.tsx` (the
input `id`/`name`/`errFor` — fixed in Task 9). No `m.meeting_date` /
`meeting.meeting_date` reads remain.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/meetings/page.tsx" "src/app/(app)/admin/meetings/page.tsx" "src/app/(app)/admin/meetings/[id]/page.tsx" "src/app/(app)/meetings/[id]/page.tsx"
git commit -m "feat: render meeting time in viewer's timezone across meeting pages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Admin form — time input + timezone select

**Files:**
- Modify: `src/app/(app)/admin/meetings/new/new-meeting-form.tsx` (Props + date field block lines 51–60)
- Modify: `src/app/(app)/admin/meetings/new/page.tsx` (defaults)

- [ ] **Step 1: Update `page.tsx` to pass default time + tz**

In `src/app/(app)/admin/meetings/new/page.tsx`, add the import:

```tsx
import { todayISO } from '@/lib/format'
import { DEFAULT_MEETING_TZ } from '@/lib/timezones'
```

Replace `const today = new Date().toISOString().slice(0, 10)` (line 11) with:

```tsx
  const today = todayISO()
```

Replace the `<NewMeetingForm … />` line (line 16) with:

```tsx
      <NewMeetingForm polls={polls} defaultDate={today} defaultTime="19:00" defaultTz={DEFAULT_MEETING_TZ} />
```

- [ ] **Step 2: Update the form Props and inputs**

In `src/app/(app)/admin/meetings/new/new-meeting-form.tsx`:

Add the timezone import after the `MarkdownEditor` import (line 7):

```tsx
import { MEETING_TIMEZONES } from '@/lib/timezones'
```

Replace the `Props` type (lines 11–14) with:

```tsx
type Props = {
  polls: PollOption[]
  defaultDate: string
  defaultTime: string
  defaultTz: string
}
```

Update the component signature (line 16):

```tsx
export function NewMeetingForm({ polls, defaultDate, defaultTime, defaultTz }: Props) {
```

Replace the meeting-date `<div>` block (lines 52–60 — the one wrapping the
`meeting_date` label + input) with a date + time pair plus a full-width tz row.
Replace the entire `<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">`
opening through the meeting-date closing `</div>` (lines 51–60) with:

```tsx
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="meeting_date" className="mb-1 block text-xs font-semibold text-gray-700">Meeting date</label>
          <input
            id="meeting_date" name="meeting_date" type="date" required
            defaultValue={defaultDate}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          {errFor('meeting_date') && <p className="mt-1 text-xs text-red-600">{errFor('meeting_date')}</p>}
        </div>

        <div>
          <label htmlFor="meeting_time" className="mb-1 block text-xs font-semibold text-gray-700">Start time</label>
          <input
            id="meeting_time" name="meeting_time" type="time" required
            defaultValue={defaultTime}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          {errFor('meeting_time') && <p className="mt-1 text-xs text-red-600">{errFor('meeting_time')}</p>}
        </div>

        <div>
          <label htmlFor="meeting_tz" className="mb-1 block text-xs font-semibold text-gray-700">Timezone</label>
          <select
            id="meeting_tz" name="meeting_tz" required defaultValue={defaultTz}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {MEETING_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
          {errFor('meeting_tz') && <p className="mt-1 text-xs text-red-600">{errFor('meeting_tz')}</p>}
        </div>
```

> Note: this leaves the `linked_poll_id` `<div>` (originally the second grid
> cell) in place after the timezone cell — the grid now holds four cells across
> two rows, which is the intended layout. Do not delete the linked-poll block.

- [ ] **Step 3: Verify type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS, no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/meetings/new/new-meeting-form.tsx" "src/app/(app)/admin/meetings/new/page.tsx"
git commit -m "feat: meeting create form gains time input + timezone select

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites including `datetime`, `timezones`, `meetings-validation`.

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS, zero errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds (CLAUDE.md: must pass before any PR).

- [ ] **Step 4: Confirm no stale `meeting_date` references remain in app code**

Run: `grep -rn "meeting_date" src/`
Expected: **no output** (the form now uses `meeting_date` only as an input
name, which is fine — but there should be no `.meeting_date` property *reads*).
If the only matches are the form input `id="meeting_date"`/`name="meeting_date"`
and its `errFor('meeting_date')`, that is correct and expected.

- [ ] **Step 5: Manual smoke test (after migration 035 applied to staging)**

1. `npm run dev`, sign in as admin, go to `/admin/meetings/new`.
2. Create a meeting: date today, time `19:00`, timezone `India (IST)`.
3. On `/meetings` and the detail page, confirm it shows `7:00 PM` with a zone label.
4. In browser devtools, override the timezone (Sensors → Location → set to
   `America/New_York`), reload: the same meeting should now read `9:30 AM` (EDT)
   — and hovering shows `Scheduled: … 7:00 PM` in IST.

---

## Self-Review (completed during planning)

- **Spec coverage:** Schema swap (Task 3), 7 PM IST backfill (Task 3 step 1),
  required time (Task 4 validation), IST-default tz dropdown (Tasks 2 + 9),
  browser-local + original-on-hover (Task 7), tested `Intl` conversion (Task 1).
  All spec sections map to a task. ✓
- **Spec correction:** spec listed 3 display pages; there are **4** (added
  public detail `meetings/[id]/page.tsx`). View/trigger current definitions live
  in 031/034, not 029/027 — migration rebuilds from the latest. The lock trigger
  references `meeting_date` in **two** branches; both are swapped. ✓
- **Type consistency:** `MeetingRow.meeting_at`/`meeting_tz`, `MeetingTime` props
  `meetingAt`/`meetingTz`, validator `MeetingCreateInput` fields, and the action
  insert keys all use the same names. `zonedWallTimeToInstant(date, time, tz)`
  signature is identical across Tasks 1, 4, 5. ✓
- **Placeholders:** none — every code step has full content. ✓
- **`updateMeeting`** has no UI form today but is kept consistent (Task 5 step 3)
  so it won't break if wired up later. Noted, intentional. ✓
