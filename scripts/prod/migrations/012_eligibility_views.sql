-- =============================================================================
-- 012 — Donation eligibility views.
--
-- Two views feed the app: a per-period ledger with running carry-balance for
-- the donations section, and a single-row summary for the dashboard tile.
-- Consumption (donations + bad_debt) is computed live from transactions/loans
-- so backdated donations show up immediately without recomputing periods.
-- =============================================================================

begin;

create or replace view public.donation_eligibility_ledger as
select
  p.period_end,
  p.contributions_basis,
  p.pct_used,
  p.threshold_used,
  p.corpus_at_period_end,
  p.threshold_met,
  p.amount_earned,
  coalesce(d.donations_in_period, 0)  as donations_in_period,
  coalesce(bd.bad_debts_in_period, 0) as bad_debts_in_period,
  sum(p.amount_earned
      - coalesce(d.donations_in_period, 0)
      - coalesce(bd.bad_debts_in_period, 0))
    over (order by p.period_end) as carry_balance
from public.donation_eligibility_periods p
left join lateral (
  select sum(amount) as donations_in_period
  from public.transactions
  where transaction_type = 'donation'
    and transaction_date >  (p.period_end - interval '1 month')::date
    and transaction_date <= p.period_end
) d on true
left join lateral (
  select sum(coalesce(bad_debt, 0)) as bad_debts_in_period
  from public.loans
  where status = 'write_off'
    and end_date is not null
    and end_date >  (p.period_end - interval '1 month')::date
    and end_date <= p.period_end
) bd on true;

create or replace view public.donation_eligibility_summary as
select
  (select coalesce(sum(amount_earned), 0) from public.donation_eligibility_periods) as total_earned,
  (select coalesce(sum(amount), 0)
     from public.transactions where transaction_type = 'donation')                  as total_donated,
  (select coalesce(sum(coalesce(bad_debt, 0)), 0)
     from public.loans where status = 'write_off')                                  as total_bad_debt,
  greatest(
    (select coalesce(sum(amount_earned), 0) from public.donation_eligibility_periods)
    - (select coalesce(sum(amount), 0)
         from public.transactions where transaction_type = 'donation')
    - (select coalesce(sum(coalesce(bad_debt, 0)), 0)
         from public.loans where status = 'write_off'),
    0
  ) as available_now;

commit;

notify pgrst, 'reload schema';
