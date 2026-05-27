-- =============================================================================
-- 024 — Polls feature: row-level security policies.
--
-- Shape (matches the design spec):
--
--   polls / poll_options:
--     SELECT  — every authenticated user
--     WRITE   — admin only (is_admin())
--
--   poll_votes / poll_vote_options:
--     SELECT  — own row OR admin OR (poll closed AND visibility='public')
--     INSERT/UPDATE/DELETE — voter == current_member_id() AND poll_is_open()
--
-- The RPCs (create_poll, cast_vote, close_poll) in 022 run SECURITY DEFINER
-- so they bypass RLS, but they include their own admin / voter checks. The
-- table-level policies below are the safety net for any direct query that
-- somehow reaches the table from an `authenticated` session.
--
-- Re-runnable: drop policies first, then recreate.
-- =============================================================================

begin;

-- Drop existing policies on the polls tables so we always start clean.
do $$
declare r record;
begin
  for r in
    select policyname, tablename
      from pg_policies
     where schemaname = 'public'
       and tablename in ('polls','poll_options','poll_votes','poll_vote_options')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.polls             enable row level security;
alter table public.poll_options      enable row level security;
alter table public.poll_votes        enable row level security;
alter table public.poll_vote_options enable row level security;

-- -----------------------------------------------------------------------------
-- polls
-- -----------------------------------------------------------------------------
create policy "polls_select" on public.polls
  for select to authenticated using (true);

create policy "polls_write_admin" on public.polls
  for all to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- poll_options
-- -----------------------------------------------------------------------------
create policy "poll_options_select" on public.poll_options
  for select to authenticated using (true);

create policy "poll_options_write_admin" on public.poll_options
  for all to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- poll_votes
-- -----------------------------------------------------------------------------
create policy "poll_votes_select_own_or_visible" on public.poll_votes
  for select to authenticated
  using (
    voter_id = public.current_member_id()
    or public.is_admin()
    or public.poll_is_visible_to_voters(poll_id)
  );

create policy "poll_votes_insert_self" on public.poll_votes
  for insert to authenticated
  with check (
    voter_id = public.current_member_id()
    and public.poll_is_open(poll_id)
  );

create policy "poll_votes_update_self" on public.poll_votes
  for update to authenticated
  using (
    voter_id = public.current_member_id()
    and public.poll_is_open(poll_id)
  )
  with check (
    voter_id = public.current_member_id()
    and public.poll_is_open(poll_id)
  );

create policy "poll_votes_delete_self" on public.poll_votes
  for delete to authenticated
  using (
    voter_id = public.current_member_id()
    and public.poll_is_open(poll_id)
  );

-- -----------------------------------------------------------------------------
-- poll_vote_options — gated by the parent poll_votes row's visibility.
-- -----------------------------------------------------------------------------
create policy "poll_vote_options_select" on public.poll_vote_options
  for select to authenticated
  using (
    exists (
      select 1 from public.poll_votes pv
       where pv.id = poll_vote_options.vote_id
         and (
           pv.voter_id = public.current_member_id()
           or public.is_admin()
           or public.poll_is_visible_to_voters(pv.poll_id)
         )
    )
  );

create policy "poll_vote_options_write_self" on public.poll_vote_options
  for all to authenticated
  using (
    exists (
      select 1 from public.poll_votes pv
       where pv.id = poll_vote_options.vote_id
         and pv.voter_id = public.current_member_id()
         and public.poll_is_open(pv.poll_id)
    )
  )
  with check (
    exists (
      select 1 from public.poll_votes pv
       where pv.id = poll_vote_options.vote_id
         and pv.voter_id = public.current_member_id()
         and public.poll_is_open(pv.poll_id)
    )
  );

commit;

notify pgrst, 'reload schema';
