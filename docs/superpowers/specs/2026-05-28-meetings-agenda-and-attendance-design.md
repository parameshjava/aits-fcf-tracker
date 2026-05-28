# Meetings — Agenda + Attendance (Tier 1) Design

**Date:** 2026-05-28
**Scope:** Add a free-form markdown agenda and explicit present/absent tracking to the existing meetings feature. Surface roll-call and meeting metadata in the read view.
**Parent doc:** [2026-05-28-meetings-enterprise-alignment.md](./2026-05-28-meetings-enterprise-alignment.md) — see §5 Tier 1 for context.

---

## 1. Goals

1. Admin captures an **agenda** when creating a meeting (and can refine it while the meeting is open).
2. Admin can mark any invited attendee as **absent** during/after the meeting.
3. The read view shows **who created/closed the meeting, present roster, absent roster, and the agenda** before the per-member notes — the kind of detail an absent member needs to read the minutes cold.

Non-goals: structured action items, chair/scribe roles, meeting types, carry-forward. Those are Tier 2.

---

## 2. Locked decisions

|   #   | Decision                                                                                                                   |
| :---: | :------------------------------------------------------------------------------------------------------------------------- |
|   1   | Agenda format: free-form markdown (mirrors `action_items_md`).                                                             |
|   2   | `attended` defaults to `true`; admin toggles absentees off.                                                                |
|   3   | Read-view section order: header → agenda → attendance roll-call → notes accordion → action items.                          |
|   4   | Agenda is **admin-edit only** (unlike `action_items_md`, which any authenticated user can edit while the meeting is open). |
|   5   | Notes accordion shows present attendees only. Absent members appear in the roll-call header but get no notes section.      |

---

## 3. Schema changes — migration `031_meetings_agenda_and_attendance.sql`

```sql
begin;

alter table public.meetings
  add column if not exists agenda_md text
    check (agenda_md is null or char_length(agenda_md) <= 10000);

alter table public.meeting_attendees
  add column if not exists attended boolean not null default true;

create index if not exists meeting_attendees_attended_idx
  on public.meeting_attendees (meeting_id, attended);

commit;

notify pgrst, 'reload schema';
```

**Trigger interaction (no changes needed):**
- `fn_meetings_lock_closed` (migration 027) blocks any update while `status = 'closed'`. It already covers the new `agenda_md` field — closed meetings cannot have their agenda edited. The "allow reopen" branch lists immutable fields by name; `agenda_md` is not in that list, so it would technically be writable during a reopen update, but the reopen server action only sets status/closed_at/closed_by — no risk in practice.
- `fn_attendees_lock_closed` already blocks any update on `meeting_attendees` while the parent meeting is closed. Covers `attended` toggles automatically.

**RLS (no changes needed):**
- `agenda_md`: gated by the existing `meetings_update_admin` policy. The pre-existing `meetings_update_action_items_open` policy still applies to any authenticated user — that's fine because our `updateAgenda` server action checks `is_admin()` at the application layer before issuing the update.
- `attended`: gated by `attendees_update_admin`. The `attendees_update_self` policy lets a member update their own row, but our server action will only accept `attended` changes from admins (validated in `setAttendance`).

**View update:** `meetings_with_progress` gains a `present_count` field.

```sql
create or replace view public.meetings_with_progress
with (security_invoker = true)
as
select
  m.*,
  coalesce(a.attendee_count, 0)  as attendee_count,
  coalesce(a.present_count,  0)  as present_count,
  coalesce(a.captured_count, 0)  as captured_count
from public.meetings m
left join lateral (
  select
    count(*)::int                                                              as attendee_count,
    (count(*) filter (where ma.attended))::int                                 as present_count,
    (count(*) filter (where ma.notes_md is not null and ma.attended))::int     as captured_count
  from public.meeting_attendees ma
  where ma.meeting_id = m.id
) a on true;
```

`captured_count` is narrowed to "present *and* has notes" so the progress meter on the capture page only counts contributions that should exist.

---

## 4. Server actions — `src/lib/actions/meetings.ts`

### 4.1 `createMeeting` (modify)
- Accept new FormData field `agenda_md` (optional, ≤ 10 000 chars).
- Insert into `meetings.agenda_md` alongside existing fields. No change to attendee insert path (`attended` takes DB default of `true`).

### 4.2 `updateAgenda(formData)` (new)
- Inputs: `meeting_id`, `agenda_md`.
- Auth: `getCurrentUser()` + `role === 'admin'`. Reject otherwise.
- Trigger-enforced: closed meetings cannot be updated.
- Returns `ActionResult<{ meetingId }>`. Calls `invalidate(meetingId)`.

### 4.3 `setAttendance(formData)` (new)
- Inputs: `meeting_id`, `member_id`, `attended` (`'true'` | `'false'`).
- Auth: `getCurrentUser()` + `role === 'admin'`. Reject otherwise.
- Update `meeting_attendees.attended`. Trigger blocks change when meeting is closed.
- Returns `ActionResult<{ memberId, attended }>`. Calls `invalidate(meeting_id)`.

### 4.4 No changes
- `saveAttendeeNotes`, `refreshAttendeeNotes`, `closeMeeting`, `reopenMeeting`, `updateActionItems` — unchanged.

---

## 5. Read accessors — `src/lib/actions/meetings-reads.ts`

### 5.1 Type changes

```ts
export type MeetingRow = {
  // ...existing fields...
  agenda_md: string | null         // NEW
  present_count: number            // NEW (alongside attendee_count, captured_count)
}

export type MeetingAttendee = {
  // ...existing fields...
  attended: boolean                // NEW
}

export type MeetingDetail = MeetingRow & {
  attendees: MeetingAttendee[]
  linked_poll: { ... } | null
  created_by_member: { id: string; name: string } | null   // NEW
  closed_by_member:  { id: string; name: string } | null   // NEW
}
```

### 5.2 `getMeeting(id)` (modify)
- Add `agenda_md` to the `select` from `meetings_with_progress`.
- Add `attended` to the attendees select.
- Resolve `created_by` and `closed_by` to `{ id, name }` via a `members` lookup (one batched query: `from('members').select('id,name').in('id', [created_by, closed_by].filter(Boolean))`).

### 5.3 `getMeetings()` (modify)
- Add `agenda_md`, `present_count` to the select. List page doesn't currently render the agenda, but include for cheap forward-compat.

Cache tags unchanged.

---

## 6. Validation — `src/lib/meetings-validation.ts`

- `agendaMd` validator: optional, ≤ 10 000 chars (mirrors existing `actionItemsMd`).
- `attendedFlag` validator: parses `'true' | 'false'` → boolean.
- Extend `createMeetingInput` schema to include `agenda_md`.

Add tests to `meetings-validation.test.ts` covering: empty agenda, exactly 10 000 char agenda, over-limit, non-string `attended`.

---

## 7. UI changes

### 7.1 `src/app/(app)/admin/meetings/new/new-meeting-form.tsx` — add agenda editor

Insert between the linked-poll row and `<AttendeePicker>`:

```tsx
<div>
  <label htmlFor="agenda_md" className="mb-1 block text-xs font-semibold text-gray-700">
    Agenda <span className="font-normal text-gray-400">(markdown — keeps discussion on track)</span>
  </label>
  <MarkdownEditor
    name="agenda_md"
    initialValue=""
    mode="split"
    minHeight={200}
    placeholder={"# Topics\n\n1. Review last meeting's action items\n2. ...\n"}
  />
  {errFor('agenda_md') && <p className="mt-1 text-xs text-red-600">{errFor('agenda_md')}</p>}
</div>
```

(If `MarkdownEditor` doesn't currently accept a `name` prop for FormData submission, wire it via a hidden `<input name="agenda_md">` mirrored from the editor's value — pattern used by `ActionItemsPanel`. Plan task should verify this.)

### 7.2 `src/app/(app)/admin/meetings/[id]/capture-page.tsx` — agenda + absent toggle

Above the existing capture progress strip, add an **agenda panel** (admin-only, inline edit while meeting is open). Pattern after `action-items-panel.tsx`:

```
┌──────────────────────────────────────────┐
│ Agenda                       [Edit] btn  │
│ <MarkdownView of agenda_md>              │
└──────────────────────────────────────────┘
```

On each attendee row, add a **Present** toggle before the expand control:

```
[✓ Present]  Member Name   ✓ Notes saved   [↻ refresh] [▼ expand]
```

When toggled to absent:
- Row visually dims (`opacity-60`)
- Expand control disabled
- `setAttendance` server action fires with `attended=false`

The toggle calls `setAttendance` directly (no debounce — single click).

### 7.3 `src/app/(app)/meetings/[id]/page.tsx` — restructure read view

Replace the current header card + single consolidated view with five sections in order:

1. **Header card** — title, status pill, date, linked poll, created-by + closed-by attribution.
2. **Agenda card** — `<MarkdownView source={meeting.agenda_md} />`. If `agenda_md` is null, hide the card entirely (no "no agenda set" empty state).
3. **Attendance card** — two labeled rows: "Present (N): name · name · …" and "Absent (M): name · …" (omit absent row if M=0). Names are plain text, comma-joined.
4. **Notes accordion** — pass only `attendees.filter(a => a.attended)` to `<ConsolidatedView>`.
5. **Action items panel** — unchanged.

### 7.4 `src/app/(app)/meetings/[id]/consolidated-view.tsx` — minor

No structural change. The page filters attendees before passing them in, so this file just continues rendering whatever it receives. Add a one-line guard: if `meeting.attendees.length === 0`, render an empty state ("No present attendees yet").

---

## 8. Cache invalidation

`updateAgenda` and `setAttendance` both call the existing `invalidate(meetingId)` helper, which already busts `meetings` and `meeting:${meetingId}` tags. No new tags.

---

## 9. Tests

| File                                  | Add                                                                                                                                                                                                                                                                            |
| :------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/meetings-validation.test.ts` | agenda length boundaries; attended flag parser                                                                                                                                                                                                                                 |
| `src/lib/actions/meetings.test.ts`    | `createMeeting` accepts/persists `agenda_md`; `updateAgenda` rejects non-admin; `updateAgenda` rejects closed meeting; `setAttendance` rejects non-admin; `setAttendance` rejects closed meeting; `getMeeting` returns `created_by_member` / `closed_by_member` resolved names |

UI snapshot tests are not part of the convention in this repo — manual verification per the run skill on `/admin/meetings/new` and `/meetings/[id]`.

---

## 10. Rollout

One PR. No data backfill needed:
- New rows naturally get `agenda_md = null` and `attended = true`.
- Old closed meetings remain valid; they simply have no agenda and report everyone as present (correct historical default).

No env-var or migration-order coupling. The migration runs cleanly against current production schema.

---

## 11. Out of scope (deferred to Tier 2 or later)

- Structured action items (owner / due / status / carry-forward to next meeting)
- Meeting type (regular / AGM / ad-hoc)
- Chair and scribe roles
- Decision log
- Sign-off / minutes-approval workflow
- PDF or email export of minutes
- Full-text search across past meetings
