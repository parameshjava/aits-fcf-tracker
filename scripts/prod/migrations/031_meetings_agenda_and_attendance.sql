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
