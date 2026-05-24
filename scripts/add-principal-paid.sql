-- =============================================================================
-- add-principal-paid.sql
--
-- Adds `principal_paid` to public.transactions and public.pending_payments.
-- The column records how much of a payment's `amount` was applied to loan
-- principal (vs. interest). This is what lets a single payment row capture
-- a mixed principal+interest payment, or a partial-principal repayment.
--
-- Backfill: every existing `loan_repayment` row's whole amount was, by
-- definition, principal — so we copy `amount` into `principal_paid` for
-- those rows. Interest rows have no principal component (left NULL).
--
-- Run order:
--   - Re-runnable. `add column if not exists` and `where principal_paid is null`
--     guards make the script idempotent.
-- =============================================================================

alter table public.transactions
  add column if not exists principal_paid numeric(12, 2);

alter table public.pending_payments
  add column if not exists principal_paid numeric(12, 2);

-- For an existing loan_repayment row, the whole amount IS the principal
-- portion. Future mixed payments can split principal_paid < amount and
-- carry the rest as interest in the same row.
update public.transactions
   set principal_paid = amount
 where contribution_type = 'loan_repayment'
   and principal_paid is null;

update public.pending_payments
   set principal_paid = amount
 where contribution_type = 'loan_repayment'
   and principal_paid is null;
