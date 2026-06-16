-- =============================================================================
-- 050 — Member × month matrix: show every ACTIVE member, not just contributors.
--
-- The original dashboard_member_month_matrix (migration 003) was built FROM
-- transactions, so a member who recorded no contribution in a given year simply
-- never appeared in that year's matrix. The dashboard's "Member × Month" tab is
-- meant to be a roster the whole batch is measured against — an active member
-- with no payment yet should still show as a row of em-dashes, not vanish.
--
-- New shape: the row set is the GRID of (contribution-year × active member),
-- UNIONed with every (year, member_id) that actually has a contribution. The
-- union arm preserves two cases the active-member grid alone would drop:
--   * inactive / archived members who DID contribute in some year, and
--   * the null-member "— Unattributed —" bucket (contributions with no member).
-- Contribution sums are then left-joined on, so empty (member, year) cells fall
-- back to 0 and render as "—" in the UI.
--
-- Column list & order are byte-identical to migration 003 (year, member_id,
-- member_name, jan…dec, total) so `create or replace view` only swaps the body.
--
-- Re-runnable (create-or-replace).
-- =============================================================================

begin;

create or replace view public.dashboard_member_month_matrix as
with contrib as (
  -- Per (year, member) contribution sums — the original aggregation, kept as a
  -- CTE so we can both derive the year list from it and join it back on.
  select
    extract(year from t.transaction_date)::int as year,
    t.member_id,
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
  where t.transaction_type = 'contribution'
  group by extract(year from t.transaction_date), t.member_id
),
years as (
  select distinct year from contrib
),
grid as (
  -- Every active member for every year that has any contribution…
  select y.year, m.id as member_id
  from years y
  cross join public.members m
  where m.status = 'active'
  union
  -- …plus every (year, member) that actually contributed. Covers inactive /
  -- archived contributors and the null "— Unattributed —" bucket (UNION treats
  -- NULL member_ids as equal, so the bucket collapses to one row per year).
  select year, member_id from contrib
)
select
  g.year,
  g.member_id,
  coalesce(m.name, '— Unattributed —')              as member_name,
  coalesce(c.jan, 0)::numeric                       as jan,
  coalesce(c.feb, 0)::numeric                       as feb,
  coalesce(c.mar, 0)::numeric                       as mar,
  coalesce(c.apr, 0)::numeric                       as apr,
  coalesce(c.may, 0)::numeric                       as may,
  coalesce(c.jun, 0)::numeric                       as jun,
  coalesce(c.jul, 0)::numeric                       as jul,
  coalesce(c.aug, 0)::numeric                       as aug,
  coalesce(c.sep, 0)::numeric                       as sep,
  coalesce(c.oct, 0)::numeric                       as oct,
  coalesce(c.nov, 0)::numeric                       as nov,
  coalesce(c.dec, 0)::numeric                       as dec,
  coalesce(c.total, 0)::numeric                     as total
from grid g
left join public.members m on m.id = g.member_id
left join contrib c
  on c.year = g.year
  and c.member_id is not distinct from g.member_id
order by g.year desc, member_name;

commit;

notify pgrst, 'reload schema';
