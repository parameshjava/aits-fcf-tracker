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
  add column if not exists meeting_tz text,
  add column if not exists meeting_ends_at timestamptz;

-- 2. Backfill existing rows: 7:00 PM IST on the stored date.
update public.meetings
set
  meeting_at = (meeting_date + time '19:00') at time zone 'Asia/Kolkata',
  meeting_ends_at = (meeting_date + time '19:00') at time zone 'Asia/Kolkata' + interval '1 hour',
  meeting_tz = 'Asia/Kolkata'
where meeting_at is null;

-- 3. Enforce NOT NULL now that every row has values.
alter table public.meetings
  alter column meeting_at set not null,
  alter column meeting_tz set not null,
  alter column meeting_ends_at set not null,
  add constraint meetings_ends_after_start check (meeting_ends_at > meeting_at);

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
