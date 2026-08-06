-- =============================================================================
-- FCF Tracker — repair: EMI schedules that were regenerated from the loan's
-- original start date instead of the EMI cutover.
--
-- WHAT WENT WRONG
--   A loan converted from the accrual model to EMI is scheduled from
--   `emi_cutover_date` on its OUTSTANDING principal. Nothing persisted that
--   anchor, so a later `updateLoan` (any edit — even notes) or "Recalculate"
--   regenerated it from `loans.start_date` and `loans.principal_amount`.
--   Since migration 044 the generator upserts in place with
--   `due_date = excluded.due_date`, so those calls rewrote every unsettled
--   row's due date to a back-dated one and re-amortized the FULL original
--   principal, ignoring repayments already made.
--
--   Symptom seen in production: installment #1 due 2025-10-10, pending
--   principal back at ₹1,00,000, and late fees charged on months that never
--   should have existed. Those late fees created real `penalty` transactions.
--
--   Migration 051 stops this recurring (the cutover floor now lives inside
--   fn_generate_emi_schedule). This script cleans up rows written before it.
--
-- WHAT THIS SCRIPT DOES, per affected loan
--   1. Reverses every late fee charged on a back-dated installment — a
--      balancing negative `penalty` transaction, mirroring the waiver flow in
--      payEmi. The original charge is KEPT so the audit trail stays intact and
--      the pair nets to zero.
--   2. Deletes the back-dated unsettled installments.
--   3. Rebuilds the schedule from the cutover on the CURRENT outstanding
--      principal, via fn_generate_emi_schedule (051 or later).
--
-- SAFETY
--   * Only `scheduled` / `overdue` rows are touched. Anything settled
--     (paid / partially_paid / waived) is left exactly as it is, and step 3
--     aborts if a settled row exists — a part-repaid schedule must be reshaped
--     through Prepay, not rebuilt underneath the payments.
--   * Every step is a transaction you COMMIT or ROLLBACK yourself.
--   * Re-running is harmless: the second pass finds nothing to fix.
--
-- Run migration 051 FIRST. Then run this as the Supabase SQL editor's default
-- role (owner; bypasses RLS).
-- =============================================================================


-- ----------------------------------------------------------------------------
-- STEP 1 — Diagnose. Read-only; run this first and eyeball the output.
--
-- Lists every EMI loan holding unsettled installments dated before the cutover
-- month's first due date (the cutover month + 1, on the 10th). Those are the
-- back-dated rows.
-- ----------------------------------------------------------------------------
with cutover as (
  select to_date(trunc(value)::bigint::text, 'YYYYMMDD') as d
    from public.reference where key = 'emi_cutover_date'
),
first_legit_due as (
  -- The earliest due date a correctly-anchored schedule can have: the 10th of
  -- the month after the cutover month.
  select (date_trunc('month', d) + interval '1 month' + interval '9 days')::date as d
    from cutover
)
select
  l.loan_number,
  m.name                                   as member_name,
  l.start_date,
  (select d from cutover)                  as cutover_date,
  l.principal_amount                       as original_principal,
  lb.pending_principal                     as outstanding_now,
  count(*) filter (where s.due_date < (select d from first_legit_due))
                                           as backdated_rows,
  min(s.due_date)                          as earliest_due,
  count(*) filter (where s.status in ('paid','partially_paid','waived'))
                                           as settled_rows,
  coalesce(sum(s.late_fee_charged) filter (
    where s.due_date < (select d from first_legit_due)
      and not coalesce(s.late_fee_waived, false)
  ), 0)                                    as bogus_late_fees
from public.loans l
join public.loan_emi_schedule s on s.loan_id = l.id
left join public.members m       on m.id = l.member_id
left join public.loans_balances lb on lb.loan_id = l.id
where l.repayment_model = 'emi'
group by l.id, l.loan_number, m.name, l.start_date, l.principal_amount, lb.pending_principal
having count(*) filter (
         where s.due_date < (select d from first_legit_due)
           and s.status in ('scheduled','overdue')
       ) > 0
order by l.loan_number;


-- ----------------------------------------------------------------------------
-- STEP 2 — Repair one loan. Set the loan number ONCE below, run the whole
-- block, check the NOTICE, then COMMIT (or ROLLBACK).
--
-- Do the loans one at a time so each result can be checked against the loan
-- page before committing.
-- ----------------------------------------------------------------------------
begin;

-- >>> THE ONLY LINE TO EDIT. Both the repair and the verification query below
--     read the target from here, so there is no second copy to forget.
create temp table _repair_target on commit drop as
  select '202503-003'::text as loan_number;

do $$
declare
  v_loan_number   text := (select loan_number from _repair_target);
  v_loan          record;
  v_cutover       date;
  v_first_legit   date;
  v_outstanding   numeric;
  v_rate          numeric;
  v_settled       int;
  v_fee_row       record;
  v_fees_reversed numeric := 0;
  v_rows_deleted  int;
  v_generated     int;
begin
  select l.*, lb.pending_principal
    into v_loan
    from public.loans l
    left join public.loans_balances lb on lb.loan_id = l.id
   where l.loan_number = v_loan_number;

  if v_loan.id is null then
    raise exception 'No loan with loan_number %', v_loan_number;
  end if;
  if v_loan.repayment_model <> 'emi' then
    raise exception 'Loan % is on the % model, not emi', v_loan_number, v_loan.repayment_model;
  end if;
  -- A null term slips past the generator's own `p_term <= 0` guard (null
  -- comparisons are never true) and would spin out 1000 null-amount rows.
  if v_loan.term_months is null or v_loan.term_months < 1 then
    raise exception 'Loan % has no usable term_months (%)', v_loan_number, v_loan.term_months;
  end if;

  select to_date(trunc(value)::bigint::text, 'YYYYMMDD') into v_cutover
    from public.reference where key = 'emi_cutover_date';
  if v_cutover is null then
    raise exception 'emi_cutover_date is not set in public.reference';
  end if;
  v_first_legit := (date_trunc('month', v_cutover) + interval '1 month' + interval '9 days')::date;

  -- Guard: never rebuild a schedule that already has settled installments.
  select count(*) into v_settled
    from public.loan_emi_schedule
   where loan_id = v_loan.id
     and status in ('paid', 'partially_paid', 'waived');
  if v_settled > 0 then
    raise exception
      'Loan % has % settled installment(s); reshape it with Prepay instead of rebuilding',
      v_loan_number, v_settled;
  end if;

  -- (a) Reverse late fees charged on back-dated rows. The original penalty
  --     transaction stays; this posts the balancing negative entry so the pair
  --     nets to zero and the reversal is visible in recent activity.
  for v_fee_row in
    select id, installment_no, late_fee_charged
      from public.loan_emi_schedule
     where loan_id = v_loan.id
       and status in ('scheduled', 'overdue')
       and due_date < v_first_legit
       and coalesce(late_fee_charged, 0) > 0
       and not coalesce(late_fee_waived, false)
  loop
    insert into public.transactions
      (member_id, loan_id, transaction_type, amount, transaction_date, description)
    values
      (v_loan.member_id, v_loan.id, 'penalty', -v_fee_row.late_fee_charged,
       (now() at time zone 'Asia/Kolkata')::date,
       'Late fee reversed: EMI #' || v_fee_row.installment_no
         || ' — installment was back-dated in error');
    v_fees_reversed := v_fees_reversed + v_fee_row.late_fee_charged;
  end loop;

  -- (b) Drop the FK from any transaction that points at a row we are deleting
  --     (loan_emi_schedule_id is ON DELETE RESTRICT). The transactions
  --     themselves are kept — only the link to the bogus installment goes.
  update public.transactions t
     set loan_emi_schedule_id = null
   where t.loan_emi_schedule_id in (
     select id from public.loan_emi_schedule
      where loan_id = v_loan.id and status in ('scheduled', 'overdue')
   );

  -- (c) Delete the unsettled schedule. late_fee_txn_id is a plain FK to
  --     transactions and does not block the delete.
  delete from public.loan_emi_schedule
   where loan_id = v_loan.id
     and status in ('scheduled', 'overdue');
  get diagnostics v_rows_deleted = row_count;

  -- (d) Rebuild from the cutover on the CURRENT outstanding principal. The
  --     generator floors p_start at the cutover itself (migration 051), so
  --     passing the loan's own start_date is correct and self-documenting.
  v_outstanding := v_loan.pending_principal;
  if v_outstanding is null or v_outstanding <= 0 then
    raise exception 'Loan % has no outstanding principal (%) to schedule',
      v_loan_number, v_outstanding;
  end if;

  select value::numeric into v_rate
    from public.reference where key = 'loan_interest_rate_pct';
  if v_rate is null then
    raise exception 'loan_interest_rate_pct is not set in public.reference';
  end if;

  select public.fn_generate_emi_schedule(
    v_loan.id,
    v_outstanding,
    v_loan.start_date,
    v_loan.term_months,
    0,                    -- waiver is spent; the generator zeroes it when floored anyway
    v_rate
  ) into v_generated;

  raise notice 'Loan %: deleted % back-dated row(s), reversed % in late fees, generated % installment(s) on an outstanding principal of %',
    v_loan_number, v_rows_deleted, v_fees_reversed, v_generated, v_outstanding;
end $$;

-- Verify before committing: first due date should be the 10th of the month
-- after the cutover, and the opening balance should be the outstanding amount.
select installment_no, due_date, opening_balance, emi_amount,
       principal_due, interest_due, closing_balance, status, late_fee_charged
  from public.loan_emi_schedule
 where loan_id = (
   select id from public.loans
    where loan_number = (select loan_number from _repair_target)
 )
 order by installment_no;

-- Happy with it?  COMMIT;      Not happy?  ROLLBACK;
commit;


-- ----------------------------------------------------------------------------
-- STEP 3 — Confirm. Re-run STEP 1: it should return zero rows.
-- ----------------------------------------------------------------------------
