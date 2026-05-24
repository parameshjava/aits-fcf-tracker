-- =============================================================================
-- add-interest-free-months.sql
--
-- Adds `interest_waiver_months` to public.loans. Some loans (e.g. medical-
-- benefit assistance to a member) are granted with an interest waiver: the
-- principal must still be repaid, but interest doesn't start accruing until N
-- months after `start_date`. Default 0 = no waiver (current behaviour).
--
-- Math behaviour (see src/lib/loan-math.ts):
--   - Repayments made during the waiver window still reduce the principal
--     that interest will later accrue on.
--   - Once `start_date + interest_waiver_months` is past, the existing
--     piecewise accrual on the pending balance kicks in.
--
-- Re-runnable: `add column if not exists` is idempotent.
-- =============================================================================

alter table public.loans
  add column if not exists interest_waiver_months integer not null default 0
    check (interest_waiver_months >= 0);
