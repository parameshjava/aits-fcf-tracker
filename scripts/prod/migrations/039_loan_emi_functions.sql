-- =============================================================================
-- 039 — Loan EMI model: functions, triggers, cron, accrual guard.
--
-- The logic layer for the EMI repayment track introduced in 037/038:
--
--   (A) fn_generate_emi_schedule  — amortizes a loan into loan_emi_schedule
--                                   rows (mirrors src/lib/emi-math.ts).
--   (B) fn_recompute_emi_paid_state + trigger — keeps loan_emi_schedule
--       principal_paid/interest_paid/status in sync from loan_emi_payments
--       (mirrors fn_recompute_accrual_paid_state in 009).
--   (C) fn_apply_emi_late_fees    — charges late fees on long-overdue EMIs.
--   (D) Cron re-schedule          — appends the late-fee job to the existing
--                                   daily EOM heartbeat (013).
--   (E) Accrual guard patch       — fn_compute_loan_interest_for now skips
--                                   EMI loans so converted loans don't
--                                   double-accrue interest.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- (A) fn_generate_emi_schedule
--     Mirrors src/lib/emi-math.ts (computeEmiAmount + amortize + buildSchedule).
--     Monthly rate r = p_rate_pct/100/12; EMI = round(P*r*(1+r)^n/((1+r)^n-1)).
--     Due dates are anchored to the start day, clamped to month-end each month.
-- -----------------------------------------------------------------------------

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
  v_r            numeric;       -- monthly rate
  v_emi          numeric;       -- standard EMI amount
  v_pow          numeric;       -- (1+r)^n
  v_balance      numeric;
  v_anchor_day   int;           -- original start-date day, re-clamped each month
  v_i            int;
  v_interest_due numeric;
  v_emi_amount   numeric;
  v_principal_due numeric;
  v_closing      numeric;
  v_due          date;
  v_is_last      boolean;
  v_count        int := 0;
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

  v_anchor_day := extract(day from p_start)::int;
  v_balance    := p_principal;
  v_i          := 1;

  while v_balance > 0 and v_i <= p_term loop
    -- Due date for installment v_i: day `v_anchor_day` of the month
    -- (date_trunc('month', p_start) + (p_waiver_months + v_i) months),
    -- clamped to that month's last day. Mirrors addMonthsClamped, re-anchored
    -- each iteration so short months don't permanently shift the day.
    v_due := (
      select least(
        (mn + ((v_anchor_day - 1) || ' days')::interval)::date,        -- anchor day in target month
        (mn + interval '1 month' - interval '1 day')::date              -- last day of target month
      )
      from (
        select (date_trunc('month', p_start)
                  + ((p_waiver_months + v_i) || ' months')::interval) as mn
      ) m
    );

    v_interest_due  := round(v_balance * v_r);
    v_emi_amount    := v_emi;
    v_principal_due := v_emi_amount - v_interest_due;

    -- Final / payoff installment clears the balance exactly.
    v_is_last := (v_principal_due >= v_balance) or (v_i = p_term);
    if v_is_last then
      v_principal_due := v_balance;
      v_emi_amount    := v_principal_due + v_interest_due;
    end if;

    v_closing := v_balance - v_principal_due;

    insert into public.loan_emi_schedule (
      loan_id, installment_no, due_date, opening_balance, emi_amount,
      principal_due, interest_due, closing_balance, status
    )
    values (
      p_loan_id, v_i, v_due, v_balance, v_emi_amount,
      v_principal_due, v_interest_due, v_closing, 'scheduled'
    )
    -- Guard: only overwrite still-open installments. Settled rows
    -- (paid/partially_paid/waived) are protected so a regenerate that reuses an
    -- installment_no cannot clobber their amounts; the update is a no-op for them.
    on conflict (loan_id, installment_no) do update set
      due_date        = excluded.due_date,
      opening_balance = excluded.opening_balance,
      emi_amount      = excluded.emi_amount,
      principal_due   = excluded.principal_due,
      interest_due    = excluded.interest_due,
      closing_balance = excluded.closing_balance,
      status          = excluded.status
    where public.loan_emi_schedule.status in ('scheduled', 'overdue');

    v_count  := v_count + 1;
    v_balance := v_closing;
    exit when v_is_last;
    v_i := v_i + 1;
  end loop;

  update public.loans
     set repayment_model      = 'emi',
         term_months          = p_term,
         interest_rate_pct    = p_rate_pct,
         emi_amount           = v_emi,
         schedule_generated_at = now()
   where id = p_loan_id;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- (B) fn_recompute_emi_paid_state + trigger
--     Mirrors fn_recompute_accrual_paid_state (009): recompute the target
--     schedule row's paid sums from the junction; set status; reject overpay.
-- -----------------------------------------------------------------------------

create or replace function public.fn_recompute_emi_paid_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule_id   uuid;
  v_principal_paid numeric;
  v_interest_paid  numeric;
  v_principal_due  numeric;
  v_interest_due   numeric;
  v_new_status     text;
  v_new_paid_at    timestamptz;
begin
  -- For INSERT and DELETE alike, recompute the affected schedule row.
  v_schedule_id := coalesce(new.schedule_id, old.schedule_id);

  select coalesce(sum(principal_applied), 0),
         coalesce(sum(interest_applied), 0)
    into v_principal_paid, v_interest_paid
  from public.loan_emi_payments
  where schedule_id = v_schedule_id;

  select principal_due, interest_due
    into v_principal_due, v_interest_due
  from public.loan_emi_schedule
  where id = v_schedule_id;

  if v_principal_paid > v_principal_due + 0.01
     or v_interest_paid > v_interest_due + 0.01 then
    raise exception 'Overpayment: principal %/% interest %/% (schedule %)',
      v_principal_paid, v_principal_due, v_interest_paid, v_interest_due, v_schedule_id;
  end if;

  if v_principal_paid >= v_principal_due - 0.01
     and v_interest_paid >= v_interest_due - 0.01 then
    v_new_status := 'paid';
    -- Preserve the original paid_at if already set; otherwise stamp now.
    select coalesce(paid_at, now()) into v_new_paid_at
    from public.loan_emi_schedule where id = v_schedule_id;
  elsif v_principal_paid > 0 or v_interest_paid > 0 then
    v_new_status := 'partially_paid';
    v_new_paid_at := null;
  else
    v_new_status := null;  -- keep existing status (e.g. scheduled / overdue)
    v_new_paid_at := null;
  end if;

  -- Don't clobber waived rows; keep existing status when nothing is applied.
  update public.loan_emi_schedule
  set principal_paid = v_principal_paid,
      interest_paid  = v_interest_paid,
      status = case
                 when status = 'waived' then 'waived'
                 when v_new_status is null then status
                 else v_new_status
               end,
      paid_at = case
                  when status = 'waived' then paid_at
                  when v_new_status = 'paid' then v_new_paid_at
                  else null
                end
  where id = v_schedule_id;

  return null;
end;
$$;

drop trigger if exists trg_recompute_emi_paid_state on public.loan_emi_payments;
create trigger trg_recompute_emi_paid_state
  after insert or delete on public.loan_emi_payments
  for each row execute function public.fn_recompute_emi_paid_state();

-- -----------------------------------------------------------------------------
-- (C) fn_apply_emi_late_fees
--     Charge a late fee on EMIs overdue by >= late_fee_overdue_months.
-- -----------------------------------------------------------------------------

create or replace function public.fn_apply_emi_late_fees()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pct             numeric;
  v_overdue_months  numeric;
  v_today           date;
  v_count           int := 0;
  v_row             record;
  v_fee             numeric;
  v_txn_id          uuid;
begin
  select value::numeric into v_pct
  from public.reference where key = 'late_fee_pct';

  select value::numeric into v_overdue_months
  from public.reference where key = 'late_fee_overdue_months';

  if v_pct is null or v_overdue_months is null then
    raise exception 'fn_apply_emi_late_fees: late_fee_pct / late_fee_overdue_months missing from reference';
  end if;

  v_today := (now() at time zone 'Asia/Kolkata')::date;

  for v_row in
    select s.id            as schedule_id,
           s.installment_no,
           s.emi_amount,
           l.id            as loan_id,
           l.member_id
    from public.loan_emi_schedule s
    join public.loans l on l.id = s.loan_id
    where s.status in ('scheduled', 'partially_paid', 'overdue')
      and s.late_fee_charged = 0
      and s.due_date < (v_today - (v_overdue_months || ' months')::interval)
  loop
    v_fee := round(v_row.emi_amount * v_pct / 100.0);

    -- transaction_id auto-fills via set_transaction_id (002); do NOT supply it.
    insert into public.transactions (
      member_id, loan_id, transaction_type, amount, transaction_date, description
    )
    values (
      v_row.member_id, v_row.loan_id, 'penalty', v_fee, v_today,
      'Late fee: EMI #' || v_row.installment_no || ' overdue 2+ months'
    )
    returning id into v_txn_id;

    update public.loan_emi_schedule
       set late_fee_charged = v_fee,
           late_fee_txn_id  = v_txn_id,
           status           = 'overdue'
     where id = v_row.schedule_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- (D) Cron re-schedule — append the late-fee job to the existing 013 heartbeat.
--     SAME name + schedule; only the body gains one new line.
-- -----------------------------------------------------------------------------

do $$
begin
  perform cron.unschedule('fcf-eom-accruals');
exception when others then
  -- Job didn't exist; ignore.
  null;
end $$;

select cron.schedule(
  'fcf-eom-accruals',
  '25 18 * * *',
  $cron$
    select public.fn_accrue_loan_interest();
    select public.fn_accrue_donation_eligibility();
    select public.fn_apply_emi_late_fees();
  $cron$
);

-- -----------------------------------------------------------------------------
-- (E) Accrual guard patch — fn_compute_loan_interest_for (from 020) with ONE
--     added predicate: `and l.repayment_model = 'accrual'`. Converted EMI
--     loans amortize via the schedule, so they must NOT also accrue monthly
--     interest here (would double-charge). Everything else is byte-for-byte 020.
-- -----------------------------------------------------------------------------

create or replace function public.fn_compute_loan_interest_for(p_period_end date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate       numeric;
  v_count      int := 0;
begin
  select value into v_rate
  from public.reference_history
  where key = 'interest_per_lakh'
    and effective_from <= p_period_end
    and (effective_to is null or effective_to >= p_period_end)
  order by effective_from desc
  limit 1;

  if v_rate is null then
    raise exception 'fn_compute_loan_interest_for: no interest_per_lakh in reference_history for %', p_period_end;
  end if;

  with active_loans as (
    select
      l.id,
      l.start_date,
      l.interest_waiver_months,
      greatest(
        l.principal_amount
        - coalesce((select sum(t.amount) from public.transactions t
                    where t.loan_id = l.id
                      and t.transaction_type = 'loan_repayment'
                      and t.transaction_date <= p_period_end), 0)
        - coalesce(l.bad_debt, 0),
        0
      )::numeric as balance,
      (extract(year  from p_period_end)::int - extract(year  from l.start_date)::int) * 12
      + (extract(month from p_period_end)::int - extract(month from l.start_date)::int) as months_elapsed,
      -- NEW: first day of the month AFTER start, plus waiver months.
      (date_trunc('month', l.start_date)
        + interval '1 month'
        + (coalesce(l.interest_waiver_months, 0) || ' months')::interval
      )::date as interest_start_date
    from public.loans l
    where l.status = 'active'
      and l.start_date <= p_period_end
      -- EMI guard: converted loans amortize via loan_emi_schedule; never accrue.
      and l.repayment_model = 'accrual'
  ),
  to_insert as (
    select
      id as loan_id,
      p_period_end as period_end,
      case
        when p_period_end < interest_start_date then 0
        else round((balance / 100000.0) * v_rate, 2)
      end as amount_due,
      case
        when p_period_end < interest_start_date then 'waived'
        else 'pending'
      end as status,
      v_rate as interest_rate_used,
      balance as balance_basis,
      case
        when p_period_end < interest_start_date then 'within_waiver_window'
        else null
      end as waiver_reason
    from active_loans
    where months_elapsed >= 1
  )
  insert into public.loan_interest_accruals (
    loan_id, period_end, amount_due, status,
    interest_rate_used, balance_basis, waiver_reason, recomputed_at
  )
  select loan_id, period_end, amount_due, status,
         interest_rate_used, balance_basis, waiver_reason, now()
  from to_insert
  on conflict (loan_id, period_end) do update set
    amount_due         = excluded.amount_due,
    status             = excluded.status,
    interest_rate_used = excluded.interest_rate_used,
    balance_basis      = excluded.balance_basis,
    waiver_reason      = excluded.waiver_reason,
    recomputed_at      = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

commit;

notify pgrst, 'reload schema';
