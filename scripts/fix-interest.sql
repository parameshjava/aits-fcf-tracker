-- ============================================================================
-- Corrective patch: bank_interest vs loan_interest classification.
--
-- The original extract_data.py shared a single `bank_interest` field for both
-- the "Bank Intrest" and "Loans Intrest" rows in the Excel Contributions sheet,
-- so for years where both existed (notably 2026) the loan-interest values
-- overwrote the bank-interest values. After fixing the extractor, this patch:
--   1. Deletes the old SEED-BANKINT-* and SEED-LOANINT-* rows
--   2. Re-inserts them with the correct interest_source from the fixed seed
--
-- Contributions, donations, and loan_repayment rows are untouched.
-- Safe to re-run.
-- ============================================================================

begin;

delete from public.transactions
 where transaction_id like 'SEED-BANKINT-%'
    or transaction_id like 'SEED-LOANINT-%';

insert into public.transactions
  (transaction_id, amount, contribution_type, interest_source, member_id, transaction_date, description) values
  ('SEED-BANKINT-2016-01', 9.00, 'interest', 'bank', null, '2016-01-28', 'Bank interest credited'),
  ('SEED-BANKINT-2016-04', 311.00, 'interest', 'bank', null, '2016-04-28', 'Bank interest credited'),
  ('SEED-BANKINT-2016-06', 384.00, 'interest', 'bank', null, '2016-06-28', 'Bank interest credited'),
  ('SEED-BANKINT-2016-07', 704.00, 'interest', 'bank', null, '2016-07-28', 'Bank interest credited'),
  ('SEED-BANKINT-2017-03', 500.00, 'interest', 'bank', null, '2017-03-28', 'Bank interest credited'),
  ('SEED-BANKINT-2017-06', 428.00, 'interest', 'bank', null, '2017-06-28', 'Bank interest credited'),
  ('SEED-BANKINT-2017-07', 2042.00, 'interest', 'bank', null, '2017-07-28', 'Bank interest credited'),
  ('SEED-BANKINT-2017-09', 368.00, 'interest', 'bank', null, '2017-09-28', 'Bank interest credited'),
  ('SEED-BANKINT-2017-12', 135.00, 'interest', 'bank', null, '2017-12-28', 'Bank interest credited'),
  ('SEED-BANKINT-2018-01', 1612.00, 'interest', 'bank', null, '2018-01-28', 'Bank interest credited'),
  ('SEED-BANKINT-2018-03', 402.00, 'interest', 'bank', null, '2018-03-28', 'Bank interest credited'),
  ('SEED-BANKINT-2018-04', 11458.00, 'interest', 'bank', null, '2018-04-28', 'Bank interest credited'),
  ('SEED-BANKINT-2018-06', 2018.00, 'interest', 'bank', null, '2018-06-28', 'Bank interest credited'),
  ('SEED-BANKINT-2018-09', 2135.00, 'interest', 'bank', null, '2018-09-28', 'Bank interest credited'),
  ('SEED-BANKINT-2018-12', 2363.00, 'interest', 'bank', null, '2018-12-28', 'Bank interest credited'),
  ('SEED-BANKINT-2019-02', 1600.00, 'interest', 'bank', null, '2019-02-28', 'Bank interest credited'),
  ('SEED-BANKINT-2019-03', 2169.00, 'interest', 'bank', null, '2019-03-28', 'Bank interest credited'),
  ('SEED-BANKINT-2019-06', 1370.00, 'interest', 'bank', null, '2019-06-28', 'Bank interest credited'),
  ('SEED-BANKINT-2019-07', 4666.00, 'interest', 'bank', null, '2019-07-28', 'Bank interest credited'),
  ('SEED-BANKINT-2019-09', 1813.00, 'interest', 'bank', null, '2019-09-28', 'Bank interest credited'),
  ('SEED-BANKINT-2019-11', 533.00, 'interest', 'bank', null, '2019-11-28', 'Bank interest credited'),
  ('SEED-BANKINT-2019-12', 2052.00, 'interest', 'bank', null, '2019-12-28', 'Bank interest credited'),
  ('SEED-BANKINT-2020-03', 2243.00, 'interest', 'bank', null, '2020-03-28', 'Bank interest credited'),
  ('SEED-BANKINT-2020-06', 1547.00, 'interest', 'bank', null, '2020-06-28', 'Bank interest credited'),
  ('SEED-BANKINT-2020-07', 3000.00, 'interest', 'bank', null, '2020-07-28', 'Bank interest credited'),
  ('SEED-BANKINT-2020-10', 1752.00, 'interest', 'bank', null, '2020-10-28', 'Bank interest credited'),
  ('SEED-BANKINT-2020-12', 3330.00, 'interest', 'bank', null, '2020-12-28', 'Bank interest credited'),
  ('SEED-BANKINT-2021-01', 666.00, 'interest', 'bank', null, '2021-01-28', 'Bank interest credited'),
  ('SEED-BANKINT-2021-02', 3000.00, 'interest', 'bank', null, '2021-02-28', 'Bank interest credited'),
  ('SEED-BANKINT-2021-03', 2438.00, 'interest', 'bank', null, '2021-03-28', 'Bank interest credited'),
  ('SEED-BANKINT-2021-04', 1200.00, 'interest', 'bank', null, '2021-04-28', 'Bank interest credited'),
  ('SEED-BANKINT-2021-05', 600.00, 'interest', 'bank', null, '2021-05-28', 'Bank interest credited'),
  ('SEED-BANKINT-2021-06', 3155.00, 'interest', 'bank', null, '2021-06-28', 'Bank interest credited'),
  ('SEED-BANKINT-2021-07', 1200.00, 'interest', 'bank', null, '2021-07-28', 'Bank interest credited'),
  ('SEED-BANKINT-2021-08', 1200.00, 'interest', 'bank', null, '2021-08-28', 'Bank interest credited'),
  ('SEED-BANKINT-2021-09', 2663.00, 'interest', 'bank', null, '2021-09-28', 'Bank interest credited'),
  ('SEED-BANKINT-2021-10', 1200.00, 'interest', 'bank', null, '2021-10-28', 'Bank interest credited'),
  ('SEED-BANKINT-2021-11', 1200.00, 'interest', 'bank', null, '2021-11-28', 'Bank interest credited'),
  ('SEED-BANKINT-2021-12', 2609.00, 'interest', 'bank', null, '2021-12-28', 'Bank interest credited'),
  ('SEED-BANKINT-2022-01', 1200.00, 'interest', 'bank', null, '2022-01-28', 'Bank interest credited'),
  ('SEED-BANKINT-2022-02', 1200.00, 'interest', 'bank', null, '2022-02-28', 'Bank interest credited'),
  ('SEED-BANKINT-2022-03', 1823.00, 'interest', 'bank', null, '2022-03-28', 'Bank interest credited'),
  ('SEED-BANKINT-2022-04', 600.00, 'interest', 'bank', null, '2022-04-28', 'Bank interest credited'),
  ('SEED-BANKINT-2022-05', 600.00, 'interest', 'bank', null, '2022-05-28', 'Bank interest credited'),
  ('SEED-BANKINT-2022-06', 3789.00, 'interest', 'bank', null, '2022-06-28', 'Bank interest credited'),
  ('SEED-BANKINT-2022-07', 600.00, 'interest', 'bank', null, '2022-07-28', 'Bank interest credited'),
  ('SEED-BANKINT-2022-08', 600.00, 'interest', 'bank', null, '2022-08-28', 'Bank interest credited'),
  ('SEED-BANKINT-2022-09', 1500.00, 'interest', 'bank', null, '2022-09-28', 'Bank interest credited'),
  ('SEED-BANKINT-2023-11', 600.00, 'interest', 'bank', null, '2023-11-28', 'Bank interest credited'),
  ('SEED-BANKINT-2024-02', 600.00, 'interest', 'bank', null, '2024-02-28', 'Bank interest credited'),
  ('SEED-BANKINT-2024-03', 5600.00, 'interest', 'bank', null, '2024-03-28', 'Bank interest credited'),
  ('SEED-BANKINT-2024-08', 600.00, 'interest', 'bank', null, '2024-08-28', 'Bank interest credited'),
  ('SEED-BANKINT-2024-10', 600.00, 'interest', 'bank', null, '2024-10-28', 'Bank interest credited'),
  ('SEED-BANKINT-2024-11', 600.00, 'interest', 'bank', null, '2024-11-28', 'Bank interest credited'),
  ('SEED-BANKINT-2024-12', 600.00, 'interest', 'bank', null, '2024-12-28', 'Bank interest credited'),
  ('SEED-BANKINT-2025-01', 600.00, 'interest', 'bank', null, '2025-01-28', 'Bank interest credited'),
  ('SEED-BANKINT-2025-02', 1200.00, 'interest', 'bank', null, '2025-02-28', 'Bank interest credited'),
  ('SEED-BANKINT-2025-03', 600.00, 'interest', 'bank', null, '2025-03-28', 'Bank interest credited'),
  ('SEED-BANKINT-2025-06', 1300.00, 'interest', 'bank', null, '2025-06-28', 'Bank interest credited'),
  ('SEED-BANKINT-2025-07', 1300.00, 'interest', 'bank', null, '2025-07-28', 'Bank interest credited'),
  ('SEED-BANKINT-2025-08', 1300.00, 'interest', 'bank', null, '2025-08-28', 'Bank interest credited'),
  ('SEED-BANKINT-2025-09', 1300.00, 'interest', 'bank', null, '2025-09-28', 'Bank interest credited'),
  ('SEED-BANKINT-2025-10', 2650.00, 'interest', 'bank', null, '2025-10-28', 'Bank interest credited'),
  ('SEED-BANKINT-2025-11', 800.00, 'interest', 'bank', null, '2025-11-28', 'Bank interest credited'),
  ('SEED-BANKINT-2025-12', 2214.00, 'interest', 'bank', null, '2025-12-28', 'Bank interest credited'),
  ('SEED-BANKINT-2026-01', 535.00, 'interest', 'bank', null, '2026-01-28', 'Bank interest credited'),
  ('SEED-BANKINT-2026-02', 548.00, 'interest', 'bank', null, '2026-02-28', 'Bank interest credited'),
  ('SEED-BANKINT-2026-03', 647.00, 'interest', 'bank', null, '2026-03-28', 'Bank interest credited'),
  ('SEED-BANKINT-2026-04', 573.00, 'interest', 'bank', null, '2026-04-28', 'Bank interest credited'),
  ('SEED-LOANINT-2026-01', 1950.00, 'interest', 'loans', null, '2026-01-28', 'Loan interest collected'),
  ('SEED-LOANINT-2026-02', 1950.00, 'interest', 'loans', null, '2026-02-28', 'Loan interest collected'),
  ('SEED-LOANINT-2026-03', 1950.00, 'interest', 'loans', null, '2026-03-28', 'Loan interest collected'),
  ('SEED-LOANINT-2026-04', 1950.00, 'interest', 'loans', null, '2026-04-28', 'Loan interest collected'),
  ('SEED-LOANINT-2026-05', 3100.00, 'interest', 'loans', null, '2026-05-28', 'Loan interest collected')
on conflict (transaction_id) do nothing;

commit;

-- Verify:
-- select contribution_type, interest_source, count(*), sum(amount)
--   from public.transactions
--  where contribution_type = 'interest'
--  group by 1, 2 order by 1, 2;