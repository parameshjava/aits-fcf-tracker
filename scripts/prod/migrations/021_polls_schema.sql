-- =============================================================================
-- 021 — Polls feature (schema only).
--
-- WhatsApp-style polls: admin-created single- or multi-select with optional
-- "Other" free-text. Voters can change their vote until the poll closes.
-- Results visibility (sensitive vs public) is set once at create time.
--
-- Sister migrations:
--   022 — triggers + helper functions (current_member_id, poll_is_open, RPCs)
--   023 — views (poll_voter_counts, poll_option_counts)
--   024 — RLS policies
--
-- Re-runnable: every statement guarded with `if not exists` / `if not exists`.
-- =============================================================================

begin;

create table if not exists public.polls (
  id              uuid primary key default gen_random_uuid(),
  question        text not null check (char_length(btrim(question)) between 3 and 500),
  description     text,
  kind            text not null check (kind in ('single','multi')),
  max_selections  int,
  allow_other     boolean not null default false,
  visibility      text not null check (visibility in ('sensitive','public')),
  status          text not null default 'open' check (status in ('open','closed')),
  created_by      uuid not null references public.members(id),
  created_at      timestamptz not null default now(),
  closes_at       timestamptz not null,
  closed_at       timestamptz,
  closed_by       uuid references public.members(id),
  check (
    (kind = 'multi'  and (max_selections is null or max_selections >= 1))
    or
    (kind = 'single' and max_selections is null)
  ),
  check (closes_at > created_at)
);

create index if not exists polls_status_closes_at_idx
  on public.polls (status, closes_at);

create index if not exists polls_created_at_idx
  on public.polls (created_at desc);

create table if not exists public.poll_options (
  id        uuid primary key default gen_random_uuid(),
  poll_id   uuid not null references public.polls(id) on delete cascade,
  label     text not null check (char_length(btrim(label)) between 1 and 200),
  position  int  not null check (position >= 1),
  unique (poll_id, position)
);

create index if not exists poll_options_poll_idx on public.poll_options (poll_id);

create table if not exists public.poll_votes (
  id          uuid primary key default gen_random_uuid(),
  poll_id     uuid not null references public.polls(id) on delete cascade,
  voter_id    uuid not null references public.members(id),
  other_text  text check (other_text is null or (char_length(btrim(other_text)) between 1 and 280)),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (poll_id, voter_id)
);

create index if not exists poll_votes_poll_idx  on public.poll_votes (poll_id);
create index if not exists poll_votes_voter_idx on public.poll_votes (voter_id);

create table if not exists public.poll_vote_options (
  vote_id    uuid not null references public.poll_votes(id) on delete cascade,
  option_id  uuid not null references public.poll_options(id) on delete cascade,
  primary key (vote_id, option_id)
);

create index if not exists poll_vote_options_option_idx
  on public.poll_vote_options (option_id);

commit;

notify pgrst, 'reload schema';
