-- =============================================================================
-- 036 — Meetings: add an end time (start + end, like Google/Outlook).
--
-- Builds on 035 (which replaced meeting_date with meeting_at + meeting_tz).
-- Adds meeting_ends_at (absolute instant, same zone as meeting_at) and rebuilds
-- the view + close-lock trigger to carry it.
--
-- IDEMPOTENT: safe to re-run. The column add, backfill, NOT NULL, and the CHECK
-- constraint are all guarded; the view and function use drop/replace. It reads
-- meeting_at (NOT the dropped meeting_date), so it converges from the post-035
-- schema regardless of how many times it runs.
--
-- Dependent objects rebuilt here (current defs from 035):
--   - view  meetings_with_progress     — gains meeting_ends_at
--   - func  fn_meetings_lock_closed      — locks meeting_ends_at on closed rows
-- =============================================================================

begin;

-- 1. Add the end-time column (nullable while we backfill).
alter table public.meetings
  add column if not exists meeting_ends_at timestamptz;

-- 2. Backfill: end = start + 1 hour (only rows not yet set).
update public.meetings
set meeting_ends_at = meeting_at + interval '1 hour'
where meeting_ends_at is null;

-- 3. Enforce NOT NULL (idempotent — no-op if already set).
alter table public.meetings
  alter column meeting_ends_at set not null;

-- 4. Add the end-after-start CHECK, guarded so re-runs don't error.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'meetings_ends_after_start'
  ) then
    alter table public.meetings
      add constraint meetings_ends_after_start check (meeting_ends_at > meeting_at);
  end if;
end $$;

-- 5. Rebuild the view to expose meeting_ends_at (drop + create: adding a column
--    to the middle of the select list is not allowed by create-or-replace).
drop view if exists public.meetings_with_progress;

create view public.meetings_with_progress
with (security_invoker = true)
as
select
  m.id,
  m.title,
  m.meeting_at,
  m.meeting_tz,
  m.meeting_ends_at,
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

-- 6. Recreate the close-lock trigger so meeting_ends_at is also frozen on a
--    closed meeting (both guard branches). Mirrors 035's function, +end time.
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
       and new.meeting_ends_at = old.meeting_ends_at
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
       and new.meeting_ends_at =  old.meeting_ends_at
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
