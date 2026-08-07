/**
 * Re-price an EMI schedule after the interest rate changes.
 *
 * When `loan_interest_rate_pct` moves, every loan still running was priced at
 * the old rate. Recomputing re-amortizes **the principal still owed on unpaid
 * installments, over those same installments, at the new rate** — the
 * installments keep their own numbers and due dates, and only their money
 * columns change.
 *
 * What it never touches:
 *   • `paid` installments — settled history, and their transactions are linked
 *     through `loan_emi_payments`;
 *   • `partially_paid` — money has been applied against the row's own figures,
 *     so re-pricing it would strand that payment;
 *   • `waived`.
 *
 * Rows are therefore *updated in place* rather than deleted and reinserted:
 * installment numbers, due dates, late fees and any foreign keys pointing at
 * them all survive untouched.
 *
 * Re-amortizing what is left, rather than regenerating from the loan's original
 * principal, is what keeps this safe on a loan that has already had a
 * prepayment — a regeneration would quietly undo it.
 */

import { computeEmiAmount, recomputeAfterPrepayment } from './emi-math'

export type RecomputeScheduleRow = {
  id: string
  installment_no: number
  due_date: string
  status: 'scheduled' | 'paid' | 'partially_paid' | 'overdue' | 'waived'
  opening_balance: number
  emi_amount: number
  principal_due: number
  interest_due: number
  closing_balance: number
  principal_paid: number
  interest_paid: number
}

export type RecomputedAmounts = {
  openingBalance: number
  emiAmount: number
  principalDue: number
  interestDue: number
  closingBalance: number
}

export type RecomputedRow = {
  scheduleId: string
  installmentNo: number
  dueDate: string
  before: RecomputedAmounts
  after: RecomputedAmounts
  changed: boolean
}

export type EmiRecomputePlan = {
  /** Every unpaid installment, in due order, with its before/after figures. */
  rows: RecomputedRow[]
  /** Just the ones that actually move. */
  changed: RecomputedRow[]
  hasChanges: boolean
  /** Principal still owed on those installments — what gets re-amortized. */
  outstanding: number
  /** EMI the loan is priced at today, from the first unpaid installment. */
  currentEmi: number
  /** EMI at the new rate. */
  newEmi: number
  interestBefore: number
  interestAfter: number
  /** Cheap equality check so the action can spot a schedule that moved. */
  fingerprint: string
  error: EmiRecomputeError | null
}

export type EmiRecomputeError =
  /** Nothing left to re-price. */
  | 'no_unpaid_installments'
  /** The new rate is so high the loan would never amortize. */
  | 'rate_too_high'

const r2 = (n: number) => Math.round(n * 100) / 100

const amounts = (r: RecomputeScheduleRow): RecomputedAmounts => ({
  openingBalance: r2(Number(r.opening_balance)),
  emiAmount: r2(Number(r.emi_amount)),
  principalDue: r2(Number(r.principal_due)),
  interestDue: r2(Number(r.interest_due)),
  closingBalance: r2(Number(r.closing_balance)),
})

const differs = (a: RecomputedAmounts, b: RecomputedAmounts) =>
  a.emiAmount !== b.emiAmount ||
  a.principalDue !== b.principalDue ||
  a.interestDue !== b.interestDue ||
  a.openingBalance !== b.openingBalance ||
  a.closingBalance !== b.closingBalance

export function planEmiRecompute({
  rows,
  annualRatePct,
}: {
  rows: RecomputeScheduleRow[]
  /** The rate to re-price at — normally `loan_interest_rate_pct`. */
  annualRatePct: number
}): EmiRecomputePlan {
  // "Unpaid or deferred" — anything the member has put money against keeps its
  // own figures, whatever the late-fee cron has done to its `status`.
  const repriceable = rows
    .filter(
      (r) =>
        (r.status === 'scheduled' || r.status === 'overdue') &&
        Number(r.principal_paid) === 0 &&
        Number(r.interest_paid) === 0,
    )
    .sort((a, b) => (a.due_date === b.due_date
      ? a.installment_no - b.installment_no
      : a.due_date < b.due_date ? -1 : 1))

  const outstanding = r2(repriceable.reduce((s, r) => s + Number(r.principal_due), 0))
  const currentEmi = r2(Number(repriceable[0]?.emi_amount ?? 0))
  const interestBefore = r2(repriceable.reduce((s, r) => s + Number(r.interest_due), 0))

  const empty = {
    rows: [] as RecomputedRow[],
    changed: [] as RecomputedRow[],
    hasChanges: false,
    outstanding,
    currentEmi,
    newEmi: 0,
    interestBefore,
    interestAfter: 0,
    fingerprint: '',
  }

  if (repriceable.length === 0 || outstanding <= 0) {
    return { ...empty, error: 'no_unpaid_installments' }
  }

  const priced = recomputeAfterPrepayment({
    outstanding,
    annualRatePct,
    remainingTerm: repriceable.length,
    // Ignored by reduce_emi, which recomputes the instalment from the term.
    currentEmi,
    // Dates come from the existing rows below; this only sets the cadence of a
    // sequence we do not use.
    firstDueDate: repriceable[0].due_date,
    mode: 'reduce_emi',
  })

  // reduce_emi collapses to a single balloon row when the EMI would not cover
  // even one month's interest. That is not a re-pricing, it is a broken rate.
  if (priced.length !== repriceable.length) {
    return {
      ...empty,
      newEmi: computeEmiAmount(outstanding, annualRatePct, repriceable.length),
      error: 'rate_too_high',
    }
  }

  const out: RecomputedRow[] = repriceable.map((r, i) => {
    const p = priced[i]
    const after: RecomputedAmounts = {
      openingBalance: r2(p.openingBalance),
      emiAmount: r2(p.emiAmount),
      principalDue: r2(p.principalDue),
      interestDue: r2(p.interestDue),
      closingBalance: r2(p.closingBalance),
    }
    const before = amounts(r)
    return {
      scheduleId: r.id,
      installmentNo: r.installment_no,
      // Due dates are kept exactly as they are — re-pricing must not move when
      // the member has to pay.
      dueDate: r.due_date,
      before,
      after,
      changed: differs(before, after),
    }
  })

  const changed = out.filter((r) => r.changed)
  return {
    rows: out,
    changed,
    hasChanges: changed.length > 0,
    outstanding,
    currentEmi,
    newEmi: r2(priced[0].emiAmount),
    interestBefore,
    interestAfter: r2(priced.reduce((s, p) => s + p.interestDue, 0)),
    fingerprint: [outstanding, repriceable.length, repriceable[0].due_date, currentEmi].join('|'),
    error: null,
  }
}

export function emiRecomputeErrorMessage(plan: EmiRecomputePlan): string {
  switch (plan.error) {
    case 'no_unpaid_installments':
      return 'This loan has no unpaid installments left to re-price.'
    case 'rate_too_high':
      return 'At this rate an installment would not cover even one month of interest, so the loan would never amortize.'
    default:
      return 'The schedule could not be recomputed.'
  }
}
