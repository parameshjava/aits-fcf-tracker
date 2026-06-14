-- =============================================================================
-- 046 — fn_apply_emi_late_fees: cumulative, duration-scaled late fee.
--
-- Replaces the one-time fee with a duration-scaled one. With grace =
-- late_fee_overdue_months (default 2 → first two overdue months free):
--   months overdue 0–1  → ₹0 (still inside the 1st/2nd overdue month)
--   2 months overdue    → late_fee_pct% × EMI × 1   (the 3rd month)
--   3 months overdue    → late_fee_pct% × EMI × 2   (the 4th month)
--   N months overdue    → late_fee_pct% × EMI × (N − grace + 1)   [cumulative target]
-- months_overdue counts FULL months from the (10th) due date to today (IST), so
-- a "2M 4D" overdue installment has months_overdue = 2 → first chargeable step.
--
-- Each monthly run (the 11th) tops the schedule row's late_fee_charged up to the
-- current cumulative target and records the *delta* as a penalty transaction
-- (so one ~2%-of-EMI penalty per overdue month). Idempotent within a month:
-- re-running with the same month count is a no-op (target == already charged).
-- "Months overdue" = full months from the (10th) due date to today (IST).
-- =============================================================================

begin;

create or replace function public.fn_apply_emi_late_fees()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pct     numeric;
  v_grace   numeric;
  v_today   date;
  v_row     record;
  v_months  int;
  v_mult    int;
  v_target  numeric;
  v_delta   numeric;
  v_txn_id  uuid;
  v_count   int := 0;
begin
  select value::numeric into v_pct   from public.reference where key = 'late_fee_pct';
  select value::numeric into v_grace from public.reference where key = 'late_fee_overdue_months';
  if v_pct is null or v_grace is null then
    raise exception 'fn_apply_emi_late_fees: late_fee_pct / late_fee_overdue_months missing from reference';
  end if;

  v_today := (now() at time zone 'Asia/Kolkata')::date;

  for v_row in
    select s.id            as schedule_id,
           s.installment_no,
           s.emi_amount,
           s.due_date,
           coalesce(s.late_fee_charged, 0) as late_fee_charged,
           l.id            as loan_id,
           l.member_id
    from public.loan_emi_schedule s
    join public.loans l on l.id = s.loan_id
    where s.status in ('scheduled', 'partially_paid', 'overdue')
  loop
    -- Full months from the due date (the 10th) to today (the 11th-run date).
    v_months := (extract(year  from v_today)::int - extract(year  from v_row.due_date)::int) * 12
              + (extract(month from v_today)::int - extract(month from v_row.due_date)::int)
              - case when extract(day from v_today) < extract(day from v_row.due_date) then 1 else 0 end;

    -- Grace: the first v_grace overdue months are free; charging starts once
    -- months_overdue reaches v_grace (the 3rd month when grace=2), scaling by one
    -- step per further month: multiplier = months_overdue - grace + 1.
    v_mult := greatest(v_months - v_grace::int + 1, 0);
    if v_mult <= 0 then
      continue;
    end if;

    v_target := round(v_row.emi_amount * v_pct / 100.0 * v_mult);  -- cumulative target
    if v_target <= v_row.late_fee_charged then
      continue;  -- already charged for this (or a later) month
    end if;
    v_delta := v_target - v_row.late_fee_charged;

    insert into public.transactions
      (member_id, loan_id, transaction_type, amount, transaction_date, description)
    values
      (v_row.member_id, v_row.loan_id, 'penalty', v_delta, v_today,
       'Late fee: EMI #' || v_row.installment_no || ' — ' || v_months
         || ' months overdue (cumulative ' || v_target || ')')
    returning id into v_txn_id;

    update public.loan_emi_schedule
       set late_fee_charged = v_target,
           late_fee_txn_id  = v_txn_id,
           status           = 'overdue'
     where id = v_row.schedule_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

commit;
