-- =============================================================================
-- 016 — Backfill individual monthly accruals for active loans.
--
-- Migration 014 inserted ONE synthetic opening-balance accrual row per active
-- loan, lumping all pre-cutover unpaid interest into a single ₹X due. This
-- migration replaces that lump with one row per past month-end, so the loan
-- timeline (introduced by the loan-timeline feature) shows each historical
-- month as its own visible entry.
--
-- Algorithm:
--   1. For each end-of-month between the earliest active loan's interest
--      start date and yesterday (IST), call fn_compute_loan_interest_for(eom).
--      That function already iterates active loans, computes running balance
--      and rate, and inserts one accrual row per (loan, eom) with ON CONFLICT
--      DO UPDATE for pending/waived rows. So this is naturally idempotent.
--   2. Delete the opening-balance rows for active loans that are still pending
--      (no payments allocated). Their amount is now fully represented by the
--      individual monthly rows.
--
-- Safety:
--   * Opening-balance rows that have been touched (status != 'pending', or any
--     row in loan_interest_payments references them) are NOT deleted. The
--     ON DELETE RESTRICT FK on loan_interest_payments(accrual_id) provides a
--     hard backstop against accidentally severing payment history.
--   * The migration is idempotent: re-running is a no-op (ON CONFLICT updates
--     existing pending rows; the opening-balance row is already gone).
-- =============================================================================

begin;

do $$
declare
  v_eom date;
  v_min_start date;
  v_yesterday date := (now() at time zone 'Asia/Kolkata')::date - 1;
begin
  -- Earliest interest-bearing start across active loans. Waiver windows are
  -- already handled inside fn_compute_loan_interest_for (it emits 'waived'
  -- rows for periods before interest_start_date), so we just need to begin
  -- at the loan's start_date here.
  select min(start_date) into v_min_start
  from public.loans
  where status = 'active';

  if v_min_start is null then
    raise notice '016 backfill: no active loans; nothing to do';
    return;
  end if;

  -- First EOM at or after v_min_start.
  v_eom := (date_trunc('month', v_min_start) + interval '1 month - 1 day')::date;

  while v_eom <= v_yesterday loop
    perform public.fn_compute_loan_interest_for(v_eom);
    -- Step to the next month-end: jump into the next month, then back to its
    -- last day.
    v_eom := (date_trunc('month', v_eom + interval '2 days') + interval '1 month - 1 day')::date;
  end loop;
end $$;

-- Drop the lumpsum opening-balance rows that are still untouched on active
-- loans. The individual monthly rows inserted above now cover the same span,
-- so keeping the lump would double-count pending interest.
--
-- Only deletes rows whose status is 'pending' AND have no junction entries —
-- defense-in-depth against accidentally severing a partially-paid history.
delete from public.loan_interest_accruals a
where a.is_opening_balance = true
  and a.status = 'pending'
  and not exists (
    select 1 from public.loan_interest_payments p
    where p.accrual_id = a.id
  )
  and exists (
    select 1 from public.loans l
    where l.id = a.loan_id and l.status = 'active'
  );

commit;
