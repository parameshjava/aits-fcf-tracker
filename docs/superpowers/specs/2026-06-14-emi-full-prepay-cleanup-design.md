# Full EMI prepayment: delete pending installments and close the loan

**Date:** 2026-06-14
**Status:** Approved
**Area:** EMI loan model — `prepayLoan` server action

## Problem

When an EMI loan is fully prepaid (the advance covers the entire outstanding
principal), the current code flips every remaining `scheduled` / `overdue`
installment to `status = 'waived'`:

```ts
// src/lib/actions/emi.ts:212-219 (current)
if (newOutstanding === 0) {
  await supabase.from('loan_emi_schedule')
    .update({ status: 'waived' })
    .eq('loan_id', loanId)
    .in('status', ['scheduled', 'overdue'])
}
```

This is misleading. "Waived" means the obligation was *forgiven without
payment*, but in a full prepayment the member **paid** the outstanding
principal. The schedule then shows a row of "Waived" badges for installments
the member actually settled in cash. Two further gaps:

- The loan is **not** formally closed — `loans.status` stays `active` even
  though the balance is zero.
- A `partially_paid` installment's unpaid remainder is part of
  `pending_principal`; the lump sum covers it, but nothing reconciles that row.

## Goal

After a full prepayment, the loan record should read like a clean, closed
loan: only real installments remain on the schedule, the advance is captured
as one transaction, and the loan is marked paid.

## Design

Change applies only to the **full-prepay branch** (`newOutstanding === 0`) of
`prepayLoan` in `src/lib/actions/emi.ts`. The transaction insert (current
line 193) and the optional bank-balance bump (line 207) are unchanged. Partial
prepayment (`newOutstanding > 0`) is unchanged.

New behavior when `newOutstanding === 0`:

1. **Settle `partially_paid` rows from the lump sum.** The entered amount
   equals `pending_principal`, which *includes* the unpaid remainder of any
   partially-paid EMI. For each such row, set `principal_paid = principal_due`,
   `status = 'paid'`, `paid_at = now()`. The row keeps its payment history and
   stops reporting a dangling balance. (Without this, `loan_emi_balances` would
   still show that remainder and the loan would not net to zero.)
2. **Delete `scheduled` + `overdue` rows.** These never received a payment, so
   they have no `loan_emi_payments` junction rows and the `ON DELETE RESTRICT`
   FK (migration 038, line 74) does not block the delete. Paid /
   partially-paid rows — which we keep — *do* have junction rows, which is an
   additional reason the deletion scope is exactly `scheduled` + `overdue`.
3. **Close the loan:** set `loans.status = 'paid'`.

### What is kept vs deleted

| Installment status | Action |
| :----------------- | :----- |
| `paid`             | kept untouched |
| `partially_paid`   | kept, completed to `paid` (step 1) |
| `scheduled`        | deleted |
| `overdue`          | deleted |

### Downstream — no changes required

- `loan_emi_balances` (migration 040) sums `principal_due - principal_paid`
  over non-`waived` rows. After the change all remaining rows are fully paid →
  `pending_principal = 0`.
- `loan-timeline-section.tsx` renders whatever rows exist; it simply shows
  fewer rows. No badge logic change.
- Authorization, `runAction` wrapper, `updateTag('dashboard')` /
  `revalidatePath` calls remain as-is.

## Verification

- `recomputeAfterPrepayment` (pure helper) is untouched; its existing unit
  tests still pass.
- Add / extend a unit test asserting the full-prepay branch: paid rows kept,
  partially-paid completed, scheduled/overdue gone, `loans.status = 'paid'`,
  balance zero. (Confirm existing test harness for the action during
  implementation; fall back to a focused test of any extractable pure logic if
  the action itself is not unit-testable.)
- Manual check on a seeded EMI loan: full prepay → timeline shows no "Waived"
  rows, loan listed as closed/paid, KPIs show zero outstanding.

## Out of scope

- Partial prepayment behavior (unchanged).
- The accrual loan model.
- Backfill of loans already fully prepaid under the old waive logic. Noted as a
  possible follow-up cleanup script; no historical rows touched here unless
  requested.
