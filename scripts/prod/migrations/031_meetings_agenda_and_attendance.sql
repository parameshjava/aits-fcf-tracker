-- =============================================================================
-- 031 — Meetings: agenda + attendance.
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

-- CREATE OR REPLACE VIEW can only APPEND new columns to the end of the column
-- list — it cannot rename, reorder, or remove existing columns. The original
-- view (migration 029) ended with: …, attendee_count, captured_count. We keep
-- those 12 columns in their exact original positions and append agenda_md +
-- present_count after captured_count. captured_count's *expression* is
-- narrowed to "present with notes" — the column name and type stay identical,
-- so the replace is accepted.
create or replace view public.meetings_with_progress
with (security_invoker = true)
as
select
  m.id,
  m.title,
  m.meeting_date,
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

commit;

notify pgrst, 'reload schema';
