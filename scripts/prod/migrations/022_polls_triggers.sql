-- =============================================================================
-- 022 — Polls feature: triggers, helper functions, RPCs.
--
-- Helpers:
--   current_member_id()           — maps auth.uid() to members.id via email.
--   poll_is_open(uuid)            — used by RLS to gate inserts/updates.
--   poll_is_visible_to_voters(uuid) — used by RLS to expose results post-close.
--
-- RPCs (SECURITY DEFINER, callable by `authenticated`):
--   create_poll(...)              — admin only; inserts poll + options atomically.
--   cast_vote(poll_id, options[], other_text) — voter only; upserts a vote and
--                                   replaces its option-links in one txn.
--   close_poll(poll_id)           — admin only; flips status to 'closed'.
--
-- Triggers:
--   trg_poll_votes_updated_at     — keeps poll_votes.updated_at fresh.
--   trg_check_poll_vote_has_selection — deferred constraint trigger that
--                                   enforces "≥1 option link OR non-empty
--                                   other_text" at txn commit. Defense-in-depth
--                                   on top of the action-layer validation.
--
-- All functions pin `search_path = public` per AGENTS.md.
-- Re-runnable.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- current_member_id() — auth.uid() → members.id by email.
-- -----------------------------------------------------------------------------
create or replace function public.current_member_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select m.id
    from public.members m
    join auth.users u on lower(u.email) = lower(m.email)
   where u.id = auth.uid()
   limit 1;
$$;

grant execute on function public.current_member_id() to authenticated;

-- -----------------------------------------------------------------------------
-- poll_is_open(uuid) — true when poll exists, status='open', and not past
-- the deadline.
-- -----------------------------------------------------------------------------
create or replace function public.poll_is_open(p_poll_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select status = 'open' and closes_at > now() from public.polls where id = p_poll_id),
    false
  );
$$;

grant execute on function public.poll_is_open(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- poll_is_visible_to_voters(uuid) — true when poll is effectively closed
-- AND visibility = 'public' (i.e. members are allowed to see individual votes).
-- -----------------------------------------------------------------------------
create or replace function public.poll_is_visible_to_voters(p_poll_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select (status = 'closed' or closes_at < now()) and visibility = 'public'
       from public.polls where id = p_poll_id),
    false
  );
$$;

grant execute on function public.poll_is_visible_to_voters(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- updated_at bumper on poll_votes.
-- -----------------------------------------------------------------------------
create or replace function public.set_poll_votes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_poll_votes_updated_at on public.poll_votes;
create trigger trg_poll_votes_updated_at
  before update on public.poll_votes
  for each row execute function public.set_poll_votes_updated_at();

-- -----------------------------------------------------------------------------
-- Deferred constraint trigger: every poll_votes row must reference at least
-- one option OR carry a non-empty other_text. Fires at txn commit so the
-- cast_vote RPC (which inserts the parent first, then the option links) is
-- valid.
-- -----------------------------------------------------------------------------
create or replace function public.check_poll_vote_has_selection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  link_count int;
  has_other  boolean;
begin
  -- If the row was deleted in the same transaction, nothing to check.
  if not exists (select 1 from public.poll_votes where id = new.id) then
    return new;
  end if;
  select count(*) into link_count from public.poll_vote_options where vote_id = new.id;
  select other_text is not null and btrim(other_text) <> ''
    into has_other
    from public.poll_votes where id = new.id;
  if link_count = 0 and not coalesce(has_other, false) then
    raise exception 'poll_votes row % has no option links and no other_text', new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_poll_vote_has_selection on public.poll_votes;
create constraint trigger trg_check_poll_vote_has_selection
  after insert or update on public.poll_votes
  deferrable initially deferred
  for each row execute function public.check_poll_vote_has_selection();

-- -----------------------------------------------------------------------------
-- create_poll RPC.
-- -----------------------------------------------------------------------------
create or replace function public.create_poll(
  p_question        text,
  p_description     text,
  p_kind            text,
  p_max_selections  int,
  p_allow_other     boolean,
  p_visibility      text,
  p_closes_at       timestamptz,
  p_option_labels   text[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poll_id    uuid;
  v_member_id  uuid;
  v_label      text;
  v_position   int := 1;
  v_count      int;
begin
  if not public.is_admin() then
    raise exception 'admin role required';
  end if;

  v_member_id := public.current_member_id();
  if v_member_id is null then
    raise exception 'no member row found for the current user';
  end if;

  if p_kind not in ('single','multi') then
    raise exception 'kind must be single or multi';
  end if;

  if p_visibility not in ('sensitive','public') then
    raise exception 'visibility must be sensitive or public';
  end if;

  if p_closes_at is null or p_closes_at <= now() then
    raise exception 'closes_at must be in the future';
  end if;

  v_count := coalesce(array_length(p_option_labels, 1), 0);
  if v_count < 2 then
    raise exception 'a poll needs at least 2 options';
  end if;
  if v_count > 20 then
    raise exception 'a poll cannot have more than 20 options';
  end if;

  if p_kind = 'single' and p_max_selections is not null then
    raise exception 'max_selections is only valid for multi-select polls';
  end if;
  if p_kind = 'multi' and p_max_selections is not null and p_max_selections > v_count then
    raise exception 'max_selections cannot exceed option count';
  end if;

  insert into public.polls (
    question, description, kind, max_selections, allow_other,
    visibility, status, created_by, closes_at
  ) values (
    btrim(p_question),
    nullif(btrim(coalesce(p_description, '')), ''),
    p_kind,
    p_max_selections,
    coalesce(p_allow_other, false),
    p_visibility,
    'open',
    v_member_id,
    p_closes_at
  )
  returning id into v_poll_id;

  foreach v_label in array p_option_labels loop
    if btrim(coalesce(v_label, '')) = '' then
      raise exception 'option labels cannot be empty';
    end if;
    insert into public.poll_options (poll_id, label, position)
    values (v_poll_id, btrim(v_label), v_position);
    v_position := v_position + 1;
  end loop;

  return v_poll_id;
end;
$$;

grant execute on function public.create_poll(text, text, text, int, boolean, text, timestamptz, text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- cast_vote RPC. Upserts a poll_votes row and replaces its option links.
-- -----------------------------------------------------------------------------
create or replace function public.cast_vote(
  p_poll_id    uuid,
  p_option_ids uuid[],
  p_other_text text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id      uuid;
  v_poll           public.polls;
  v_vote_id        uuid;
  v_option_count   int;
  v_invalid_count  int;
  v_other_clean    text;
  v_total_picks    int;
begin
  v_member_id := public.current_member_id();
  if v_member_id is null then
    raise exception 'no member row found for the current user';
  end if;

  select * into v_poll from public.polls where id = p_poll_id;
  if v_poll.id is null then
    raise exception 'poll not found';
  end if;

  if v_poll.status = 'closed' or v_poll.closes_at < now() then
    raise exception 'this poll has closed';
  end if;

  v_other_clean := nullif(btrim(coalesce(p_other_text, '')), '');
  if v_other_clean is not null and not v_poll.allow_other then
    raise exception 'this poll does not allow Other responses';
  end if;
  if v_other_clean is not null and char_length(v_other_clean) > 280 then
    raise exception 'Other responses are limited to 280 characters';
  end if;

  v_option_count := coalesce(array_length(p_option_ids, 1), 0);
  v_total_picks := v_option_count + (case when v_other_clean is null then 0 else 1 end);
  if v_total_picks = 0 then
    raise exception 'you must pick at least one option';
  end if;
  if v_poll.kind = 'single' and v_total_picks > 1 then
    raise exception 'this poll is single-select';
  end if;
  if v_poll.kind = 'multi' and v_poll.max_selections is not null
     and v_total_picks > v_poll.max_selections then
    raise exception 'you can pick up to % options', v_poll.max_selections;
  end if;

  if v_option_count > 0 then
    select count(*) into v_invalid_count
      from unnest(p_option_ids) as opt(id)
      left join public.poll_options po on po.id = opt.id and po.poll_id = p_poll_id
     where po.id is null;
    if v_invalid_count > 0 then
      raise exception 'one or more options do not belong to this poll';
    end if;
  end if;

  insert into public.poll_votes (poll_id, voter_id, other_text)
  values (p_poll_id, v_member_id, v_other_clean)
  on conflict (poll_id, voter_id)
    do update set other_text = excluded.other_text, updated_at = now()
  returning id into v_vote_id;

  delete from public.poll_vote_options where vote_id = v_vote_id;
  if v_option_count > 0 then
    insert into public.poll_vote_options (vote_id, option_id)
    select v_vote_id, opt.id from unnest(p_option_ids) as opt(id);
  end if;
end;
$$;

grant execute on function public.cast_vote(uuid, uuid[], text) to authenticated;

-- -----------------------------------------------------------------------------
-- close_poll RPC.
-- -----------------------------------------------------------------------------
create or replace function public.close_poll(p_poll_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_member uuid;
begin
  if not public.is_admin() then
    raise exception 'admin role required';
  end if;
  v_member := public.current_member_id();
  update public.polls
     set status = 'closed', closed_at = now(), closed_by = v_member
   where id = p_poll_id
     and status = 'open';
end;
$$;

grant execute on function public.close_poll(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
