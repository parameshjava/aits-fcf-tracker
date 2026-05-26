# Loan timeline: show monthly interest accruals alongside transactions

Date: 2026-05-26
Status: Approved (brainstorming) — ready for implementation plan

## Problem

On every loan detail view (the expandable row on `/admin/loans`, the standalone
`/admin/loans/[loan_number]` page, and the read-only `/dashboard/loans/[loan_number]`
page) the "Transactions" section shows only rows from `public.transactions`. For a
freshly disbursed loan with accrued-but-unpaid interest, that table is empty even
though `loan_interest_accruals` already has monthly rows totalling the displayed
"Interest Due" KPI. A member cannot see *which* months are pending versus paid.

## Goal

Render a unified, chronological **timeline** under each loan that interleaves:
- System-generated monthly interest accrual rows (`loan_interest_accruals`).
- Real money-movement rows (`transactions` tagged to the loan).

Each accrual row carries a clear payment-status badge (Paid / Partial / Pending /
Waived) and a description that cross-references the settling transaction when
applicable. Each interest-payment transaction row similarly lists the accrual
periods it was allocated to.

This is **read-only** for non-admin members and for admins; the admin payment
form (`PendingInterestPanel` on `/admin/loans/[loan_number]`) is unchanged.

## Non-goals

- No new admin actions inside the timeline. "Pay" still happens in the existing
  `PendingInterestPanel`.
- No changes to accrual generation (cron job), accrual settlement RPC, or
  reverse-payment flow.
- No new financial KPIs. The four existing tiles (Amount Due / Principal Paid /
  Interest Paid / Interest Due) stay.

## Data model (existing — reference only)

- `loan_interest_accruals` — one row per active loan per month from cutover, plus
  one synthetic `is_opening_balance=true` row capturing pre-cutover interest.
  Columns: `id`, `loan_id`, `period_end`, `amount_due`, `paid_amount`, `status`
  (`pending|partially_paid|paid|waived`), `interest_rate_used`, `balance_basis`,
  `is_opening_balance`, `waiver_reason`, `paid_at`, `created_at`.
- `loan_interest_payments` — junction (accrual ↔ transaction). One transaction
  can settle multiple accrual rows. Trigger keeps the accrual's `paid_amount` and
  `status` in sync.
- `transactions` — all money movements (`loan_repayment`, `interest` with
  `interest_source='loans'`, `penalty`, etc.).

## Approach

**Server-side merge in `getLoanDetail`.** One additional Supabase select fetches
all accruals for the loan plus the payments-junction rows (with the linked
transaction's short `transaction_id`). The action assembles a discriminated
`LoanTimelineRow[]` and returns it alongside the existing fields. The standalone
`/dashboard/loans/[loan_number]` page migrates from its current pair of calls
(`getLoanByNumber` + `getLoanTransactions`) to `getLoanDetail`.

Rejected alternatives:
- A separate `getLoanInterestTimeline` action — two round-trips, duplicate fetch
  with `getLoanDetail`, no benefit.
- A Postgres `loan_timeline` view — descriptions like `Allocated to Oct + Nov
  2025` are awkward in SQL and would force date-formatting decisions into the DB.

## Data shape

In `src/lib/actions/loans.ts`:

```ts
export type LoanTimelineRow =
  | {
      kind: 'accrual'
      sortDate: string             // period_end (YYYY-MM-DD)
      accrual: LoanInterestAccrual
      settledByTxnIds: string[]    // short txn ids like "20251210-04"; may be empty
    }
  | {
      kind: 'transaction'
      sortDate: string             // transaction_date (YYYY-MM-DD)
      txn: LoanDetailTxn
      settledAccrualPeriods: string[]  // ["Oct 2025", "Nov 2025"] — only for interest payments
    }

export type LoanDetailData = {
  loan: LoanRow
  transactions: LoanDetailTxn[]      // unchanged — kept for any existing consumer
  accruals: LoanInterestAccrual[]    // new
  timeline: LoanTimelineRow[]        // new — merged + sorted; UI renders from this
  interestPerLakh: number
  financials: LoanFinancials
}
```

Merge function lives as an exported pure helper `buildLoanTimeline(accruals,
transactions, payments)` so it can be unit-tested without a DB.

### Sort order

- Primary key: `sortDate` ascending.
- Secondary key: `kind` — `'accrual'` sorts before `'transaction'` on the same
  date (so an end-of-month accrual that's settled the same day appears above the
  payment row).
- `is_opening_balance` rows naturally sort first because their `period_end` is
  the earliest in the set.

## UI

### Affected components

- `src/components/loan-detail-panel.tsx` — primary surface; replaces the existing
  single transactions `<table>` with the new unified timeline table.
- `src/app/(app)/admin/loans/[loan_number]/page.tsx` — adopt `LoanDetailPanel`
  (or render the same timeline section) above the existing edit form and
  `PendingInterestPanel`.
- `src/app/(app)/dashboard/loans/[loan_number]/page.tsx` — migrate to
  `getLoanDetail` and render `LoanDetailPanel`.
- `src/components/loans-list-table.tsx` — no change; already uses
  `LoanDetailPanel` via `getLoanDetail`.

### Columns

Date · Type · Txn ID · Description · Amount · Status

### Row rules

**Accrual row** (`kind: 'accrual'`):
- Type: `Interest accrual` (for `is_opening_balance` rows: `Interest accrual (opening)`).
- Txn ID: `—`.
- Description: `{Month YYYY} · ₹{rate}/L on ₹{balance_basis} pending` for normal
  rows; `Carried over from pre-cutover months` for opening balance. If
  `settledByTxnIds.length > 0`, append `· Settled via {ids.join(', ')}`. For
  `waived` rows, replace with `Waived — {waiver_reason}` (e.g.,
  `Waived — loan_closed`).
- Amount: `formatRupees(amount_due)`.
- Status badge (DB status → label → color):
  - `paid` → `Paid` → emerald (`bg-emerald-50 text-emerald-700 ring-emerald-200`)
  - `partially_paid` → `Partial` → amber (`bg-amber-50 text-amber-700 ring-amber-200`)
  - `pending` → `Pending` → gray (`bg-gray-50 text-gray-600 ring-gray-200`)
  - `waived` → `Waived` → slate (`bg-slate-50 text-slate-600 ring-slate-200`)

**Transaction row** (`kind: 'transaction'`):
- Type: `Interest payment` when `transaction_type='interest'` and
  `interest_source='loans'`; else the existing `TYPE_LABELS` mapping.
- Description: existing `description` field if non-null, else empty. For
  interest payments with `settledAccrualPeriods.length > 0`, append (or stand
  alone if description was null) `Allocated to {periods.join(' + ')}`. Final
  rendered string never starts with a leading `· `.
- Status: `—` (non-accrual rows have no status; render as a dash so the column
  width is stable).

### Empty state

If `timeline.length === 0`, show "No accruals or transactions yet." Replaces the
current "No transactions tagged to this loan yet."

### Currency, locale, and styling

- Rupees via `formatRupees()` per AGENTS.md.
- `tabular-nums` already applied globally on `<body>` (no per-element class needed).
- All colors via Tailwind utility classes (no inline hex). Status badges follow
  the existing pattern from `STATUS_PILL` in `loans-list-table.tsx`.

## Edge cases

- **Waiver window months** (`loans.interest_waiver_months > 0`): no accrual rows
  exist for those months because the cron skips them. The waiver window is
  already surfaced via the meta line in `LoanDetailPanel` ("X-mo interest waiver
  → accrual from {date}"). No synthetic timeline rows are added.
- **Closed loan (paid)**: all `pending` accruals were flipped to `waived` by the
  trigger; they appear in the timeline as `Waived — loan_closed`.
- **Closed loan (write-off)**: same plus the loan's `interest_waived` total is
  surfaced via the existing meta line; bad-debt amount via the existing
  "Amount Due" hint. Timeline rows themselves are unchanged.
- **Multi-allocation payment**: `settledByTxnIds` on each accrual row contains
  the single shared txn id; `settledAccrualPeriods` on the transaction row lists
  all periods it touched.
- **Reversal** (`reverseInterestPayment`): already calls `revalidatePath` on
  `/admin/loans/[loanId]` — Next refetches `getLoanDetail`, accrual `paid_amount`
  and `status` are restored by the existing junction-delete trigger, and the
  timeline reflects the reversal automatically.

## Testing

New file: `src/lib/actions/loan-timeline.test.ts` (Vitest, no DB).

Cases:
1. Accrual and same-day interest payment → accrual sorts before payment.
2. Single payment allocated to multiple accruals → each accrual carries the same
   `settledByTxnIds` entry; the payment row's `settledAccrualPeriods` lists all
   months.
3. `waived` accrual carries the `waiver_reason` and renders without
   `settledByTxnIds`.
4. `is_opening_balance=true` row sorts to the top of the timeline regardless of
   adjacent transactions.
5. Non-interest transaction (loan_repayment) appears in the timeline as
   `kind: 'transaction'` with empty `settledAccrualPeriods`.

## Out of scope (explicitly deferred)

- Per-row "Pay" action in the timeline.
- Showing the timeline on the loans **list** rows (only inside the expanded
  detail panel).
- Exporting the timeline as CSV.
- Surfacing the `interest_rate_used` and `balance_basis` per accrual as separate
  columns (kept in the description string for now).

## Files touched (anticipated)

- `src/lib/actions/loans.ts` — add `accruals`, `timeline` to `LoanDetailData`;
  call new fetch + helper.
- `src/lib/actions/loan-timeline.ts` — new file exporting `buildLoanTimeline`
  pure helper plus the row types.
- `src/lib/actions/loan-timeline.test.ts` — Vitest cases above.
- `src/components/loan-detail-panel.tsx` — render the timeline table.
- `src/app/(app)/admin/loans/[loan_number]/page.tsx` — render
  `LoanDetailPanel` (or the timeline section) above existing forms.
- `src/app/(app)/dashboard/loans/[loan_number]/page.tsx` — migrate to
  `getLoanDetail` and `LoanDetailPanel`.
