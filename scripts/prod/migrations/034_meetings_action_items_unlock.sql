-- =============================================================================
-- 034 — Meetings: allow admins to edit action items on closed meetings.
--
-- The 027 lock trigger (`fn_meetings_lock_closed`) blocks ALL updates to a
-- closed meeting except a clean reopen. That also blocked the action-items
-- ("todo") list, which admins need to keep current after a meeting closes.
--
-- This migration widens the lock to permit ONE additional case: an update that
-- keeps the meeting closed and changes ONLY `action_items_md` (every other
-- column unchanged). WHO may do this is still enforced by RLS
-- (`meetings_update_admin`, admin-only for closed rows) and by the server
-- actions (`toggleActionItem` / `updateActionItems`, which re-check role). This
-- trigger only widens WHAT may change. Editing any other field still requires
-- reopening the meeting first.
-- =============================================================================

begin;

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
       and new.meeting_date = old.meeting_date
       and new.linked_poll_id is not distinct from old.linked_poll_id
    then
      return new;
    end if;

    -- allow editing the action-items list while the meeting stays closed;
    -- every other column must be unchanged
    if new.status = 'closed'
       and new.id            =  old.id
       and new.title         =  old.title
       and new.meeting_date  =  old.meeting_date
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

-- Trigger binding is unchanged (027 created trg_meetings_lock_closed on
-- public.meetings); CREATE OR REPLACE FUNCTION updates the body in place.

commit;

notify pgrst, 'reload schema';
