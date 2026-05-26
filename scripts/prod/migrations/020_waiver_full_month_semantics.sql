-- 020_waiver_full_month_semantics.sql
--
-- Shift "interest waiver months" from day-precise to full-calendar-month.
--
-- OLD:  interest_start_date = start_date + N months  (day preserved)
--       → loan 202503-003 starting 2025-03-21 with waiver=6 charges
--         interest from 2025-09-21, so the 2025-09-30 EOM is charged. Only
--         5 EOM rows (Apr–Aug) get the `waived/within_waiver_window` mark.
--
-- NEW:  interest_start_date = first day of the month AFTER start_date,
--       plus N months. Same loan now waives all of Mar–Sep (the 6 EOMs
--       Apr 2025 → Sep 2025) and starts charging 2025-10-31.
--
-- Matches typical "N-month moratorium" expectations: borrower pays no
-- interest for the first N FULL calendar months after disbursement.
--
-- No data is rewritten by this migration. Admin runs "Recompute accruals"
-- on any affected loan to resync existing rows.

begin;

-- 1. fn_compute_loan_interest_for — used by the cron + manual per-EOM recompute.

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

-- 2. fn_recompute_loan_accruals — surgical per-loan rebuild from migration 019.

create or replace function public.fn_recompute_loan_accruals(
  p_loan_id  uuid,
  p_through  date default current_date
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan             record;
  v_eom              date;
  v_months_elapsed   int;
  v_interest_start   date;
  v_balance          numeric;
  v_amount_due       numeric;
  v_status_seed      text;
  v_waiver_reason    text;
  v_rate             numeric;
  v_rows             int := 0;
begin
  if not public.is_admin() then
    raise exception 'fn_recompute_loan_accruals: admin role required';
  end if;

  select id, start_date, interest_waiver_months, principal_amount, bad_debt, status
    into v_loan
    from public.loans
   where id = p_loan_id;

  if not found then
    raise exception 'fn_recompute_loan_accruals: loan % not found', p_loan_id;
  end if;

  -- NEW semantic: full calendar months. First charged EOM is N+1 months after
  -- the start month, not N months after start_date.
  v_interest_start := (date_trunc('month', v_loan.start_date)
                         + interval '1 month'
                         + (coalesce(v_loan.interest_waiver_months, 0) || ' months')::interval
                      )::date;

  v_eom := (date_trunc('month', v_loan.start_date) + interval '1 month' - interval '1 day')::date;

  while v_eom <= p_through loop
    v_months_elapsed :=
      (extract(year  from v_eom)::int - extract(year  from v_loan.start_date)::int) * 12
      + (extract(month from v_eom)::int - extract(month from v_loan.start_date)::int);

    if v_months_elapsed >= 1 then
      select value into v_rate
        from public.reference_history
       where key = 'interest_per_lakh'
         and effective_from <= v_eom
         and (effective_to is null or effective_to >= v_eom)
       order by effective_from desc
       limit 1;

      if v_rate is null then
        raise exception 'fn_recompute_loan_accruals: no interest_per_lakh in reference_history for %', v_eom;
      end if;

      v_balance := greatest(
        v_loan.principal_amount
        - coalesce(
            (select sum(t.amount)
               from public.transactions t
              where t.loan_id = p_loan_id
                and t.transaction_type = 'loan_repayment'
                and t.transaction_date <= v_eom), 0)
        - coalesce(v_loan.bad_debt, 0),
        0
      );

      if v_eom < v_interest_start then
        v_amount_due    := 0;
        v_status_seed   := 'waived';
        v_waiver_reason := 'within_waiver_window';
      else
        v_amount_due    := round((v_balance / 100000.0) * v_rate, 2);
        v_status_seed   := 'pending';
        v_waiver_reason := null;
      end if;

      insert into public.loan_interest_accruals as a (
        loan_id, period_end, amount_due, status,
        interest_rate_used, balance_basis, waiver_reason, recomputed_at
      )
      values (
        p_loan_id, v_eom, v_amount_due, v_status_seed,
        v_rate, v_balance, v_waiver_reason, now()
      )
      on conflict (loan_id, period_end) do update set
        amount_due         = excluded.amount_due,
        interest_rate_used = excluded.interest_rate_used,
        balance_basis      = excluded.balance_basis,
        waiver_reason      = excluded.waiver_reason,
        recomputed_at      = now(),
        status = case
          when a.status = 'waived' and a.waiver_reason = 'loan_closed' then a.status
          when excluded.amount_due = 0 and a.paid_amount = 0 then 'waived'
          when excluded.amount_due = 0 and a.paid_amount > 0 then 'paid'
          when a.paid_amount = 0 then 'pending'
          when a.paid_amount >= excluded.amount_due then 'paid'
          else 'partially_paid'
        end,
        paid_at = case
          when a.status = 'waived' and a.waiver_reason = 'loan_closed' then a.paid_at
          when excluded.amount_due = 0 then null
          when a.paid_amount >= excluded.amount_due and a.paid_amount > 0 then a.paid_at
          else null
        end
      where a.is_opening_balance = false
        and not (a.status = 'waived' and a.waiver_reason = 'loan_closed');

      v_rows := v_rows + 1;
    end if;

    v_eom := (date_trunc('month', v_eom + interval '2 day') + interval '1 month' - interval '1 day')::date;
  end loop;

  return v_rows;
end;
$$;

commit;

notify pgrst, 'reload schema';
