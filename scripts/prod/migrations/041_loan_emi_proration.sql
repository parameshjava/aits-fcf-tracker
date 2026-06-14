-- =============================================================================
-- 041 — EMI schedule: 10th-of-following-month due dates + mid-month proration.
--
-- Replaces fn_generate_emi_schedule (from 039) to mirror the revised
-- src/lib/emi-math.ts model:
--   * Every installment is due on the 10th of the month AFTER its accrual month.
--   * Mid-month disbursement (no waiver, day != 1) → a pro-rated STUB installment
--     #1 whose interest AND principal are both scaled by f = (days to month-end)/30.
--   * Full monthly EMIs (standard EMI on the full principal) follow until cleared.
--   * A waiver absorbs the partial month (no stub); first EMI starts after waiver.
-- The settled-row upsert guard from 039 is preserved.
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
  v_r              numeric;       -- monthly rate
  v_emi            numeric;       -- standard EMI on full principal over p_term
  v_pow            numeric;
  v_balance        numeric;
  v_day            int;
  v_dim            int;           -- days in the disbursement month
  v_has_waiver     boolean;
  v_make_stub      boolean;
  v_f              numeric;
  v_i0             numeric;       -- stub interest
  v_p0             numeric;       -- stub principal
  v_inst           int := 0;      -- installment number written
  v_k              int;           -- 0-based full-row index
  v_base_off       int;          -- month offset for the first full accrual month
  v_off            int;           -- month offset used for the due date
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

  -- Standard EMI (mirrors computeEmiAmount). r = 0 → straight-line.
  if v_r = 0 then
    v_emi := round(p_principal / p_term);
  else
    v_pow := power(1 + v_r, p_term);
    v_emi := round((p_principal * v_r * v_pow) / (v_pow - 1));
  end if;

  -- Preserve already-settled rows; only rebuild scheduled/overdue installments.
  delete from public.loan_emi_schedule
   where loan_id = p_loan_id
     and status in ('scheduled', 'overdue');

  v_day := extract(day from p_start)::int;
  v_dim := extract(day from (date_trunc('month', p_start) + interval '1 month' - interval '1 day'))::int;
  v_has_waiver := p_waiver_months > 0;
  v_make_stub := (not v_has_waiver) and v_day <> 1;

  v_balance := p_principal;

  -- (1) Pro-rated stub for a mid-month disbursement (no waiver).
  if v_make_stub then
    v_f := least((v_dim - v_day + 1)::numeric / 30.0, 1);
    v_i0 := round(p_principal * v_r * v_f);
    v_p0 := least(round((v_emi - p_principal * v_r) * v_f), p_principal);
    v_inst := 1;
    -- accrual = disbursement month → due 10th of the next month (offset 1).
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
      status = excluded.status
    where public.loan_emi_schedule.status in ('scheduled', 'overdue');

    v_count := v_count + 1;
    v_balance := p_principal - v_p0;
    v_base_off := 2;   -- first full accrual month is the month after disbursement;
                       -- its due date is the 10th two months after p_start.
  else
    -- No stub: first full accrual month is offset by the waiver (0 when none).
    v_base_off := (case when v_has_waiver then p_waiver_months else 0 end) + 1;
  end if;

  -- (2) Full EMIs at the fixed standard EMI until the balance clears.
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
      status = excluded.status
    where public.loan_emi_schedule.status in ('scheduled', 'overdue');

    v_count := v_count + 1;
    v_balance := v_balance - v_principal;
    exit when v_is_last;
    v_k := v_k + 1;
  end loop;

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
