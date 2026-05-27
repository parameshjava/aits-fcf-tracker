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
  m.action_items_md,
  m.created_by,
  m.created_at,
  m.closed_at,
  m.closed_by,
  coalesce(a.attendee_count, 0)  as attendee_count,
  coalesce(a.captured_count, 0)  as captured_count
from public.meetings m
left join lateral (
  select
    count(*)::int                                              as attendee_count,
    (count(*) filter (where ma.notes_md is not null))::int     as captured_count
  from public.meeting_attendees ma
  where ma.meeting_id = m.id
) a on true;

commit;

notify pgrst, 'reload schema';
