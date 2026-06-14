-- =============================================================================
-- 042 — Reference value datatypes.
--
-- Adds an explicit `datatype` column to public.reference so the admin UI can
-- render each value correctly (currency, percentage, date, plain number)
-- instead of inferring the type from the key name. The datatype is chosen in
-- the /admin/reference edit form; it never surfaces in the read-only display.
--
-- `value` stays `numeric`. Date-typed keys (e.g. emi_cutover_date) continue to
-- store a YYYYMMDD integer (20260701 = 2026-07-01); only the rendering differs.
--
-- IDEMPOTENT: `add column if not exists` + targeted backfill UPDATEs. The
-- backfill mirrors the prior key-name rules so existing rows keep displaying
-- as before — except corpus_threshold, which now correctly renders as INR
-- (the old list view showed it as a bare number; the history editor already
-- treated it as money — this reconciles the two).
-- =============================================================================

begin;

alter table public.reference
  add column if not exists datatype text not null default 'number'
    check (datatype in ('inr', 'percentage', 'date', 'number'));

-- Currency: anything ending in _balance/_amount, plus the known rupee keys.
update public.reference
   set datatype = 'inr'
 where key ~ '(_balance|_amount)$'
    or key in ('interest_per_lakh', 'corpus_threshold');

-- Percentage: any key ending in _pct.
update public.reference
   set datatype = 'percentage'
 where key ~ '_pct$';

-- Date: YYYYMMDD-encoded keys.
update public.reference
   set datatype = 'date'
 where key = 'emi_cutover_date';

commit;
