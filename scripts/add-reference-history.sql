-- =============================================================================
-- add-reference-history.sql
--
-- Adds public.reference_history — time-windowed values for each row in
-- public.reference. Used by computeEligibility() to resolve the rule that
-- was in effect for any past year (corpus_threshold + donation_eligibility_pct
-- in particular).
--
-- Backwards-compatible: public.reference itself is untouched. The current
-- value still lives there (denormalised hot read). The history table is
-- the timeline that admins manage via /admin/reference/[key].
--
-- This script is the standalone migration for already-deployed dev DBs. For
-- fresh installs, the same DDL + seed lives in scripts/prod/01-schema.sql.
-- =============================================================================

begin;

create table if not exists public.reference_history (
  id              uuid primary key default gen_random_uuid(),
  key             text not null references public.reference(key) on delete cascade,
  value           numeric not null,
  effective_from  date not null,
  effective_to    date,
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  constraint reference_history_window_chk
    check (effective_to is null or effective_to >= effective_from),
  unique (key, effective_from)
);

create index if not exists reference_history_key_from_idx
  on public.reference_history (key, effective_from);

alter table public.reference_history disable row level security;

-- Seed: mirror every current reference row into a history row backdated to
-- 2000-01-01 so per-year lookups always resolve to today's value as a
-- baseline. effective_to = NULL ⇒ currently active.
insert into public.reference_history (key, value, effective_from, effective_to, notes)
select r.key, r.value, '2000-01-01'::date, null, 'initial baseline'
  from public.reference r
 where not exists (
   select 1 from public.reference_history h where h.key = r.key
 );

commit;

notify pgrst, 'reload schema';
