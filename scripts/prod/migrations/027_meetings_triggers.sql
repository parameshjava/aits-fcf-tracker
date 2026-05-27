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
