# Loan EMI Model — Design Spec

**Date:** 2026-06-13
**Status:** Draft — awaiting review
**Author:** Claude (brainstorm with @pkorrakuti)

## 1. Goal

Migrate loans from the current **open-ended month-end interest accrual** model to a
**bank-style EMI (Equated Monthly Installment) model**. Every active/new loan gets a
fully materialized repayment schedule at creation time, where each installment pays both
**principal + interest** computed on a **reducing balance** at **8% annual**.

## 2. Current model (recap — what we are replacing)

- Loans are open-ended; no term. `loans(principal_amount, start_date, end_date, status, loan_type, interest_waiver_months, interest_waived, bad_debt)`.
- A `pg_cron` job (`fn_accrue_loan_interest`, 23:55 IST) writes one row per active loan per month into `loan_interest_accruals` where `amount_due = (outstanding ÷ 100,000) × interest_per_lakh`.
- Interest and principal are paid as **separate** transactions (`interest`/source=`loans`, and `loan_repayment`).
- `loans_balances.pending_interest` = Σ unpaid accruals. `interest_per_lakh` lives in `reference`.

This whole accrual machinery is **retired for EMI loans** (kept read-only for history / closed loans).

## 3. New model — decisions (locked)

| #   | Decision           | Choice                                                                                                                                                                                                                                     |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Interest method    | **Reducing-balance amortization.** EMI = `P·r·(1+r)ⁿ / ((1+r)ⁿ−1)`, `r = annual/12`.                                                                                                                                                       |
| 2   | Annual rate        | **8%** (`r = 0.08/12 ≈ 0.0066667/mo`). Configurable via reference key.                                                                                                                                                                     |
| 3   | Term               | Member-chosen, **1 … 30 months** (max 2yr 6mo).                                                                                                                                                                                            |
| 4   | Loan types         | `medical` → **6-month** interest-free waiver by default. `personal` → **0** default, admin may set **0–6**.                                                                                                                                |
| 5   | Waiver semantics   | **Interest-free moratorium.** No interest during waiver; EMIs start the month after waiver ends, amortizing the **original principal** over the chosen term at 8%.                                                                         |
| 6   | EMI due day        | **The 10th of the month *following* the accrual month.** Each calendar month's EMI is payable by the 10th of the next month (June's charge → due 10 Jul; July's → due 10 Aug). Late fee triggers if still unpaid 2 months past this due date. |
| 6a  | Mid-month proration | If a loan is disbursed mid-month (no waiver), the disbursement month is a **pro-rated stub installment**: both interest and principal are scaled by `f = (days from disbursement to month-end inclusive) / 30`. Full monthly EMIs follow. See §6a. |
| 7   | Rate handling      | Schedule **materialized at creation** using the then-current reference rate (stored on schedule rows → effectively locked). Admin can trigger **Recalculate**, which re-reads the live reference rate and rebuilds the remaining schedule. |
| 8   | Prepayment         | **Member's choice each time:** (a) keep EMI → shorten tenure, or (b) keep tenure → lower EMI. Remaining schedule rebuilt from new outstanding.                                                                                             |
| 9   | EMI → transactions | **Two linked transactions per EMI:** a `loan_repayment` (principal portion) + an `interest`/source=`loans` (interest portion). Both link to the schedule row. Existing dashboards unchanged.                                               |
| 10  | Late fees          | **Cumulative, duration-scaled.** First 2 overdue months free, then each month adds `late_fee_pct` × EMI; cumulative = `late_fee_pct% × EMI × (months_overdue − grace + 1)` (grace 2 → ×1 at 2 months, ×2 at 3 months…). Evaluated monthly on the **11th**; each step recorded as a `penalty` transaction (delta) and accumulated on the schedule row. See §9. |
| 11  | Legacy conversion  | At a configurable **cutoff date**, admin opens each active loan and sets a remaining term (≤30mo). Current outstanding becomes the principal of a fresh EMI schedule dated from cutoff.                                                    |

## 4. Configuration (`public.reference` + `reference_history`)

New keys (admin-editable, history-tracked like existing reference values):

| Key                           | Default          | Meaning                                        |
| ----------------------------- | ---------------- | ---------------------------------------------- |
| `loan_interest_rate_pct`      | `8`              | Annual nominal rate for new EMI schedules.     |
| `loan_max_term_months`        | `30`             | Max selectable term.                           |
| `loan_default_waiver_medical` | `6`              | Default waiver months for medical loans.       |
| `loan_max_waiver_months`      | `6`              | Cap on waiver months for any loan.             |
| `late_fee_pct`                | `2`              | % of overdue EMI charged as one-time late fee. |
| `late_fee_overdue_months`     | `2`              | Months past due before the late fee triggers.  |
| `emi_cutover_date`            | (set at rollout) | Date from which legacy loans convert to EMI.   |

`interest_per_lakh` stays for historical accrual math on pre-cutover/closed loans.

> **Storage note:** `public.reference.value` is `numeric NOT NULL`, so the date-valued key `emi_cutover_date` is stored as a **`YYYYMMDD` integer** (e.g. `20260701`), not a date string. Convert in SQL with `to_date(value::int::text,'YYYYMMDD')` and in TS by parsing the 8-digit number. All other EMI keys are plain numbers.

## 5. Schema changes

### 5.1 `loans` (additive columns)
```sql
alter table public.loans
  add column if not exists term_months          integer,            -- chosen tenure (1..30)
  add column if not exists interest_rate_pct     numeric,            -- rate captured at schedule generation
  add column if not exists emi_amount            numeric(12,2),      -- standard EMI (last row may differ)
  add column if not exists schedule_generated_at timestamptz,
  add column if not exists repayment_model       text not null default 'accrual'
                                                  check (repayment_model in ('accrual','emi'));
```
`repayment_model='accrual'` = legacy untouched loan; `'emi'` = on the new model.

### 5.2 New `loan_emi_schedule`
```sql
create table public.loan_emi_schedule (
  id                 uuid primary key default gen_random_uuid(),
  loan_id            uuid not null references public.loans(id) on delete cascade,
  installment_no     integer not null,            -- 1..term_months
  due_date           date not null,
  opening_balance    numeric(12,2) not null,
  emi_amount         numeric(12,2) not null,      -- principal_due + interest_due
  principal_due      numeric(12,2) not null,
  interest_due       numeric(12,2) not null,
  closing_balance    numeric(12,2) not null,
  principal_paid     numeric(12,2) not null default 0,
  interest_paid      numeric(12,2) not null default 0,
  status             text not null default 'scheduled'
                       check (status in ('scheduled','paid','partially_paid','overdue','waived')),
  late_fee_charged   numeric(12,2) not null default 0,
  late_fee_txn_id    uuid references public.transactions(id),
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  unique (loan_id, installment_no)
);
```

### 5.3 New `loan_emi_payments` (junction, mirrors `loan_interest_payments`)
```sql
create table public.loan_emi_payments (
  schedule_id    uuid not null references public.loan_emi_schedule(id) on delete restrict,
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  principal_applied numeric(12,2) not null default 0,
  interest_applied  numeric(12,2) not null default 0,
  applied_at     timestamptz not null default now(),
  primary key (schedule_id, transaction_id)
);
```
RLS mirrors existing accrual tables (admin write via `is_admin()`).

## 6. Schedule generation (stored procedure / background job)

`fn_generate_emi_schedule(p_loan_id uuid, p_principal numeric, p_start date, p_term int, p_waiver_months int, p_rate_pct numeric)`:

1. Delete any existing **unpaid** schedule rows for the loan (paid rows preserved on recalc).
2. `r = p_rate_pct/100/12`. `emi = round(P·r·(1+r)ⁿ / ((1+r)ⁿ−1))` (n = term) — the **standard monthly EMI** on the full principal. Store `emi_amount` on the loan.
3. **Accrual months → due dates.** Each schedule row corresponds to one *accrual month* and is **due on the 10th of the following month** (see due-day rule). The first accrual month is the disbursement month `p_start` (when `p_waiver_months = 0`), otherwise the first full month after the waiver.
4. **Pro-rated stub (only when `p_waiver_months = 0` and `p_start` is not the 1st):** the disbursement month is a partial period. `f = (days_in_month(p_start) − day(p_start) + 1) / 30`. The stub installment = `f ×` a normal first EMI: `interest = round(P·r·f)`, `principal = round((emi − P·r)·f)`. It is **installment #1**, due on the 10th of the month after `p_start`. The remaining balance carries into the first full month.
5. **Full EMIs:** amortize the remaining balance at the fixed `emi` (reducing-balance), one row per full month, each due the 10th of the *next* month, until the balance clears. `interest_due = round(opening × r)`, `principal_due = emi − interest_due`; the final installment sets `principal_due = opening` and `emi_amount = principal_due + interest_due` so the closing balance hits exactly 0.
6. Set `loans.repayment_model='emi'`, `term_months`, `interest_rate_pct`, `schedule_generated_at`. (With a stub, total rows = chosen term + 1.)

**Due-day rule (canonical — both the SQL generator and the TS preview must agree):** every installment is **due on the 10th of the month following its accrual month**. The accrual month of installment 1 is `p_start`'s month (no waiver) or the first post-waiver month; each subsequent installment advances the accrual month by one. So a loan disbursed any day in June has its June (stub) charge due **10 Jul**, July's EMI due **10 Aug**, August's due **10 Sep**, and so on — the due day is always the 10th regardless of the disbursement day. (`addMonthsClamped` / start-anniversary logic is replaced by this rule.)

**Waiver interaction:** when `p_waiver_months > 0`, the interest-free moratorium absorbs the partial disbursement month — **no stub is generated**. The first charged accrual month is the first full month after the waiver ends, due the 10th of the month after that. All such EMIs are full (un-prorated) months.

**Recalculate guard:** `fn_generate_emi_schedule` deletes and rebuilds only `scheduled`/`overdue` rows; its upsert is guarded so it never overwrites a `paid`/`partially_paid`/`waived` installment. The **Recalculate** action additionally refuses to run once any EMI payment exists on the loan (use prepayment to re-shape a schedule that already has payments).

**Trigger point:** called from `createLoan` server action (after insert) and from the admin **Recalculate** action. Runs synchronously (≤30 rows — cheap); no async job needed. Past-dated loans (decision #11/#8) generate identically — due dates simply fall in the past and the first scheduled job run marks them paid/overdue based on recorded payments.

### 6a. Worked example — mid-month disbursement with proration

Loan **₹2,40,000**, **30 months**, **8%**, **disbursed 27 Jun 2026**, no waiver. Standard EMI = **₹8,853**. June is partial: `f = (30 − 27 + 1)/30 = 4/30 = 0.1333`.

| # | Accrual month (due by) | Opening | EMI | Interest | Principal | Closing |
|--:|---|--:|--:|--:|--:|--:|
| 1 | Jun-26 — stub (**due 10 Jul**) | 2,40,000 | **1,180** | 213 | 967 | 2,39,033 |
| 2 | Jul-26 (**due 10 Aug**) | 2,39,033 | 8,853 | 1,594 | 7,259 | 2,31,774 |
| 3 | Aug-26 (**due 10 Sep**) | 2,31,774 | 8,853 | 1,545 | 7,308 | 2,24,466 |
| 4 | Sep-26 (**due 10 Oct**) | 2,24,466 | 8,853 | 1,496 | 7,357 | 2,17,109 |
| … | … | … | … | … | … | … |
| 31 | last (full) | 7,628 | 7,679 | 51 | 7,628 | 0 |

- **Stub row #1** is the disbursement month (June): interest `= 2,40,000 × 0.6667% × 0.1333 = ₹213`, principal `= (8,853 − 1,600) × 0.1333 = ₹967` — both pro-rated by `f`. Due **10 Jul** (10th of the following month).
- The remaining balance (₹2,39,033) amortizes at the fixed ₹8,853 EMI; each row is due the **10th of the month after** its accrual month. Total rows = **31** (1 stub + 30 full).
- If disbursed on the **1st** (`f = 30/30 = 1`) or with a **waiver**, there is **no stub** — the schedule is all full months, first EMI due the 10th of the month after the (post-waiver) first accrual month.

## 7. Payment flow

`payEmi(loanId, installmentNo, amount, paidDate)` server action (admin) — analogous to today's `payLoanInterest`:

1. Re-check admin auth.
2. Determine the target installment(s); allocate `amount` to `interest_due` first then `principal_due` (interest-first within an EMI).
3. Insert **two** transactions: `loan_repayment` (principal portion) + `interest`/`loans` (interest portion), dated `paidDate`.
4. Insert a `loan_emi_payments` row linking both txns to the schedule row, with `principal_applied`/`interest_applied`.
5. A trigger (`fn_recompute_emi_paid_state`, like `fn_recompute_accrual_paid_state`) updates `principal_paid`/`interest_paid`/`status` on the schedule row; rejects overpayment beyond `emi_amount`.
6. `updateTag('dashboard')` + `revalidatePath`.

## 8. Prepayment (advance payment)

`prepayLoan(loanId, amount, mode, paidDate)` where `mode ∈ {reduce_tenure, reduce_emi}`:

1. Record the advance as a `loan_repayment` transaction (extra principal).
2. New outstanding = current closing balance − advance.
3. Rebuild the **remaining** schedule via `fn_generate_emi_schedule` on the new outstanding for the remaining due dates:
   - `reduce_tenure`: keep `emi_amount`, recompute n (fewer rows).
   - `reduce_emi`: keep remaining n, recompute a smaller EMI.
4. Already-paid installments are untouched.

## 9. Late fees (scheduled job)

`fn_apply_emi_late_fees()` runs on a **dedicated monthly `pg_cron` job on the 11th of each month** (`'fcf-emi-late-fees'`, 00:30 UTC = 06:00 IST on the 11th) — the day after the 10th due date, analogous to how accruals run at month-end. The admin **Recalculate** action also calls it on demand (idempotent). It is **not** part of the daily EOM accruals job.

**Cumulative, duration-scaled fee.** The fee grows with how long an installment stays unpaid:

- `months_overdue` = full months from the installment's (10th) due date to today (IST). A "2M 4D"-overdue installment has `months_overdue = 2`.
- Grace = `late_fee_overdue_months` (default **2**): the first 2 overdue months are free; the first fee lands once `months_overdue` reaches `grace` (the 3rd month).
- `multiplier = max(months_overdue − grace + 1, 0)` → 0 while `months_overdue < 2`, then **1** at 2 months, **2** at 3 months, **3** at 4 months, …
- **Cumulative target** = `round(emi_amount × late_fee_pct% × multiplier)`.

On each monthly run, for every unpaid EMI (`status ∈ scheduled/partially_paid/overdue`), the job tops `late_fee_charged` up to the current cumulative target and records the **delta** as a `penalty` transaction (so one ~`late_fee_pct%`-of-EMI penalty per overdue month). It is **idempotent within a month** (target unchanged ⇒ no charge) and **preserved across schedule rebuilds** (migration 044). The schedule row's `late_fee_charged` holds the running cumulative total; `late_fee_txn_id` points at the latest monthly penalty.

### 9a. Worked late-fee example — cumulative over months

EMI **₹8,699**, `late_fee_pct = 2%` (so 2% × EMI = **₹174/step**), grace = 2. Installment due **2026-06-10**, never paid. The 11th-of-month job:

| Run (11th) | `months_overdue` | `multiplier = max(m−2+1, 0)` | Cumulative target | Penalty txn this run (delta) |
|---|---:|---:|---:|---:|
| 2026-07-11 | 1 | 0 | ₹0 | — (1st/2nd month grace) |
| 2026-08-11 | 2 | 1 | ₹174 | **₹174** (3rd month) |
| 2026-09-11 | 3 | 2 | ₹348 | ₹174 |
| 2026-10-11 | 4 | 3 | ₹522 | ₹174 |

So an installment **2 months overdue → ₹174**, **3 months → ₹348**, **4 months → ₹522**, …  Each run inserts a `penalty` transaction for the **incremental** ₹174 (description e.g. `Late fee: EMI #N — 3 months overdue (cumulative 348)`), and `loan_emi_schedule.late_fee_charged` advances to the cumulative target with `status='overdue'`.

Notes:
- Per-installment: EMI #2 overdue accrues its **own** cumulative fee on *its* EMI amount; fees are never bundled across installments.
- The penalty is **not** part of the EMI; it is a standalone receivable surfaced via `transaction_type='penalty'` in dashboards. Each monthly delta is its own transaction.
- Once the installment is paid (status leaves the unpaid set) it stops accruing further late fees.

## 10. Migrating existing loans after the cutoff

Existing loans are on the **accrual** model and carry two kinds of balance: outstanding **principal** and **pre-cutoff accrued interest** (rows in `loan_interest_accruals`). The migration treats these two **independently** — it does **not** waive, capitalize, or lump-sum the old interest.

### 10.1 Rules

- **Pre-cutoff accrued interest is preserved exactly as-is.** All existing `loan_interest_accruals` rows (pending / partially_paid) stay untouched. The member continues to **pay them off one-by-one** through the existing "Pending interest" flow (`payLoanInterest`) until that backlog is cleared. The migration touches **none** of these rows — no waiver, no rollover.
- **The EMI schedule covers only the outstanding principal, starting from the cutoff date.** New EMI base = `pending_principal` from `loans_balances` at conversion time (`principal − repaid − bad_debt`). Schedule generated via `fn_generate_emi_schedule(loan, pending_principal, emi_cutover_date, term, waiver_months = 0, current_rate)`. First EMI falls one month after `emi_cutover_date`. No moratorium on conversions.
- **Forward interest comes only from the EMI schedule.** Once a loan is converted (`repayment_model='emi'`), the month-end accrual cron **stops generating new accrual rows for it** (`fn_accrue_loan_interest` is guarded to skip `repayment_model='emi'` loans). So interest up to the cutoff lives in the legacy accruals; interest after the cutoff lives in the EMI schedule's `interest_due`. No overlap, no double-charge.
- **Net effect — two parallel obligations on a converted loan until the backlog clears:**
  1. Legacy accrued-interest backlog → settled one installment at a time (existing pending-interest panel).
  2. EMI schedule on the principal → principal + forward interest, paid monthly.
  Both surface on the loan detail page; the loan is fully closed only when both reach zero.

### 10.2 Process (decision #11 — admin-driven, per loan)

1. Set `emi_cutover_date` in `reference` (e.g. `2026-07-01`).
2. Until that date, active loans behave exactly as today.
3. From the cutoff date, an admin opens each active loan and runs **Convert to EMI**: pick a remaining term (1–`loan_max_term_months`). The action reads `pending_principal`, generates the EMI schedule from the cutoff date, and flips `repayment_model` to `'emi'`. Legacy accruals are left in place.
4. Conversion is per-loan and explicit — there is no automatic batch flip. (A one-off SQL helper that loops active loans with a default term is possible later, but is **not** the default.)

### 10.3 Worked migration example

A legacy personal loan at the cutoff has **₹50,000 outstanding principal** and, say, **₹2,193 of unpaid accrued interest** sitting in `loan_interest_accruals`. Admin converts it with a **12-month** term:

- The **₹2,193 accrued-interest backlog is untouched** — the member keeps paying it down via the pending-interest panel (e.g. ₹650-ish at a time), independent of the EMI schedule.
- A fresh EMI schedule is generated on the **₹50,000 principal** from the cutoff date. EMI on ₹50,000 / 12 months / 8% = **₹4,349** (last EMI ₹4,354):

| EMI # | Opening | EMI | Interest | Principal | Closing |
|---:|--------:|----:|---------:|----------:|--------:|
| 1 | 50,000 | 4,349 | 333 | 4,016 | 45,984 |
| 2 | 45,984 | 4,349 | 307 | 4,042 | 41,942 |
| 3 | 41,942 | 4,349 | 280 | 4,069 | 37,873 |
| 4 | 37,873 | 4,349 | 252 | 4,097 | 33,776 |
| 5 | 33,776 | 4,349 | 225 | 4,124 | 29,652 |
| 6 | 29,652 | 4,349 | 198 | 4,151 | 25,501 |
| 7 | 25,501 | 4,349 | 170 | 4,179 | 21,322 |
| 8 | 21,322 | 4,349 | 142 | 4,207 | 17,115 |
| 9 | 17,115 | 4,349 | 114 | 4,235 | 12,880 |
| 10 | 12,880 | 4,349 | 86 | 4,263 | 8,617 |
| 11 | 8,617 | 4,349 | 57 | 4,292 | 4,325 |
| 12 | 4,325 | **4,354** | 29 | 4,325 | 0 |

Forward interest on the EMI schedule = **₹2,193**. This is *new* interest accruing after the cutoff on the principal — entirely separate from the ₹2,193 legacy backlog (the equal figure here is coincidental). The member's total remaining obligation = ₹2,193 (legacy interest, paid one-by-one) + ₹52,193 (EMI principal + forward interest, paid monthly).

## 11. Views & dashboard impact

- **New view `loan_emi_balances`** (or extend `loans_balances`): for EMI loans, `pending_principal`, `pending_interest`, `next_due_date`, `next_emi_amount`, `overdue_count` derived from `loan_emi_schedule`. For accrual loans, fall back to existing logic. The app reads one unified shape keyed off `repayment_model`.
- `loans_balances.pending_interest` for EMI loans = Σ `interest_due − interest_paid` over unpaid rows.
- No change to contribution/donation/eligibility views — EMI interest still flows through the same `interest`/`loans` transactions.

## 12. UI changes

- **Create loan** (`admin/loans/new`): add term selector (1–30), loan_type drives waiver default, live EMI + total-interest preview, and a schedule preview table before submit. Support back-dated `start_date`.
- **Loan detail** (`admin/loans/[loan_number]`):
  - For **EMI loans**, show an **EMI schedule table** (installment #, due date, opening, EMI, principal, interest, status, late fee) with actions: **Pay EMI**, **Prepay (reduce-tenure / reduce-EMI choice)**, **Recalculate**.
    - **Pay EMI gating:** the **Pay EMI** button appears **only on the earliest unpaid installment that is currently due or overdue** (i.e. its due date — the 10th of the following month — has arrived). Future installments show **no** Pay EMI button (paying ahead is done via **Prepay**). This enforces sequential, in-cycle payment.
  - For **accrual loans** before cutoff, keep today's "Pending interest" panel; from the cutoff date also offer **Convert to EMI** (term input).
  - For a **converted loan that still has a legacy accrued-interest backlog**, show **both** panels — the legacy "Pending interest" panel (so the member pays the pre-cutoff backlog one-by-one) *and* the EMI schedule. The loan closes only when both are zero.
- **Read-only** dashboard loan pages show the same schedule, no actions.
- Currency via `formatRupees`; tables follow existing shadcn patterns.

## 13. Worked example — ₹1,00,000, personal, 18 months, 8%, no waiver

EMI = `100000 · 0.0066667 · (1.0066667)¹⁸ / ((1.0066667)¹⁸ − 1)` ≈ **₹5,914/mo** (last EMI ₹5,913 to zero out).

|   Mo |  Opening |   EMI | Interest | Principal | Closing |
| ---: | -------: | ----: | -------: | --------: | ------: |
|    1 | 1,00,000 | 5,914 |      667 |     5,247 |  94,753 |
|    2 |   94,753 | 5,914 |      632 |     5,282 |  89,471 |
|    3 |   89,471 | 5,914 |      596 |     5,318 |  84,153 |
|    4 |   84,153 | 5,914 |      561 |     5,353 |  78,800 |
|    5 |   78,800 | 5,914 |      525 |     5,389 |  73,411 |
|    6 |   73,411 | 5,914 |      489 |     5,425 |  67,986 |
|    7 |   67,986 | 5,914 |      453 |     5,461 |  62,525 |
|    8 |   62,525 | 5,914 |      417 |     5,497 |  57,028 |
|    9 |   57,028 | 5,914 |      380 |     5,534 |  51,494 |
|   10 |   51,494 | 5,914 |      343 |     5,571 |  45,923 |
|   11 |   45,923 | 5,914 |      306 |     5,608 |  40,315 |
|   12 |   40,315 | 5,914 |      269 |     5,645 |  34,670 |
|   13 |   34,670 | 5,914 |      231 |     5,683 |  28,987 |
|   14 |   28,987 | 5,914 |      193 |     5,721 |  23,266 |
|   15 |   23,266 | 5,914 |      155 |     5,759 |  17,507 |
|   16 |   17,507 | 5,914 |      117 |     5,797 |  11,710 |
|   17 |   11,710 | 5,914 |       78 |     5,836 |   5,874 |
|   18 |    5,874 | 5,913 |       39 |     5,874 |       0 |

**Totals:** principal ₹1,00,000 + interest **₹6,451** = ₹1,06,451 repaid.

*Medical variant:* same numbers, but EMI #1 due 6 months after start (interest-free waiver); total interest identical (₹6,451) since the moratorium is interest-free and amortization is on the original principal.

### 13a. Worked prepayment — ₹30,000 advance after 6 months

Continuing the loan above: the member pays the first **6 EMIs** normally, then makes a **₹30,000 advance** (recorded as an extra `loan_repayment`). The closing balance after EMI #6 is **₹67,986**, so the new outstanding becomes **₹67,986 − ₹30,000 = ₹37,986**. The first 6 paid installments are untouched; only the remaining schedule is rebuilt from ₹37,986. Per decision #8, the member picks one of two modes:

**Mode A — `reduce_tenure` (keep EMI ₹5,914, finish sooner):**

| EMI # | Opening | Pay | Interest | Principal | Closing |
|---:|--------:|----:|---------:|----------:|--------:|
| 7 | 37,986 | 5,914 | 253 | 5,661 | 32,325 |
| 8 | 32,325 | 5,914 | 216 | 5,698 | 26,627 |
| 9 | 26,627 | 5,914 | 178 | 5,736 | 20,891 |
| 10 | 20,891 | 5,914 | 139 | 5,775 | 15,116 |
| 11 | 15,116 | 5,914 | 101 | 5,813 | 9,303 |
| 12 | 9,303 | 5,914 | 62 | 5,852 | 3,451 |
| 13 | 3,451 | **3,474** | 23 | 3,451 | 0 |

Loan now **closes at installment #13 instead of #18** — 5 months early. Interest charged from here = **₹972** (vs ₹2,981 if no prepayment) → **~₹2,009 interest saved** (plus the ₹30,000 no longer accrues interest).

**Mode B — `reduce_emi` (keep the remaining 12 months, lower the EMI):**

New EMI on ₹37,986 over 12 months = **₹3,304** (down from ₹5,914):

| EMI # | Opening | Pay | Interest | Principal | Closing |
|---:|--------:|----:|---------:|----------:|--------:|
| 7 | 37,986 | 3,304 | 253 | 3,051 | 34,935 |
| 8 | 34,935 | 3,304 | 233 | 3,071 | 31,864 |
| 9 | 31,864 | 3,304 | 212 | 3,092 | 28,772 |
| 10 | 28,772 | 3,304 | 192 | 3,112 | 25,660 |
| 11 | 25,660 | 3,304 | 171 | 3,133 | 22,527 |
| 12 | 22,527 | 3,304 | 150 | 3,154 | 19,373 |
| 13 | 19,373 | 3,304 | 129 | 3,175 | 16,198 |
| 14 | 16,198 | 3,304 | 108 | 3,196 | 13,002 |
| 15 | 13,002 | 3,304 | 87 | 3,217 | 9,785 |
| 16 | 9,785 | 3,304 | 65 | 3,239 | 6,546 |
| 17 | 6,546 | 3,304 | 44 | 3,260 | 3,286 |
| 18 | 3,286 | **3,308** | 22 | 3,286 | 0 |

Tenure is unchanged (#18), monthly burden drops to **₹3,304**. Interest charged from here = **₹1,666** → **~₹1,315 interest saved**. (The final EMI absorbs a ₹4 rounding remainder, per the last-installment zero-out rule.)

**Summary:** both modes start the rebuilt schedule from ₹37,986 at the next due date. `reduce_tenure` saves the most interest (₹2,009) by finishing 5 months early; `reduce_emi` lightens the monthly payment (₹5,914 → ₹3,304) over the original horizon. This is exactly what `recomputeAfterPrepayment(...)` and `prepayLoan(...)` produce.

## 14. Rollout / migration plan

1. Migration N: reference keys + `loans` columns + `loan_emi_schedule` + `loan_emi_payments` + RLS.
2. Migration N+1: `fn_generate_emi_schedule`, `fn_recompute_emi_paid_state`, `fn_apply_emi_late_fees`; wire late-fee call into the existing cron.
3. Migration N+2: `loan_emi_balances` view (or extend `loans_balances`).
4. App: `createLoan`/`updateLoan` generate schedules; new `payEmi`, `prepayLoan`, `recalculateSchedule`, `convertToEmi` actions; UI updates.
5. Set `emi_cutover_date`; convert legacy loans per loan.
6. Once all active loans are `emi`, the EOM accrual cron stops touching them (guard on `repayment_model`).

## 15. Resolved edge-case decisions

- **Prepayment scope:** A prepayment is applied **only to outstanding principal** (reduces the future schedule). The currently-due EMI is settled via `payEmi`; `prepayLoan` operates on the loan's current closing balance, not the open installment.
- **`reduce_emi` clamp:** If the recomputed EMI would be **≤ one month's interest** on the remaining balance (tiny-balance / very-long-tenure edge), collapse the remaining schedule to a **single final installment** that pays off the full balance + that month's interest.
- **Late fee scope:** The fee is **per-installment and one-time** — `late_fee_pct` × that single overdue EMI's amount. Each installment independently incurs its own one-time fee when it individually crosses 2 months past due (guarded by `late_fee_charged = 0` on that row). Fees are **not** cumulative across installments into a single charge.

## 15a. Out of scope

- Member self-service EMI payment (still admin-recorded via `pending_payments` → approve, unchanged).
- Multi-rate tiers and foreclosure charges.

## 16. Testing (Vitest + SQL)

- Unit: EMI formula, rounding, last-installment zero-out, waiver date shift, prepayment recompute (both modes) — in a new `src/lib/emi-math.ts` with `*.test.ts`.
- SQL: schedule generation totals = principal; paid-state trigger; overpayment rejection; late-fee one-time guard.
- Integration: pay full schedule → loan auto-closes; convert legacy loan preserves paid history.
