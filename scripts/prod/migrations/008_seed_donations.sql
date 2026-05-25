-- =============================================================================
-- 008 — Beneficiary column + seed historical donations.
--
-- Until this migration, the 7 historical donations from the Excel seed
-- (`src/data/seed.json` → donations[]) lived only as runtime-synthesized rows
-- emitted by `seedToTransactions()`. The donations page saw them; the
-- dashboard ledger (which reads `public.dashboard_yearly`) did not — so
-- donations showed as ₹0 in every year on /dashboard.
--
-- This migration makes the DB the single source of truth:
--   1. Adds `beneficiary_name` to public.transactions. Most donation
--      beneficiaries are external people (not members of the fund); for
--      those, `member_id` stays null and the name lives in `beneficiary_name`.
--      When the beneficiary IS a canonical member (Bhagavan Das, sno=1),
--      `member_id` is set normally and `beneficiary_name` stays null — the
--      view's coalesce pulls the name from the members table.
--   2. Recreates `public.dashboard_transactions` so `member_name` coalesces
--      member name → beneficiary_name. Donations row beneficiaries flow
--      straight to the existing "Beneficiary" column on the donations page.
--   3. Inserts the 7 donations. `ON CONFLICT (transaction_id) DO NOTHING`
--      keeps this re-runnable.
--
-- Dates: 6 of the 7 seed donations have an empty `date` in seed.json — we
-- use 2024-01-01 as a placeholder (matches the synthetic fallback the app
-- used before). sno=8 carries 2024-06-10 from the seed.
-- =============================================================================

begin;

-- 1) Schema: beneficiary_name column on transactions.
alter table public.transactions
  add column if not exists beneficiary_name text;

-- 2) View: coalesce member name → beneficiary so the donations table shows
-- the recipient. Slug intentionally remains member-only (beneficiaries
-- aren't linkable members).
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
  coalesce(m.name, t.beneficiary_name) as member_name,
  m.slug                                as member_slug
from public.transactions t
left join public.members m on m.id = t.member_id;

-- 3) Historical donations. Bhagavan Das (sno=1) is a canonical member, so
-- his row uses `member_id` via canonical email (matches the pattern in
-- transactions/2024.sql — UUIDs change across rebuilds, emails don't).
-- The other six beneficiaries aren't members; their names live in
-- `beneficiary_name`.
insert into public.transactions
  (transaction_id, amount, transaction_type, interest_source, member_id,
   transaction_date, description, beneficiary_name) values
  ('SEED-DONATION-1', 30000.00, 'donation', null,
     (select id from public.members where email = 'bagavandas.g@gmail.com'),
     '2024-01-01', 'To help his medical issues.', null),
  ('SEED-DONATION-2', 10000.00, 'donation', null, null, '2024-01-01', 'To help his medical issues.', 'Naidruva'),
  ('SEED-DONATION-3', 30000.00, 'donation', null, null, '2024-01-01', 'Education',                   'Sampoorna'),
  ('SEED-DONATION-4', 25000.00, 'donation', null, null, '2024-01-01', 'To help his medical issues.', 'Jagadeesh'),
  ('SEED-DONATION-5', 20000.00, 'donation', null, null, '2024-01-01', 'To help his medical issues.', 'Narasimhulu Oruganti'),
  ('SEED-DONATION-7', 20000.00, 'donation', null, null, '2024-01-01', 'To help medical issues',      'Master Harinath'),
  ('SEED-DONATION-8', 10000.00, 'donation', null, null, '2024-06-10', 'To help his medical issues.', null)
on conflict (transaction_id) do nothing;

commit;
