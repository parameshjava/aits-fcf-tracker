-- =============================================================================
-- 037 — EMI model configuration keys.
--
-- Inserts 7 new key/value rows into public.reference and matching baseline
-- rows into public.reference_history.
--
-- NOTE: emi_cutover_date default (20260701) is a placeholder — set the real
-- cutover date before running in prod via the /admin/reference UI or a follow-up
-- UPDATE, then close out the history row and append the corrected value.
-- reference.value is numeric, so the date is stored as a YYYYMMDD integer;
-- convert back with to_date(value::int::text,'YYYYMMDD').
--
-- IDEMPOTENT: `on conflict (key) do nothing` means re-running is safe and
-- existing values are never overwritten.
-- =============================================================================

begin;

insert into public.reference (key, name, description, value) values
  (
    'loan_interest_rate_pct',
    'Loan Interest Rate (%)',
    'Annual interest rate applied to EMI-model loans, expressed as a percentage.',
    8
  ),
  (
    'loan_max_term_months',
    'Loan Maximum Term (months)',
    'Maximum repayment period for any new loan under the EMI model.',
    30
  ),
  (
    'loan_default_waiver_medical',
    'Default Waiver — Medical (months)',
    'Default number of interest-free waiver months granted for medical-purpose loans.',
    6
  ),
  (
    'loan_max_waiver_months',
    'Maximum Waiver (months)',
    'Absolute cap on interest-waiver months that can be granted to any single loan.',
    6
  ),
  (
    'late_fee_pct',
    'Late Fee (%)',
    'Percentage of the overdue EMI amount charged as a late fee.',
    2
  ),
  (
    'late_fee_overdue_months',
    'Late Fee Threshold (months overdue)',
    'Number of months a payment must be overdue before a late fee is applied.',
    2
  ),
  (
    'emi_cutover_date',
    'EMI Cutover Date (YYYYMMDD)',
    'Date from which legacy loans convert to the EMI model, stored as a YYYYMMDD integer (20260701 = 2026-07-01). Placeholder — update before go-live.',
    20260701
    -- reference.value is numeric; emi_cutover_date is a YYYYMMDD integer.
    -- Convert back with to_date(value::int::text, ''YYYYMMDD'') in queries.
  )
on conflict (key) do nothing;

-- Mirror each new key into reference_history (open-ended baseline).
-- Pattern matches 005: effective_from = now()::date (runtime-added keys have
-- no meaningful historical start, so we use today), effective_to = NULL.
-- The select-where-not-exists guard makes this idempotent.
insert into public.reference_history (key, value, effective_from, effective_to, notes)
select r.key, r.value, now()::date, null, 'EMI model baseline — set by migration 037'
  from public.reference r
 where r.key in (
   'loan_interest_rate_pct',
   'loan_max_term_months',
   'loan_default_waiver_medical',
   'loan_max_waiver_months',
   'late_fee_pct',
   'late_fee_overdue_months',
   'emi_cutover_date'
 )
   and not exists (
     select 1 from public.reference_history h where h.key = r.key
   );

commit;
