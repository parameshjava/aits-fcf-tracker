-- 018_loan_type.sql
--
-- Loans are now categorised as either `personal` or `medical`:
--   * personal — standard loan, no interest waiver allowed
--   * medical  — admin may grant an interest waiver of 0..12 months
--
-- This migration:
--   1. Adds the `loan_type` column with a default of 'personal'.
--   2. Backfills existing rows: anything with interest_waiver_months > 0 is
--      reclassified as `medical`; everything else stays `personal`.
--   3. Adds a CHECK constraint enforcing the type→waiver rule.

begin;

alter table public.loans
  add column if not exists loan_type text not null default 'personal'
  check (loan_type in ('personal', 'medical'));

update public.loans
   set loan_type = 'medical'
 where interest_waiver_months is not null
   and interest_waiver_months > 0
   and loan_type <> 'medical';

-- Drop a prior version of the constraint if a previous attempt left one behind,
-- then re-add. `not valid` would let invalid rows linger; we want strict checks.
alter table public.loans
  drop constraint if exists loans_type_waiver_check;

alter table public.loans
  add constraint loans_type_waiver_check
  check (
    (loan_type = 'personal' and coalesce(interest_waiver_months, 0) = 0)
    or
    (loan_type = 'medical'  and coalesce(interest_waiver_months, 0) between 0 and 12)
  );

commit;

notify pgrst, 'reload schema';
