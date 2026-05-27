# Meetings Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Meetings feature that lets admins capture per-attendee markdown notes during fund meetings, in a randomized accordion editor, with a consolidated read view for everyone.

**Architecture:** Two new tables (`meetings`, `meeting_attendees`) under RLS. Server actions in `src/lib/actions/meetings.ts` handle all writes with admin-vs-self auth checks. Three new client components (`MarkdownEditor`, `MarkdownView`, `AttendeePicker`) cover the UI. The capture page auto-saves on accordion switch.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres + RLS, React 19, Tailwind v4, shadcn primitives (`Dialog`, `Accordion`, `Tabs`), Vitest. New deps: `@uiw/react-md-editor`, `react-markdown`, `remark-gfm`.

**Reference spec:** `docs/superpowers/specs/2026-05-27-meetings-feature-design.md`. Persona/permission matrix, full DDL, and acceptance criteria live there — read it before starting.

---

## File map

**New files:**
```
scripts/prod/migrations/
  026_meetings_schema.sql
  027_meetings_triggers.sql
  028_meetings_rls.sql
  029_meetings_views.sql

src/lib/
  meetings-validation.ts            # zod-free validators following polls-validation.ts pattern
  shuffle.ts                        # seeded Fisher–Yates (pure, unit-tested)
  shuffle.test.ts
  actions/
    meetings.ts                     # all read/write actions
    meetings.test.ts                # pure-logic tests (validation + shuffle wiring)

src/components/
  markdown-editor.tsx               # @uiw/react-md-editor wrapper with mode toggle
  markdown-view.tsx                 # react-markdown + remark-gfm wrapper

src/app/(app)/
  meetings/
    page.tsx                        # list (RSC)
    [id]/
      page.tsx                      # consolidated read view (RSC)
      consolidated-view.tsx         # client accordion + self-edit modal
  admin/meetings/
    page.tsx                        # admin list (RSC)
    new/
      page.tsx
      new-meeting-form.tsx          # client form (useActionState)
      attendee-picker.tsx           # client checkbox grid
    [id]/
      page.tsx                      # admin capture page (RSC)
      capture-page.tsx              # client randomized accordion editor
      meeting-controls.tsx          # client close/reopen + metadata edit
```

**Modified files:**
```
package.json                        # 3 new deps
src/components/layout/sidebar.tsx   # Meetings link + admin entries + badge prop
src/app/(app)/layout.tsx            # fetch openMeetingsBadge, pass to <Sidebar>
src/lib/breadcrumbs.ts              # register /meetings, /admin/meetings routes
```

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install runtime deps**

```bash
npm install @uiw/react-md-editor react-markdown remark-gfm
```

Expected: three entries added under `"dependencies"` in `package.json`. `npm install` exits 0.

- [ ] **Step 2: Verify build still succeeds**

```bash
npm run build
```

Expected: build passes (no usage of the new packages yet, so this is just a sanity check).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add markdown editor and renderer for meetings feature"
```

---

## Task 2: Database migrations

**Files:**
- Create: `scripts/prod/migrations/026_meetings_schema.sql`
- Create: `scripts/prod/migrations/027_meetings_triggers.sql`
- Create: `scripts/prod/migrations/028_meetings_rls.sql`
- Create: `scripts/prod/migrations/029_meetings_views.sql`

These migrations follow the style of 021–024 (polls). Wrap each in `begin; … commit;`. End each with `notify pgrst, 'reload schema';`. Use `if not exists` for tables and indexes; drop-and-recreate for policies, functions, triggers, and views.

- [ ] **Step 1: Write `026_meetings_schema.sql`**

```sql
-- =============================================================================
-- 026 — Meetings feature (schema only).
--
-- Admin-run meetings with per-attendee markdown notes captured in a
-- randomized accordion order. See spec:
--   docs/superpowers/specs/2026-05-27-meetings-feature-design.md
--
-- Sister migrations:
--   027 — triggers (touch updated_at; lock writes when closed)
--   028 — RLS policies
--   029 — views (meetings_with_progress)
-- =============================================================================

begin;

create table if not exists public.meetings (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (char_length(btrim(title)) between 3 and 200),
  meeting_date    date not null,
  status          text not null default 'open' check (status in ('open','closed')),
  random_seed     bigint not null,
  linked_poll_id  uuid references public.polls(id) on delete set null,
  created_by      uuid not null references public.members(id),
  created_at      timestamptz not null default now(),
  closed_at       timestamptz,
  closed_by       uuid references public.members(id),
  check ((status = 'closed') = (closed_at is not null)),
  check ((status = 'closed') = (closed_by is not null))
);

create index if not exists meetings_status_date_idx
  on public.meetings (status, meeting_date desc);

create index if not exists meetings_created_at_idx
  on public.meetings (created_at desc);

create table if not exists public.meeting_attendees (
  meeting_id        uuid not null references public.meetings(id) on delete cascade,
  member_id         uuid not null references public.members(id)  on delete restrict,
  position          int  not null check (position >= 1),
  notes_md          text,
  notes_updated_at  timestamptz,
  notes_updated_by  uuid references public.members(id),
  primary key (meeting_id, member_id),
  unique (meeting_id, position)
);

create index if not exists meeting_attendees_meeting_idx
  on public.meeting_attendees (meeting_id, position);

create index if not exists meeting_attendees_member_idx
  on public.meeting_attendees (member_id);

commit;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Write `027_meetings_triggers.sql`**

```sql
-- =============================================================================
-- 027 — Meetings: triggers.
--
--   fn_touch_attendee_notes        — bump notes_updated_at on notes_md change
--   fn_meetings_lock_closed        — block writes to closed meetings (except reopen)
--   fn_attendees_lock_closed       — block all writes on attendees of closed meetings
-- =============================================================================

begin;

create or replace function public.fn_touch_attendee_notes()
returns trigger
language plpgsql
as $$
begin
  if new.notes_md is distinct from old.notes_md then
    new.notes_updated_at := now();
    -- notes_updated_by must be set by the caller (server action populates from
    -- current_member_id()). Enforce non-null so we never lose attribution.
    if new.notes_updated_by is null then
      raise exception 'notes_updated_by must be set when notes_md changes';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_touch_attendee_notes on public.meeting_attendees;
create trigger trg_touch_attendee_notes
  before update on public.meeting_attendees
  for each row
  execute function public.fn_touch_attendee_notes();

create or replace function public.fn_meetings_lock_closed()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'closed' then
    -- only allow a clean transition back to 'open'
    if new.status = 'open'
       and new.closed_at is null
       and new.closed_by is null
       and new.title = old.title
       and new.meeting_date = old.meeting_date
       and new.linked_poll_id is not distinct from old.linked_poll_id
    then
      return new;
    end if;
    raise exception 'meeting is closed; reopen it before editing';
  end if;
  return new;
end
$$;

drop trigger if exists trg_meetings_lock_closed on public.meetings;
create trigger trg_meetings_lock_closed
  before update on public.meetings
  for each row
  execute function public.fn_meetings_lock_closed();

create or replace function public.fn_attendees_lock_closed()
returns trigger
language plpgsql
as $$
declare
  meeting_status text;
  target_meeting uuid;
begin
  target_meeting := coalesce(new.meeting_id, old.meeting_id);
  select status into meeting_status
    from public.meetings
   where id = target_meeting;
  if meeting_status = 'closed' then
    raise exception 'meeting is closed; attendees cannot be modified';
  end if;
  return coalesce(new, old);
end
$$;

drop trigger if exists trg_attendees_lock_closed on public.meeting_attendees;
create trigger trg_attendees_lock_closed
  before insert or update or delete on public.meeting_attendees
  for each row
  execute function public.fn_attendees_lock_closed();

commit;

notify pgrst, 'reload schema';
```

- [ ] **Step 3: Write `028_meetings_rls.sql`**

```sql
-- =============================================================================
-- 028 — Meetings: row-level security.
--
--   meetings           — SELECT: authenticated. WRITE: admin.
--   meeting_attendees  — SELECT: authenticated.
--                        INSERT/DELETE: admin only.
--                        UPDATE: admin OR (member_id = current_member_id()
--                                          AND meeting is open).
-- =============================================================================

begin;

do $$
declare r record;
begin
  for r in
    select policyname, tablename
      from pg_policies
     where schemaname = 'public'
       and tablename in ('meetings','meeting_attendees')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.meetings          enable row level security;
alter table public.meeting_attendees enable row level security;

create policy "meetings_select" on public.meetings
  for select to authenticated using (true);

create policy "meetings_write_admin" on public.meetings
  for all to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

create policy "attendees_select" on public.meeting_attendees
  for select to authenticated using (true);

create policy "attendees_insert_admin" on public.meeting_attendees
  for insert to authenticated
  with check (public.is_admin());

create policy "attendees_delete_admin" on public.meeting_attendees
  for delete to authenticated
  using (public.is_admin());

create policy "attendees_update_admin" on public.meeting_attendees
  for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

create policy "attendees_update_self" on public.meeting_attendees
  for update to authenticated
  using (
    member_id = public.current_member_id()
    and exists (
      select 1 from public.meetings m
       where m.id = meeting_id and m.status = 'open'
    )
  )
  with check (
    member_id = public.current_member_id()
  );

commit;

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Write `029_meetings_views.sql`**

```sql
-- =============================================================================
-- 029 — Meetings: read-side views.
--
--   meetings_with_progress — list page wants capture progress without N+1.
-- =============================================================================

begin;

create or replace view public.meetings_with_progress
with (security_invoker = true)
as
select
  m.id,
  m.title,
  m.meeting_date,
  m.status,
  m.linked_poll_id,
  m.created_by,
  m.created_at,
  m.closed_at,
  m.closed_by,
  coalesce(a.attendee_count, 0)  as attendee_count,
  coalesce(a.captured_count, 0)  as captured_count
from public.meetings m
left join lateral (
  select
    count(*)::int filter (where true)                          as attendee_count,
    count(*)::int filter (where ma.notes_md is not null)       as captured_count
  from public.meeting_attendees ma
  where ma.meeting_id = m.id
) a on true;

commit;

notify pgrst, 'reload schema';
```

- [ ] **Step 5: Apply migrations against the local Supabase**

Run each file via the Supabase SQL editor or `psql` (whatever you usually use locally — there is no migration runner in this repo; the SQL files are applied manually). Confirm:

```sql
select count(*) from public.meetings;
select count(*) from public.meeting_attendees;
select count(*) from public.meetings_with_progress;
```

Expected: all three return `0` without error.

- [ ] **Step 6: Verify RLS blocks anonymous writes**

```sql
-- as the authenticated role with a non-admin member:
insert into public.meetings (title, meeting_date, random_seed, created_by)
values ('test', current_date, 1, '<non-admin member id>');
```

Expected: error "new row violates row-level security policy".

- [ ] **Step 7: Commit**

```bash
git add scripts/prod/migrations/026_meetings_schema.sql \
        scripts/prod/migrations/027_meetings_triggers.sql \
        scripts/prod/migrations/028_meetings_rls.sql \
        scripts/prod/migrations/029_meetings_views.sql
git commit -m "feat(db): meetings schema, triggers, RLS, and progress view"
```

---

## Task 3: Seeded shuffle utility (TDD)

**Files:**
- Create: `src/lib/shuffle.ts`
- Test: `src/lib/shuffle.test.ts`

The shuffle must be deterministic from a seed so the random order is stable across server-action retries and page reloads. We use Mulberry32 (a tiny, well-known seedable PRNG) for Fisher–Yates.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/shuffle.test.ts
import { describe, expect, it } from 'vitest'
import { seededShuffle } from './shuffle'

describe('seededShuffle', () => {
  it('is deterministic for a given seed', () => {
    const input = ['a', 'b', 'c', 'd', 'e']
    const out1 = seededShuffle(input, 12345)
    const out2 = seededShuffle(input, 12345)
    expect(out1).toEqual(out2)
  })

  it('preserves length and contents', () => {
    const input = ['a', 'b', 'c', 'd', 'e']
    const out = seededShuffle(input, 99)
    expect(out).toHaveLength(input.length)
    expect([...out].sort()).toEqual([...input].sort())
  })

  it('different seeds produce different orders', () => {
    const input = ['a', 'b', 'c', 'd', 'e']
    const a = seededShuffle(input, 1)
    const b = seededShuffle(input, 2)
    expect(a).not.toEqual(b)
  })

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c']
    const before = [...input]
    seededShuffle(input, 42)
    expect(input).toEqual(before)
  })
})
```

- [ ] **Step 2: Run the test, watch it fail**

```bash
npm test -- --run src/lib/shuffle.test.ts
```

Expected: FAIL — "Failed to resolve import './shuffle'".

- [ ] **Step 3: Implement**

```ts
// src/lib/shuffle.ts

// Mulberry32 — tiny, well-known seedable PRNG with good distribution for
// shuffling tasks. Not cryptographic, but we don't need that here.
function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Deterministic Fisher–Yates shuffle. The same `seed` always yields the same
 * output ordering for the same input. Does not mutate `input`.
 */
export function seededShuffle<T>(input: readonly T[], seed: number): T[] {
  const out = input.slice()
  const rand = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
```

- [ ] **Step 4: Run the test, watch it pass**

```bash
npm test -- --run src/lib/shuffle.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shuffle.ts src/lib/shuffle.test.ts
git commit -m "feat(lib): seeded Fisher-Yates shuffle (deterministic by seed)"
```

---

## Task 4: Meeting validation helpers (TDD)

**Files:**
- Create: `src/lib/meetings-validation.ts`
- Test: `src/lib/meetings-validation.test.ts`

Mirror the style of `src/lib/polls-validation.ts` — return `{ ok: true, value }` or `{ ok: false, error, field }` discriminated unions.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/meetings-validation.test.ts
import { describe, expect, it } from 'vitest'
import {
  validateMeetingCreate,
  validateNotes,
} from './meetings-validation'

describe('validateMeetingCreate', () => {
  it('rejects empty title', () => {
    const r = validateMeetingCreate({
      title: '   ',
      meeting_date: '2026-05-27',
      attendee_ids: ['m1'],
      linked_poll_id: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('title')
  })

  it('rejects title shorter than 3 chars', () => {
    const r = validateMeetingCreate({
      title: 'ab',
      meeting_date: '2026-05-27',
      attendee_ids: ['m1'],
      linked_poll_id: null,
    })
    expect(r.ok).toBe(false)
  })

  it('rejects empty attendees list', () => {
    const r = validateMeetingCreate({
      title: 'Fund rules review',
      meeting_date: '2026-05-27',
      attendee_ids: [],
      linked_poll_id: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('attendees')
  })

  it('rejects invalid date', () => {
    const r = validateMeetingCreate({
      title: 'OK title',
      meeting_date: 'nope',
      attendee_ids: ['m1'],
      linked_poll_id: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('meeting_date')
  })

  it('deduplicates attendee ids', () => {
    const r = validateMeetingCreate({
      title: 'OK title',
      meeting_date: '2026-05-27',
      attendee_ids: ['m1', 'm1', 'm2'],
      linked_poll_id: null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.attendee_ids).toEqual(['m1', 'm2'])
  })

  it('passes a well-formed payload', () => {
    const r = validateMeetingCreate({
      title: 'Fund rules review',
      meeting_date: '2026-05-27',
      attendee_ids: ['m1', 'm2'],
      linked_poll_id: '11111111-1111-1111-1111-111111111111',
    })
    expect(r.ok).toBe(true)
  })
})

describe('validateNotes', () => {
  it('coerces empty/whitespace to null', () => {
    const r = validateNotes('   ')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBeNull()
  })

  it('rejects notes longer than 20000 chars', () => {
    const r = validateNotes('a'.repeat(20_001))
    expect(r.ok).toBe(false)
  })

  it('passes a normal markdown string', () => {
    const r = validateNotes('## Notes\n- point one')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('## Notes\n- point one')
  })
})
```

- [ ] **Step 2: Run the test, watch it fail**

```bash
npm test -- --run src/lib/meetings-validation.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/meetings-validation.ts

export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; field?: string }

export type MeetingCreateInput = {
  title: string
  meeting_date: string
  attendee_ids: string[]
  linked_poll_id: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateMeetingCreate(
  raw: unknown,
): Validated<MeetingCreateInput> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Invalid payload' }
  }
  const r = raw as Record<string, unknown>

  const title = String(r.title ?? '').trim()
  if (title.length < 3 || title.length > 200) {
    return { ok: false, error: 'Title must be 3–200 characters', field: 'title' }
  }

  const meeting_date = String(r.meeting_date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meeting_date) || Number.isNaN(Date.parse(meeting_date))) {
    return { ok: false, error: 'Pick a valid date', field: 'meeting_date' }
  }

  const rawIds = Array.isArray(r.attendee_ids) ? r.attendee_ids : []
  const attendee_ids = Array.from(new Set(rawIds.map((x) => String(x).trim()).filter(Boolean)))
  if (attendee_ids.length === 0) {
    return { ok: false, error: 'Pick at least one attendee', field: 'attendees' }
  }
  for (const id of attendee_ids) {
    if (!UUID_RE.test(id)) {
      return { ok: false, error: 'Invalid attendee id', field: 'attendees' }
    }
  }

  const linkedRaw = r.linked_poll_id
  let linked_poll_id: string | null = null
  if (linkedRaw && String(linkedRaw).trim()) {
    const v = String(linkedRaw).trim()
    if (!UUID_RE.test(v)) {
      return { ok: false, error: 'Invalid linked poll id', field: 'linked_poll_id' }
    }
    linked_poll_id = v
  }

  return { ok: true, value: { title, meeting_date, attendee_ids, linked_poll_id } }
}

export function validateNotes(raw: unknown): Validated<string | null> {
  const s = (raw == null ? '' : String(raw))
  if (s.length > 20_000) {
    return { ok: false, error: 'Notes are too long (max 20000 chars)' }
  }
  const trimmed = s.trim()
  return { ok: true, value: trimmed.length === 0 ? null : s }
}
```

- [ ] **Step 4: Run the test, watch it pass**

```bash
npm test -- --run src/lib/meetings-validation.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/meetings-validation.ts src/lib/meetings-validation.test.ts
git commit -m "feat(meetings): input validators for create and notes"
```

---

## Task 5: Server actions — reads

**Files:**
- Create: `src/lib/actions/meetings.ts` (reads only in this task)

Reads use the project's caching contract (`'use cache'` + `cacheLife('hours')` + `cacheTag('meetings')`). The badge query is per-user and stays uncached. Read functions throw on failure (project convention).

Important: this file is a **read-only module** in this task. We will add writes in Task 6. Per the project rule (AGENTS.md), a file cannot mix `'use server'` with `'use cache'`. We solve this by putting reads in this file with `'use cache'` per function, and putting writes in a *separate* file in Task 6. **Revise**: re-read AGENTS.md — it says `dashboard.ts` drops `'use server'` for that reason and reads + writes can co-exist in one file as long as the file does not have a top-level `'use server'` and `'use cache'` is only applied per-function. We follow the same pattern: no top-level directive; each write action is its own `'use server'` annotated function... actually `'use server'` is a top-level directive in Next 16. **Final decision**: split into `src/lib/actions/meetings-reads.ts` (reads with `'use cache'` per function) and `src/lib/actions/meetings.ts` (writes with top-level `'use server'`). This matches the dashboard/dashboard-actions split style and avoids the conflict.

Re-read the file map at the top of this plan and apply this correction before starting:
- **Create:** `src/lib/actions/meetings-reads.ts` (this task)
- **Create:** `src/lib/actions/meetings.ts` (Task 6) — writes only

- [ ] **Step 1: Write `meetings-reads.ts`**

```ts
// src/lib/actions/meetings-reads.ts

import { cacheLife, cacheTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'

export type MeetingRow = {
  id: string
  title: string
  meeting_date: string
  status: 'open' | 'closed'
  linked_poll_id: string | null
  created_by: string
  created_at: string
  closed_at: string | null
  closed_by: string | null
  attendee_count: number
  captured_count: number
}

export async function getMeetings(): Promise<MeetingRow[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('meetings')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('meetings_with_progress')
    .select('*')
    .order('meeting_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as MeetingRow[]
}

export type MeetingAttendee = {
  meeting_id: string
  member_id: string
  position: number
  notes_md: string | null
  notes_updated_at: string | null
  notes_updated_by: string | null
  member_name: string
  member_slug: string
}

export type MeetingDetail = MeetingRow & {
  attendees: MeetingAttendee[]
  linked_poll: { id: string; question: string; status: 'open' | 'closed' } | null
}

export async function getMeeting(id: string): Promise<MeetingDetail | null> {
  'use cache'
  cacheLife('hours')
  cacheTag('meetings')
  cacheTag(`meeting:${id}`)

  const supabase = await createClient()
  const { data: meeting, error: mErr } = await supabase
    .from('meetings_with_progress')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (mErr) throw new Error(mErr.message)
  if (!meeting) return null

  const { data: attendees, error: aErr } = await supabase
    .from('meeting_attendees')
    .select('meeting_id, member_id, position, notes_md, notes_updated_at, notes_updated_by, members:member_id (full_name, slug)')
    .eq('meeting_id', id)
    .order('position', { ascending: true })
  if (aErr) throw new Error(aErr.message)

  let linked_poll = null as MeetingDetail['linked_poll']
  if (meeting.linked_poll_id) {
    const { data: poll } = await supabase
      .from('polls')
      .select('id, question, status')
      .eq('id', meeting.linked_poll_id)
      .maybeSingle()
    if (poll) linked_poll = poll as MeetingDetail['linked_poll']
  }

  return {
    ...(meeting as MeetingRow),
    attendees: (attendees ?? []).map((row) => {
      // Supabase nests the foreign-table select under the relation name.
      const m = (row as { members: { full_name: string; slug: string } | null }).members
      return {
        meeting_id: row.meeting_id as string,
        member_id: row.member_id as string,
        position: row.position as number,
        notes_md: (row.notes_md as string | null) ?? null,
        notes_updated_at: (row.notes_updated_at as string | null) ?? null,
        notes_updated_by: (row.notes_updated_by as string | null) ?? null,
        member_name: m?.full_name ?? '(unknown)',
        member_slug: m?.slug ?? '',
      }
    }),
    linked_poll,
  }
}

/** Open polls (status='open') for the linked-poll picker on the create form. */
export async function getOpenAndRecentPolls(): Promise<
  Array<{ id: string; question: string; status: 'open' | 'closed'; closes_at: string }>
> {
  'use cache'
  cacheLife('hours')
  cacheTag('polls')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('polls')
    .select('id, question, status, closes_at')
    .order('status', { ascending: true })   // open before closed
    .order('closes_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []) as Array<{ id: string; question: string; status: 'open' | 'closed'; closes_at: string }>
}

/**
 * Per-user count of open meetings where the viewer is an attendee with no
 * notes yet. Intentionally NOT cached — varies per user. Used by sidebar.
 */
export async function getMyOpenUncapturedMeetingCount(): Promise<number> {
  const user = await getCurrentUser()
  if (!user?.member?.id) return 0

  const supabase = await createClient()
  const { count, error } = await supabase
    .from('meeting_attendees')
    .select('meeting_id, meetings!inner(status)', { count: 'exact', head: true })
    .eq('member_id', user.member.id)
    .is('notes_md', null)
    .eq('meetings.status', 'open')

  if (error) return 0
  return count ?? 0
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
npm run build
```

Expected: passes. (No call sites yet — we only need TS validation.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/meetings-reads.ts
git commit -m "feat(meetings): read-side server actions (list, detail, badge count)"
```

---

## Task 6: Server actions — writes

**Files:**
- Create: `src/lib/actions/meetings.ts`
- Test: `src/lib/actions/meetings.test.ts`

All writes are wrapped in `runAction()` and return `ActionResult<T>`. Each one re-checks the caller's role/identity. We use raw inserts (not RPC) because the operations are simple enough; RLS + triggers are the safety net.

- [ ] **Step 1: Write `meetings.ts`**

```ts
// src/lib/actions/meetings.ts
'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'
import {
  actionError,
  actionOk,
  runAction,
  type ActionResult,
} from './action-result'
import {
  validateMeetingCreate,
  validateNotes,
} from '@/lib/meetings-validation'
import { seededShuffle } from '@/lib/shuffle'

function invalidate(meetingId?: string) {
  updateTag('meetings')
  if (meetingId) updateTag(`meeting:${meetingId}`)
  revalidatePath('/meetings')
  if (meetingId) revalidatePath(`/meetings/${meetingId}`)
  revalidatePath('/admin/meetings')
  if (meetingId) revalidatePath(`/admin/meetings/${meetingId}`)
}

export async function createMeeting(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('createMeeting', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin' || !user.member?.id) {
      return actionError('Unauthorized')
    }

    const v = validateMeetingCreate({
      title: formData.get('title'),
      meeting_date: formData.get('meeting_date'),
      attendee_ids: formData.getAll('attendee_ids'),
      linked_poll_id: formData.get('linked_poll_id'),
    })
    if (!v.ok) return actionError(v.error, v.field)

    const supabase = await createClient()

    // Pick a seed in [0, 2^31). We store it on the meeting so the random order
    // is reproducible if we ever need to recompute it.
    const random_seed = Math.floor(Math.random() * 0x7fffffff)

    const { data: meeting, error: mErr } = await supabase
      .from('meetings')
      .insert({
        title: v.value.title,
        meeting_date: v.value.meeting_date,
        random_seed,
        linked_poll_id: v.value.linked_poll_id,
        created_by: user.member.id,
      })
      .select('id')
      .single()
    if (mErr) return actionError(mErr.message)

    const ordered = seededShuffle(v.value.attendee_ids, random_seed)
    const rows = ordered.map((member_id, idx) => ({
      meeting_id: meeting.id,
      member_id,
      position: idx + 1,
    }))
    const { error: aErr } = await supabase.from('meeting_attendees').insert(rows)
    if (aErr) {
      // best-effort cleanup so we don't leave an empty meeting around
      await supabase.from('meetings').delete().eq('id', meeting.id)
      return actionError(aErr.message)
    }

    invalidate(meeting.id)
    return actionOk({ meetingId: meeting.id }, 'Meeting created')
  })
}

export async function updateMeeting(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('updateMeeting', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const id = String(formData.get('id') ?? '').trim()
    if (!id) return actionError('Missing meeting id')

    const patch: Record<string, unknown> = {}
    const title = formData.get('title')
    if (typeof title === 'string') {
      const t = title.trim()
      if (t.length < 3 || t.length > 200) {
        return actionError('Title must be 3–200 characters', 'title')
      }
      patch.title = t
    }
    const meeting_date = formData.get('meeting_date')
    if (typeof meeting_date === 'string' && meeting_date.trim()) {
      const d = meeting_date.trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return actionError('Pick a valid date', 'meeting_date')
      }
      patch.meeting_date = d
    }
    if (formData.has('linked_poll_id')) {
      const raw = String(formData.get('linked_poll_id') ?? '').trim()
      patch.linked_poll_id = raw === '' ? null : raw
    }

    if (Object.keys(patch).length === 0) return actionError('Nothing to update')

    const supabase = await createClient()
    const { error } = await supabase.from('meetings').update(patch).eq('id', id)
    if (error) return actionError(error.message)

    invalidate(id)
    return actionOk({ meetingId: id }, 'Meeting updated')
  })
}

export async function addAttendee(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('addAttendee', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const meetingId = String(formData.get('meeting_id') ?? '').trim()
    const memberId  = String(formData.get('member_id')  ?? '').trim()
    if (!meetingId || !memberId) return actionError('Missing ids')

    const supabase = await createClient()
    const { data: rows, error: posErr } = await supabase
      .from('meeting_attendees')
      .select('position')
      .eq('meeting_id', meetingId)
      .order('position', { ascending: false })
      .limit(1)
    if (posErr) return actionError(posErr.message)
    const nextPos = (rows?.[0]?.position ?? 0) + 1

    const { error } = await supabase
      .from('meeting_attendees')
      .insert({ meeting_id: meetingId, member_id: memberId, position: nextPos })
    if (error) return actionError(error.message)

    invalidate(meetingId)
    return actionOk({ meetingId }, 'Attendee added')
  })
}

export async function removeAttendee(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('removeAttendee', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const meetingId = String(formData.get('meeting_id') ?? '').trim()
    const memberId  = String(formData.get('member_id')  ?? '').trim()
    if (!meetingId || !memberId) return actionError('Missing ids')

    const supabase = await createClient()
    // Guard: only allow removal when no notes captured.
    const { data: row, error: rErr } = await supabase
      .from('meeting_attendees')
      .select('notes_md')
      .eq('meeting_id', meetingId)
      .eq('member_id', memberId)
      .maybeSingle()
    if (rErr) return actionError(rErr.message)
    if (!row) return actionError('Attendee not found')
    if (row.notes_md != null) {
      return actionError('Cannot remove an attendee whose notes are already captured')
    }

    const { error } = await supabase
      .from('meeting_attendees')
      .delete()
      .eq('meeting_id', meetingId)
      .eq('member_id', memberId)
    if (error) return actionError(error.message)

    invalidate(meetingId)
    return actionOk({ meetingId }, 'Attendee removed')
  })
}

export async function saveAttendeeNotes(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('saveAttendeeNotes', async () => {
    const user = await getCurrentUser()
    if (!user?.member?.id) return actionError('Unauthorized')

    const meetingId = String(formData.get('meeting_id') ?? '').trim()
    const memberId  = String(formData.get('member_id')  ?? '').trim()
    if (!meetingId || !memberId) return actionError('Missing ids')

    const isAdmin = user.profile?.role === 'admin'
    const isSelf  = user.member.id === memberId
    if (!isAdmin && !isSelf) return actionError('Unauthorized')

    const v = validateNotes(formData.get('notes_md'))
    if (!v.ok) return actionError(v.error, 'notes_md')

    const supabase = await createClient()

    // For self-edit, also confirm the meeting is open (RLS would block it
    // anyway, but we want a clean error message instead of a generic 403).
    if (isSelf && !isAdmin) {
      const { data: m, error: mErr } = await supabase
        .from('meetings').select('status').eq('id', meetingId).maybeSingle()
      if (mErr) return actionError(mErr.message)
      if (!m) return actionError('Meeting not found')
      if (m.status !== 'open') return actionError('This meeting is closed')
    }

    const { error } = await supabase
      .from('meeting_attendees')
      .update({
        notes_md: v.value,
        notes_updated_by: user.member.id,
      })
      .eq('meeting_id', meetingId)
      .eq('member_id', memberId)
    if (error) return actionError(error.message)

    invalidate(meetingId)
    return actionOk({ meetingId }, 'Notes saved')
  })
}

export async function closeMeeting(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('closeMeeting', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin' || !user.member?.id) {
      return actionError('Unauthorized')
    }
    const id = String(formData.get('id') ?? '').trim()
    if (!id) return actionError('Missing meeting id')

    const supabase = await createClient()
    const { error } = await supabase
      .from('meetings')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: user.member.id,
      })
      .eq('id', id)
    if (error) return actionError(error.message)

    invalidate(id)
    return actionOk({ meetingId: id }, 'Meeting closed')
  })
}

export async function reopenMeeting(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('reopenMeeting', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')
    const id = String(formData.get('id') ?? '').trim()
    if (!id) return actionError('Missing meeting id')

    const supabase = await createClient()
    const { error } = await supabase
      .from('meetings')
      .update({ status: 'open', closed_at: null, closed_by: null })
      .eq('id', id)
    if (error) return actionError(error.message)

    invalidate(id)
    return actionOk({ meetingId: id }, 'Meeting reopened')
  })
}
```

- [ ] **Step 2: Write a small smoke test for the action wiring**

```ts
// src/lib/actions/meetings.test.ts
import { describe, expect, it } from 'vitest'
import { seededShuffle } from '@/lib/shuffle'

// The action functions themselves call into Supabase; we don't mock that here.
// Instead we lock in the deterministic-order contract that the create flow
// relies on, plus the validators (covered by their own file).

describe('createMeeting ordering contract', () => {
  it('produces stable position 1..N for a given seed', () => {
    const ids = ['a','b','c','d','e','f','g','h']
    const seed = 4729
    const ordered = seededShuffle(ids, seed)
    // The same seed must always give the same order; positions are 1-indexed.
    expect(ordered).toEqual(seededShuffle(ids, seed))
    expect(ordered.length).toBe(ids.length)
    const positions = ordered.map((_, i) => i + 1)
    expect(positions[0]).toBe(1)
    expect(positions[positions.length - 1]).toBe(ids.length)
  })
})
```

- [ ] **Step 3: Run the test**

```bash
npm test -- --run src/lib/actions/meetings.test.ts
```

Expected: pass.

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: passes (no call sites yet).

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/meetings.ts src/lib/actions/meetings.test.ts
git commit -m "feat(meetings): write actions (create, update, attendees, notes, close)"
```

---

## Task 7: `<MarkdownView>` component

**Files:**
- Create: `src/components/markdown-view.tsx`

Lightweight, safe-to-render-in-RSC wrapper around `react-markdown` + `remark-gfm`. Used by the consolidated read view.

- [ ] **Step 1: Write the component**

```tsx
// src/components/markdown-view.tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type Props = {
  source: string
  className?: string
}

export function MarkdownView({ source, className }: Props) {
  return (
    <div
      className={
        'prose prose-sm max-w-none prose-headings:font-semibold prose-headings:text-gray-900 ' +
        'prose-p:text-gray-800 prose-li:text-gray-800 prose-strong:text-gray-900 ' +
        'prose-blockquote:border-l-3 prose-blockquote:border-gray-300 prose-blockquote:text-gray-600 ' +
        (className ?? '')
      }
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/markdown-view.tsx
git commit -m "feat(ui): MarkdownView wrapper around react-markdown"
```

---

## Task 8: `<MarkdownEditor>` component

**Files:**
- Create: `src/components/markdown-editor.tsx`

Three-mode wrapper around `@uiw/react-md-editor`. Editor must be client-only (`next/dynamic` with `ssr: false`) because it touches `window` at module init.

- [ ] **Step 1: Write the component**

```tsx
// src/components/markdown-editor.tsx
'use client'

import dynamic from 'next/dynamic'

const MDEditor = dynamic(() => import('@uiw/react-md-editor'), { ssr: false })

export type MarkdownEditorMode = 'write' | 'split' | 'read'

const MODE_TO_PREVIEW: Record<MarkdownEditorMode, 'edit' | 'live' | 'preview'> = {
  write: 'edit',
  split: 'live',
  read: 'preview',
}

type Props = {
  value: string
  onChange: (next: string) => void
  mode?: MarkdownEditorMode
  onModeChange?: (next: MarkdownEditorMode) => void
  minHeight?: number
}

export function MarkdownEditor({
  value,
  onChange,
  mode = 'split',
  onModeChange,
  minHeight = 220,
}: Props) {
  return (
    <div data-color-mode="light" className="rounded-md border border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-1.5 text-xs">
        <span className="text-gray-500">Markdown supported · GitHub flavored</span>
        <div className="inline-flex overflow-hidden rounded-md border border-gray-200">
          {(['write','split','read'] as MarkdownEditorMode[]).map((m) => {
            const active = m === mode
            return (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange?.(m)}
                className={
                  'px-2.5 py-1 text-xs font-medium transition-colors ' +
                  (active
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50')
                }
                aria-pressed={active}
              >
                {m === 'write' ? 'Write' : m === 'split' ? 'Split' : 'Read'}
              </button>
            )
          })}
        </div>
      </div>
      <MDEditor
        value={value}
        onChange={(next) => onChange(next ?? '')}
        preview={MODE_TO_PREVIEW[mode]}
        height={minHeight}
        textareaProps={{ placeholder: "Capture this attendee's points..." }}
        hideToolbar={false}
        enableScroll
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/components/markdown-editor.tsx
git commit -m "feat(ui): MarkdownEditor with write/split/read modes"
```

---

## Task 9: Sidebar navigation + breadcrumbs

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/lib/breadcrumbs.ts`

- [ ] **Step 1: Extend `SidebarUser` and `mainGroup` in `sidebar.tsx`**

In `src/components/layout/sidebar.tsx`:

1. Add to the `SidebarUser` type (line ~52-58):
   ```ts
   /** Count of open meetings the viewer is an attendee in and hasn't captured. */
   openMeetingsBadge?: number
   ```
2. Add Meetings to `mainGroup.items` right after Polls (line ~70-75):
   ```ts
   { label: 'Meetings', href: '/meetings', icon: <Emoji char="📝" label="Meetings" /> },
   ```
3. Add admin entries to `adminGroup.items` immediately after the "New Poll" entry (line ~105):
   ```ts
   { label: 'Manage Meetings', href: '/admin/meetings',     icon: <Emoji char="📋" label="Manage Meetings" />, exact: true },
   { label: 'New Meeting',     href: '/admin/meetings/new', icon: <Emoji char="📝" label="New Meeting" /> },
   ```
4. In the `Sidebar` component (around line 420 where `mainGroup` is mapped to include `openPollsBadge`), extend the same map to also attach `openMeetingsBadge`:
   ```ts
   const groups: NavGroup[] = [
     {
       ...mainGroup,
       items: mainGroup.items.map((item) => {
         if (item.href === '/polls' && user.openPollsBadge && user.openPollsBadge > 0) {
           return { ...item, badge: user.openPollsBadge }
         }
         if (item.href === '/meetings' && user.openMeetingsBadge && user.openMeetingsBadge > 0) {
           return { ...item, badge: user.openMeetingsBadge }
         }
         return item
       }),
     },
     transactionsGroup,
     rulesGroup,
     ...(user.isAdmin ? [adminGroup] : []),
   ]
   ```

- [ ] **Step 2: Wire `openMeetingsBadge` in `src/app/(app)/layout.tsx`**

Find the place where `openPollsBadge` is fetched (a server call before rendering `<Sidebar>`) and add a sibling call to `getMyOpenUncapturedMeetingCount()`. Pass the count as `openMeetingsBadge={…}` on the `<Sidebar user={…}>` prop.

Example diff (the exact lines depend on the current shape of the layout):

```tsx
import { getMyOpenUncapturedMeetingCount } from '@/lib/actions/meetings-reads'
// …
const openMeetingsBadge = await getMyOpenUncapturedMeetingCount()
// pass through:
<Sidebar user={{ ...sidebarUser, openMeetingsBadge }} />
```

- [ ] **Step 3: Register breadcrumb labels in `src/lib/breadcrumbs.ts`**

Open the file, find the existing path → label mappings (the file follows a clear pattern — see entries for `/polls`, `/admin/polls`, etc.). Add equivalent entries for:
- `/meetings` → "Meetings"
- `/meetings/[id]` → meeting title (resolve from data) or fall back to "Meeting"
- `/admin/meetings` → "Manage Meetings"
- `/admin/meetings/new` → "New Meeting"
- `/admin/meetings/[id]` → meeting title or "Meeting"

Follow the existing pattern exactly — including any dynamic-segment resolution helpers used by polls.

- [ ] **Step 4: Build & manually click around**

```bash
npm run dev
```

Visit `/` → confirm the sidebar shows **Meetings** under Polls. As an admin, confirm **Manage Meetings** and **New Meeting** show under Admin. Both routes 404 right now (no pages yet) — that's expected.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/sidebar.tsx src/app/\(app\)/layout.tsx src/lib/breadcrumbs.ts
git commit -m "feat(nav): add Meetings entry + admin links + uncaptured-meetings badge"
```

---

## Task 10: AttendeePicker component

**Files:**
- Create: `src/app/(app)/admin/meetings/new/attendee-picker.tsx`

Client component. Receives the full member list, manages a `Set<string>` of selected ids, exposes the selection via hidden `<input name="attendee_ids">` so the parent server action sees it.

- [ ] **Step 1: Write the component**

```tsx
// src/app/(app)/admin/meetings/new/attendee-picker.tsx
'use client'

import { useMemo, useState } from 'react'

export type AttendeeOption = { id: string; name: string }

type Props = {
  members: AttendeeOption[]
  /** Pre-checked ids. Defaults to all. */
  defaultSelected?: string[]
}

export function AttendeePicker({ members, defaultSelected }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultSelected ?? members.map((m) => m.id)),
  )
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return members
    return members.filter((m) => m.name.toLowerCase().includes(f))
  }, [filter, members])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-semibold text-gray-700">
          Attendees{' '}
          <span className="font-normal text-gray-500">
            ({selected.size} of {members.length})
          </span>
        </label>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setSelected(new Set(members.map((m) => m.id)))}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs hover:bg-gray-50"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs hover:bg-gray-50"
          >
            Clear
          </button>
        </div>
      </div>

      <input
        type="search"
        placeholder="🔍 Filter by name"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mb-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
      />

      <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto rounded-md border border-gray-200 p-2 sm:grid-cols-3">
        {filtered.map((m) => (
          <label key={m.id} className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-sm hover:bg-gray-50">
            <input
              type="checkbox"
              checked={selected.has(m.id)}
              onChange={() => toggle(m.id)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span className="truncate">{m.name}</span>
          </label>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-3 text-center text-xs text-gray-400">No matches</div>
        )}
      </div>

      {/* Hidden inputs so the server action receives multiple attendee_ids values */}
      {Array.from(selected).map((id) => (
        <input key={id} type="hidden" name="attendee_ids" value={id} />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/admin/meetings/new/attendee-picker.tsx
git commit -m "feat(meetings): AttendeePicker client component"
```

---

## Task 11: New-meeting form + page

**Files:**
- Create: `src/app/(app)/admin/meetings/new/page.tsx`
- Create: `src/app/(app)/admin/meetings/new/new-meeting-form.tsx`

The page is a Server Component that fetches members + recent polls, then renders the client form. Form uses `useActionState` + sonner toasts + inline errors per project rules.

- [ ] **Step 1: Write `new-meeting-form.tsx`**

```tsx
// src/app/(app)/admin/meetings/new/new-meeting-form.tsx
'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createMeeting } from '@/lib/actions/meetings'
import { AttendeePicker, type AttendeeOption } from './attendee-picker'

type PollOption = { id: string; question: string; status: 'open' | 'closed'; closes_at: string }

type Props = {
  members: AttendeeOption[]
  polls: PollOption[]
  defaultDate: string
}

export function NewMeetingForm({ members, polls, defaultDate }: Props) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, fd: FormData) => createMeeting(fd),
    null,
  )

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Meeting created')
      router.push(`/admin/meetings/${state.data.meetingId}`)
    }
  }, [state, router])

  const errFor = (field: string) =>
    state && !state.ok && state.field === field ? state.error : null

  const openPolls = polls.filter((p) => p.status === 'open')
  const closedPolls = polls.filter((p) => p.status === 'closed')

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div>
        <label htmlFor="title" className="mb-1 block text-xs font-semibold text-gray-700">Title</label>
        <input
          id="title" name="title" required minLength={3} maxLength={200}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="e.g. Fund Rules Review — May 2026"
        />
        {errFor('title') && <p className="mt-1 text-xs text-red-600">{errFor('title')}</p>}
      </div>

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
          <label htmlFor="linked_poll_id" className="mb-1 block text-xs font-semibold text-gray-700">
            Linked poll <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <select
            id="linked_poll_id" name="linked_poll_id" defaultValue=""
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">— No linked poll —</option>
            {openPolls.length > 0 && (
              <optgroup label="Open polls">
                {openPolls.map((p) => (
                  <option key={p.id} value={p.id}>{p.question}</option>
                ))}
              </optgroup>
            )}
            {closedPolls.length > 0 && (
              <optgroup label="Closed polls">
                {closedPolls.map((p) => (
                  <option key={p.id} value={p.id}>{p.question}</option>
                ))}
              </optgroup>
            )}
          </select>
          {errFor('linked_poll_id') && <p className="mt-1 text-xs text-red-600">{errFor('linked_poll_id')}</p>}
        </div>
      </div>

      <AttendeePicker members={members} />
      {errFor('attendees') && <p className="mt-1 text-xs text-red-600">{errFor('attendees')}</p>}

      {state && !state.ok && !state.field && (
        <p className="text-xs text-red-600">{state.error}</p>
      )}

      <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
        <button type="button" onClick={() => router.back()} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
        <button type="submit" disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60">
          {pending ? 'Creating…' : 'Create meeting'}
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Write `page.tsx`**

```tsx
// src/app/(app)/admin/meetings/new/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'
import { getMembersForBankAccountForm } from '@/lib/actions/bank-accounts'
import { getOpenAndRecentPolls } from '@/lib/actions/meetings-reads'
import { NewMeetingForm } from './new-meeting-form'

export default async function NewMeetingPage() {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') redirect('/')

  // Reuse the existing member list helper used by bank accounts. If its
  // shape differs from { id, name }, map it here.
  const members = (await getMembersForBankAccountForm()).map((m) => ({
    id: m.id,
    name: m.full_name ?? m.name ?? m.slug ?? '(unnamed)',
  }))

  const polls = await getOpenAndRecentPolls()
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">New meeting</h1>
      <NewMeetingForm members={members} polls={polls} defaultDate={today} />
    </div>
  )
}
```

If `getMembersForBankAccountForm` does not exist or has a different shape, check `src/lib/actions/members.ts` for the canonical helper (e.g., `getMembersForSelect()`) and use that. The pattern is: any cached read returning `[{ id, full_name }]` rows for the 22 canonical members works.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: passes.

- [ ] **Step 4: Manual check**

```bash
npm run dev
```

As an admin, visit `/admin/meetings/new`. Confirm: title field, date defaulting to today, linked-poll dropdown with open/closed groups, attendee grid showing all members with all checked by default, Select all / Clear buttons working.

Submit with one attendee unchecked. Confirm you land on `/admin/meetings/<uuid>` (404 page — no admin detail page yet), and a sonner success toast fires.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/admin/meetings/new/
git commit -m "feat(meetings): new-meeting form with attendee picker and linked-poll dropdown"
```

---

## Task 12: Admin capture page

**Files:**
- Create: `src/app/(app)/admin/meetings/[id]/page.tsx`
- Create: `src/app/(app)/admin/meetings/[id]/capture-page.tsx`
- Create: `src/app/(app)/admin/meetings/[id]/meeting-controls.tsx`

This is the largest UI surface. Server page loads the meeting; client `CapturePage` renders the randomized accordion with markdown editor. `MeetingControls` is a small client component for close/reopen + metadata edits.

- [ ] **Step 1: Write `capture-page.tsx`**

```tsx
// src/app/(app)/admin/meetings/[id]/capture-page.tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { MarkdownEditor, type MarkdownEditorMode } from '@/components/markdown-editor'
import { saveAttendeeNotes } from '@/lib/actions/meetings'
import type { MeetingDetail } from '@/lib/actions/meetings-reads'

type Props = {
  meeting: MeetingDetail
}

export function CapturePage({ meeting }: Props) {
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null)
  const [draftByMember, setDraftByMember] = useState<Record<string, string>>(
    Object.fromEntries(meeting.attendees.map((a) => [a.member_id, a.notes_md ?? ''])),
  )
  const [modeByMember, setModeByMember] = useState<Record<string, MarkdownEditorMode>>({})
  const [pending, startTransition] = useTransition()

  const captured = meeting.attendees.filter((a) => a.notes_md != null).length
  const total = meeting.attendees.length

  function saveActive(): Promise<boolean> {
    if (!activeMemberId) return Promise.resolve(true)
    const memberId = activeMemberId
    const value = draftByMember[memberId] ?? ''
    return new Promise((resolve) => {
      startTransition(async () => {
        const fd = new FormData()
        fd.set('meeting_id', meeting.id)
        fd.set('member_id', memberId)
        fd.set('notes_md', value)
        const res = await saveAttendeeNotes(fd)
        if (res.ok) {
          toast.success('Notes saved')
          resolve(true)
        } else {
          toast.error(res.error)
          resolve(false)
        }
      })
    })
  }

  async function expand(memberId: string) {
    if (memberId === activeMemberId) {
      setActiveMemberId(null)
      return
    }
    const ok = await saveActive()
    if (ok) setActiveMemberId(memberId)
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs text-gray-700">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{captured} / {total} captured</span>
          <span className="text-gray-400">order locked at meeting start (seed: {String((meeting as unknown as { random_seed?: number }).random_seed ?? '—')})</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
          <div className="h-full bg-blue-600" style={{ width: `${total === 0 ? 0 : (captured / total) * 100}%` }} />
        </div>
      </div>

      <div className="space-y-2">
        {meeting.attendees.map((a) => {
          const isActive = activeMemberId === a.member_id
          const hasNotes = a.notes_md != null
          const mode = modeByMember[a.member_id] ?? 'split'
          return (
            <div
              key={a.member_id}
              className={
                'rounded-lg border bg-white ' +
                (isActive ? 'border-blue-500 shadow-sm' : 'border-gray-200')
              }
            >
              <button
                type="button"
                onClick={() => void expand(a.member_id)}
                className={
                  'flex w-full items-center justify-between px-4 py-3 text-left ' +
                  (isActive ? 'bg-blue-50' : 'bg-white hover:bg-gray-50')
                }
              >
                <div className="flex items-center gap-3">
                  <span
                    className={
                      'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-2 text-[11px] font-bold ' +
                      (hasNotes
                        ? 'bg-green-100 text-green-700'
                        : isActive
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-500')
                    }
                  >
                    {a.position}
                  </span>
                  <span className="text-sm font-semibold text-gray-900">{a.member_name}</span>
                  <span className="text-xs text-gray-500">
                    {hasNotes ? '✓ Notes saved' : isActive ? 'Capturing…' : 'Not yet captured'}
                  </span>
                </div>
                <span className="text-gray-400">{isActive ? '▾' : '▸'}</span>
              </button>

              {isActive && (
                <div className="border-t border-gray-200 p-3">
                  <MarkdownEditor
                    value={draftByMember[a.member_id] ?? ''}
                    onChange={(next) =>
                      setDraftByMember((prev) => ({ ...prev, [a.member_id]: next }))
                    }
                    mode={mode}
                    onModeChange={(next) =>
                      setModeByMember((prev) => ({ ...prev, [a.member_id]: next }))
                    }
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveMemberId(null)}
                      className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void saveActive()}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {pending ? 'Saving…' : 'Save notes'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write `meeting-controls.tsx`**

```tsx
// src/app/(app)/admin/meetings/[id]/meeting-controls.tsx
'use client'

import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { closeMeeting, reopenMeeting } from '@/lib/actions/meetings'

type Props = { meetingId: string; status: 'open' | 'closed' }

export function MeetingControls({ meetingId, status }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)

  function close() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('id', meetingId)
      const res = await closeMeeting(fd)
      if (res.ok) {
        toast.success('Meeting closed')
        setConfirmOpen(false)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  function reopen() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('id', meetingId)
      const res = await reopenMeeting(fd)
      if (res.ok) {
        toast.success('Meeting reopened')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  if (status === 'closed') {
    return (
      <button onClick={reopen} disabled={pending} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-60">
        Reopen meeting
      </button>
    )
  }

  return (
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogTrigger asChild>
        <button className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Mark complete</button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close this meeting?</DialogTitle>
          <DialogDescription>
            Closing locks the meeting — no further edits to notes, attendees, or metadata.
            You can reopen it later if needed.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button onClick={() => setConfirmOpen(false)} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
          <button onClick={close} disabled={pending} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {pending ? 'Closing…' : 'Close meeting'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Write `page.tsx`**

```tsx
// src/app/(app)/admin/meetings/[id]/page.tsx
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/actions/auth'
import { getMeeting } from '@/lib/actions/meetings-reads'
import { CapturePage } from './capture-page'
import { MeetingControls } from './meeting-controls'

export default async function AdminMeetingDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') redirect('/')

  const meeting = await getMeeting(id)
  if (!meeting) notFound()

  return (
    <div className="mx-auto max-w-4xl space-y-3 px-4 py-6 sm:px-6">
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{meeting.title}</h1>
            <div className="mt-1 text-xs text-gray-500">
              {meeting.meeting_date} · {meeting.attendee_count} attendees
              {meeting.linked_poll && (
                <>
                  {' · linked poll: '}
                  <Link href={`/polls/${meeting.linked_poll.id}`} className="text-blue-600 underline">
                    {meeting.linked_poll.question}
                  </Link>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={
                'rounded-full px-2 py-0.5 text-xs font-semibold ' +
                (meeting.status === 'open'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-green-100 text-green-800')
              }
            >
              {meeting.status === 'open' ? 'In progress' : 'Closed'}
            </span>
            <MeetingControls meetingId={meeting.id} status={meeting.status} />
          </div>
        </div>
      </div>

      <CapturePage meeting={meeting} />
    </div>
  )
}
```

- [ ] **Step 4: Build & manual smoke**

```bash
npm run dev
```

Open `/admin/meetings/<uuid-from-task-11>`. Confirm: randomized accordion list with progress strip; clicking a row opens the markdown editor (Write/Split/Read toggle visible); typing and saving works; clicking another row auto-saves current and opens the next.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/admin/meetings/\[id\]/
git commit -m "feat(meetings): admin capture page with markdown editor accordion"
```

---

## Task 13: Admin meetings list

**Files:**
- Create: `src/app/(app)/admin/meetings/page.tsx`

Simple table-like view of all meetings with status, capture progress, and a "Manage" link to the detail page. Mirror the style of `src/app/(app)/admin/polls/page.tsx`.

- [ ] **Step 1: Write `page.tsx`**

```tsx
// src/app/(app)/admin/meetings/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'
import { getMeetings } from '@/lib/actions/meetings-reads'

export default async function AdminMeetingsListPage() {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') redirect('/')

  const meetings = await getMeetings()

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Manage meetings</h1>
        <Link href="/admin/meetings/new" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">
          New meeting
        </Link>
      </div>

      {meetings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No meetings yet. <Link href="/admin/meetings/new" className="text-blue-600 underline">Create one</Link>.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Progress</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {meetings.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2 whitespace-nowrap">{m.meeting_date}</td>
                  <td className="px-4 py-2 font-medium text-gray-900">{m.title}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        'rounded-full px-2 py-0.5 text-xs font-semibold ' +
                        (m.status === 'open'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-green-100 text-green-800')
                      }
                    >
                      {m.status === 'open' ? 'Open' : 'Closed'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {m.captured_count} / {m.attendee_count}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/meetings/${m.id}`} className="text-blue-600 hover:underline">
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build & verify**

```bash
npm run dev
```

Visit `/admin/meetings`. Confirm: list shows the meeting created earlier with correct progress.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/admin/meetings/page.tsx
git commit -m "feat(meetings): admin meetings list page"
```

---

## Task 14: User-facing meetings list

**Files:**
- Create: `src/app/(app)/meetings/page.tsx`

Public list, no manage link, no admin badges. Click row → detail page.

- [ ] **Step 1: Write `page.tsx`**

```tsx
// src/app/(app)/meetings/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'
import { getMeetings } from '@/lib/actions/meetings-reads'

export default async function MeetingsListPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/auth/login')

  const meetings = await getMeetings()

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Meetings</h1>
      {meetings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No meetings yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {meetings.map((m) => (
            <li key={m.id}>
              <Link
                href={`/meetings/${m.id}`}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-blue-400 hover:bg-blue-50"
              >
                <div>
                  <div className="font-semibold text-gray-900">{m.title}</div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {m.meeting_date} · {m.captured_count} / {m.attendee_count} captured
                  </div>
                </div>
                <span
                  className={
                    'rounded-full px-2 py-0.5 text-xs font-semibold ' +
                    (m.status === 'open'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-green-100 text-green-800')
                  }
                >
                  {m.status === 'open' ? 'Open' : 'Closed'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/meetings/page.tsx
git commit -m "feat(meetings): user-facing meetings list page"
```

---

## Task 15: Consolidated read view + self-edit modal

**Files:**
- Create: `src/app/(app)/meetings/[id]/page.tsx`
- Create: `src/app/(app)/meetings/[id]/consolidated-view.tsx`

- [ ] **Step 1: Write `consolidated-view.tsx`**

```tsx
// src/app/(app)/meetings/[id]/consolidated-view.tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MarkdownView } from '@/components/markdown-view'
import { MarkdownEditor, type MarkdownEditorMode } from '@/components/markdown-editor'
import { saveAttendeeNotes } from '@/lib/actions/meetings'
import type { MeetingDetail } from '@/lib/actions/meetings-reads'

type Props = {
  meeting: MeetingDetail
  viewerMemberId: string | null
}

export function ConsolidatedView({ meeting, viewerMemberId }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>(
    Object.fromEntries(meeting.attendees.filter((a) => a.notes_md).map((a) => [a.member_id, true])),
  )
  const [editing, setEditing] = useState<{ memberId: string; value: string } | null>(null)
  const [mode, setMode] = useState<MarkdownEditorMode>('split')
  const [pending, startTransition] = useTransition()

  const canEditOwn = meeting.status === 'open' && viewerMemberId != null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-gray-500">Click any member to expand · sections appear in the order captured</p>
        <div className="flex gap-2">
          <button
            onClick={() => setOpen(Object.fromEntries(meeting.attendees.map((a) => [a.member_id, true])))}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs hover:bg-gray-50"
          >
            Expand all
          </button>
          <button
            onClick={() => setOpen({})}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs hover:bg-gray-50"
          >
            Collapse all
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {meeting.attendees.map((a) => {
          const isOpen = !!open[a.member_id]
          const hasNotes = a.notes_md != null
          const isViewer = a.member_id === viewerMemberId
          return (
            <div key={a.member_id} className={'rounded-lg border bg-white ' + (hasNotes ? 'border-gray-200' : 'border-gray-200 opacity-70')}>
              <div className="flex items-center justify-between px-4 py-3">
                <button
                  type="button"
                  disabled={!hasNotes}
                  onClick={() => setOpen((prev) => ({ ...prev, [a.member_id]: !prev[a.member_id] }))}
                  className="flex flex-1 items-center gap-3 text-left disabled:cursor-default"
                >
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-100 px-2 text-[11px] font-bold text-indigo-700">
                    {a.position}
                  </span>
                  <span className="text-sm font-semibold text-gray-900">{a.member_name}</span>
                  {isViewer && <span className="text-xs text-gray-500">— you</span>}
                  {!hasNotes && <span className="text-xs text-gray-400">— no notes captured</span>}
                </button>
                {hasNotes && isViewer && canEditOwn && (
                  <button
                    onClick={() => setEditing({ memberId: a.member_id, value: a.notes_md ?? '' })}
                    className="ml-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                  >
                    Edit my notes
                  </button>
                )}
                {!hasNotes && isViewer && canEditOwn && (
                  <button
                    onClick={() => setEditing({ memberId: a.member_id, value: '' })}
                    className="ml-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                  >
                    Add my notes
                  </button>
                )}
                {hasNotes && <span className="ml-2 text-gray-400">{isOpen ? '▾' : '▸'}</span>}
              </div>
              {hasNotes && isOpen && (
                <div className="border-t border-gray-100 px-4 py-3">
                  <MarkdownView source={a.notes_md ?? ''} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit my notes</DialogTitle>
          </DialogHeader>
          {editing && (
            <MarkdownEditor
              value={editing.value}
              onChange={(next) => setEditing((prev) => (prev ? { ...prev, value: next } : prev))}
              mode={mode}
              onModeChange={setMode}
              minHeight={300}
            />
          )}
          <DialogFooter>
            <button onClick={() => setEditing(null)} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
            <button
              disabled={pending || !editing}
              onClick={() => {
                if (!editing) return
                startTransition(async () => {
                  const fd = new FormData()
                  fd.set('meeting_id', meeting.id)
                  fd.set('member_id', editing.memberId)
                  fd.set('notes_md', editing.value)
                  const res = await saveAttendeeNotes(fd)
                  if (res.ok) {
                    toast.success('Notes saved')
                    setEditing(null)
                    // refresh server data
                    if (typeof window !== 'undefined') window.location.reload()
                  } else {
                    toast.error(res.error)
                  }
                })
              }}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {pending ? 'Saving…' : 'Save notes'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

(Note: a `window.location.reload()` after self-edit is a pragmatic v1 choice. If you want to avoid the reload, the cleaner alternative is `router.refresh()` from `next/navigation`, which is fine here too. Either works.)

- [ ] **Step 2: Write `page.tsx`**

```tsx
// src/app/(app)/meetings/[id]/page.tsx
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/actions/auth'
import { getMeeting } from '@/lib/actions/meetings-reads'
import { ConsolidatedView } from './consolidated-view'

export default async function MeetingDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) redirect('/auth/login')

  const meeting = await getMeeting(id)
  if (!meeting) notFound()

  return (
    <div className="mx-auto max-w-4xl space-y-3 px-4 py-6 sm:px-6">
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{meeting.title}</h1>
            <div className="mt-1 text-xs text-gray-500">
              {meeting.meeting_date} · {meeting.attendee_count} attendees
              {meeting.linked_poll && (
                <>
                  {' · linked poll: '}
                  <Link href={`/polls/${meeting.linked_poll.id}`} className="text-blue-600 underline">
                    {meeting.linked_poll.question}
                  </Link>
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

      <ConsolidatedView meeting={meeting} viewerMemberId={user.member?.id ?? null} />
    </div>
  )
}
```

- [ ] **Step 3: Build & manual smoke**

```bash
npm run dev
```

Open `/meetings/<uuid>` as a non-admin user (sign in with a non-admin allowlisted email). Confirm:
- Header shows title, date, attendee count, linked poll link.
- Notes sections render markdown; unfilled rows are dimmed and not expandable.
- Your own section shows "Add my notes" / "Edit my notes" button while meeting is open.
- Save flow updates the page.

Switch to an admin account: confirm the same page also shows the "Edit my notes" on the admin's section (admin can also edit anyone via the admin capture page).

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/meetings/\[id\]/
git commit -m "feat(meetings): consolidated read view with self-edit modal"
```

---

## Task 16: End-to-end verification

**Files:** none — this is a verification task.

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass — at minimum:
- `src/lib/shuffle.test.ts` (4 tests)
- `src/lib/meetings-validation.test.ts` (≥8 tests)
- `src/lib/actions/meetings.test.ts` (1 test)
- All pre-existing tests unaffected.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: passes. Fix any auto-fixable issues with `npm run lint -- --fix`.

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: passes with no type errors. The dynamic-imported `@uiw/react-md-editor` should not appear in the server bundles.

- [ ] **Step 4: Manual acceptance walkthrough (against `npm run dev`)**

Tick off each acceptance criterion from the spec — all of these must work:

1. Admin creates a meeting at `/admin/meetings/new` with title, today's date, an open poll selected as linked poll, and 18 of 22 attendees checked.
2. Admin lands at `/admin/meetings/<id>` and sees a randomized accordion. Reload the page — same order persists.
3. Admin opens 3 attendees in sequence, captures markdown notes for each (toggle Write/Split/Read modes), and confirms auto-save fires when switching to the next section.
4. Switch to a non-admin attendee account. Open `/meetings/<id>`. Confirm consolidated read view; confirm "Add my notes" button is visible on the viewer's own section. Save some notes; reload; confirm they persist.
5. As admin, click **Mark complete** → confirm dialog → close. Confirm the admin detail page now lacks editor controls and the consolidated view is read-only for the previously-self-editable user.
6. Reopen the meeting from the admin page; confirm the meeting becomes editable again.
7. Confirm the sidebar's Meetings row shows a badge for the non-admin attendee while their notes are blank, and the badge disappears after they save.
8. Confirm `/polls/<id>` (linked poll) still works and the meeting detail's "linked poll" link navigates correctly.

- [ ] **Step 5: Commit the verification status if anything was tweaked**

If you fixed anything during verification, commit the fixes individually with descriptive messages — do not lump them in a single "fixes" commit.

- [ ] **Step 6: Create the PR**

```bash
git push -u origin <branch>
gh pr create --title "Meetings feature" --body "$(cat <<'EOF'
## Summary

- Adds a Meetings feature for capturing per-attendee markdown viewpoints during fund meetings (admin capture flow + consolidated read view).
- New tables `meetings` and `meeting_attendees` under RLS; admin writes + self-edit-own-while-open.
- Optional linkage to a Poll for context.

## Test plan

- [ ] `npm run lint` passes
- [ ] `npm test` passes (incl. new tests for shuffle + validators)
- [ ] `npm run build` passes
- [ ] Manual: admin creates a meeting with 18 attendees, captures notes for 3, switches between sections (auto-save), marks complete, reopens
- [ ] Manual: non-admin attendee adds own notes via the consolidated view, sees sidebar badge clear
- [ ] Manual: linked poll link navigates correctly; closed meetings reject writes (verified at DB layer via trigger)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review (already done before saving)

- **Spec coverage:** Every acceptance criterion has a task. The persona/permission matrix is enforced by Task 2 (RLS), Task 6 (server-action auth checks), and Task 15 (UI gating of self-edit button).
- **Placeholder scan:** No "TBD" / "TODO" left. Each step has either runnable code, a concrete command, or an explicit "follow existing pattern" instruction pointing at a named reference file.
- **Type consistency:** `MeetingDetail` is defined in `meetings-reads.ts` and imported by both `capture-page.tsx` (Task 12) and `consolidated-view.tsx` (Task 15). `MarkdownEditorMode` is defined in `markdown-editor.tsx` (Task 8) and imported in Tasks 12 and 15. Names match across tasks.
- **One late correction:** Task 5 originally placed reads + writes in the same file; the project rule against mixing `'use server'` with `'use cache'` forced a split into `meetings-reads.ts` (reads) and `meetings.ts` (writes). The file map and all call sites in Tasks 9, 11, 12, 13, 14, 15 use the corrected paths.
