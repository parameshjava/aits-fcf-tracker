# Excel ↔ Migration Drift Report

**Sources compared**
- Workbook: `FCF Latest one upto 6_07_2020.xlsx` (despite the filename, this file has been kept current through May 2026)
- Migrations: `scripts/prod/transactions/{2016..2026}.sql` + `scripts/prod/migrations/006_seed_members.sql` + `scripts/prod/migrations/001_init_schema.sql`

**Verdict:** The transaction migrations are a faithful copy of the workbook with **three classes of drift** worth fixing before relying on the migration as the source of truth.

---

## 1. Contribution / Interest totals — match (one exception)

The migration's header comments are exact arithmetic checks against the workbook's yearly tabs. Per-`(year, email, month)` reconciliation finds **zero discrepancies** for contributions, bank interest, or loan interest — except for 2023.

| Year | Excel contrib | SQL contrib | Excel bank-int | SQL bank-int | Excel loan-int | SQL loan-int |
|-----:|--------------:|------------:|---------------:|-------------:|---------------:|-------------:|
| 2016 |        74,000 |      74,000 |            704 |          704 |              0 |            0 |
| 2017 |       107,550 |     107,550 |          3,473 |        3,473 |              0 |            0 |
| 2018 |        94,000 |      94,000 |         19,988 |       19,988 |              0 |            0 |
| 2019 |        53,000 |      53,000 |         14,203 |       14,203 |              0 |            0 |
| 2020 |       109,405 |     109,405 |         11,872 |       11,872 |              0 |            0 |
| 2021 |        99,700 |      99,700 |         21,131 |       21,131 |              0 |            0 |
| 2022 |        75,600 |      75,600 |         11,912 |       11,912 |              0 |            0 |
| 2023 |    **63,500** |  **60,500** |            600 |          600 |              0 |            0 |
| 2024 |        65,800 |      65,800 |          8,600 |        8,600 |              0 |            0 |
| 2025 |       104,862 |     104,862 |         13,264 |       13,264 |              0 |            0 |
| 2026 |        35,900 |      35,900 |          2,303 |        2,303 |         10,900 |       10,900 |
| **Σ** |   **883,317** | **880,317** |    **108,050** |  **108,050** |     **10,900** |   **10,900** |

### ⚠️ Drift #1 — `Ranga Reddy` ₹3,000 in 2023

- The 2023 yearly tab contains a contribution row `Ranga Reddy` totalling **₹3,000** (Jun 2023).
- `Ranga Reddy` does **not** exist in `scripts/prod/migrations/006_seed_members.sql` (canonical 22-member seed).
- `scripts/prod/transactions/2023.sql` silently drops this row, so its ₹3,000 never lands in `public.transactions`.

**Fix options:**
1. Add a 23rd member to `006_seed_members.sql` (status `inactive`) and reinstate the row in `2023.sql`.
2. Confirm the row is bogus and remove it from the workbook to bring it into sync.

---

## 2. Schema drift — wrong column name

`scripts/prod/migrations/001_init_schema.sql:129` declares the column as:

```sql
transaction_type   text not null check (transaction_type in
                     ('interest', 'contribution', 'loan_repayment',
                      'penalty',  'donation',     'other'))
```

But every yearly seed file under `scripts/prod/transactions/` writes:

```sql
insert into public.transactions
  (transaction_id, amount, contribution_type, interest_source, member_id, transaction_date, description) values ...
```

`contribution_type` does **not** exist on the table. Running any of `2016.sql` … `2026.sql` against a clean prod schema will fail with `ERROR: column "contribution_type" of relation "transactions" does not exist`.

`AGENTS.md` Golden Rules already pins the name as `transaction_type` ("`transaction_type` is the discriminator on both `transactions` and `pending_payments`"). The generator (`scripts/generate-yearly-transactions.py` per the file header comments) must be regenerating with a stale column name.

**Fix:** rename `contribution_type` → `transaction_type` in all 11 yearly files (a single `sed -i 's/contribution_type/transaction_type/g'` plus a re-run of the generator if it still hardcodes the old name).

---

## 3. Missing entity migrations

The workbook holds three more datasets that have **no corresponding migration** anywhere in `scripts/prod/`:

### 3a. Loans (₹10,30,000 principal across 14 loans)

`Loans` sheet inventory (sums from rows 2-15):

| Metric            |     Amount |
|-------------------|-----------:|
| Loan principal Σ  | 10,30,000  |
| Outstanding bal Σ |    5,50,000 |
| Principal paid Σ  |    4,10,000 |
| Interest paid Σ   |       22,250 |
| Status `Paid`     |          4 |
| Status `Active`   |          5 |
| Status `Write Off`|          1 |
| Status `null`     |          4 |

There is no `scripts/prod/loans.sql` (or similar) to populate `public.loans`. The schema is ready (`001_init_schema.sql:100`) but the data has not been brought across.

### 3b. Donations (₹1,45,000 across 7 records)

`Donations` sheet captures 7 outflows (Bhagavan Das, Naidruva, Sampoorna, Jagadeesh, Narasimhulu Oruganti, Master Harinath, plus an unnamed recipient). They should land in `public.transactions` with `transaction_type = 'donation'`, but **zero donation rows** exist in any yearly migration:

```
SQL transaction_type counts → contribution: 1207, interest: 73
                              donation: 0, loan_repayment: 0, penalty: 0
```

### 3c. Loan repayments

The `Loans` sheet shows ₹4,10,000 of principal already paid back and ₹22,250 of interest collected — only the 2026 portion (₹10,900) of loan interest made it into a migration row. Repayments themselves are entirely absent.

Without these, `dashboard_overall.loan_repayments` / `.loans` views (per `003_views.sql`) will under-report against the workbook by hundreds of thousands of rupees.

---

## 4. Workbook internal inconsistencies (informational)

These are quirks of the source workbook, not migration bugs — but worth noting so future drift checks don't chase them.

- **`Summary` sheet** reports `Total Contributions = ₹8,80,317` while the per-year sum of the `Contributions` tab is ₹9,84,355 (contributions + interest) and the per-member contribution sum from the yearly tabs is ₹8,83,317. The Summary's 880,317 figure is stale by exactly ₹3,000 — the same Ranga Reddy row that's missing from the migration.
- **2026 yearly tab uses two spellings** of "interest" — the body row `Bank Intrest` / `Loans Intrest` (misspelled) feeds the yearly `Total` row, while a second block at the bottom (`Bank Interest` / `Loans Interest`, correct spelling) is just a duplicate summary block. A naive parser that doesn't skip the trailing `Summary` section will double-count ₹13,203 for 2026.
- **Year-`Total` row only includes contributions + bank interest**, not loan interest. The 2026 yearly Total of 38,203 = 35,900 contrib + 2,303 bank-int (loan-int of 10,900 sits below the `Total` line). The Excel author intentionally treated loan interest as out-of-band.

---

## 5. What the migration does well

- Transaction IDs use a deterministic `SEED-YYYY-MM-<3LETTER>` scheme so reruns are idempotent (`on conflict do nothing`).
- `member_id` is resolved by canonical email in a subselect — survives UUID rebuilds.
- Header comments in each `YYYY.sql` are derived totals, providing a built-in checksum against the workbook (currently passing for all years except 2023, as noted above).
- All 1,280 parsed rows (1,207 contributions + 73 interest) match the workbook's monthly cells exactly.

---

## 6. Summary of action items

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | `Ranga Reddy` ₹3,000 dropped in 2023 | medium | add member or remove from workbook |
| 2 | All yearly seeds use `contribution_type` (column does not exist) | **blocker** | rename to `transaction_type`; fix generator |
| 3 | Loans sheet not migrated (14 loans, ₹10.3L) | high | author `scripts/prod/loans.sql` |
| 4 | Donations sheet not migrated (7 rows, ₹1.45L) | high | seed as `donation` transactions |
| 5 | Loan repayments / interest paid not migrated (₹4.1L + ₹22K) | high | derive `loan_repayment` + `interest` rows from `Loans` |
