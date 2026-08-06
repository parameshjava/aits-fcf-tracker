-- =============================================================================
-- FCF Tracker — one-off fix: drop the July 2026 accrual on EMI loans
--
-- Problem
--   A loan converted to the EMI model is charged interest twice for July 2026:
--     * public.loan_interest_accruals — the EOM cron wrote a period_end
--       2026-07-31 row while the loan was still on the `accrual` model.
--     * public.loan_emi_schedule      — installment #1 is due 2026-08-10, and
--       under the 041 model an installment due on the 10th carries the
--       interest for the PREVIOUS month, i.e. July.
--   Only one should exist. The EMI schedule wins, so the 2026-07-31 accrual
--   rows go.
--
-- Scope — deliberately narrow
--   EMI loans only (`loans.repayment_model = 'emi'`), and ONLY the single
--   period_end = 2026-07-31 row. Every other accrual (including any later
--   month, should one exist) is left untouched — per spec §10 the member keeps
--   paying legacy accrued interest month by month via payLoanInterest.
--
-- Safety
--   * Rows with any settlement (paid_amount > 0, or a loan_interest_payments
--     junction row) are excluded. loan_interest_payments.accrual_id is
--     ON DELETE RESTRICT, so a paid row would abort the statement anyway —
--     the guard makes the intent explicit instead of relying on the FK error.
--   * Run step 1 first and eyeball the rows. Step 2 is wrapped in an explicit
--     transaction: check the reported row count, then COMMIT (or ROLLBACK).
--   * Re-running is harmless — the second pass matches nothing.
--
-- Run as the Supabase SQL editor's default role (owner; bypasses RLS).
-- The going-forward cron is already correct: fn_compute_loan_interest_for
-- skips repayment_model = 'emi' (migration 039, patch E). This only cleans up
-- rows written BEFORE each loan was converted.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Step 1 — PREVIEW. Nothing is modified. Confirm this is the expected set.
-- -----------------------------------------------------------------------------
select
  l.loan_number,
  m.name          as member,
  a.period_end,
  a.amount_due,
  a.paid_amount,
  a.status,
  -- The EMI installment that already covers July (due 10 Aug 2026).
  s.due_date      as covered_by_emi_due,
  s.interest_due  as emi_interest_component
from public.loan_interest_accruals a
join public.loans l on l.id = a.loan_id
left join public.members m on m.id = l.member_id
left join public.loan_emi_schedule s
       on s.loan_id = a.loan_id
      and s.due_date = date '2026-08-10'
where l.repayment_model = 'emi'
  and a.period_end = date '2026-07-31'
  and a.paid_amount = 0
  and not exists (
    select 1 from public.loan_interest_payments p where p.accrual_id = a.id
  )
order by l.loan_number;


-- -----------------------------------------------------------------------------
-- Step 2 — DELETE. Review the row count, then COMMIT.
-- -----------------------------------------------------------------------------
begin;

delete from public.loan_interest_accruals a
using public.loans l
where l.id = a.loan_id
  and l.repayment_model = 'emi'
  and a.period_end = date '2026-07-31'
  and a.paid_amount = 0
  and not exists (
    select 1 from public.loan_interest_payments p where p.accrual_id = a.id
  );

-- Expect exactly one row per converted EMI loan.
-- If the count looks wrong: ROLLBACK;
commit;


-- -----------------------------------------------------------------------------
-- Alternative to step 2 — WAIVE instead of DELETE.
--
-- Keeps the row for audit (the loan-detail accrual timeline still shows July)
-- while zeroing it out of loans_balances.pending_interest. Mirrors what
-- fn_waive_accruals_on_loan_close does at closure. Use this INSTEAD OF step 2,
-- not in addition to it.
-- -----------------------------------------------------------------------------
-- begin;
-- update public.loan_interest_accruals a
-- set status        = 'waived',
--     amount_due    = 0,
--     waiver_reason = 'emi_conversion',
--     recomputed_at = now()
-- from public.loans l
-- where l.id = a.loan_id
--   and l.repayment_model = 'emi'
--   and a.period_end = date '2026-07-31'
--   and a.status = 'pending'
--   and a.paid_amount = 0;
-- commit;


-- -----------------------------------------------------------------------------
-- Step 3 — VERIFY. Should return zero rows.
-- -----------------------------------------------------------------------------
select l.loan_number, a.period_end, a.amount_due, a.status
from public.loan_interest_accruals a
join public.loans l on l.id = a.loan_id
where l.repayment_model = 'emi'
  and a.period_end = date '2026-07-31'
  and a.status <> 'waived'
order by l.loan_number;
