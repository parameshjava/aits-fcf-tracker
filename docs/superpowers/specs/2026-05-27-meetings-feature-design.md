# Meetings feature — design

**Date:** 2026-05-27
**Status:** Approved for implementation planning
**Related:** Polls (migrations 021–024), `members`, sidebar navigation

## Goal

Capture members' viewpoints during fund meetings as markdown notes — one section per attendee, in a randomized order — so the consolidated record becomes the source of truth when revising rules.

## Personas & permissions

| Capability                                | Admin | Authenticated member (self) | Authenticated member (other sections) |
|-------------------------------------------|:-----:|:---------------------------:|:------------------------------------:|
| List & read meetings                      |  ✓    |             ✓               |                  ✓                   |
| Create meeting                            |  ✓    |             —               |                  —                   |
| Edit meeting metadata (open meetings)     |  ✓    |             —               |                  —                   |
| Add/remove attendees (open meetings)      |  ✓    |             —               |                  —                   |
| Edit any attendee's `notes_md` (open)     |  ✓    |             —               |                  —                   |
| Edit own `notes_md` (open meetings)       |  ✓    |             ✓               |                  —                   |
| Edit `action_items_md` body (open)        |  ✓    |             —               |                  —                   |
| Toggle a checkbox in `action_items_md`    |  ✓    |             ✓               |                  ✓                   |
| Close / reopen meeting                    |  ✓    |             —               |                  —                   |
| Read consolidated view (closed meeting)   |  ✓    |             ✓               |                  ✓                   |

A meeting transitions `open` → `closed` via an explicit admin action. While `closed`, all writes are blocked.

## Data model

Two new tables in `public`. All Postgres identifiers lowercase per project convention.

### `public.meetings`
```sql
create table public.meetings (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (char_length(btrim(title)) between 3 and 200),
  meeting_date    date not null,
  status          text not null default 'open' check (status in ('open','closed')),
  random_seed     int  not null,                              -- locked at create time
  linked_poll_id  uuid references public.polls(id) on delete set null,
  action_items_md text,                                    -- nullable; one shared list per meeting (markdown)
  created_by      uuid not null references public.members(id),
  created_at      timestamptz not null default now(),
  closed_at       timestamptz,
  closed_by       uuid references public.members(id),
  check ((status = 'closed') = (closed_at is not null)),
  check ((status = 'closed') = (closed_by is not null))
);

create index meetings_status_date_idx on public.meetings (status, meeting_date desc);
create index meetings_created_at_idx  on public.meetings (created_at desc);
```

### `public.meeting_attendees`
```sql
create table public.meeting_attendees (
  meeting_id        uuid not null references public.meetings(id) on delete cascade,
  member_id         uuid not null references public.members(id)  on delete restrict,
  position          int  not null check (position >= 1),
  notes_md          text,
  notes_updated_at  timestamptz,
  notes_updated_by  uuid references public.members(id),
  primary key (meeting_id, member_id),
  unique (meeting_id, position)
);

create index meeting_attendees_meeting_idx on public.meeting_attendees (meeting_id, position);
create index meeting_attendees_member_idx  on public.meeting_attendees (member_id);
```

### Triggers
- `fn_touch_attendee_notes()` (BEFORE UPDATE on `meeting_attendees`): when `notes_md` changes, set `notes_updated_at = now()` and require `notes_updated_by` to be set by the caller (server action populates it from `current_member_id()`).
- `fn_meetings_lock_closed()` (BEFORE UPDATE on `meetings`): when current row's `status = 'closed'`, reject any update except a transition back to `'open'` initiated by an admin (the action layer enforces the role; this trigger just blocks accidental writes to closed metadata).
- `fn_meeting_attendees_lock_closed()` (BEFORE INSERT/UPDATE/DELETE on `meeting_attendees`): reject any change when the parent meeting is `closed`.

No `loan_year_counter`-style sequence needed — meetings use UUIDs end-to-end.

## RLS policies

All `public.*` tables have RLS enabled per project rule.

### `meetings`
- `select` — `to authenticated using (true)` (org-wide read).
- `insert` / `delete` — `to authenticated using (is_admin()) with check (is_admin())`.
- `update` — split into two policies (same shape as `meeting_attendees`):
  - **Admin update** — `using (is_admin()) with check (is_admin())` (any column).
  - **Action-items-only toggle for anyone** — `using (status = 'open') with check (status = 'open')`. Like the attendee self-update policy, this permits any column write at the RLS layer; the `toggleActionItem` server action is the single enforcement point that restricts the update to `action_items_md` only.

### `meeting_attendees`
- `select` — `to authenticated using (true)`.
- `insert` / `delete` — `to authenticated using (is_admin()) with check (is_admin())`.
- `update` — split policy:
  - **Admin update** — `using (is_admin()) with check (is_admin())`.
  - **Self update of notes only** — `using (member_id = current_member_id() and exists (select 1 from meetings m where m.id = meeting_id and m.status = 'open')) with check (member_id = current_member_id())`.
- The "self update" policy permits any column write at the RLS layer; the server action is the single enforcement point that limits self-edits to `notes_md` + `notes_updated_at` + `notes_updated_by`. We do **not** rely on column-level RLS — it's hard to maintain. Server-action authorization is defense-in-depth as per project rules.

## Server actions — `src/lib/actions/meetings.ts`

All write actions wrapped in `runAction(name, async () => { ... })` returning `ActionResult<T>`. All write actions re-check `getCurrentUser()` + role before touching the database. Read actions throw on failure.

### Reads (`'use cache'` + `cacheTag('meetings')`)
- `getMeetings()` — returns list of meetings with attendee count + capture progress (count of attendees with non-null `notes_md`).
- `getMeeting(id)` — returns meeting + ordered attendees (with member name/slug) + linked poll summary.
- `getAttendingOpenMeetingsForBadge()` — used by sidebar; counts open meetings where the viewer is an attendee with null `notes_md`. Not cached (per-user query).

### Writes
| Action                                                | Authorization gate                                              | Notes |
|-------------------------------------------------------|-----------------------------------------------------------------|-------|
| `createMeeting({ title, meeting_date, attendee_ids[], linked_poll_id? })` | admin                                                           | Generates `random_seed = floor(random()*1e9)`, shuffles `attendee_ids` deterministically with that seed (Fisher–Yates seeded by `random_seed`), inserts attendee rows with `position` starting at 1. |
| `updateMeeting({ id, title?, meeting_date?, linked_poll_id? })`            | admin, meeting must be `open`                                   | |
| `addAttendee({ meeting_id, member_id })`              | admin, meeting `open`, member not already an attendee           | Appends at `position = max(position)+1` — does *not* reshuffle. |
| `removeAttendee({ meeting_id, member_id })`           | admin, meeting `open`, target row has `notes_md is null`        | Action returns `actionError(...)` if notes already captured. Position gaps are left as-is (we do not renumber). |
| `saveAttendeeNotes({ meeting_id, member_id, notes_md })` | meeting `open` AND (admin OR `member_id = currentMemberId()`) | Sets `notes_updated_at = now()`, `notes_updated_by = currentMemberId()`. Empty string → store as `null`. |
| `closeMeeting(id)`                                    | admin                                                           | Sets `status='closed'`, `closed_at=now()`, `closed_by=currentMemberId()`. |
| `reopenMeeting(id)`                                   | admin                                                           | Sets `status='open'`, clears `closed_at`/`closed_by`. |
| `updateActionItems({ id, action_items_md })`          | admin, meeting `open`                                           | Replaces the whole `action_items_md` body. Length-capped at 10 000 chars. |
| `toggleActionItem({ id, line_index, checked })`       | any authenticated user, meeting `open`                          | Loads `action_items_md`, finds the line at `line_index` (0-based), validates it starts with `- [ ]` or `- [x]`, flips the box to the target state, writes back. Idempotent: setting to a state the line is already in is a no-op success. |

All writes call `updateTag('meetings')` after success.

## Routes & UI

```
src/app/(app)/
  meetings/
    page.tsx                          # list (Server Component)
    [id]/
      page.tsx                        # consolidated read view (Server Component)
      consolidated-view.tsx           # 'use client' — accordion w/ self-edit modal
  admin/
    meetings/
      new/
        page.tsx
        new-meeting-form.tsx          # 'use client' — useActionState wrapper
        attendee-picker.tsx           # 'use client' — checkbox grid + filter
      [id]/
        page.tsx                      # admin capture page (Server Component)
        capture-page.tsx              # 'use client' — randomized accordion + editor
        meeting-controls.tsx          # 'use client' — close/reopen, edit metadata
```

### Shared components
- `src/components/markdown-editor.tsx` — wraps `@uiw/react-md-editor` (`MDEditor`) with our three-mode toggle. Props: `value`, `onChange`, `mode` (`'write' | 'split' | 'read'`), `onModeChange`, plus an optional `mentions?: { trigger: '@'; options: { label: string; value: string }[] }` prop for the @-typeahead. Internally maps `preview="edit" | "live" | "preview"`. Dynamic-imported (`next/dynamic`, `ssr: false`) because the editor touches `window` at module init.
- `src/components/markdown-view.tsx` — wraps `react-markdown` with `remark-gfm` plugin. Accepts an optional `mentions?: { slugToName: Record<string, string> }` prop; when provided, a custom text-node renderer walks rendered output and replaces `@<slug>` tokens with styled chips (`<a href="/dashboard/members#slug">@Name</a>`). Unknown slugs fall through as plain text. Lightweight; safe to use server-side except where `mentions` makes it client-bound.
- `src/components/action-items-panel.tsx` *(new — client)* — renders `action_items_md` as a checklist. Built on top of `<MarkdownView mentions={…}>` plus an overlay that intercepts checkbox clicks: each click resolves to a `(line_index, checked)` pair and dispatches `toggleActionItem`. Read-only when the meeting is `closed`. Shows a small "Edit list" button (admin + open only) that opens a `<Dialog>` with the markdown editor.
- `src/components/action-items-editor.tsx` *(new — client)* — wraps `<MarkdownEditor>` with the `mentions` prop populated from the meeting's attendees, an "Add item" button that inserts `- [ ] ` at the cursor, and a save handler that calls `updateActionItems`.

### Sidebar update (`src/components/layout/sidebar.tsx`)
- Add to `mainGroup.items` directly after Polls:
  ```ts
  { label: 'Meetings', href: '/meetings', icon: <Emoji char="📝" label="Meetings" /> }
  ```
- Add to `adminGroup.items` (right after "New Poll"):
  ```ts
  { label: 'Manage Meetings', href: '/admin/meetings',     icon: <Emoji char="📋" label="Manage Meetings" />, exact: true },
  { label: 'New Meeting',     href: '/admin/meetings/new', icon: <Emoji char="📝" label="New Meeting" /> },
  ```
- Extend `SidebarUser` with `openMeetingsBadge?: number`; render same badge pattern as `openPollsBadge` on the Meetings row.

### Admin capture page — interaction notes
- Accordion: only one section expanded at a time. Expanding another section auto-saves the current one (if dirty) by calling `saveAttendeeNotes` — show a sonner success toast and inline error if it fails.
- Mode toggle (Write / Split / Read) lives in the expanded section's header. Default mode = `split`. Mode preference is **not** persisted (session-scoped).
- Progress strip at top shows `X / N captured` + the meeting's `random_seed` (informational only; helps admin explain order to attendees).
- `<ActionItemsPanel>` renders below the attendee accordion, always visible. When `action_items_md` is null/empty, shows an empty state "No action items yet" with an "Add list" button for admins. Counts done/total in the heading (`📋 Action items (2 / 4 done)`).
- Mark complete button → confirm `<Dialog>` ("Closing locks all notes. You can reopen later.") → calls `closeMeeting`. On success, route stays at the same URL; the page just re-renders in consolidated read mode.

### Action items — @mention typeahead
- In `<ActionItemsEditor>`, a `@` keystroke at a word boundary opens a small popover anchored to the cursor with member names from the meeting's attendee list (typeahead filtered as the user types more letters).
- Selecting a member inserts `@<member-slug>` plain text at the cursor.
- Implementation: a thin listener wired through `MDEditor`'s `textareaProps.onKeyDown`; the popover itself is a regular floating `<div>` positioned via `getBoundingClientRect()`. No extra editor plugin needed.
- In the read view, `@<slug>` tokens are detected by a regex (`/@([a-z][a-z0-9-]+)/g`) in the custom text-node renderer described above. The slug is resolved against the meeting's attendee list — unknown slugs render as plain text.

### Consolidated read view — interaction notes
- Renders attendee rows in ascending `position` order.
- A row whose `notes_md` is `null` is dimmed and labelled "— no notes captured" (not expandable).
- For the row matching `currentMemberId()` on an **open** meeting, show an **"Edit my notes"** button that opens a `<Dialog>` containing the `MarkdownEditor`. On save, call `saveAttendeeNotes` and close the dialog.
- "Expand all" / "Collapse all" toolbar controls multi-row state.
- `<ActionItemsPanel>` renders at the bottom of the page. Checkboxes are clickable for **any authenticated user** when the meeting is `open` (calls `toggleActionItem`); fully read-only when the meeting is `closed`. The "Edit list" button is visible to admins only and disabled on closed meetings.

## Form & validation

- Title: 3..200 chars.
- Meeting date: required, accepts past or today; no future-date restriction (admins may backfill).
- Attendees: at least 1.
- Linked poll: optional dropdown of polls (any status), grouped "Open polls" / "Closed polls", showing `question` text. Selected value is stored as `linked_poll_id` (nullable).
- Validate on the server inside the action; surface errors inline next to fields (no toast for errors per project rule).

## Caching & invalidation

- `getMeetings` and `getMeeting` use the `'use cache'` directive with `cacheLife('hours')` + `cacheTag('meetings')`.
- All write actions call `updateTag('meetings')`. They also call `revalidatePath('/meetings')` and (when applicable) `revalidatePath(\`/meetings/${id}\`)` because tags and paths invalidate different layers.
- The sidebar badge (`getAttendingOpenMeetingsForBadge`) is intentionally uncached because it's per-user.

## Migrations

New migrations under `scripts/prod/migrations/`:

1. **`026_meetings_schema.sql`** — `meetings` + `meeting_attendees` tables, indexes.
2. **`027_meetings_triggers.sql`** — `fn_touch_attendee_notes`, `fn_meetings_lock_closed`, `fn_meeting_attendees_lock_closed`.
3. **`028_meetings_rls.sql`** — RLS enable + policies.
4. **`029_meetings_views.sql`** *(optional)* — a `meetings_with_progress` view used by `getMeetings()` to avoid an N+1 in the list page.

All migrations re-runnable with `if not exists` / `create or replace` guards, matching the polls migration style.

## Dependencies (new)

| Package                  | Purpose                                | Approx size (gzipped) |
|--------------------------|----------------------------------------|-----------------------|
| `@uiw/react-md-editor`   | Three-mode markdown editor             | ~50 KB                |
| `react-markdown`         | Read-only markdown rendering           | ~12 KB                |
| `remark-gfm`             | GitHub-flavored markdown (tables, etc.)| ~14 KB                |

Confirmed allowed during brainstorming (per AGENTS.md "ask first" rule).

## Out of scope (deliberate)

- Per-section comments or threaded replies.
- Versioning / audit history of `notes_md` edits — `notes_updated_at` + `notes_updated_by` is the audit trail. Last-write-wins.
- Real-time collaboration / concurrent edit conflict resolution.
- File / image uploads inside markdown notes (markdown image syntax pointing to external URLs still works, but no upload UI).
- PDF / Word export — browser print of the consolidated view is acceptable for v1.
- Meeting templates / cloning.

## Acceptance criteria

1. Admin can create a meeting with a title, date, optional linked poll, and a checkbox-selected set of attendees from canonical members.
2. On meeting open, admin sees a randomized accordion list; the order is stable across page reloads (deterministic from `random_seed`).
3. Admin can capture markdown notes for any attendee; the editor supports Write / Split / Read modes.
4. Switching the active accordion section auto-saves the previously-edited section.
5. While the meeting is `open`, the consolidated view shows an "Edit my notes" button on the viewer's own section; saving updates `notes_updated_at` / `notes_updated_by`.
6. Admin closes the meeting via a confirm dialog; all writes are subsequently blocked (DB-level via triggers + RLS, server-action level via role check).
7. Closed meetings render read-only for everyone, including the owner of a section.
8. Sidebar shows a badge on "Meetings" with the count of open meetings where the viewer is an unfilled attendee.
9. Admin can edit the meeting's action-items markdown via a dialog with @-mention typeahead; the saved markdown round-trips as `- [ ] ... @<slug>` lines and renders @mentions as styled chips in the read view.
10. Any authenticated user can toggle action-item checkboxes on an open meeting (the toggle persists across reloads). On a closed meeting, checkboxes are read-only for everyone.
11. RLS policies match the persona matrix above; service-role bypass is not used at runtime.
12. `npm run build`, `npm run lint`, and `npm test` all pass.
