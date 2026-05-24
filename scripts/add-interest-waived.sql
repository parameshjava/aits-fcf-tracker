-- =============================================================================
-- add-interest-waived.sql
--
-- Adds `interest_waived` to public.loans. Records how much accrued-but-unpaid
-- interest was forgiven at loan closure. Parallels `bad_debt` (the principal
-- portion forgiven). Distinct from `historical_interest_paid` so reports can
-- always tell what was actually paid vs. what was written off.
--
-- Closure rules enforced in the closeLoan server action:
--   - Status 'paid'      → only allowed when pending principal AND pending
--                          interest are both zero.
--   - Status 'write_off' → admin must explicitly enter the principal write-off
--                          (`bad_debt`) and interest waived (`interest_waived`)
--                          to settle the loan. Both are recorded.
--
-- Re-runnable: `add column if not exists` is idempotent.
-- =============================================================================

alter table public.loans
  add column if not exists interest_waived numeric(12, 2) not null default 0
    check (interest_waived >= 0);
