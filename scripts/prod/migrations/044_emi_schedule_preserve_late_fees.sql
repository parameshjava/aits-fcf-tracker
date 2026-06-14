-- =============================================================================
-- 044 — fn_generate_emi_schedule: preserve late fees + overdue status on rebuild.
--
-- The 041 generator deleted all scheduled/overdue rows before re-inserting,
-- which WIPED late_fee_charged / late_fee_txn_id and reset 'overdue' → 'scheduled'.
-- That meant Recalculate erased late fees. This version:
--   * Does NOT pre-delete; it upserts in place, so late_fee_charged/late_fee_txn_id
--     (never in the UPDATE SET) survive, and existing 'overdue' status is kept.
--   * Removes only the stale tail (installment_no beyond the new schedule length)
--     for unsettled rows, so a shorter schedule (e.g. after a term change) is clean.
-- Recalculate then also calls fn_apply_emi_late_fees() to charge any newly-due
-- late fees (idempotent via the late_fee_charged = 0 guard, so no duplicates).
-- =============================================================================

begin;

create or replace function public.fn_generate_emi_schedule(
  p_loan_id        uuid,
  p_principal      numeric,
  p_start          date,
  p_term           int,
  p_waiver_months  int,
  p_rate_pct       numeric
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r              numeric;
  v_emi            numeric;
  v_pow            numeric;
  v_balance        numeric;
  v_day            int;
  v_dim            int;
  v_has_waiver     boolean;
  v_make_stub      boolean;
  v_f              numeric;
  v_i0             numeric;
  v_p0             numeric;
  v_inst           int := 0;
  v_k              int;
  v_base_off       int;
  v_off            int;
  v_due            date;
  v_interest       numeric;
  v_principal      numeric;
  v_emi_amt        numeric;
  v_is_last        boolean;
  v_count          int := 0;
begin
  if p_term <= 0 then
    raise exception 'fn_generate_emi_schedule: term must be > 0 (got %)', p_term;
  end if;

  v_r := p_rate_pct / 100.0 / 12.0;

  if v_r = 0 then
    v_emi := round(p_principal / p_term);
  else
    v_pow := power(1 + v_r, p_term);
    v_emi := round((p_principal * v_r * v_pow) / (v_pow - 1));
  end if;

  -- NO pre-delete: we upsert in place so late_fee_charged/late_fee_txn_id and
  -- 'overdue' status on existing rows are preserved. Stale tail is trimmed below.

  v_day := extract(day from p_start)::int;
  v_dim := extract(day from (date_trunc('month', p_start) + interval '1 month' - interval '1 day'))::int;
  v_has_waiver := p_waiver_months > 0;
  v_make_stub := (not v_has_waiver) and v_day <> 1;

  v_balance := p_principal;

  if v_make_stub then
    v_f := least((v_dim - v_day + 1)::numeric / 30.0, 1);
    v_i0 := round(p_principal * v_r * v_f);
    v_p0 := least(round((v_emi - p_principal * v_r) * v_f), p_principal);
    v_inst := 1;
    v_due := (date_trunc('month', p_start) + make_interval(months => 1) + interval '9 days')::date;

    insert into public.loan_emi_schedule
      (loan_id, installment_no, due_date, opening_balance, emi_amount,
       principal_due, interest_due, closing_balance, status)
    values
      (p_loan_id, v_inst, v_due, p_principal, v_i0 + v_p0,
       v_p0, v_i0, p_principal - v_p0, 'scheduled')
    on conflict (loan_id, installment_no) do update set
      due_date = excluded.due_date, opening_balance = excluded.opening_balance,
      emi_amount = excluded.emi_amount, principal_due = excluded.principal_due,
      interest_due = excluded.interest_due, closing_balance = excluded.closing_balance,
      -- keep an already-overdue marker (and thus its late fee); else take the new status
      status = case when public.loan_emi_schedule.status = 'overdue'
                    then 'overdue' else excluded.status end
    where public.loan_emi_schedule.status in ('scheduled', 'overdue');

    v_count := v_count + 1;
    v_balance := p_principal - v_p0;
    v_base_off := 2;
  else
    v_base_off := (case when v_has_waiver then p_waiver_months else 0 end) + 1;
  end if;

  v_k := 0;
  while v_balance > 0 and v_k < 1000 loop
    v_off := v_base_off + v_k;
    v_due := (date_trunc('month', p_start) + make_interval(months => v_off) + interval '9 days')::date;

    v_interest  := round(v_balance * v_r);
    v_emi_amt   := v_emi;
    v_principal := v_emi_amt - v_interest;
    v_is_last   := v_principal >= v_balance;
    if v_is_last then
      v_principal := v_balance;
      v_emi_amt   := v_principal + v_interest;
    end if;

    v_inst := v_inst + 1;
    insert into public.loan_emi_schedule
      (loan_id, installment_no, due_date, opening_balance, emi_amount,
       principal_due, interest_due, closing_balance, status)
    values
      (p_loan_id, v_inst, v_due, v_balance, v_emi_amt,
       v_principal, v_interest, v_balance - v_principal, 'scheduled')
    on conflict (loan_id, installment_no) do update set
      due_date = excluded.due_date, opening_balance = excluded.opening_balance,
      emi_amount = excluded.emi_amount, principal_due = excluded.principal_due,
      interest_due = excluded.interest_due, closing_balance = excluded.closing_balance,
      status = case when public.loan_emi_schedule.status = 'overdue'
                    then 'overdue' else excluded.status end
    where public.loan_emi_schedule.status in ('scheduled', 'overdue');

    v_count := v_count + 1;
    v_balance := v_balance - v_principal;
    exit when v_is_last;
    v_k := v_k + 1;
  end loop;

  -- Trim a stale tail (a previously-longer schedule), but never settled rows.
  delete from public.loan_emi_schedule
   where loan_id = p_loan_id
     and installment_no > v_inst
     and status in ('scheduled', 'overdue');

  update public.loans
     set repayment_model       = 'emi',
         term_months           = p_term,
         interest_rate_pct     = p_rate_pct,
         emi_amount            = v_emi,
         schedule_generated_at = now()
   where id = p_loan_id;

  return v_count;
end;
$$;

commit;

notify pgrst, 'reload schema';
