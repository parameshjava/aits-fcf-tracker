-- =============================================================================
-- FCF Tracker — Historical loans seed
-- Source: 'Loans' sheet of FCF Latest one upto 6_07_2020.xlsx
--
-- Re-running is safe: every INSERT uses ON CONFLICT (loan_number) DO NOTHING.
--
-- Rows: 10 loans  (1 write-off + 4 paid + 5 active)
-- Totals: principal=₹10,30,000  outstanding_balance=₹5,50,000
--         principal_paid=₹4,10,000  bad_debt=₹70,000
--
-- The set_loan_number trigger (002) is disabled around this batch so the
-- migration can preserve a stable, sortable numbering scheme — re-runs and
-- future inserts must agree on which row is which. After the batch we bump
-- loan_year_counter forward so the next live insert continues from N+1.
--
-- member_id is resolved at INSERT time via the canonical email so this
-- works even after a clean DB rebuild (UUIDs change; emails don't).
-- =============================================================================

begin;

alter table public.loans disable trigger trg_set_loan_number;

insert into public.loans
  (loan_number, member_id, principal_amount, start_date, end_date, status,
   bad_debt, interest_waiver_months, interest_waived, notes) values

  -- 2020 placeholder — Malli Sunil Kumar's interest-free house-construction
  -- loan predates the workbook and has no recorded start/end date. Date set
  -- to 2020-07-01 (workbook cutoff month) so loan_number sorts before the
  -- 2023 cohort; correct this if the true start date surfaces.
  ('202007-001',
   (select id from public.members where email = 'mallisunilmca69@gmail.com'),
   100000.00, '2020-07-01', null, 'paid',
   0, 0, 0,
   'Interest free loan for his house construction. Start date unknown — placeholder.'),

  -- 2023 cohort
  ('202301-001',
   (select id from public.members where email = 'bagavandas.g@gmail.com'),
   80000.00, '2023-01-01', '2025-01-04', 'write_off',
   70000, 0, 0,
   'Interest free loan for his business. ₹10,000 recovered, ₹70,000 written off.'),

  ('202303-002',
   (select id from public.members where email = 'sudhakar487248@gmail.com'),
   100000.00, '2023-03-10', null, 'paid',
   0, 0, 0,
   'For his mother health expenses.'),

  ('202304-003',
   (select id from public.members where email = 'sambamca06@gmail.com'),
   100000.00, '2023-04-10', '2025-03-23', 'paid',
   0, 0, 0,
   'For his financial needs to set up his new home.'),

  -- 2024 cohort
  ('202412-001',
   (select id from public.members where email = 'paramesh.java5@gmail.com'),
   100000.00, '2024-12-13', '2025-01-05', 'paid',
   0, 0, 0,
   'For buying car.'),

  -- 2025 cohort
  ('202502-001',
   (select id from public.members where email = 'srimca67@gmail.com'),
   150000.00, '2025-02-01', null, 'active',
   0, 0, 0,
   'Medical.'),

  ('202503-002',
   (select id from public.members where email = 'dlnarayana.mca29@gmail.com'),
   100000.00, '2025-03-05', null, 'active',
   0, 0, 0,
   'For business reasons.'),

  ('202503-003',
   (select id from public.members where email = 'malli.chindukuri@gmail.com'),
   100000.00, '2025-03-21', null, 'active',
   0, 6, 0,
   'Interest free loan for first 6 months.'),

  ('202504-004',
   (select id from public.members where email = 'dlnarayana.mca29@gmail.com'),
   100000.00, '2025-04-29', null, 'active',
   0, 0, 0,
   'Personal.'),

  ('202510-005',
   (select id from public.members where email = 'sunilreddy.meda@gmail.com'),
   100000.00, '2025-10-10', null, 'active',
   0, 0, 0,
   'For personal reasons.')

on conflict (loan_number) do nothing;

alter table public.loans enable trigger trg_set_loan_number;

-- Advance loan_year_counter so future trigger-driven inserts pick up where
-- this seed left off (3 for 2023, 1 for 2024, 5 for 2025, 1 for 2020).
insert into public.loan_year_counter (year, counter) values
  (2020, 1), (2023, 3), (2024, 1), (2025, 5)
on conflict (year) do update
  set counter = greatest(public.loan_year_counter.counter, excluded.counter);

commit;

-- Sanity check (uncomment after insert):
-- select loan_number, principal_amount, status, start_date, end_date
--   from public.loans
--  order by start_date nulls first, loan_number;
-- select status, count(*), sum(principal_amount)
--   from public.loans group by status order by status;
