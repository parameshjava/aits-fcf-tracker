-- =============================================================================
-- 032 — Meetings: atomic reshuffle helper.
--
-- Reassigns positions 1..N to every attendee of a meeting in the order given
-- by p_member_order. The (meeting_id, position) unique constraint is not
-- deferrable, so we use a two-pass update: negate every existing position
-- (still unique, so no constraint violation), then assign new positive
-- positions from the input ordering. Wrapped in a single transaction so a
-- failure mid-way leaves the table untouched.
-- =============================================================================

begin;

create or replace function public.reshuffle_meeting_attendees(
  p_meeting_id    uuid,
  p_member_order  uuid[]
) returns void
language plpgsql
security invoker
as $$
declare
  v_attendee_count int;
begin
  -- Caller must pass exactly the set of attendees — anything else risks
  -- leaving stragglers with negative positions after pass 2.
  select count(*) into v_attendee_count
    from public.meeting_attendees
   where meeting_id = p_meeting_id;

  if v_attendee_count <> coalesce(array_length(p_member_order, 1), 0) then
    raise exception 'p_member_order must contain every attendee (% expected, % given)',
      v_attendee_count, coalesce(array_length(p_member_order, 1), 0);
  end if;

  -- Pass 1: move all positions to negative space. -1, -2, … stay mutually
  -- unique, so the (meeting_id, position) constraint is satisfied.
  update public.meeting_attendees
     set position = -position
   where meeting_id = p_meeting_id;

  -- Pass 2: assign new positions from the input ordering.
  update public.meeting_attendees ma
     set position = (t.ord)::int
    from unnest(p_member_order) with ordinality as t(mid, ord)
   where ma.meeting_id = p_meeting_id
     and ma.member_id  = t.mid;
end
$$;

-- Expose to the authenticated role; the server action gates on admin role
-- before calling, so RLS / GRANT keeps the function callable by app code.
grant execute on function public.reshuffle_meeting_attendees(uuid, uuid[]) to authenticated;

commit;

notify pgrst, 'reload schema';
