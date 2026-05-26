-- =============================================================================
-- 014 — Opening-balance seeds for active loans.
--
-- One synthetic accrual row per active loan, dated (current_date - 1),
-- amount = current interestDue from src/lib/loan-math.ts:computeLoanFinancials.
-- This collapses all pre-cutover unpaid interest into one auditable row so the
-- loan summary becomes "pending = Σ unpaid accruals" with no special pre/post
-- cutover handling.
-- =============================================================================

begin;

-- Compute expected interest for one loan via a single SQL helper that
-- mirrors computeLoanFinancials. Uses the per-EOM rate from reference_history.
create or replace function public.fn_compute_expected_interest(
  p_loan_id   uuid,
  p_as_of     date default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_as_of date;
  v_principal numeric;
  v_start date;
  v_end date;
  v_status text;
  v_bad_debt numeric;
  v_waiver_months int;
  v_interest_start date;
  v_running_balance numeric;
  v_expected numeric := 0;
  r record;
  v_cursor date;
  v_rate numeric;
  v_chunk_end date;
  v_chunk_months int;
begin
  v_as_of := coalesce(p_as_of, (now() at time zone 'Asia/Kolkata')::date);

  select principal_amount, start_date, end_date, status,
         coalesce(bad_debt, 0), coalesce(interest_waiver_months, 0)
    into v_principal, v_start, v_end, v_status, v_bad_debt, v_waiver_months
  from public.loans where id = p_loan_id;

  v_end := coalesce(v_end, v_as_of);
  if v_end > v_as_of then v_end := v_as_of; end if;

  v_interest_start := (v_start + (v_waiver_months || ' months')::interval)::date;
  v_running_balance := v_principal;

  -- Apply waiver-window repayments to the running balance up front.
  for r in
    select transaction_date, amount
    from public.transactions
    where loan_id = p_loan_id
      and transaction_type = 'loan_repayment'
      and transaction_date < v_interest_start
    order by transaction_date
  loop
    v_running_balance := greatest(v_running_balance - r.amount, 0);
  end loop;

  -- Piecewise accrual after the waiver window.
  if v_interest_start < v_end then
    v_cursor := v_interest_start;
    for r in
      select transaction_date, amount
      from public.transactions
      where loan_id = p_loan_id
        and transaction_type = 'loan_repayment'
        and transaction_date >= v_interest_start
        and transaction_date <= v_end
      order by transaction_date
    loop
      v_chunk_end := least(r.transaction_date, v_end);
      if v_chunk_end > v_cursor then
        v_chunk_months := (extract(year from v_chunk_end)::int - extract(year from v_cursor)::int) * 12
                        + (extract(month from v_chunk_end)::int - extract(month from v_cursor)::int);
        -- Use the rate in effect at the START of the chunk. (Good enough; rate
        -- changes mid-loan are rare in this fund's history.)
        select value into v_rate
        from public.reference_history
        where key = 'interest_per_lakh'
          and effective_from <= v_cursor
          and (effective_to is null or effective_to >= v_cursor)
        order by effective_from desc limit 1;
        if v_rate is null then
          raise exception 'No interest_per_lakh in reference_history for %', v_cursor;
        end if;
        v_expected := v_expected + (v_running_balance / 100000.0) * v_rate * v_chunk_months;
      end if;
      v_running_balance := greatest(v_running_balance - r.amount, 0);
      v_cursor := v_chunk_end;
      if v_cursor >= v_end then exit; end if;
    end loop;

    if v_cursor < v_end then
      v_chunk_months := (extract(year from v_end)::int - extract(year from v_cursor)::int) * 12
                      + (extract(month from v_end)::int - extract(month from v_cursor)::int);
      select value into v_rate
      from public.reference_history
      where key = 'interest_per_lakh'
        and effective_from <= v_cursor
        and (effective_to is null or effective_to >= v_cursor)
      order by effective_from desc limit 1;
      v_expected := v_expected + (v_running_balance / 100000.0) * v_rate * v_chunk_months;
    end if;
  end if;

  return round(v_expected, 2);
end;
$$;

-- Seed one opening-balance row per active loan.
do $$
declare
  l record;
  v_paid numeric;
  v_expected numeric;
  v_due numeric;
  v_rate numeric;
  v_balance numeric;
  v_period date := (now() at time zone 'Asia/Kolkata')::date - 1;
begin
  -- Pre-resolve today's rate for the balance_basis snapshot.
  select value into v_rate
  from public.reference_history
  where key = 'interest_per_lakh'
    and effective_from <= v_period
    and (effective_to is null or effective_to >= v_period)
  order by effective_from desc limit 1;

  for l in select id, principal_amount, bad_debt from public.loans where status = 'active' loop
    v_expected := public.fn_compute_expected_interest(l.id, v_period);
    select coalesce(sum(amount), 0) into v_paid
    from public.transactions
    where loan_id = l.id
      and transaction_type = 'interest'
      and interest_source = 'loans';
    v_due := greatest(v_expected - v_paid, 0);

    v_balance := greatest(
      l.principal_amount
      - coalesce((select sum(amount) from public.transactions
                  where loan_id = l.id
                    and transaction_type = 'loan_repayment'
                    and transaction_date <= v_period), 0)
      - coalesce(l.bad_debt, 0),
      0
    );

    insert into public.loan_interest_accruals (
      loan_id, period_end, amount_due, status,
      interest_rate_used, balance_basis, is_opening_balance, recomputed_at
    ) values (
      l.id, v_period, v_due,
      case when v_due <= 0 then 'paid' else 'pending' end,
      v_rate, v_balance, true, now()
    )
    on conflict (loan_id, period_end) do nothing;
  end loop;
end $$;

commit;
