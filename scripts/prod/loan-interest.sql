-- =============================================================================
-- FCF Tracker — Historical loan-interest payments
-- Source: 'Loans' sheet → "Interest Paid" column, FCF Latest one upto 6_07_2020.xlsx
--
-- Re-running is safe: every INSERT uses ON CONFLICT (transaction_id) DO NOTHING.
--
-- Rows: 5  (one per loan with non-zero interest_paid)
-- Total: ₹22,250 of historical loan interest collected
--
-- Why this file exists separately:
--   * Per the comment on public.loans (001_init_schema.sql:110-114), historical
--     interest payments live in public.transactions, not on the loan row.
--   * `2026.sql` previously held five aggregate monthly loan-interest rows
--     (₹10,900 with `loan_id` = null). Those have been removed from 2026.sql in
--     favour of the per-loan rows below, so paid-interest can be drilled down
--     by loan and member.
--
-- Ordering: each row references its loan via loan_number, so loans.sql MUST
-- run before this file. The transaction_date is the loan's end_date when the
-- loan is closed, otherwise the import snapshot date (2026-05-15).
-- =============================================================================

begin;

insert into public.transactions
  (transaction_id, amount, transaction_type, interest_source,
   member_id, loan_id, transaction_date, description) values

  ('SEED-LOAN-INT-202412-001', 650.00, 'interest', 'loans',
   (select member_id from public.loans where loan_number = '202412-001'),
   (select id        from public.loans where loan_number = '202412-001'),
   '2025-01-05',
   'Historical interest paid (pre-tracking import) — Korrakuti Paramesh ₹1L car loan'),

  ('SEED-LOAN-INT-202502-001', 1300.00, 'interest', 'loans',
   (select member_id from public.loans where loan_number = '202502-001'),
   (select id        from public.loans where loan_number = '202502-001'),
   '2026-05-15',
   'Historical interest paid (pre-tracking import) — Chintalapalli Srinith ₹1.5L medical loan'),

  ('SEED-LOAN-INT-202503-002', 8450.00, 'interest', 'loans',
   (select member_id from public.loans where loan_number = '202503-002'),
   (select id        from public.loans where loan_number = '202503-002'),
   '2026-05-15',
   'Historical interest paid (pre-tracking import) — Darisiguntla Lakshmi Narayana ₹1L business loan'),

  ('SEED-LOAN-INT-202504-004', 7800.00, 'interest', 'loans',
   (select member_id from public.loans where loan_number = '202504-004'),
   (select id        from public.loans where loan_number = '202504-004'),
   '2026-05-15',
   'Historical interest paid (pre-tracking import) — Darisiguntla Lakshmi Narayana ₹1L personal loan'),

  ('SEED-LOAN-INT-202510-005', 4050.00, 'interest', 'loans',
   (select member_id from public.loans where loan_number = '202510-005'),
   (select id        from public.loans where loan_number = '202510-005'),
   '2026-05-15',
   'Historical interest paid (pre-tracking import) — Meda Sunil Kumar Reddy ₹1L personal loan')

on conflict (transaction_id) do nothing;

commit;

-- Sanity check (uncomment after insert):
-- select t.transaction_id, l.loan_number, t.amount, t.transaction_date, m.name
--   from public.transactions t
--   join public.loans   l on l.id = t.loan_id
--   join public.members m on m.id = t.member_id
--  where t.transaction_type = 'interest' and t.interest_source = 'loans'
--  order by l.start_date, t.transaction_date;
-- select sum(amount) as loan_interest_total
--   from public.transactions
--  where transaction_type = 'interest' and interest_source = 'loans';
