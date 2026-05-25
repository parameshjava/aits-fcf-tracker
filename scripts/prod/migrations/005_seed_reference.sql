-- =============================================================================
-- 005 — Seed global reference values.
--
-- All four rows are idempotent (`on conflict (key) do nothing`). Existing
-- values are never overwritten — admins can re-tune from /admin/reference.
--
-- reference_history baseline rows pin each value's start date to far enough
-- in the past that every historical transaction has a defined value to look
-- up. Admins can split open-ended periods later by closing out the current
-- row's `effective_to` and appending a new one via the server action.
-- =============================================================================

begin;

insert into public.reference (key, name, description, value) values
  (
    'interest_per_lakh',
    'Loan Interest (per ₹1 lakh / month)',
    'Monthly interest charged per ₹1 lakh of loan principal.',
    650
  ),
  (
    'bank_balance',
    'FCF Bank Balance',
    'Current available balance in the FCF bank account.',
    0
  ),
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

-- Mirror each current reference value into reference_history with an
-- effective_from far enough in the past to cover every transaction year.
-- effective_to is NULL = currently active (open-ended).
insert into public.reference_history (key, value, effective_from, effective_to, notes)
select r.key, r.value, '2000-01-01'::date, null, 'initial baseline'
  from public.reference r
 where not exists (
   select 1 from public.reference_history h where h.key = r.key
 );

commit;
