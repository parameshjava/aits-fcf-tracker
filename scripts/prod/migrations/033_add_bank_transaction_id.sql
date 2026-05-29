-- =============================================================================
-- 033 — Bank transaction reference (`bank_transaction_id`).
--
-- Adds a dedicated, optional free-text column for the BANK's own transaction
-- reference (UPI / NEFT UTR / cheque number) on both `transactions` and
-- `pending_payments`. This is distinct from `transactions.transaction_id`, the
-- app's internal identifier auto-generated as `YYYYMMDD-NNN` by the
-- `set_transaction_id()` trigger.
--
-- Why: the user-facing "Submit a payment" form had a required "Transaction ID"
-- input that wrote the user's free-text value straight into
-- `transactions.transaction_id` (via the pending row). Because that column was
-- never empty on those rows, the auto-generate trigger was bypassed, so
-- user-submitted transactions ended up with non-canonical IDs (e.g. `TXN-001`)
-- while admin-created ones got proper `YYYYMMDD-NNN` IDs.
--
-- This migration:
--   1. Adds `bank_transaction_id text` to both tables (nullable, not unique).
--   2. Drops the NOT NULL on `pending_payments.transaction_id` so submitted
--      payments no longer need a user-supplied canonical ID — the trigger fills
--      `transactions.transaction_id` at approval time.
--   3. Backfills: copies non-canonical `transaction_id` values into the new
--      column. Existing `transactions.transaction_id` values are LEFT UNTOUCHED
--      (we do not re-number live data). On `pending_payments` the non-canonical
--      `transaction_id` values are cleared after being copied, so future
--      approvals auto-generate a clean canonical ID.
--   4. Recreates `dashboard_transactions` to expose the new column (appended at
--      the tail — `create or replace view` only allows appending columns).
--
-- Canonical format is `YYYYMMDD-NNN`: 8 digits, a dash, 3 digits. The regex
-- `^\d{8}-\d{3}$` identifies it; anything else is treated as a user reference.
--
-- Re-runnable.
-- =============================================================================

begin;

-- 1) New optional reference column on both tables.
alter table public.transactions
  add column if not exists bank_transaction_id text;
alter table public.pending_payments
  add column if not exists bank_transaction_id text;

-- 2) Submitted payments no longer carry a user-supplied canonical id.
alter table public.pending_payments
  alter column transaction_id drop not null;

-- 3a) Backfill transactions: move any non-canonical transaction_id into the new
--     column. Leave the transaction_id value itself in place.
update public.transactions
   set bank_transaction_id = transaction_id
 where bank_transaction_id is null
   and transaction_id !~ '^\d{8}-\d{3}$';

-- 3b) Backfill pending_payments: copy the user-typed transaction_id across,
--     then clear the non-canonical value so future approvals auto-generate.
update public.pending_payments
   set bank_transaction_id = coalesce(bank_transaction_id, transaction_id)
 where transaction_id is not null;

update public.pending_payments
   set transaction_id = null
 where transaction_id is not null
   and transaction_id !~ '^\d{8}-\d{3}$';

-- 4) Recreate dashboard_transactions with bank_transaction_id appended.
--    Column order matches migration 030's shape with the new column at the tail
--    (create or replace view requires existing columns to keep their order).
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
  m.slug as member_slug,
  t.poll_id,
  t.beneficiary_name,
  t.bank_transaction_id
from public.transactions t
left join public.members m on m.id = t.member_id;

commit;

notify pgrst, 'reload schema';
