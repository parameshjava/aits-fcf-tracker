-- =============================================================================
-- 010 — Donation eligibility periods.
--
-- One row per calendar month, dated at EOM. Earned eligibility is
-- thatMonth.contributions × pct, gated on cumulative-corpus ≥ threshold.
-- Consumption (donations + bad_debt) is NOT stored here — it lives in
-- transactions / loans, and views (012) compute the running balance.
-- =============================================================================

begin;

create table if not exists public.donation_eligibility_periods (
  id                    uuid primary key default gen_random_uuid(),
  period_end            date not null unique,
  contributions_basis   numeric(12,2) not null default 0,
  pct_used              numeric not null,
  threshold_used        numeric not null,
  corpus_at_period_end  numeric(12,2) not null,
  threshold_met         boolean not null,
  amount_earned         numeric(12,2) not null,
  recomputed_at         timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists donation_eligibility_periods_period_end_idx
  on public.donation_eligibility_periods (period_end desc);

alter table public.donation_eligibility_periods enable row level security;

drop policy if exists "eligibility_read_authenticated" on public.donation_eligibility_periods;
create policy "eligibility_read_authenticated"
  on public.donation_eligibility_periods
  for select to authenticated using (true);

drop policy if exists "eligibility_write_admin" on public.donation_eligibility_periods;
create policy "eligibility_write_admin"
  on public.donation_eligibility_periods
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Helper: compute + upsert eligibility for one EOM date. Used by both the
-- cron function and the backfill function so the math lives in one place.
-- ---------------------------------------------------------------------------
create or replace function public.fn_compute_eligibility_for(p_period_end date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_start  date;
  v_pct           numeric;
  v_threshold     numeric;
  v_contributions numeric;
  v_corpus        numeric;
  v_threshold_met boolean;
  v_amount_earned numeric;
begin
  v_period_start := date_trunc('month', p_period_end)::date;

  select value into v_pct
  from public.reference_history
  where key = 'donation_eligibility_pct'
    and effective_from <= p_period_end
    and (effective_to is null or effective_to >= p_period_end)
  order by effective_from desc
  limit 1;

  if v_pct is null then
    raise exception 'No donation_eligibility_pct in reference_history for %', p_period_end;
  end if;

  select value into v_threshold
  from public.reference_history
  where key = 'corpus_threshold'
    and effective_from <= p_period_end
    and (effective_to is null or effective_to >= p_period_end)
  order by effective_from desc
  limit 1;

  if v_threshold is null then
    raise exception 'No corpus_threshold in reference_history for %', p_period_end;
  end if;

  select coalesce(sum(amount), 0) into v_contributions
  from public.transactions
  where transaction_type = 'contribution'
    and transaction_date between v_period_start and p_period_end;

  select
    coalesce(sum(case when transaction_type = 'contribution' then amount end), 0)
    - coalesce(sum(case when transaction_type = 'donation'   then amount end), 0)
    into v_corpus
  from public.transactions
  where transaction_date <= p_period_end;

  v_corpus := v_corpus - coalesce(
    (select sum(coalesce(bad_debt, 0)) from public.loans
     where status = 'write_off' and end_date is not null and end_date <= p_period_end),
    0
  );

  v_threshold_met := v_corpus >= v_threshold;
  v_amount_earned := case when v_threshold_met
                          then round(v_contributions * v_pct / 100.0, 2)
                          else 0 end;

  insert into public.donation_eligibility_periods (
    period_end, contributions_basis, pct_used, threshold_used,
    corpus_at_period_end, threshold_met, amount_earned, recomputed_at
  ) values (
    p_period_end, v_contributions, v_pct, v_threshold,
    v_corpus, v_threshold_met, v_amount_earned, now()
  )
  on conflict (period_end) do update set
    contributions_basis  = excluded.contributions_basis,
    pct_used             = excluded.pct_used,
    threshold_used       = excluded.threshold_used,
    corpus_at_period_end = excluded.corpus_at_period_end,
    threshold_met        = excluded.threshold_met,
    amount_earned        = excluded.amount_earned,
    recomputed_at        = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Cron entrypoint. EOM-IST guard inside the function so the cron schedule
-- can be a UTC heartbeat (see migration 013).
-- ---------------------------------------------------------------------------
create or replace function public.fn_accrue_donation_eligibility()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today_ist date;
begin
  v_today_ist := (now() at time zone 'Asia/Kolkata')::date;
  if (v_today_ist + 1) <> (date_trunc('month', v_today_ist + interval '1 month'))::date then
    return;
  end if;
  perform public.fn_compute_eligibility_for(v_today_ist);
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill from fund inception to today. Idempotent (upsert via helper).
-- Returns row count for visibility.
-- ---------------------------------------------------------------------------
create or replace function public.fn_backfill_donation_eligibility()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date;
  v_iter  date;
  v_count int := 0;
begin
  select (date_trunc('month', min(transaction_date)) + interval '1 month' - interval '1 day')::date
    into v_start
  from public.transactions
  where transaction_type = 'contribution';

  if v_start is null then return 0; end if;

  v_iter := v_start;
  while v_iter <= (now() at time zone 'Asia/Kolkata')::date loop
    perform public.fn_compute_eligibility_for(v_iter);
    v_count := v_count + 1;
    -- Jump to next EOM
    v_iter := (date_trunc('month', v_iter + interval '2 days') + interval '1 month' - interval '1 day')::date;
  end loop;

  return v_count;
end;
$$;

commit;

notify pgrst, 'reload schema';
