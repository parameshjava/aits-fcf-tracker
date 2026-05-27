-- =============================================================================
-- 023 — Polls feature: read-side views.
--
-- These views are created `WITH (security_invoker = off)` so they run with
-- the privileges of the view OWNER (postgres / superuser) and bypass RLS on
-- the underlying poll_votes table. This is intentional — every authenticated
-- user should be able to read the AGGREGATE counts (e.g. "12 voted so far",
-- "Option B: 7 votes") even on sensitive polls, while individual rows in
-- poll_votes stay gated by RLS (024).
--
-- Re-runnable.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- polls_effective — polls + computed `is_closed` flag.
-- Used by RLS-aware queries to share one definition of "closed" with the UI.
-- -----------------------------------------------------------------------------
create or replace view public.polls_effective
  with (security_invoker = off)
as
select
  p.*,
  (p.status = 'closed' or p.closes_at < now()) as is_closed
from public.polls p;

-- -----------------------------------------------------------------------------
-- poll_voter_counts — per-poll voter count. Drives the open-poll "X voted
-- so far" indicator and the sidebar badge (subtracted against the user's
-- voted-poll set).
-- -----------------------------------------------------------------------------
create or replace view public.poll_voter_counts
  with (security_invoker = off)
as
select
  pv.poll_id,
  count(distinct pv.voter_id)::int as voter_count
from public.poll_votes pv
group by pv.poll_id;

-- -----------------------------------------------------------------------------
-- poll_option_counts — per-option vote tally. Used by the closed-poll
-- results page (counts shown to everyone) and the admin live view.
-- -----------------------------------------------------------------------------
create or replace view public.poll_option_counts
  with (security_invoker = off)
as
select
  po.poll_id,
  po.id        as option_id,
  po.label     as option_label,
  po.position  as position,
  coalesce(c.vote_count, 0)::int as vote_count
from public.poll_options po
left join (
  select pvo.option_id, count(*)::int as vote_count
    from public.poll_vote_options pvo
   group by pvo.option_id
) c on c.option_id = po.id;

-- -----------------------------------------------------------------------------
-- poll_other_count — per-poll count of voters who submitted an Other
-- response. Used by the admin live view + closed results.
-- -----------------------------------------------------------------------------
create or replace view public.poll_other_count
  with (security_invoker = off)
as
select
  pv.poll_id,
  count(*)::int as other_count
from public.poll_votes pv
where pv.other_text is not null
  and btrim(pv.other_text) <> ''
group by pv.poll_id;

grant select on public.polls_effective    to authenticated;
grant select on public.poll_voter_counts  to authenticated;
grant select on public.poll_option_counts to authenticated;
grant select on public.poll_other_count   to authenticated;

commit;

notify pgrst, 'reload schema';
