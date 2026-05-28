# Meetings — Agenda + Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a free-form markdown agenda and explicit present/absent tracking to the existing meetings feature; surface roll-call + meeting metadata in the read view.

**Spec:** [`docs/superpowers/specs/2026-05-28-meetings-agenda-and-attendance-design.md`](../specs/2026-05-28-meetings-agenda-and-attendance-design.md)

**Architecture:** One additive DB migration (new column on `meetings`, new column on `meeting_attendees`, replace the `meetings_with_progress` view). Two new server actions (`updateAgenda`, `setAttendance`) using the existing `runAction` + `ActionResult<T>` pattern. UI changes touch four files; reuse the existing `MarkdownEditor` / `MarkdownView` / `ActionItemsPanel` patterns — no new components.

**Tech Stack:** Next.js 16 App Router (cacheComponents), React 19, Supabase Postgres (RLS + triggers), TypeScript strict, Tailwind v4, Vitest.

---

## File map

**Create:**
- `scripts/prod/migrations/030_meetings_agenda_and_attendance.sql` — adds `meetings.agenda_md`, `meeting_attendees.attended`, replaces `meetings_with_progress` view.

**Modify:**
- `src/lib/meetings-validation.ts` — add `agenda_md` to `MeetingCreateInput`; add `validateAgenda`, `validateAttendedFlag`.
- `src/lib/meetings-validation.test.ts` — add cases for new validators.
- `src/lib/actions/meetings.ts` — extend `createMeeting`; add `updateAgenda`, `setAttendance`.
- `src/lib/actions/meetings-reads.ts` — extend `MeetingRow` / `MeetingAttendee` / `MeetingDetail`; modify `getMeeting`, `getMeetings`.
- `src/app/(app)/admin/meetings/new/new-meeting-form.tsx` — agenda editor block.
- `src/app/(app)/admin/meetings/[id]/capture-page.tsx` — agenda panel + per-row Present toggle.
- `src/app/(app)/meetings/[id]/page.tsx` — restructure into five cards.
- `src/app/(app)/meetings/[id]/consolidated-view.tsx` — minor empty-state guard.

---

## Task 1: Schema migration

**Files:**
- Create: `scripts/prod/migrations/030_meetings_agenda_and_attendance.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- 030 — Meetings: agenda + attendance.
--
--   meetings.agenda_md          — free-form markdown, locked-on-close by 027.
--   meeting_attendees.attended  — present/absent flag, defaults true.
--   meetings_with_progress      — replaced to expose present_count and to
--                                 narrow captured_count to present-with-notes.
-- =============================================================================

begin;

alter table public.meetings
  add column if not exists agenda_md text
    check (agenda_md is null or char_length(agenda_md) <= 10000);

alter table public.meeting_attendees
  add column if not exists attended boolean not null default true;

create index if not exists meeting_attendees_attended_idx
  on public.meeting_attendees (meeting_id, attended);

create or replace view public.meetings_with_progress
with (security_invoker = true)
as
select
  m.id,
  m.title,
  m.meeting_date,
  m.status,
  m.linked_poll_id,
  m.agenda_md,
  m.action_items_md,
  m.created_by,
  m.created_at,
  m.closed_at,
  m.closed_by,
  coalesce(a.attendee_count, 0)                                            as attendee_count,
  coalesce(a.present_count,  0)                                            as present_count,
  coalesce(a.captured_count, 0)                                            as captured_count
from public.meetings m
left join lateral (
  select
    count(*)::int                                                          as attendee_count,
    (count(*) filter (where ma.attended))::int                             as present_count,
    (count(*) filter (where ma.notes_md is not null and ma.attended))::int as captured_count
  from public.meeting_attendees ma
  where ma.meeting_id = m.id
) a on true;

commit;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply migration locally**

Run via the project's standard migration mechanism (`supabase db push` or the equivalent helper script in this repo).

Verify in `psql`:
```sql
\d+ public.meetings           -- agenda_md column present, check constraint
\d+ public.meeting_attendees  -- attended boolean not null default true
\d+ public.meetings_with_progress  -- present_count column listed
```

- [ ] **Step 3: Commit**

```bash
git add scripts/prod/migrations/030_meetings_agenda_and_attendance.sql
git commit -m "feat(meetings): migration 030 — agenda_md, attended, present_count"
```

---

## Task 2: Validation helpers (TDD)

**Files:**
- Modify: `src/lib/meetings-validation.ts`
- Test: `src/lib/meetings-validation.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/lib/meetings-validation.test.ts`:

```ts
import {
  validateMeetingCreate,
  validateNotes,
  validateAgenda,
  validateAttendedFlag,
} from './meetings-validation'

describe('validateMeetingCreate with agenda', () => {
  it('accepts an empty/null agenda', () => {
    const r = validateMeetingCreate({
      title: 'OK title',
      meeting_date: '2026-05-27',
      attendee_ids: ['11111111-1111-1111-1111-111111111111'],
      linked_poll_id: null,
      agenda_md: null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.agenda_md).toBeNull()
  })

  it('passes a normal markdown agenda', () => {
    const r = validateMeetingCreate({
      title: 'OK title',
      meeting_date: '2026-05-27',
      attendee_ids: ['11111111-1111-1111-1111-111111111111'],
      linked_poll_id: null,
      agenda_md: '# Topics\n1. Item one',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.agenda_md).toBe('# Topics\n1. Item one')
  })

  it('rejects agenda longer than 10000 chars', () => {
    const r = validateMeetingCreate({
      title: 'OK title',
      meeting_date: '2026-05-27',
      attendee_ids: ['11111111-1111-1111-1111-111111111111'],
      linked_poll_id: null,
      agenda_md: 'a'.repeat(10_001),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('agenda_md')
  })
})

describe('validateAgenda', () => {
  it('coerces empty / whitespace to null', () => {
    const r = validateAgenda('   ')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBeNull()
  })

  it('passes a normal markdown string', () => {
    const r = validateAgenda('## Agenda\n- topic one')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('## Agenda\n- topic one')
  })

  it('rejects strings longer than 10000 chars', () => {
    const r = validateAgenda('x'.repeat(10_001))
    expect(r.ok).toBe(false)
  })
})

describe('validateAttendedFlag', () => {
  it('parses the literal string "true"', () => {
    const r = validateAttendedFlag('true')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(true)
  })

  it('parses the literal string "false"', () => {
    const r = validateAttendedFlag('false')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(false)
  })

  it('rejects any other value', () => {
    expect(validateAttendedFlag('yes').ok).toBe(false)
    expect(validateAttendedFlag(undefined).ok).toBe(false)
    expect(validateAttendedFlag(1).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- meetings-validation`
Expected: failing — `validateAgenda` and `validateAttendedFlag` don't exist; `validateMeetingCreate` doesn't accept `agenda_md`.

- [ ] **Step 3: Implement validators in `src/lib/meetings-validation.ts`**

Update `MeetingCreateInput`:

```ts
export type MeetingCreateInput = {
  title: string
  meeting_date: string
  attendee_ids: string[]
  linked_poll_id: string | null
  agenda_md: string | null
}
```

At the bottom of `validateMeetingCreate`, before the success return, add agenda parsing:

```ts
  const agendaRaw = r.agenda_md
  let agenda_md: string | null = null
  if (agendaRaw != null) {
    const a = String(agendaRaw)
    if (a.length > 10_000) {
      return { ok: false, error: 'Agenda is too long (max 10000 chars)', field: 'agenda_md' }
    }
    agenda_md = a.trim().length === 0 ? null : a
  }

  return { ok: true, value: { title, meeting_date, attendee_ids, linked_poll_id, agenda_md } }
```

Append two new validators after `validateNotes`:

```ts
export function validateAgenda(raw: unknown): Validated<string | null> {
  const s = raw == null ? '' : String(raw)
  if (s.length > 10_000) {
    return { ok: false, error: 'Agenda is too long (max 10000 chars)' }
  }
  return { ok: true, value: s.trim().length === 0 ? null : s }
}

export function validateAttendedFlag(raw: unknown): Validated<boolean> {
  if (raw === 'true')  return { ok: true, value: true }
  if (raw === 'false') return { ok: true, value: false }
  return { ok: false, error: 'attended must be the string "true" or "false"' }
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test -- meetings-validation`
Expected: PASS (all existing + new cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/meetings-validation.ts src/lib/meetings-validation.test.ts
git commit -m "feat(meetings): validators for agenda_md and attended flag"
```

---

## Task 3: Extend `createMeeting`

**Files:**
- Modify: `src/lib/actions/meetings.ts`

- [ ] **Step 1: Update `createMeeting` to pass `agenda_md` through validation + insert**

Inside `createMeeting`, replace the `validateMeetingCreate({...})` call so it also passes the agenda field, and insert the validated value:

```ts
    const v = validateMeetingCreate({
      title: formData.get('title'),
      meeting_date: formData.get('meeting_date'),
      attendee_ids: formData.getAll('attendee_ids'),
      linked_poll_id: formData.get('linked_poll_id'),
      agenda_md: formData.get('agenda_md'),
    })
    if (!v.ok) return actionError(v.error, v.field)
```

In the existing `.from('meetings').insert({...})` call, add `agenda_md: v.value.agenda_md` to the object (keep the rest of the call intact).

- [ ] **Step 2: Verify build still type-checks**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/meetings.ts
git commit -m "feat(meetings): createMeeting persists agenda_md"
```

---

## Task 4: Add `updateAgenda` server action

**Files:**
- Modify: `src/lib/actions/meetings.ts`

- [ ] **Step 1: Import `validateAgenda`**

In the existing import block from `@/lib/meetings-validation`, add `validateAgenda`:

```ts
import {
  validateMeetingCreate,
  validateNotes,
  validateAgenda,
} from '@/lib/meetings-validation'
```

- [ ] **Step 2: Append `updateAgenda` action**

Append this function at the bottom of `src/lib/actions/meetings.ts`:

```ts
export async function updateAgenda(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('updateAgenda', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const id = String(formData.get('id') ?? '').trim()
    if (!id) return actionError('Missing meeting id')

    const v = validateAgenda(formData.get('agenda_md'))
    if (!v.ok) return actionError(v.error, 'agenda_md')

    const supabase = await createClient()
    const { error } = await supabase
      .from('meetings')
      .update({ agenda_md: v.value })
      .eq('id', id)
    if (error) return actionError(error.message)

    invalidate(id)
    return actionOk({ meetingId: id }, 'Agenda saved')
  })
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/meetings.ts
git commit -m "feat(meetings): updateAgenda server action (admin-only)"
```

---

## Task 5: Add `setAttendance` server action

**Files:**
- Modify: `src/lib/actions/meetings.ts`

- [ ] **Step 1: Import `validateAttendedFlag`**

Extend the validation import:

```ts
import {
  validateMeetingCreate,
  validateNotes,
  validateAgenda,
  validateAttendedFlag,
} from '@/lib/meetings-validation'
```

- [ ] **Step 2: Append `setAttendance` action**

Append at the bottom of `src/lib/actions/meetings.ts`:

```ts
export async function setAttendance(
  formData: FormData,
): Promise<ActionResult<{ memberId: string; attended: boolean }>> {
  return runAction('setAttendance', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const meetingId = String(formData.get('meeting_id') ?? '').trim()
    const memberId  = String(formData.get('member_id')  ?? '').trim()
    if (!meetingId || !memberId) return actionError('Missing ids')

    const v = validateAttendedFlag(formData.get('attended'))
    if (!v.ok) return actionError(v.error, 'attended')

    const supabase = await createClient()
    const { error } = await supabase
      .from('meeting_attendees')
      .update({ attended: v.value })
      .eq('meeting_id', meetingId)
      .eq('member_id', memberId)
    if (error) return actionError(error.message)

    invalidate(meetingId)
    return actionOk(
      { memberId, attended: v.value },
      v.value ? 'Marked present' : 'Marked absent',
    )
  })
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/meetings.ts
git commit -m "feat(meetings): setAttendance server action (admin-only)"
```

---

## Task 6: Extend read accessors

**Files:**
- Modify: `src/lib/actions/meetings-reads.ts`

- [ ] **Step 1: Extend type exports**

Update the three exported types:

```ts
export type MeetingRow = {
  id: string
  title: string
  meeting_date: string
  status: 'open' | 'closed'
  linked_poll_id: string | null
  agenda_md: string | null              // NEW
  action_items_md: string | null
  created_by: string
  created_at: string
  closed_at: string | null
  closed_by: string | null
  attendee_count: number
  present_count: number                 // NEW
  captured_count: number
}

export type MeetingAttendee = {
  meeting_id: string
  member_id: string
  position: number
  attended: boolean                     // NEW
  notes_md: string | null
  notes_updated_at: string | null
  notes_updated_by: string | null
  member_name: string
  member_slug: string
}

export type MeetingDetail = MeetingRow & {
  attendees: MeetingAttendee[]
  linked_poll: { id: string; question: string; status: 'open' | 'closed' } | null
  created_by_member: { id: string; name: string } | null   // NEW
  closed_by_member:  { id: string; name: string } | null   // NEW
}
```

- [ ] **Step 2: Update `getMeetings` select to include new columns**

The current `getMeetings` uses `select('*')` from `meetings_with_progress`. The view now exposes `agenda_md` and `present_count`, so `*` already picks them up — no select-string change. Just verify the cast at the bottom (`as MeetingRow[]`) stays correct after the type extension. No code change needed beyond the type updates from Step 1.

- [ ] **Step 3: Update `getMeeting` to fetch attendees with `attended` and resolve creator/closer names**

In the existing attendees select, add `attended`:

```ts
const { data: attendees, error: aErr } = await supabase
  .from('meeting_attendees')
  .select('meeting_id, member_id, position, attended, notes_md, notes_updated_at, notes_updated_by, members:member_id (name, slug)')
  .eq('meeting_id', id)
  .order('position', { ascending: true })
```

After the existing `linked_poll` lookup block, add a batched member-name lookup for `created_by` and `closed_by`:

```ts
const memberIds = [meeting.created_by, meeting.closed_by].filter(
  (x): x is string => typeof x === 'string',
)
let nameById: Record<string, string> = {}
if (memberIds.length > 0) {
  const { data: members } = await supabase
    .from('members')
    .select('id, name')
    .in('id', memberIds)
  nameById = Object.fromEntries((members ?? []).map((m) => [m.id as string, m.name as string]))
}

const created_by_member = meeting.created_by
  ? { id: meeting.created_by, name: nameById[meeting.created_by] ?? '—' }
  : null
const closed_by_member = meeting.closed_by
  ? { id: meeting.closed_by, name: nameById[meeting.closed_by] ?? '—' }
  : null
```

In the final return object, include `created_by_member` and `closed_by_member`. Also include `attended` in the per-attendee mapping (the row already has it after Step 3's select extension; just make sure the existing `attendees:` array carries it through):

```ts
return {
  ...meeting,
  linked_poll,
  created_by_member,
  closed_by_member,
  attendees: (attendees ?? []).map((row) => ({
    meeting_id: row.meeting_id as string,
    member_id:  row.member_id  as string,
    position:   row.position   as number,
    attended:   row.attended   as boolean,
    notes_md:   row.notes_md   as string | null,
    notes_updated_at: row.notes_updated_at as string | null,
    notes_updated_by: row.notes_updated_by as string | null,
    // members is an array (PostgREST 1-to-many shape) — pick first or fall back
    member_name: (row.members as { name: string }[] | { name: string } | null)?.[0]?.name
              ?? (row.members as { name: string } | null)?.name
              ?? '—',
    member_slug: (row.members as { slug: string }[] | { slug: string } | null)?.[0]?.slug
              ?? (row.members as { slug: string } | null)?.slug
              ?? '',
  })) as MeetingAttendee[],
} as MeetingDetail
```

(Use the exact same array/object-shape coercion the file already uses for the members join — keep it consistent. If the existing code does `row.members?.[0]?.name`, match that style verbatim.)

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/meetings-reads.ts
git commit -m "feat(meetings): read accessors expose agenda_md, attended, creator/closer names"
```

---

## Task 7: New-meeting form — agenda editor

**Files:**
- Modify: `src/app/(app)/admin/meetings/new/new-meeting-form.tsx`

- [ ] **Step 1: Add agenda state + hidden input + editor**

`MarkdownEditor` is fully controlled (no `name` prop) — we mirror its value into a hidden `<input>` so the native form submission picks it up.

At the top of `NewMeetingForm`, import the editor and add state:

```tsx
import { useActionState, useEffect, useState } from 'react'
import { MarkdownEditor } from '@/components/markdown-editor'
```

Inside the component:

```tsx
const [agendaMd, setAgendaMd] = useState('')
```

Between the linked-poll grid row and `<AttendeePicker>`, insert the agenda block:

```tsx
<div>
  <label className="mb-1 block text-xs font-semibold text-gray-700">
    Agenda{' '}
    <span className="font-normal text-gray-400">
      (markdown — sets what the meeting will cover)
    </span>
  </label>
  <MarkdownEditor
    value={agendaMd}
    onChange={setAgendaMd}
    mode="split"
    minHeight={200}
  />
  <input type="hidden" name="agenda_md" value={agendaMd} />
  {errFor('agenda_md') && (
    <p className="mt-1 text-xs text-red-600">{errFor('agenda_md')}</p>
  )}
</div>
```

- [ ] **Step 2: Manual verification**

Run dev server, navigate to `/admin/meetings/new`. Confirm:
- Agenda editor renders between linked-poll and attendee picker.
- Toggling write/split/read works.
- Submitting with a non-empty agenda creates the meeting and the agenda persists (check via psql or by reloading the detail page once Task 9 lands; until then, query `select agenda_md from meetings order by created_at desc limit 1;`).

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/admin/meetings/new/new-meeting-form.tsx
git commit -m "feat(meetings): agenda editor on new-meeting form"
```

---

## Task 8: Capture page — agenda panel + Present toggle

**Files:**
- Modify: `src/app/(app)/admin/meetings/[id]/capture-page.tsx`

- [ ] **Step 1: Add agenda panel at top of capture page**

Just above the existing capture-progress strip, insert an inline-editable agenda panel. Imports at top:

```tsx
import { useState } from 'react'
import { MarkdownEditor } from '@/components/markdown-editor'
import { MarkdownView } from '@/components/markdown-view'
import { Button } from '@/components/ui/button'
import { updateAgenda } from '@/lib/actions/meetings'
```

Inside the component (alongside existing state), add:

```tsx
const [agendaEditing, setAgendaEditing] = useState(false)
const [agendaDraft, setAgendaDraft] = useState(meeting.agenda_md ?? '')

async function saveAgenda() {
  const fd = new FormData()
  fd.set('id', meeting.id)
  fd.set('agenda_md', agendaDraft)
  const res = await updateAgenda(fd)
  if (res.ok) {
    toast.success('Agenda saved')
    setAgendaEditing(false)
    router.refresh()
  } else {
    toast.error("Couldn't save agenda", { description: res.error })
  }
}
```

Render the panel just before the existing `<div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs text-gray-700">` progress block:

```tsx
<div className="rounded-lg border border-gray-200 bg-white">
  <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
    <h2 className="text-sm font-semibold text-gray-900">Agenda</h2>
    {meeting.status === 'open' && (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setAgendaDraft(meeting.agenda_md ?? '')
          setAgendaEditing((prev) => !prev)
        }}
      >
        {agendaEditing ? 'Cancel' : meeting.agenda_md ? 'Edit' : 'Add agenda'}
      </Button>
    )}
  </div>
  {!agendaEditing && (
    <div className="px-4 py-3">
      {meeting.agenda_md ? (
        <MarkdownView source={meeting.agenda_md} />
      ) : (
        <p className="py-2 text-xs text-gray-400">No agenda set.</p>
      )}
    </div>
  )}
  {agendaEditing && (
    <div className="space-y-2 px-4 py-3">
      <MarkdownEditor
        value={agendaDraft}
        onChange={setAgendaDraft}
        mode="split"
        minHeight={220}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setAgendaEditing(false)}>
          Cancel
        </Button>
        <Button type="button" onClick={saveAgenda}>
          Save agenda
        </Button>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 2: Add Present toggle on each attendee row**

Import `setAttendance` at the top:

```tsx
import { refreshAttendeeNotes, saveAttendeeNotes, setAttendance } from '@/lib/actions/meetings'
```

Helper inside the component:

```tsx
async function toggleAttendance(memberId: string, nextAttended: boolean) {
  const fd = new FormData()
  fd.set('meeting_id', meeting.id)
  fd.set('member_id', memberId)
  fd.set('attended', String(nextAttended))
  const res = await setAttendance(fd)
  if (res.ok) {
    toast.success(nextAttended ? 'Marked present' : 'Marked absent')
    router.refresh()
  } else {
    toast.error("Couldn't update attendance", { description: res.error })
  }
}
```

In the `meeting.attendees.map((a) => …)` block, just before the existing expand/refresh controls in each row's header bar, insert:

```tsx
<label className="mr-2 flex items-center gap-1 text-xs text-gray-600">
  <input
    type="checkbox"
    checked={a.attended}
    onChange={(e) => toggleAttendance(a.member_id, e.target.checked)}
    className="h-3.5 w-3.5 rounded border-gray-300"
    aria-label={`Mark ${a.member_name} present`}
  />
  Present
</label>
```

Also apply visual dimming on the row container when `!a.attended` by appending ` ${a.attended ? '' : 'opacity-60'}` to its className. If the row is absent, hide the expand toggle (don't render `<ExpandToggle>`) so notes can't be captured for an absent member.

- [ ] **Step 3: Manual verification**

Reload `/admin/meetings/<id>` for an open meeting. Confirm:
- Agenda panel renders above the progress strip with `Add agenda` / `Edit` button.
- Editing → split editor + Save persists; reload shows the markdown rendered.
- Each attendee row has a Present checkbox; toggling absent dims the row + hides expand; toggling back re-enables it.
- Closing the meeting (existing button) disables the Edit button (meeting.status becomes `'closed'` → button only renders when open).

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/admin/meetings/\[id\]/capture-page.tsx
git commit -m "feat(meetings): agenda panel + Present toggle on capture page"
```

---

## Task 9: Read view — restructure into five sections

**Files:**
- Modify: `src/app/(app)/meetings/[id]/page.tsx`
- Modify: `src/app/(app)/meetings/[id]/consolidated-view.tsx`

- [ ] **Step 1: Restructure `meetings/[id]/page.tsx`**

Replace the body of the component (everything inside the outer `<div className="mx-auto max-w-4xl …">`) with five sections in order. Import `MarkdownView`:

```tsx
import { MarkdownView } from '@/components/markdown-view'
```

Section 1 — header card (extend with creator/closer attribution):

```tsx
<div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 className="text-lg font-semibold text-gray-900">{meeting.title}</h1>
      <div className="mt-1 text-xs text-gray-500">
        {meeting.meeting_date}
        {meeting.linked_poll && (
          <>
            {' · linked poll: '}
            <LinkedPollModal poll={meeting.linked_poll} />
          </>
        )}
      </div>
      <div className="mt-2 text-xs text-gray-500">
        Created by {meeting.created_by_member?.name ?? '—'} on{' '}
        {new Date(meeting.created_at).toLocaleDateString('en-IN')}
        {meeting.status === 'closed' && meeting.closed_by_member && meeting.closed_at && (
          <>
            {' · Closed by '}{meeting.closed_by_member.name}{' on '}
            {new Date(meeting.closed_at).toLocaleDateString('en-IN')}
          </>
        )}
      </div>
    </div>
    <span
      className={
        'rounded-full px-2 py-0.5 text-xs font-semibold ' +
        (meeting.status === 'open'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-green-100 text-green-800')
      }
    >
      {meeting.status === 'open' ? 'Open' : 'Closed'}
    </span>
  </div>
</div>
```

Section 2 — agenda card (hide if null):

```tsx
{meeting.agenda_md && (
  <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
    <h2 className="mb-2 text-sm font-semibold text-gray-900">Agenda</h2>
    <MarkdownView source={meeting.agenda_md} />
  </div>
)}
```

Section 3 — attendance card. Compute groups inline:

```tsx
const present = meeting.attendees.filter((a) => a.attended)
const absent  = meeting.attendees.filter((a) => !a.attended)
```

Then render (place this expression before the `return` so the JSX stays clean, or compute via const declarations in scope):

```tsx
<div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
  <h2 className="mb-2 text-sm font-semibold text-gray-900">
    Attendance{' '}
    <span className="font-normal text-gray-500">
      ({present.length} present{absent.length > 0 ? ` · ${absent.length} absent` : ''})
    </span>
  </h2>
  <div className="space-y-1 text-xs text-gray-700">
    <div>
      <span className="font-semibold text-gray-900">Present:</span>{' '}
      {present.length > 0 ? present.map((a) => a.member_name).join(' · ') : '—'}
    </div>
    {absent.length > 0 && (
      <div>
        <span className="font-semibold text-gray-900">Absent:</span>{' '}
        {absent.map((a) => a.member_name).join(' · ')}
      </div>
    )}
  </div>
</div>
```

Section 4 — notes accordion. Filter to present attendees only by passing a sliced meeting object:

```tsx
<ConsolidatedView
  meeting={{ ...meeting, attendees: present }}
  viewerMemberId={viewerMemberId}
/>
```

Section 5 — existing `<ActionItemsPanel …/>` block, unchanged.

Wrap all five in the existing outer `<div className="mx-auto max-w-4xl space-y-3 px-4 py-6 sm:px-6">`.

- [ ] **Step 2: Update `consolidated-view.tsx` with empty-state guard**

At the top of the returned JSX (just before the existing `<div className="flex items-center justify-between px-1">` strip), add:

```tsx
if (meeting.attendees.length === 0) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-xs text-gray-400">
      No notes — nobody marked present yet.
    </div>
  )
}
```

Place this as an early return inside the function body, before `return (` of the main render.

- [ ] **Step 3: Manual verification**

Open `/meetings/<id>` for: (a) an open meeting with no absentees, (b) an open meeting with one absentee, (c) a closed meeting. Confirm:
- Five cards render in order: header (with "Created by X on date"), agenda (when set), attendance roll-call, notes accordion (present only), action items.
- Absent member is listed under "Absent:" but does NOT appear in the notes accordion.
- Closed meetings show "Closed by Y on date" in the header.
- If no agenda is set, the agenda card is hidden entirely (no empty state).
- If everyone is marked absent, the empty-state guard in `consolidated-view.tsx` fires.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/meetings/\[id\]/page.tsx src/app/\(app\)/meetings/\[id\]/consolidated-view.tsx
git commit -m "feat(meetings): read view shows agenda, roll-call, creator/closer attribution"
```

---

## Task 10: End-to-end manual verification + final build

**Files:** none

- [ ] **Step 1: Full happy-path walkthrough**

Run `npm run dev`. As an admin user:

1. Go to `/admin/meetings/new`. Set title, date, write a short markdown agenda ("## Topics\n1. Loans review\n2. Donations approval"), keep all attendees selected, submit.
2. Land on `/admin/meetings/<id>`. Verify agenda panel shows the rendered markdown. Toggle one attendee to absent. Capture notes for two present members.
3. Open `/meetings/<id>` in a second tab. Verify the five sections render: header with "Created by …", agenda, attendance (with one absent), notes accordion (two members visible), action items.
4. Return to admin tab, click **Mark complete** to close. In the public tab, refresh. Verify "Closed by … on …" appears in the header and that **Edit** buttons for agenda + Present toggles are gone (capture page).
5. Reopen the meeting from the admin controls. Verify the buttons return.

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: all green (existing + new validation tests).

- [ ] **Step 3: Run full build + lint**

Run: `npm run build && npm run lint`
Expected: clean build, no new lint errors.

- [ ] **Step 4: Final commit (only if anything was tweaked during verification)**

```bash
git add -A
git commit -m "chore(meetings): tweaks from manual verification"
```

If nothing changed, skip this step — don't make an empty commit.

---

## Notes for the implementer

- **Reopen still has a tiny historical gap with `agenda_md` and `action_items_md`.** The `fn_meetings_lock_closed` trigger in migration 027 allows reopen only when title/meeting_date/linked_poll_id are unchanged, but doesn't list `agenda_md` or `action_items_md`. The `reopenMeeting` server action only touches status/closed_at/closed_by, so in practice this is never exploited. Out of scope for this plan — call out in the PR description if you want it tracked.
- **Why `*` works for `getMeetings` after the view change:** `meetings_with_progress` is replaced (not extended via `alter view`), and the new column list now includes `agenda_md` + `present_count`. PostgREST will return them; the type cast in TypeScript is what makes them typed for consumers. Make sure the TypeScript type is updated before the cast (Task 6 step 1) or the build will complain that the cast widens silently.
- **Server-action tests for Supabase writes are out of scope** because this repo doesn't currently mock the Supabase client. Validation logic is fully unit-tested in Task 2; server actions + UI are covered by manual verification (Task 9 + 10). If a future task introduces a Supabase test harness, expand `meetings.test.ts` per the spec §9 table.
