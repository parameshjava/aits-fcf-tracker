# Monthly Loan Interest Accruals & Donation Eligibility — Design

- **Date:** 2026-05-26
- **Status:** Draft (awaiting user review)
- **Author:** Paramesh (with Claude)

## Problem

Two financial figures are currently computed on the fly every time a page loads:

1. **Loan interest due** — `src/lib/loan-math.ts` walks every loan's repayment history and computes piecewise expected interest minus paid interest. There is no audit trail of what was charged when, no way for admins to mark "May 2026 interest as paid" against a specific month, and no notion of *pending interest as a settle-able item*. A member who hasn't paid interest for ten months looks identical (a single "interest due: ₹X" number) to someone who skipped only the latest month.
2. **Donation eligibility** — `src/lib/eligibility.ts` aggregates `dashboard_yearly` and computes annual eligibility = `pct × contributions` for each year, gated on the corpus threshold. The math is correct but it lives entirely in app code; there is no historical ledger of "in May 2026 we earned ₹X of donation capacity" that an admin can query, edit, or back-date corrections against.

This design moves both calculations into **first-class database tables** with monthly cadence, populated by **`pg_cron`** running at end-of-month, with full historical backfill for donation eligibility and a single opening-balance seed for each active loan.

## Goals

1. Each active loan has one `loan_interest_accruals` row per month from cutover onward, automatically inserted at EOM.
2. Each accrual row is settleable: admin can apply a payment against one or many rows, partial payments supported, full audit linkage to a `transactions` row.
3. Each calendar month has one `donation_eligibility_periods` row from fund inception onward, automatically inserted at EOM. Backfilled in the migration.
4. Both tables are idempotent and recomputable when a historical `reference_history` value is corrected.
5. Cron lives in the database (`pg_cron`), not on Vercel.
6. RLS continues to gate writes to admins; reads are open to authenticated users.

## Non-goals

- **No backfill of loan interest accruals.** Old/paid loans are not touched. Each active loan gets one synthetic *opening-balance* row at cutover; everything else flows forward from EOM.
- **No per-member donation eligibility.** Eligibility stays fund-wide (matches the 2023 resolutions). Donations have a `member_id` (beneficiary) but eligibility is a fund-level spending capacity.
- **No mixed-purpose transaction rows.** Interest payments remain single-purpose `transactions` rows (`type='interest'`, `source='loans'`) — the new junction table links them to one-or-more accrual rows, it doesn't change the transaction schema.
- **No retro-recomputation of paid accrual rows.** Once an accrual is settled (in part or full), the cron's upsert clause excludes it. Corrections to paid rows are an explicit admin action (reverse payment → recompute).

## Architecture overview

```
public.loan_interest_accruals       ← cron (EOM 23:55 IST) inserts forward-only
                                    ← admin payments stamp paid_amount / status
public.loan_interest_payments       ← junction (accrual ↔ transaction)

public.donation_eligibility_periods ← cron (EOM 23:55 IST) inserts/upserts
                                    ← migration backfills from fund inception

Cron schedule: '25 18 * * *' UTC (= 23:55 IST). Both functions guard with
   if (today_ist + 1) <> first-of-next-month then return.
```

`pg_cron` runs in the database's timezone; we make functions timezone-explicit (`now() at time zone 'Asia/Kolkata'`) so the schedule string is a heartbeat and the date math is correct.

Both functions are **idempotent** via `INSERT ... ON CONFLICT`:

- Donation eligibility: full upsert (no FK dependencies).
- Loan interest: conditional upsert (only rows where `status = 'pending'` or `status = 'waived'`; paid rows are immutable from cron's perspective).

## Loan interest

### Schema

```sql
create table public.loan_interest_accruals (
  id                  uuid primary key default gen_random_uuid(),
  loan_id             uuid not null references public.loans(id) on delete cascade,
  period_end          date not null,                          -- EOM of accrued month
  amount_due          numeric(12,2) not null default 0,
  paid_amount         numeric(12,2) not null default 0 check (paid_amount >= 0),
  status              text not null default 'pending'
                        check (status in ('pending','partially_paid','paid','waived')),
  interest_rate_used  numeric not null,                       -- interest_per_lakh @ period_end
  balance_basis       numeric(12,2) not null,                 -- loan balance @ EOM
  is_opening_balance  boolean not null default false,         -- cutover seed
  waiver_reason       text,                                   -- non-null for waived rows
  recomputed_at       timestamptz,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (loan_id, period_end)
);

create index on public.loan_interest_accruals (loan_id, status);
create index on public.loan_interest_accruals (period_end);

create table public.loan_interest_payments (
  accrual_id      uuid not null references public.loan_interest_accruals(id) on delete restrict,
  transaction_id  uuid not null references public.transactions(id) on delete restrict,
  amount_applied  numeric(12,2) not null check (amount_applied > 0),
  applied_at      timestamptz not null default now(),
  primary key (accrual_id, transaction_id)
);
```

`paid_amount` + `status` are denormalised for fast reads. They are maintained by a trigger on `loan_interest_payments` (insert / delete) that recomputes from the junction.

`on delete restrict` on both junction FKs prevents accidental loss of audit history — admins must explicitly reverse a payment, which deletes the junction rows first.

### Accrual function

`fn_accrue_loan_interest()` body, EOM run:

1. Compute `today_ist = (now() at time zone 'Asia/Kolkata')::date`. Return if `today_ist + 1` is not the first of next month.
2. Resolve `interest_per_lakh` from `reference_history` for `period_end = today_ist`.
3. For every `loans` row where `status = 'active'` AND `monthsBetween(start_date, period_end) >= 1`:
   - `balance = greatest(principal − Σ loan_repayment.amount where transaction_date ≤ period_end − bad_debt, 0)`
   - If `period_end < start_date + interest_waiver_months`: insert `status='waived'`, `amount_due=0`, `waiver_reason='within_waiver_window'`.
   - Else: `amount_due = round((balance / 100000) × rate, 2)`, `status='pending'`.
4. `INSERT ... ON CONFLICT (loan_id, period_end) DO UPDATE SET ... WHERE status IN ('pending','waived')`.

The `monthsBetween >= 1` skip matches existing `loan-math.ts`: a loan started 2026-05-20 first accrues at EOM June 2026, not May 2026.

**Known quirk (preserved from existing math, worth a future revisit):** `monthsBetween` is anniversary-based (calendar-month diff), so a loan started **June 1** is *also* skipped at EOM June — even though it was outstanding for the full month. First accrual is EOM July. A loan started **May 31** accrues 1 month at EOM June. This design preserves the current behaviour rather than fix it, to avoid changing the math during this migration. If you'd rather switch to "outstanding for at least one full calendar month" semantics, flag it before implementation and we'll add it.

### Cutover handling — opening-balance seed

For each loan with `status = 'active'` today, the migration inserts one row:

```
period_end          = (cutover_date - 1)
amount_due          = computeLoanFinancials(loan, txns, rate).interestDue
is_opening_balance  = true
status              = 'pending'  (or 'paid' if interestDue == 0)
interest_rate_used  = current interest_per_lakh
balance_basis       = current balance
```

This collapses all pre-cutover unpaid interest into one auditable row. Loan summary becomes "pending interest = Σ unpaid accrual rows" with no special pre/post-cutover splitting in the read path.

### Payment flow (hybrid)

UI on `/admin/loans/[loan_number]`:

- "Pending interest" panel lists every `pending` and `partially_paid` accrual row.
- Each row has a checkbox + an "amount to apply" input (defaults to `amount_due − paid_amount`).
- "Pay All Due" button = check all + sum.
- Submit calls `payLoanInterest(loanId, allocations, txnDate, notes?)`.

Server action wraps `fn_apply_interest_payment(loan_id, txn_date, allocations[], notes)`:

1. Insert one `public.transactions` row: `transaction_type='interest'`, `interest_source='loans'`, `amount = Σ allocations`, `loan_id`, `transaction_date`.
2. Insert one `loan_interest_payments` row per allocation.
3. The junction trigger recomputes `paid_amount` and `status` on every affected accrual.
4. Overpayment fails inside the trigger (check: `paid_amount <= amount_due`).

Reversal: `reverseInterestPayment(transactionId)` deletes the junction rows then the transaction in a single DB transaction; the trigger rolls `paid_amount` and `status` back.

### Loan closure interaction

When admin marks a loan `paid` or `write_off`, an `after update` trigger on `loans` flips all `pending` accruals for that loan to `status='waived'`, `amount_due=0`, `waiver_reason='loan_closed'`. Audit trail preserved; pending-interest reports drop to zero. Reopening (`paid → active`) does **not** reverse the waiver — that's a deliberate admin recompute action.

## Donation eligibility

### Schema

```sql
create table public.donation_eligibility_periods (
  id                    uuid primary key default gen_random_uuid(),
  period_end            date not null unique,             -- EOM of the represented month
  contributions_basis   numeric(12,2) not null default 0, -- Σ contributions in [BOM, EOM]
  pct_used              numeric not null,                 -- donation_eligibility_pct @ period_end
  threshold_used        numeric not null,                 -- corpus_threshold @ period_end
  corpus_at_period_end  numeric(12,2) not null,           -- cum. C − D − bad_debt
  threshold_met         boolean not null,
  amount_earned         numeric(12,2) not null,           -- 0 if !threshold_met
  recomputed_at         timestamptz,
  created_at            timestamptz not null default now()
);

create index on public.donation_eligibility_periods (period_end desc);
```

No junction table. Donations live in `transactions`. Eligibility is consumed *implicitly* — the available balance is `Σ amount_earned − Σ donations − Σ bad_debt` (a view, see read-path section).

### Helper + cron + backfill (single math, three callers)

```
fn_compute_eligibility_for(p_period_end date) returns void
  -- 1. v_period_start = date_trunc('month', p_period_end)
  -- 2. Resolve pct + threshold from reference_history for p_period_end
  -- 3. v_contributions = Σ transactions.amount where type='contribution'
  --                       AND transaction_date BETWEEN v_period_start AND p_period_end
  -- 4. v_corpus = Σ contributions(through p_period_end)
  --             − Σ donations(through p_period_end)
  --             − Σ loans.bad_debt where status='write_off' and end_date ≤ p_period_end
  -- 5. v_threshold_met = (v_corpus >= v_threshold)
  -- 6. v_amount_earned = v_threshold_met ? round(v_contributions × pct/100, 2) : 0
  -- 7. INSERT ... ON CONFLICT (period_end) DO UPDATE SET ... (full upsert)

fn_accrue_donation_eligibility()
  -- EOM guard + fn_compute_eligibility_for(today_ist)

fn_backfill_donation_eligibility() returns int
  -- Walks EOM dates from first contribution month to current month,
  -- calling fn_compute_eligibility_for on each. Returns row count.
```

### Migration

`010_seed_donation_eligibility.sql` (new) runs `select fn_backfill_donation_eligibility()` once during deploy. Idempotent — re-running just refreshes everything.

### Read-path views

```sql
-- Per-period ledger with running carry balance
create or replace view public.donation_eligibility_ledger as
select
  p.period_end,
  p.contributions_basis,
  p.amount_earned,
  p.threshold_met,
  coalesce(d.donations_in_period, 0) as donations_in_period,
  coalesce(bd.bad_debts_in_period, 0) as bad_debts_in_period,
  sum(p.amount_earned
      - coalesce(d.donations_in_period, 0)
      - coalesce(bd.bad_debts_in_period, 0))
    over (order by p.period_end) as carry_balance
from donation_eligibility_periods p
left join lateral (
  select sum(amount) as donations_in_period
  from transactions
  where transaction_type = 'donation'
    and transaction_date >  (p.period_end - interval '1 month')::date
    and transaction_date <= p.period_end
) d on true
left join lateral (
  select sum(bad_debt) as bad_debts_in_period
  from loans
  where status = 'write_off'
    and end_date >  (p.period_end - interval '1 month')::date
    and end_date <= p.period_end
) bd on true;

-- One-row summary for the dashboard tile
create or replace view public.donation_eligibility_summary as
select
  (select coalesce(sum(amount_earned), 0) from donation_eligibility_periods) as total_earned,
  (select coalesce(sum(amount), 0)
     from transactions where transaction_type = 'donation')                  as total_donated,
  (select coalesce(sum(bad_debt), 0)
     from loans where status = 'write_off')                                  as total_bad_debt,
  greatest(
    (select coalesce(sum(amount_earned), 0) from donation_eligibility_periods)
    - (select coalesce(sum(amount), 0)
         from transactions where transaction_type = 'donation')
    - (select coalesce(sum(bad_debt), 0)
         from loans where status = 'write_off'),
    0
  )                                                                          as available_now;
```

## RLS

All three tables enable RLS. Authenticated users `SELECT`; `INSERT/UPDATE/DELETE` gated by `public.is_admin()`. Cron functions are `security definer` and bypass RLS naturally. Matches existing `004_rls_policies.sql` patterns.

## Server actions

New file `src/lib/actions/loan-interest.ts`:

| Action                                                  | Auth          | Purpose                                                                        |
| ------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------ |
| `getLoanInterestSchedule(loanId)`                       | Authenticated | Accrual rows + linked payment txns.                                            |
| `payLoanInterest(loanId, allocations, txnDate, notes?)` | Admin         | Wraps `fn_apply_interest_payment`.                                             |
| `reverseInterestPayment(transactionId)`                 | Admin         | Atomic junction-then-txn deletion.                                             |
| `recomputeLoanInterest()`                               | Admin         | Manual `fn_accrue_loan_interest()` invocation (post `reference_history` edit). |

New file `src/lib/actions/eligibility.ts`:

| Action                                    | Auth          | Purpose                                       |
| ----------------------------------------- | ------------- | --------------------------------------------- |
| `getDonationEligibilitySummary()`         | Authenticated | `select * from donation_eligibility_summary`. |
| `getDonationEligibilityLedger()`          | Authenticated | Ordered ledger rows for the donations page.   |
| `recomputeDonationEligibility(fromDate?)` | Admin         | Manual backfill from a chosen month.          |

Existing actions that change:

- `loans.ts → getLoanDetail()`: read `pending_interest` from `loans_balances` view (updated to sum from accruals); stop calling `computeLoanFinancials` for active-loan summary.
- `transactions.ts → createTransaction()`: reject `type='interest', source='loans', loan_id=…` admin submissions with an inline error pointing to the loan detail UI.
- `dashboard.ts → getDashboardEligibility()`: rewritten as a single `select * from donation_eligibility_summary`.

## View updates

`public.loans_balances` gains a `pending_interest` column = `Σ (amount_due − paid_amount) for unpaid accruals on this loan`. Replaces the on-the-fly `interestDue` computation for active loans.

## Migration order

```
009_loan_interest_accruals.sql   -- new tables + indexes + RLS + triggers + functions
010_donation_eligibility.sql     -- new table + RLS + helper + cron functions + backfill
011_loans_balances_view.sql      -- update loans_balances view to source pending_interest from accruals
012_pg_cron_schedule.sql         -- enable extension + cron.schedule(...)
013_seed_active_loan_openings.sql -- one synthetic accrual per active loan (computed from current loan-math.ts logic in SQL)
```

Each migration is re-runnable. `013` uses idempotent `INSERT ... ON CONFLICT DO NOTHING` so re-running is harmless.

## Operational tooling

New admin page `/admin/system/accruals`:

- "Last cron run" tile (`max(recomputed_at)` from each table).
- Row counts: active loans tracked, current pending interest total, donation eligibility periods.
- "Re-run loan interest now" / "Re-run donation eligibility now" buttons (call recompute actions).
- pg_cron history: last 10 entries from `cron.job_run_details` filtered by `jobid` for `fcf-eom-accruals`.

## Testing

**Vitest (unit / server-action level):**

- `loan-math.test.ts` — unchanged; used during `013` migration to compute opening-balance seeds.
- New `loan-interest.test.ts` — FIFO allocation, partial pay, multi-row pay, overpayment rejected, reversal restores state.
- New `eligibility-views.test.ts` — feed known transactions, run backfill, assert `donation_eligibility_summary.available_now` ≈ `computeEligibility().availableNow` (≤ ₹1 rounding diff).

**Migration smoke test (`docs/migration-checklist.md`):**

```sql
-- Eligibility parity
select (select available_now from donation_eligibility_summary) as new_available;
-- Compare against pre-migration snapshot of computeEligibility().availableNow.

-- Loan interest parity (active loans)
select sum(amount_due - paid_amount) as new_pending
from loan_interest_accruals
where status in ('pending', 'partially_paid');
-- Compare against pre-migration snapshot of sum(loan-math.ts interestDue) for active loans.
```

Both diffs must be < ₹1.

## Edge cases handled

- **Loan paid off mid-month** — EOM cron sees `status != 'active'`, skips. Loan closure trigger waives any remaining pending rows.
- **Loan reopened** — picks up at next EOM; closed-month waivers stay waived unless admin recomputes manually.
- **Rate change in `reference_history`** — affects only `pending` and `waived` accrual rows on next cron run or manual recompute. Paid rows are immutable.
- **Donation backdated to a closed period** — `donation_eligibility_summary` updates immediately (it sums live transactions); `donation_eligibility_ledger` reflects new totals via the view. The periods row itself doesn't change (donation is consumption, not earning).
- **Bad-debt loan closed retroactively** — affects subsequent periods' `corpus_at_period_end` and `threshold_met`. Re-run `fn_backfill_donation_eligibility()` to update.
- **Month with zero contributions** — periods row still written with `amount_earned = 0`; preserves running-carry-balance accuracy in the ledger view.
- **First-of-month after late-night cron** — guard uses IST date, so the EOM check is correct regardless of cron's UTC clock.

## Open questions (none blocking)

- Should `recomputeLoanInterest()` accept a `loan_id` filter to recompute a single loan? (Decided: not yet — global is fine; loan-level recompute is rare and can be done via SQL.)
- Should we surface `cron.job_run_details` health (last failure, last success) as a Sentry breadcrumb? (Decided: log row counts only for now; add Sentry if pg_cron failures ever happen.)
