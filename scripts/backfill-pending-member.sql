-- ============================================================================
-- Backfill member_id on pending_payments and on transactions that were
-- approved from them, where it was left null because the row predates the
-- auto-attribution fix on submitPayment().
--
-- Two passes:
--   A. Match the submitter's auth.users.email to members.email
--      (the strongest signal — exact email match)
--   B. Fallback: match profile.full_name to members.name (case-insensitive)
--      (useful when members.email isn't seeded for that person)
--
-- Idempotent: re-running is safe; the WHERE clauses only touch null cells.
-- ============================================================================

begin;

-- A1. Pending payments → match by auth.users.email
update public.pending_payments pp
   set member_id = m.id
  from auth.users u
  join public.members m on lower(m.email) = lower(u.email)
 where pp.submitted_by = u.id
   and pp.member_id is null
   and u.email is not null
   and m.email is not null;

-- A2. Same for transactions whose source pending row we can find
update public.transactions t
   set member_id = pp.member_id
  from public.pending_payments pp
 where t.transaction_id = pp.transaction_id
   and pp.member_id is not null
   and t.member_id is null;

-- B1. Pending payments → fallback by full_name
update public.pending_payments pp
   set member_id = m.id
  from public.profiles p
  join public.members m on lower(m.name) = lower(p.full_name)
 where pp.submitted_by = p.id
   and pp.member_id is null
   and p.full_name is not null;

-- B2. Same fallback for transactions: match the submitter via created_by
update public.transactions t
   set member_id = m.id
  from public.profiles p
  join public.members m on lower(m.name) = lower(p.full_name)
 where t.created_by = p.id
   and t.member_id is null
   and t.contribution_type in ('contribution', 'interest', 'loan_repayment')
   and p.full_name is not null;

commit;

-- ----------------------------------------------------------------------------
-- Verify
-- ----------------------------------------------------------------------------
-- select count(*) as pending_without_member from public.pending_payments where member_id is null;
-- select count(*) as txns_without_member
--   from public.transactions
--  where member_id is null
--    and contribution_type in ('contribution', 'interest', 'loan_repayment')
--    and (transaction_id not like 'SEED-BANKINT-%' and transaction_id not like 'SEED-LOANINT-%');
