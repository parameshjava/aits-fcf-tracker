-- ============================================================================
-- One-time seed of all 10 loans from the Excel data into public.loans.
--
-- Prerequisites:
--   1. scripts/loans-feature.sql has been run (creates the loans table,
--      sequence, triggers, and adds loan_id to transactions).
--   2. scripts/dedupe-members.sql has been run (so member slugs match the
--      canonical 22).
--
-- This file ONLY inserts the loans + back-links any existing SEED-LOANREPAY-*
-- transactions. Safe to re-run; each loan is matched-and-skipped by
-- (member_id, principal_amount, start_date).
-- ============================================================================

begin;

insert into public.loans
  (member_id, principal_amount, start_date, end_date, status, bad_debt, historical_interest_paid, notes)
select
  m.id,
  v.principal,
  v.start_date,
  v.end_date,
  v.status,
  v.bad_debt,
  v.interest_paid,
  v.notes
from (values
  --   member_slug             principal    start_date           end_date             status        bad_debt     interest    notes
  ('bhagavan-das',         80000.00,   date '2023-01-01', date '2025-01-04', 'write_off',  70000.00,    0.00, 'Interest-free loan for his business'),
  ('samba',               100000.00,   date '2023-04-10', date '2025-03-23', 'paid',           0.00,    0.00, null),
  ('sudhakar',            100000.00,   date '2023-03-10', null,              'paid',           0.00,    0.00, null),
  ('sunil-kumar-mallii',  100000.00,   date '2023-01-01', null,              'paid',           0.00,    0.00, null),
  ('paramesh',            100000.00,   date '2024-12-13', date '2025-01-05', 'paid',           0.00,  650.00, null),
  ('mallikarjuna',        100000.00,   date '2025-03-21', null,              'active',         0.00,    0.00, null),
  ('srinath-ch',          150000.00,   date '2025-02-01', null,              'active',         0.00, 1300.00, null),
  ('d-lakshmi-narayana',  100000.00,   date '2025-04-29', null,              'active',         0.00, 7800.00, 'Loan #1'),
  ('d-lakshmi-narayana',  100000.00,   date '2025-03-05', null,              'active',         0.00, 8450.00, 'Loan #2'),
  ('meda-sunil-kumar',    100000.00,   date '2025-10-10', null,              'active',         0.00, 4050.00, null)
) as v(member_slug, principal, start_date, end_date, status, bad_debt, interest_paid, notes)
left join public.members m on m.slug = v.member_slug
where m.id is not null
  and not exists (
    select 1 from public.loans l
    where l.member_id        = m.id
      and l.principal_amount = v.principal
      and l.start_date       = v.start_date
  );

-- ----------------------------------------------------------------------------
-- Back-link existing SEED-LOANREPAY-* transactions to the loans we just
-- inserted, matching on member + (principal - bad_debt).
-- ----------------------------------------------------------------------------
update public.transactions t
   set loan_id = l.id
  from public.loans l
 where t.transaction_id like 'SEED-LOANREPAY-%'
   and t.loan_id is null
   and t.member_id = l.member_id
   and t.amount    = (l.principal_amount - l.bad_debt);

commit;

-- ============================================================================
-- Verify
-- ============================================================================
-- select l.loan_number, m.name, l.principal_amount, l.start_date,
--        l.end_date, l.status, l.historical_interest_paid, l.bad_debt
--   from public.loans l left join public.members m on m.id = l.member_id
--  order by l.loan_number;
--
-- select count(*) as loans       from public.loans;
-- select count(*) as txns_tagged from public.transactions
--  where transaction_id like 'SEED-LOANREPAY-%' and loan_id is not null;
