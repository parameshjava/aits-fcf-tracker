-- =============================================================================
-- create-dashboard-views.sql
--
-- Views the dashboard reads from, instead of querying public.transactions
-- directly and aggregating in JS. Each view answers exactly one question the
-- /dashboard page asks. Re-runnable (`create or replace view`).
--
--   dashboard_transactions      — flattened txn rows + member name/slug
--                                 (used for the recent-activity table and
--                                 the per-month drill-down)
--   dashboard_monthly           — (year, month_index, …) buckets driving the
--                                 stacked-bar chart
--   dashboard_yearly            — per-year totals across all categories
--                                 (powers the "year totals" strip and the
--                                 donation-eligibility ledger inputs)
--   dashboard_overall           — single-row all-time totals (KPI tiles)
--   dashboard_member_totals     — per-member lifetime contribution totals,
--                                 sorted descending (leaderboard)
--
-- All views are simple SELECTs — Postgres will fold them inline at query
-- time, so there's no materialisation cost.
-- =============================================================================

-- 1) Transactions, flattened with member info.
create or replace view public.dashboard_transactions as
select
  t.id,
  t.transaction_id,
  t.transaction_date,
  t.amount,
  t.contribution_type,
  t.interest_source,
  t.description,
  t.member_id,
  t.loan_id,
  t.principal_paid,
  t.created_at,
  m.name as member_name,
  m.slug as member_slug
from public.transactions t
left join public.members m on m.id = t.member_id;

-- 2) Per-(year, month) buckets for the stacked-bar chart. month_index is
--    0-based so it lines up with JS Date.getUTCMonth().
create or replace view public.dashboard_monthly as
select
  extract(year  from t.transaction_date)::int     as year,
  (extract(month from t.transaction_date)::int - 1) as month_index,
  coalesce(sum(case when t.contribution_type = 'contribution'                            then t.amount end), 0)::numeric as contributions,
  coalesce(sum(case when t.contribution_type = 'interest' and t.interest_source <> 'bank' then t.amount end), 0)::numeric as loan_interest,
  coalesce(sum(case when t.contribution_type = 'interest' and t.interest_source =  'bank' then t.amount end), 0)::numeric as bank_interest
from public.transactions t
group by 1, 2;

-- 3) Per-year totals across categories.
create or replace view public.dashboard_yearly as
select
  extract(year from t.transaction_date)::int as year,
  coalesce(sum(case when t.contribution_type = 'contribution'                              then t.amount end), 0)::numeric as contributions,
  coalesce(sum(case when t.contribution_type = 'interest'   and t.interest_source <> 'bank' then t.amount end), 0)::numeric as loan_interest,
  coalesce(sum(case when t.contribution_type = 'interest'   and t.interest_source =  'bank' then t.amount end), 0)::numeric as bank_interest,
  coalesce(sum(case when t.contribution_type = 'donation'                                 then t.amount end), 0)::numeric as donations,
  coalesce(sum(case when t.contribution_type = 'loan_repayment'                           then t.amount end), 0)::numeric as loan_repayments,
  coalesce(sum(case when t.contribution_type = 'penalty'                                  then t.amount end), 0)::numeric as penalty
from public.transactions t
group by 1
order by 1;

-- 4) Single-row all-time totals (KPI tiles).
create or replace view public.dashboard_overall as
select
  coalesce(sum(case when contribution_type = 'contribution'                            then amount end), 0)::numeric as contributions,
  coalesce(sum(case when contribution_type = 'interest' and interest_source <> 'bank'  then amount end), 0)::numeric as loan_interest,
  coalesce(sum(case when contribution_type = 'interest' and interest_source =  'bank'  then amount end), 0)::numeric as bank_interest,
  coalesce(sum(case when contribution_type = 'donation'                                then amount end), 0)::numeric as donations,
  coalesce(sum(case when contribution_type = 'loan_repayment'                          then amount end), 0)::numeric as loan_repayments,
  coalesce(sum(case when contribution_type = 'penalty'                                 then amount end), 0)::numeric as penalty
from public.transactions;

-- 5) Per-member lifetime contribution totals — for the leaderboard.
create or replace view public.dashboard_member_totals as
select
  coalesce(m.name, '— Unattributed —') as member_name,
  count(*)::int                         as count,
  sum(t.amount)::numeric                as total
from public.transactions t
left join public.members m on m.id = t.member_id
where t.contribution_type = 'contribution'
group by coalesce(m.name, '— Unattributed —')
order by sum(t.amount) desc;

notify pgrst, 'reload schema';
