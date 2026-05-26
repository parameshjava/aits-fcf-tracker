-- =============================================================================
-- 015 — Backfill donation_eligibility_periods from fund inception.
--
-- One row per EOM from the first contribution month through today.
-- Idempotent: the underlying helper uses ON CONFLICT DO UPDATE.
-- =============================================================================

begin;

do $$
declare
  v_count int;
begin
  select public.fn_backfill_donation_eligibility() into v_count;
  raise notice 'Backfilled % donation_eligibility_periods rows', v_count;
end $$;

commit;
