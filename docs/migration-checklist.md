# Monthly Accruals — Migration Checklist

Use this checklist when applying the 009–015 migrations to production.

## Pre-flight (before any migration)

- [ ] On `/dashboard`, note the **Available now** value for donation eligibility. Save as `OLD_AVAILABLE`.
- [ ] On `/admin/loans`, for each active loan note the **Pending interest** value. Save as `OLD_LOAN_DUE_<loan_number>`.
- [ ] `select count(*) from public.loans where status = 'active';` — save as `ACTIVE_LOAN_COUNT`.
- [ ] Confirm `reference_history` has rows for `interest_per_lakh`, `donation_eligibility_pct`, `corpus_threshold` covering the full fund history.

## Apply migrations in order

1. `009_loan_interest_accruals.sql` — tables, triggers, functions.
2. `010_donation_eligibility.sql` — eligibility table + helpers.
3. `011_loans_balances_view.sql` — view update (depends on 009).
4. `012_eligibility_views.sql` — ledger + summary views.
5. `013_pg_cron_schedule.sql` — pg_cron registration. **Enable extension via Supabase UI first.**
6. `014_seed_active_loan_openings.sql` — opening-balance seeds.
7. `015_seed_donation_eligibility.sql` — historical eligibility backfill.

## Parity checks (after backfills)

> **Note on parity:** Significant differences between the new view values and the prior dashboard values are EXPECTED, not bugs. The new accrual logic implements the spec rules directly; the prior `src/lib/eligibility.ts` and `src/lib/loan-math.ts` math may have included calculations that didn't match the spec. Treat the parity SQL below as a sanity check (order of magnitude, sign) rather than a strict equality test.

```sql
-- Eligibility parity
select available_now from public.donation_eligibility_summary;
-- ↓ must equal OLD_AVAILABLE ± ₹1.

-- Loan interest parity
select l.loan_number, lb.pending_interest
from public.loans_balances lb
join public.loans l on l.id = lb.loan_id
where lb.status = 'active'
order by l.loan_number;
-- ↓ each pending_interest must equal OLD_LOAN_DUE_<loan_number> ± ₹1.

-- Opening-balance row count
select count(*) from public.loan_interest_accruals where is_opening_balance;
-- ↓ must equal ACTIVE_LOAN_COUNT.
```

## Post-deploy

- [ ] Watch first EOM cron run in `cron.job_run_details` (run at 18:25 UTC on the last day of the month).
- [ ] Verify one new `loan_interest_accruals` row per active loan with `period_end = <EOM date>`.
- [ ] Verify one new `donation_eligibility_periods` row for the EOM date.

## Rollback

If a migration fails partway:

- The migration files are idempotent (`create table if not exists`, `on conflict do update`).
- To fully undo, drop in reverse order:
  ```sql
  select cron.unschedule('fcf-eom-accruals');
  drop view if exists public.donation_eligibility_summary;
  drop view if exists public.donation_eligibility_ledger;
  -- 011's loans_balances view: restore from migration 003.
  drop function if exists public.fn_apply_interest_payment;
  drop function if exists public.fn_accrue_loan_interest;
  drop function if exists public.fn_compute_loan_interest_for(date);
  drop function if exists public.fn_compute_expected_interest;
  drop function if exists public.fn_waive_accruals_on_loan_close;
  drop function if exists public.fn_recompute_accrual_paid_state;
  drop function if exists public.fn_backfill_donation_eligibility;
  drop function if exists public.fn_accrue_donation_eligibility;
  drop function if exists public.fn_compute_eligibility_for;
  drop table if exists public.loan_interest_payments;
  drop table if exists public.loan_interest_accruals;
  drop table if exists public.donation_eligibility_periods;
  ```
- Re-run `003_views.sql` to restore the original `loans_balances` view.
- Re-deploy the previous app commit (eligibility.ts + loan-math.ts paths still work; the dashboard read will fall back to derived math).
