-- =============================================================================
-- seed-donation-eligibility-refs.sql
--
-- Adds the two reference rows that drive the donation-eligibility calculator
-- on the dashboard:
--
--   corpus_threshold           — cumulative contributions the fund must reach
--                                before any donations become eligible.
--   donation_eligibility_pct   — what percentage of each year's contributions
--                                accrues as donation-eligibility for that year.
--                                Unspent eligibility carries forward.
--
-- Admin can re-tune both values later via /admin/reference. `on conflict do
-- nothing` keeps this script idempotent and won't clobber tuned values.
-- =============================================================================

insert into public.reference (key, name, description, value) values
  (
    'corpus_threshold',
    'Donation eligibility — corpus threshold',
    'Cumulative active contributions the fund must reach before donations become eligible.',
    500000
  ),
  (
    'donation_eligibility_pct',
    'Donation eligibility — annual %',
    'Percentage of each year''s contributions that accrues as donation-eligibility. Unspent carries forward.',
    25
  )
on conflict (key) do nothing;
