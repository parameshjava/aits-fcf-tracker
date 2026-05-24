-- =============================================================================
-- FCF Tracker — Production views
-- File 2 of 3.  Run after scripts/prod/01-schema.sql.
--
-- These six views are everything the app reads for read-paths:
--
--   public.member_directory          → /dashboard/members (one row per
--                                       member with contacts + bank
--                                       accounts as JSON arrays)
--
--   public.dashboard_transactions    → flattened txns + member info
--                                       (recent activity + drill-down)
--   public.dashboard_monthly         → per-(year, month_index) buckets
--                                       for the stacked-bar chart
--   public.dashboard_yearly          → per-year totals across categories
--                                       (year-totals strip, eligibility)
--   public.dashboard_overall         → single-row all-time totals
--                                       (KPI tiles)
--   public.dashboard_member_totals   → per-member lifetime contributions
--                                       (leaderboard)
--
-- All views are plain SELECTs — Postgres folds them inline, no materialisation.
-- Re-runnable (`create or replace view`).
-- =============================================================================

-- 1) Member directory — one row per member with contacts + bank_accounts JSON
create or replace view public.member_directory as
select
  m.id,
  m.name,
  m.slug,
  m.status,
  m.email,
  m.notes,
  m.created_at,
  coalesce(c.contacts,      '[]'::jsonb) as contacts,
  coalesce(b.bank_accounts, '[]'::jsonb) as bank_accounts
from public.members m
left join lateral (
  select jsonb_agg(
           jsonb_build_object(
             'id',          mc.id,
             'kind',        mc.kind,
             'value',       mc.value,
             'label',       mc.label,
             'is_primary',  mc.is_primary,
             'created_at',  mc.created_at
           )
           order by mc.is_primary desc, mc.kind, mc.created_at
         ) as contacts
  from public.member_contacts mc
  where mc.member_id = m.id
) c on true
left join lateral (
  select jsonb_agg(
           jsonb_build_object(
             'id',             ba.id,
             'bank_name',      ba.bank_name,
             'account_number', ba.account_number,
             'ifsc_code',      ba.ifsc_code,
             'account_type',   ba.account_type,
             'branch',         ba.branch,
             'upi_id',         ba.upi_id,
             'is_primary',     ba.is_primary
           )
           order by ba.is_primary desc nulls last, ba.created_at
         ) as bank_accounts
  from public.bank_accounts ba
  where ba.member_id = m.id
) b on true;

-- 2) Dashboard transactions — flattened txn rows + member name/slug.
create or replace view public.dashboard_transactions as
select
  t.id,
  t.transaction_id,
  t.transaction_date,
  t.amount,
  t.transaction_type,
  t.interest_source,
  t.description,
  t.member_id,
  t.loan_id,
  t.created_at,
  m.name as member_name,
  m.slug as member_slug
from public.transactions t
left join public.members m on m.id = t.member_id;

-- 3) Per-(year, month_index) buckets for the stacked-bar chart.
--    month_index is 0-based to line up with JS Date.getUTCMonth().
create or replace view public.dashboard_monthly as
select
  extract(year  from t.transaction_date)::int     as year,
  (extract(month from t.transaction_date)::int - 1) as month_index,
  coalesce(sum(case when t.transaction_type = 'contribution'                            then t.amount end), 0)::numeric as contributions,
  coalesce(sum(case when t.transaction_type = 'interest' and t.interest_source <> 'bank' then t.amount end), 0)::numeric as loan_interest,
  coalesce(sum(case when t.transaction_type = 'interest' and t.interest_source =  'bank' then t.amount end), 0)::numeric as bank_interest
from public.transactions t
group by 1, 2;

-- 4) Per-year totals across all categories.
create or replace view public.dashboard_yearly as
select
  extract(year from t.transaction_date)::int as year,
  coalesce(sum(case when t.transaction_type = 'contribution'                              then t.amount end), 0)::numeric as contributions,
  coalesce(sum(case when t.transaction_type = 'interest'   and t.interest_source <> 'bank' then t.amount end), 0)::numeric as loan_interest,
  coalesce(sum(case when t.transaction_type = 'interest'   and t.interest_source =  'bank' then t.amount end), 0)::numeric as bank_interest,
  coalesce(sum(case when t.transaction_type = 'donation'                                 then t.amount end), 0)::numeric as donations,
  coalesce(sum(case when t.transaction_type = 'loan_repayment'                           then t.amount end), 0)::numeric as loan_repayments,
  coalesce(sum(case when t.transaction_type = 'penalty'                                  then t.amount end), 0)::numeric as penalty
from public.transactions t
group by 1
order by 1;

-- 5) Single-row all-time totals (KPI tiles).
create or replace view public.dashboard_overall as
select
  coalesce(sum(case when transaction_type = 'contribution'                            then amount end), 0)::numeric as contributions,
  coalesce(sum(case when transaction_type = 'interest' and interest_source <> 'bank'  then amount end), 0)::numeric as loan_interest,
  coalesce(sum(case when transaction_type = 'interest' and interest_source =  'bank'  then amount end), 0)::numeric as bank_interest,
  coalesce(sum(case when transaction_type = 'donation'                                then amount end), 0)::numeric as donations,
  coalesce(sum(case when transaction_type = 'loan_repayment'                          then amount end), 0)::numeric as loan_repayments,
  coalesce(sum(case when transaction_type = 'penalty'                                 then amount end), 0)::numeric as penalty
from public.transactions;

-- 6.5) Per-loan balances — joins loans + their transactions and reports
--      paid principal, paid interest, and pending principal in one row.
--      Mirrors the math in src/lib/loan-math.ts:computeLoanFinancials so
--      SQL queries and the app stay in sync.
create or replace view public.loans_balances as
select
  l.id                            as loan_id,
  l.loan_number,
  l.member_id,
  l.principal_amount,
  l.bad_debt,
  l.interest_waiver_months,
  l.interest_waived,
  l.start_date,
  l.end_date,
  l.status,
  -- Principal repaid = sum of `amount` on loan_repayment rows.
  coalesce(sum(t.amount) filter (where t.transaction_type = 'loan_repayment'), 0)::numeric  as paid_principal,
  -- Interest collected = sum of `amount` on interest rows tagged to loans.
  coalesce(sum(t.amount) filter (where t.transaction_type = 'interest' and t.interest_source = 'loans'), 0)::numeric  as paid_interest,
  -- Pending principal = principal − paid principal − bad debt, clamped ≥ 0.
  greatest(
    l.principal_amount
    - coalesce(sum(t.amount) filter (where t.transaction_type = 'loan_repayment'), 0)
    - coalesce(l.bad_debt, 0),
    0
  )::numeric                       as pending_principal
from public.loans l
left join public.transactions t on t.loan_id = l.id
group by l.id;

-- 6.6) Member × month contribution matrix. One row per (year, member),
--      twelve numeric columns (jan…dec) holding that member's contribution
--      sum for that month, plus a `total` for the year. The dashboard
--      filters by year via WHERE year = :year.
create or replace view public.dashboard_member_month_matrix as
select
  extract(year from t.transaction_date)::int        as year,
  m.id                                              as member_id,
  coalesce(m.name, '— Unattributed —')              as member_name,
  coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 1),  0)::numeric as jan,
  coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 2),  0)::numeric as feb,
  coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 3),  0)::numeric as mar,
  coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 4),  0)::numeric as apr,
  coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 5),  0)::numeric as may,
  coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 6),  0)::numeric as jun,
  coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 7),  0)::numeric as jul,
  coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 8),  0)::numeric as aug,
  coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 9),  0)::numeric as sep,
  coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 10), 0)::numeric as oct,
  coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 11), 0)::numeric as nov,
  coalesce(sum(t.amount) filter (where extract(month from t.transaction_date) = 12), 0)::numeric as dec,
  coalesce(sum(t.amount), 0)::numeric                as total
from public.transactions t
left join public.members m on m.id = t.member_id
where t.transaction_type = 'contribution'
group by extract(year from t.transaction_date), m.id, m.name
order by 1 desc, member_name;

-- 7) Per-member lifetime contribution totals (leaderboard, descending).
create or replace view public.dashboard_member_totals as
select
  coalesce(m.name, '— Unattributed —') as member_name,
  count(*)::int                         as count,
  sum(t.amount)::numeric                as total
from public.transactions t
left join public.members m on m.id = t.member_id
where t.transaction_type = 'contribution'
group by coalesce(m.name, '— Unattributed —')
order by sum(t.amount) desc;

notify pgrst, 'reload schema';
