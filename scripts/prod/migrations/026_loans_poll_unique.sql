-- =============================================================================
-- 026 — One loan per poll.
--
-- Each approval poll authorises at most one loan, so the link is 1:1. We
-- enforce this with a UNIQUE index on `loans.poll_id`. The index is
-- partial (WHERE poll_id IS NOT NULL) so historical loans without a poll
-- remain unconstrained — Postgres UNIQUE already treats NULLs as
-- distinct, but the partial form makes intent explicit and keeps the
-- index slim.
--
-- The non-unique helper index from migration 025 is now redundant because
-- the unique index serves equality lookups too.
--
-- This migration assumes no duplicate `poll_id` values exist in
-- `public.loans` yet. If it fails with "could not create unique index",
-- resolve the duplicate links manually before re-running.
-- =============================================================================

begin;

create unique index if not exists loans_poll_id_unique
  on public.loans (poll_id)
  where poll_id is not null;

drop index if exists public.loans_poll_id_idx;

commit;

notify pgrst, 'reload schema';
