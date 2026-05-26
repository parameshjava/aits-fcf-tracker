-- =============================================================================
-- 009 — Loan interest accruals.
--
-- One row per active loan per month from cutover onward (plus one synthetic
-- opening-balance row per active loan seeded in migration 014).
-- Junction table allows one transactions row to settle multiple months.
-- =============================================================================

begin;

-- Tables -------------------------------------------------------------------

create table if not exists public.loan_interest_accruals (
  id                  uuid primary key default gen_random_uuid(),
  loan_id             uuid not null references public.loans(id) on delete cascade,
  period_end          date not null,
  amount_due          numeric(12,2) not null default 0,
  paid_amount         numeric(12,2) not null default 0 check (paid_amount >= 0),
  status              text not null default 'pending'
                        check (status in ('pending','partially_paid','paid','waived')),
  interest_rate_used  numeric not null,
  balance_basis       numeric(12,2) not null,
  is_opening_balance  boolean not null default false,
  waiver_reason       text,
  recomputed_at       timestamptz,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (loan_id, period_end)
);

create index if not exists loan_interest_accruals_loan_status_idx
  on public.loan_interest_accruals (loan_id, status);
create index if not exists loan_interest_accruals_period_end_idx
  on public.loan_interest_accruals (period_end);

create table if not exists public.loan_interest_payments (
  accrual_id      uuid not null references public.loan_interest_accruals(id) on delete restrict,
  transaction_id  uuid not null references public.transactions(id) on delete restrict,
  amount_applied  numeric(12,2) not null check (amount_applied > 0),
  applied_at      timestamptz not null default now(),
  primary key (accrual_id, transaction_id)
);

create index if not exists loan_interest_payments_txn_idx
  on public.loan_interest_payments (transaction_id);

-- RLS ----------------------------------------------------------------------

alter table public.loan_interest_accruals enable row level security;
drop policy if exists "accruals_read_authenticated" on public.loan_interest_accruals;
create policy "accruals_read_authenticated"
  on public.loan_interest_accruals
  for select to authenticated using (true);
drop policy if exists "accruals_write_admin" on public.loan_interest_accruals;
create policy "accruals_write_admin"
  on public.loan_interest_accruals
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.loan_interest_payments enable row level security;
drop policy if exists "interest_payments_read_authenticated" on public.loan_interest_payments;
create policy "interest_payments_read_authenticated"
  on public.loan_interest_payments
  for select to authenticated using (true);
drop policy if exists "interest_payments_write_admin" on public.loan_interest_payments;
create policy "interest_payments_write_admin"
  on public.loan_interest_payments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Junction trigger: keep accruals.paid_amount + status in sync -----------

create or replace function public.fn_recompute_accrual_paid_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_accrual_id uuid;
  v_total_applied numeric;
  v_amount_due numeric;
  v_new_status text;
  v_new_paid_at timestamptz;
begin
  -- For INSERT and DELETE alike, recompute the affected accrual rows.
  v_accrual_id := coalesce(new.accrual_id, old.accrual_id);

  select coalesce(sum(amount_applied), 0)
    into v_total_applied
  from public.loan_interest_payments
  where accrual_id = v_accrual_id;

  select amount_due into v_amount_due
  from public.loan_interest_accruals
  where id = v_accrual_id;

  if v_total_applied > v_amount_due + 0.005 then
    raise exception 'Overpayment: % applied vs % due (accrual %)',
      v_total_applied, v_amount_due, v_accrual_id;
  end if;

  if v_total_applied = 0 then
    v_new_status := 'pending';
    v_new_paid_at := null;
  elsif v_total_applied >= v_amount_due - 0.005 then
    v_new_status := 'paid';
    -- Preserve the original paid_at if already set; otherwise stamp now.
    select coalesce(paid_at, now()) into v_new_paid_at
    from public.loan_interest_accruals where id = v_accrual_id;
  else
    v_new_status := 'partially_paid';
    v_new_paid_at := null;
  end if;

  -- Don't clobber waived rows; payments shouldn't target them anyway, but be safe.
  update public.loan_interest_accruals
  set paid_amount = v_total_applied,
      status      = case when status = 'waived' then 'waived' else v_new_status end,
      paid_at     = case when status = 'waived' then paid_at  else v_new_paid_at end
  where id = v_accrual_id;

  return null;
end;
$$;

drop trigger if exists loan_interest_payments_recompute on public.loan_interest_payments;
create trigger loan_interest_payments_recompute
  after insert or delete on public.loan_interest_payments
  for each row execute function public.fn_recompute_accrual_paid_state();

-- Loan closure trigger: waive pending accruals -----------------------------

create or replace function public.fn_waive_accruals_on_loan_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('paid', 'write_off') and old.status = 'active' then
    update public.loan_interest_accruals
    set status         = 'waived',
        amount_due     = 0,
        waiver_reason  = 'loan_closed',
        recomputed_at  = now()
    where loan_id = new.id
      and status in ('pending', 'partially_paid');
  end if;
  return new;
end;
$$;

drop trigger if exists loans_closure_waive_accruals on public.loans;
create trigger loans_closure_waive_accruals
  after update of status on public.loans
  for each row execute function public.fn_waive_accruals_on_loan_close();

-- Accrual helper + cron function ------------------------------------------
--
-- Split into two functions so the admin "Re-run loan interest" button can
-- recompute a specific past EOM (post `reference_history` correction)
-- without going through the cron's EOM-IST guard.

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
    raise exception 'No interest_per_lakh in reference_history for %', p_period_end;
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
      -- Anniversary-month diff, mirrors src/lib/loan-math.ts:monthsBetweenDates.
      (extract(year  from p_period_end)::int - extract(year  from l.start_date)::int) * 12
      + (extract(month from p_period_end)::int - extract(month from l.start_date)::int) as months_elapsed,
      (l.start_date + (l.interest_waiver_months || ' months')::interval)::date as interest_start_date
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
    recomputed_at      = now()
  where loan_interest_accruals.status in ('pending', 'waived');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Cron wrapper: EOM-IST guard + delegate to the helper.
create or replace function public.fn_accrue_loan_interest()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today_ist date;
begin
  v_today_ist := (now() at time zone 'Asia/Kolkata')::date;
  if (v_today_ist + 1) <> (date_trunc('month', v_today_ist + interval '1 month'))::date then
    return 0;  -- not EOM in IST
  end if;
  return public.fn_compute_loan_interest_for(v_today_ist);
end;
$$;

-- Payment function (called by the server action) ---------------------------

create or replace function public.fn_apply_interest_payment(
  p_loan_id        uuid,
  p_transaction_date date,
  p_allocations    jsonb,            -- [{"accrual_id": "...", "amount": 1234.56}, ...]
  p_notes          text default null,
  p_created_by     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_txn_id uuid;
  v_alloc jsonb;
begin
  -- Sum allocations
  select coalesce(sum((a->>'amount')::numeric), 0)
    into v_total
  from jsonb_array_elements(p_allocations) a;

  if v_total <= 0 then
    raise exception 'Total payment must be positive (got %)', v_total;
  end if;

  -- Insert one transactions row (transaction_id auto-fills via set_transaction_id trigger)
  insert into public.transactions (
    amount, transaction_type, interest_source,
    loan_id, transaction_date, description, created_by
  )
  select
    v_total, 'interest', 'loans',
    p_loan_id, p_transaction_date, p_notes, p_created_by
  returning id into v_txn_id;

  -- Insert junction rows. The trigger recomputes paid_amount + status.
  for v_alloc in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.loan_interest_payments (
      accrual_id, transaction_id, amount_applied
    ) values (
      (v_alloc->>'accrual_id')::uuid,
      v_txn_id,
      (v_alloc->>'amount')::numeric
    );
  end loop;

  return v_txn_id;
end;
$$;

commit;

notify pgrst, 'reload schema';
