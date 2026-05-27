-- =============================================================================
-- 025 — Link loans to the approval poll that authorised them.
--
-- Every new loan is preceded by a poll (members vote to authorise the
-- disbursement). This column captures that audit trail. Optional —
-- historical loans pre-date the polls feature, and a future admin may still
-- create loans without a poll for one-off cases.
--
-- ON DELETE SET NULL: if a poll is deleted, the loan record survives but
-- the link is dropped. We don't cascade — losing a loan because a poll was
-- cleaned up would be a far worse outcome.
--
-- Re-runnable.
-- =============================================================================

begin;

alter table public.loans
  add column if not exists poll_id uuid
    references public.polls(id) on delete set null;

create index if not exists loans_poll_id_idx on public.loans (poll_id);

commit;

notify pgrst, 'reload schema';
