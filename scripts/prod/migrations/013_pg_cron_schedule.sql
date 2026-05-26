-- =============================================================================
-- 013 — pg_cron schedule.
--
-- Single daily heartbeat at 18:25 UTC (23:55 IST). Both accrual functions
-- guard internally on EOM-IST so the schedule string stays simple.
-- =============================================================================

begin;

-- Idempotent unschedule + re-schedule.
do $$
begin
  perform cron.unschedule('fcf-eom-accruals');
exception when others then
  -- Job didn't exist; ignore.
  null;
end $$;

select cron.schedule(
  'fcf-eom-accruals',
  '25 18 * * *',
  $cron$
    select public.fn_accrue_loan_interest();
    select public.fn_accrue_donation_eligibility();
  $cron$
);

commit;
