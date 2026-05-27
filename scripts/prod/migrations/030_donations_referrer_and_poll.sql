-- =============================================================================
-- 030 — Donations: referrer member + approval poll link.
--
-- Two semantic + structural changes for donations:
--
-- 1. `transactions.member_id` is repurposed on donation rows ONLY. It now
--    means "the fund member who referred / proposed this donation", not
--    "the beneficiary-who-happens-to-be-a-member". Beneficiary always
--    lives in `beneficiary_name` (text). For every other transaction type
--    `member_id` keeps its prior meaning (contributor / payer / loanee).
--
-- 2. Adds optional `poll_id` to `transactions`, mirroring the loans ↔
--    polls link from migration 025/026. Each approval poll authorises at
--    most one donation (1:1, enforced by a partial UNIQUE index). The
--    column is only meaningful for donation rows; the action layer
--    forces it to null for every other type.
--
-- Plus a one-row backfill for `SEED-DONATION-1`: the existing row stored
-- Bhagavan Das in `member_id` because he was the beneficiary under the
-- old semantics. Under the new model that would read as "he referred
-- this donation", which isn't accurate. The fix moves his name into
-- `beneficiary_name` and clears `member_id`.
--
-- The `dashboard_transactions` view is recreated to drop the
-- coalesce(m.name, beneficiary_name) added by migration 008 and expose
-- `beneficiary_name` + `poll_id` as their own columns. Donation
-- consumers now read those fields explicitly.
--
-- Re-runnable.
-- =============================================================================

begin;

-- 1) Backfill SEED-DONATION-1.
update public.transactions t
   set beneficiary_name = m.name,
       member_id        = null
  from public.members m
 where t.transaction_id = 'SEED-DONATION-1'
   and t.member_id      = m.id
   and t.beneficiary_name is null;

-- 2) poll_id column. ON DELETE SET NULL so deleting a poll doesn't drop
-- the donation row.
alter table public.transactions
  add column if not exists poll_id uuid
    references public.polls(id) on delete set null;

-- 3) 1:1 enforcement. Partial index so NULLs are unconstrained.
create unique index if not exists transactions_poll_id_unique
  on public.transactions (poll_id)
  where poll_id is not null;

-- 4) Recreate `dashboard_transactions`. Restores the pre-008 shape
-- (member_name = m.name, no coalesce) and exposes beneficiary_name +
-- poll_id directly so the donations page can render them as separate
-- columns. Non-donation sections see no behaviour change — their rows
-- never had beneficiary_name or poll_id set.
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
  t.poll_id,
  t.beneficiary_name,
  t.created_at,
  m.name as member_name,
  m.slug as member_slug
from public.transactions t
left join public.members m on m.id = t.member_id;

commit;

notify pgrst, 'reload schema';
