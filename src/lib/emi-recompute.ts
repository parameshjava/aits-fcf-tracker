/**
 * Re-price an EMI schedule after the interest rate changes.
 *
 * The rule: **only the interest component moves.** For every installment that
 * is not yet due, the interest is scaled by the ratio of the new rate to the
 * old one and the EMI becomes `principal_due + new interest`. Principal,
 * opening and closing balances are left exactly as they are.
 *
 * That is exact rather than approximate: an installment's interest is
 * `balance × rate/12 × period`, which is *linear in the rate*, so scaling by
 * `new/old` reprices any row — a full month, or the pro-rated stub a
 * mid-month disbursement produces — without needing to know which it is.
 *
 * The earlier version re-amortized the unpaid rows as a fresh annuity. That
 * was wrong in three ways this design cannot reproduce:
 *   • a pro-rated stub was rebuilt as a full month, so a mid-month-disbursed
 *     loan reported changes at an *unchanged* rate and would have been charged
 *     a full month of interest for a part-month;
 *   • re-amortizing a subset broke the opening/closing chain whenever a paid
 *     installment sat between unpaid ones;
 *   • leaving the principal schedule alone means the loan still clears on the
 *     same date for the same total principal, by construction.
 *
 * What it never touches:
 *   • `paid` and `partially_paid` installments — money has been applied against
 *     their own figures;
 *   • anything **already due**. `prepay-plan.ts` holds the same line: an
 *     installment the member already owes is never rewritten. Re-pricing an
 *     overdue row would also raise the late-fee target that
 *     `fn_apply_emi_late_fees` derives from `emi_amount`, retroactively
 *     re-billing months that have already elapsed.
 */

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
  emiAmount: number
  interestDue: number
}

export type RecomputedRow = {
  scheduleId: string
  installmentNo: number
  dueDate: string
  /** Unchanged by re-pricing; carried for the preview table. */
  principalDue: number
  before: RecomputedAmounts
  after: RecomputedAmounts
  changed: boolean
}

export type EmiRecomputePlan = {
  /** Every not-yet-due unpaid installment, in due order. */
  rows: RecomputedRow[]
  /** Just the ones that actually move. */
  changed: RecomputedRow[]
  hasChanges: boolean
  oldRatePct: number
  newRatePct: number
  /** The next installment's EMI, before and after — a real row, not an average. */
  nextEmiBefore: number
  nextEmiAfter: number
  interestBefore: number
  interestAfter: number
  /** Cheap equality check so the action can spot a plan that has gone stale. */
  fingerprint: string
  error: EmiRecomputeError | null
}

export type EmiRecomputeError =
  /** Nothing is both unpaid and still ahead of its due date. */
  | 'no_repriceable_installments'
  /** The loan's current rate is unknown, so there is no ratio to scale by. */
  | 'rate_unavailable'

const r2 = (n: number) => Math.round(n * 100) / 100

export function planEmiRecompute({
  rows,
  oldRatePct,
  newRatePct,
  todayIso,
}: {
  rows: RecomputeScheduleRow[]
  /** The rate the schedule was built at — `loans.interest_rate_pct`. */
  oldRatePct: number | null | undefined
  /** The rate to re-price at — `loan_interest_rate_pct`. */
  newRatePct: number
  /** Today in IST (YYYY-MM-DD); anything due on or before it is already owed. */
  todayIso: string
}): EmiRecomputePlan {
  const oldRate = Number(oldRatePct)
  const newRate = Number(newRatePct)

  // Untouched by re-pricing but needed for every early return.
  const repriceable = rows
    .filter(
      (r) =>
        (r.status === 'scheduled' || r.status === 'overdue') &&
        Number(r.principal_paid) === 0 &&
        Number(r.interest_paid) === 0 &&
        // Already due is already owed — see the module comment.
        r.due_date > todayIso,
    )
    .sort((a, b) =>
      a.due_date === b.due_date
        ? a.installment_no - b.installment_no
        : a.due_date < b.due_date
          ? -1
          : 1,
    )

  const interestBefore = r2(repriceable.reduce((s, r) => s + Number(r.interest_due), 0))
  const nextEmiBefore = r2(Number(repriceable[0]?.emi_amount ?? 0))

  const base = {
    rows: [] as RecomputedRow[],
    changed: [] as RecomputedRow[],
    hasChanges: false,
    oldRatePct: oldRate,
    newRatePct: newRate,
    nextEmiBefore,
    nextEmiAfter: nextEmiBefore,
    interestBefore,
    interestAfter: interestBefore,
    fingerprint: '',
  }

  if (repriceable.length === 0) {
    return { ...base, error: 'no_repriceable_installments' }
  }
  // Scaling by new/old is meaningless without a usable old rate. A zero-rate
  // loan has no interest to re-price either way.
  if (!Number.isFinite(oldRate) || oldRate <= 0 || !Number.isFinite(newRate) || newRate < 0) {
    return { ...base, error: 'rate_unavailable' }
  }

  const factor = newRate / oldRate
  const out: RecomputedRow[] = repriceable.map((r) => {
    const principalDue = r2(Number(r.principal_due))
    const before: RecomputedAmounts = {
      emiAmount: r2(Number(r.emi_amount)),
      interestDue: r2(Number(r.interest_due)),
    }
    // Interest is linear in the rate, so this reprices a full month and a
    // pro-rated stub alike without having to tell them apart.
    const interestDue = r2(before.interestDue * factor)
    const after: RecomputedAmounts = {
      interestDue,
      emiAmount: r2(principalDue + interestDue),
    }
    return {
      scheduleId: r.id,
      installmentNo: r.installment_no,
      dueDate: r.due_date,
      principalDue,
      before,
      after,
      changed: before.interestDue !== after.interestDue || before.emiAmount !== after.emiAmount,
    }
  })

  const changed = out.filter((r) => r.changed)
  return {
    rows: out,
    changed,
    hasChanges: changed.length > 0,
    oldRatePct: oldRate,
    newRatePct: newRate,
    nextEmiBefore,
    nextEmiAfter: r2(out[0].after.emiAmount),
    interestBefore,
    interestAfter: r2(out.reduce((s, r) => s + r.after.interestDue, 0)),
    // Both rates are in the fingerprint: the rate changing under an open
    // preview is exactly the case this guards, and the schedule alone would not
    // show it.
    fingerprint: [
      oldRate,
      newRate,
      repriceable.length,
      repriceable[0].due_date,
      interestBefore,
    ].join('|'),
    error: null,
  }
}

export function emiRecomputeErrorMessage(plan: EmiRecomputePlan): string {
  switch (plan.error) {
    case 'no_repriceable_installments':
      return 'This loan has no installments left that are both unpaid and not yet due. Installments already due keep the amount they were billed at.'
    case 'rate_unavailable':
      return 'This loan has no interest rate recorded, so there is nothing to re-price from.'
    default:
      return 'The schedule could not be recomputed.'
  }
}
