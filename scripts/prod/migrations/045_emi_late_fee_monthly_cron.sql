-- =============================================================================
-- 045 — Run the EMI late-fee job monthly on the 11th (IST), not daily.
--
-- EMIs are due on the 10th, so late fees are evaluated on the 11th of each month
-- (like accruals run at month-end). The 2-month grace is unchanged: a one-time
-- fee is charged only once an installment is ~2 months past due (governed by the
-- late_fee_overdue_months reference value); fn_apply_emi_late_fees is unchanged.
--
--   * 'fcf-eom-accruals'   → back to accruals + donation eligibility only
--                            (the late-fee line added in 039 is removed).
--   * 'fcf-emi-late-fees'  → new job at 00:30 UTC on the 11th (= 06:00 IST, 11th).
-- =============================================================================

begin;

-- 1) EOM accruals job — drop the daily late-fee call.
do $$
begin
  perform cron.unschedule('fcf-eom-accruals');
exception when others then null;
end $$;

select cron.schedule(
  'fcf-eom-accruals',
  '25 18 * * *',
  $cron$
    select public.fn_accrue_loan_interest();
    select public.fn_accrue_donation_eligibility();
  $cron$
);

-- 2) Dedicated monthly late-fee job on the 11th (IST).
do $$
begin
  perform cron.unschedule('fcf-emi-late-fees');
exception when others then null;
end $$;

select cron.schedule(
  'fcf-emi-late-fees',
  '30 0 11 * *',   -- 00:30 UTC on the 11th = 06:00 IST on the 11th
  $cron$
    select public.fn_apply_emi_late_fees();
  $cron$
);

commit;
