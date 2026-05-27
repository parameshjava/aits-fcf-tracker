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

create policy "meetings_insert_admin" on public.meetings
  for insert to authenticated
  with check (public.is_admin());

create policy "meetings_delete_admin" on public.meetings
  for delete to authenticated
  using (public.is_admin());

create policy "meetings_update_admin" on public.meetings
  for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- Action-items toggle is allowed for any authenticated user while the meeting
-- is open. RLS allows the row update; the server action is the single point
-- that restricts the change to action_items_md only.
create policy "meetings_update_action_items_open" on public.meetings
  for update to authenticated
  using      (status = 'open')
  with check (status = 'open');

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
