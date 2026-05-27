-- =============================================================================
-- Seed votes on a poll — for previewing the populated UI.
--
-- Inserts a synthetic vote for every active member on the target poll. Safe
-- to re-run: clears prior votes on that poll first. Bypasses the cast_vote
-- RPC (which needs auth.uid()) by writing directly to the tables — only
-- works when executed from the Supabase SQL Editor (role: postgres).
--
-- HOW TO USE
--   1. Open Supabase Dashboard → SQL Editor → New query.
--   2. Tweak `target_poll_id` below: leave NULL to target the most recently
--      created poll, or paste a specific UUID.
--   3. Run. You should see a NOTICE with the poll id + the number of votes
--      written.
--   4. Reload /polls/<id> in the app — counts and (for public polls) voter
--      names + Other responses should now be populated.
--
-- HOW THE PICKS ARE GENERATED
--   * Single-select polls: each member picks one option round-robin so the
--     spread is balanced.
--   * Multi-select polls: each member picks 1..min(max_selections, options)
--     options at random.
--   * If allow_other = true: ~20% of voters submit an Other response with
--     sample text.
--
-- TO REMOVE THE SEEDED DATA
--   delete from public.poll_votes where poll_id = '<the-uuid>';
-- =============================================================================

do $$
declare
  -- ┌──────────────────────────────────────────────────────────────────────┐
  -- │ Edit this to target a specific poll, or leave NULL for "most recent".│
  -- └──────────────────────────────────────────────────────────────────────┘
  target_poll_id  uuid := null;

  v_poll          public.polls;
  v_member        record;
  v_option_count  int;
  v_pick_count    int;
  v_picks         uuid[];
  v_vote_id       uuid;
  v_other_text    text;
  v_index         int := 0;
  v_total_voters  int := 0;
  v_options       uuid[];

  sample_other text[] := array[
    'Need more context before I can decide',
    'Prefer a different option entirely',
    'Let''s discuss in the next meeting',
    'Lean towards yes, but conditionally',
    'Maybe — depends on the timeline',
    'Open to alternatives'
  ];
begin
  if target_poll_id is null then
    select id into target_poll_id
      from public.polls
     order by created_at desc
     limit 1;
  end if;

  if target_poll_id is null then
    raise notice 'No polls in the database — create one first via /admin/polls/new';
    return;
  end if;

  select * into v_poll from public.polls where id = target_poll_id;
  if v_poll.id is null then
    raise exception 'poll % not found', target_poll_id;
  end if;

  -- Clear any prior votes on this poll so the script is idempotent.
  delete from public.poll_votes where poll_id = target_poll_id;

  -- Collect option ids in display order.
  select array_agg(id order by position) into v_options
    from public.poll_options where poll_id = target_poll_id;
  v_option_count := coalesce(array_length(v_options, 1), 0);

  if v_option_count = 0 then
    raise exception 'poll % has no options', target_poll_id;
  end if;

  for v_member in
    select id, name
      from public.members
     where status = 'active'
     order by name
  loop
    v_index := v_index + 1;

    if v_poll.kind = 'single' then
      -- Round-robin pick to spread votes across options evenly.
      v_picks := array[ v_options[ ((v_index - 1) % v_option_count) + 1 ] ];
      v_pick_count := 1;
    else
      -- Multi-select: random subset, capped by max_selections (or all options).
      declare
        cap int := least(coalesce(v_poll.max_selections, v_option_count), v_option_count);
        want int := 1 + floor(random() * cap)::int;
      begin
        select array_agg(id) into v_picks
          from (
            select id from unnest(v_options) as u(id) order by random() limit want
          ) s;
        v_pick_count := coalesce(array_length(v_picks, 1), 0);
      end;
    end if;

    -- Optionally swap in an Other response for ~20% of voters.
    v_other_text := null;
    if v_poll.allow_other and random() < 0.20 then
      v_other_text := sample_other[1 + floor(random() * array_length(sample_other, 1))::int];
      if v_poll.kind = 'single' then
        -- Single-select + Other → drop the option pick, keep Other only.
        v_picks := array[]::uuid[];
        v_pick_count := 0;
      else
        -- Multi-select + Other → make sure total picks fit max_selections.
        if v_poll.max_selections is not null and v_pick_count + 1 > v_poll.max_selections then
          v_picks := v_picks[1 : v_poll.max_selections - 1];
          v_pick_count := array_length(v_picks, 1);
        end if;
      end if;
    end if;

    insert into public.poll_votes (poll_id, voter_id, other_text)
    values (target_poll_id, v_member.id, v_other_text)
    returning id into v_vote_id;

    if v_pick_count > 0 then
      insert into public.poll_vote_options (vote_id, option_id)
      select v_vote_id, unnest(v_picks);
    end if;

    v_total_voters := v_total_voters + 1;
  end loop;

  raise notice 'Seeded % votes on poll % (%)',
    v_total_voters, target_poll_id, v_poll.question;
end $$;
