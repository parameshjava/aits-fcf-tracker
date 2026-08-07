/**
 * Works out what an advance principal payment does to a loan's EMI schedule,
 * before anything is written.
 *
 * The governing rule: **a prepayment reduces what is not yet due. It never
 * rewrites what the member already owes.**
 *
 * Two kinds of installment therefore survive the rebuild untouched:
 *
 *   • *partially paid* — its payment history is linked through
 *     `loan_emi_payments` (ON DELETE RESTRICT), so the row cannot be deleted at
 *     all; and
 *   • *already due* — due on or before the payment date. Folding these into the
 *     rebuilt tail re-dated them into the future, which erased their overdue
 *     status and past-due dates: a small advance against arrears bought the
 *     borrower a multi-month extension and cleared the delinquency flags.
 *
 * Both are classified **by date and paid-amount, never by `status`**. The
 * late-fee cron rewrites `status` (`partially_paid` → `overdue`) behind the
 * app's back, so a status-based rule silently reclassified rows that owned
 * junction rows and the rebuild's delete then tripped the foreign key.
 *
 * The principal still owed on surviving rows is excluded from the amortizing
 * tail — it is already owed on its own row, and counting it in both places
 * bills the member twice.
 *
 * Both `prepayLoan` and the pre-flight confirmation screen call this, and the
 * `fingerprint` lets the action detect that the schedule moved under a plan the
 * admin was still reviewing.
 */

import { formatRupees } from '@/lib/format'

export type PrepayScheduleRow = {
  id: string
  installment_no: number
  due_date: string
  status: 'scheduled' | 'paid' | 'partially_paid' | 'overdue' | 'waived'
  principal_due: number
  principal_paid: number
  interest_due: number
  interest_paid: number
  late_fee_charged: number
  late_fee_waived: boolean
}

export type RetainedInstallment = {
  scheduleId: string
  installmentNo: number
  dueDate: string
  principalOutstanding: number
  interestOutstanding: number
  /** Why the rebuild leaves it alone. */
  reason: 'partially_paid' | 'already_due'
}

export type PrepayPlan = {
  /** Principal still owed across every non-waived installment. */
  pendingPrincipal: number
  /** Installments the rebuild leaves alone, earliest first. */
  retained: RetainedInstallment[]
  /** Principal still owed on those installments. */
  retainedPrincipal: number
  /** Interest still owed on them — a full payoff cannot close over this. */
  retainedInterest: number
  /** Principal on the not-yet-due installments the rebuild replaces. */
  replacedPrincipal: number
  /** ids of those installments — the rebuild deletes exactly these. */
  replacedIds: string[]
  /** Principal the rebuilt tail amortizes. */
  tailPrincipal: number
  /** How many installments the rebuild replaces. */
  remainingTerm: number
  /** Earliest due date among them — feeds `prepaymentAnchorDate`. */
  earliestUnpaidDueDate: string | null
  /** Unwaived late fees on the replaced rows, to carry onto the new first row. */
  carriedLateFee: number
  /** First installment number the rebuilt tail may use. */
  nextInstallmentNo: number
  /** The advance clears every rupee of pending principal. */
  fullPayoff: boolean
  /** Cheap equality check so the server can spot a schedule that moved. */
  fingerprint: string
  /** Non-null when the plan cannot be applied; callers must check this first. */
  error: PrepayPlanError | null
}

export type PrepayPlanError =
  /** More than the loan owes. */
  | 'exceeds_outstanding'
  /** More than the not-yet-due principal, but less than the whole loan. */
  | 'exceeds_future_principal'
  /** Would close the loan while interest is still owed. */
  | 'interest_outstanding'

/** Round to paise — schedule columns are numeric(12,2). */
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Remaining principal on a row. Deliberately NOT clamped at zero: an
 * over-applied installment offsets the rest, exactly as
 * `loan_emi_balances.pending_principal` sums it, so the guards here agree with
 * what the rest of the app reports as outstanding.
 */
const owedPrincipal = (r: PrepayScheduleRow) =>
  r2(Number(r.principal_due) - Number(r.principal_paid))

const owedInterest = (r: PrepayScheduleRow) =>
  r2(Number(r.interest_due) - Number(r.interest_paid))

export function planPrepayment({
  rows,
  amount,
  paidDate,
}: {
  rows: PrepayScheduleRow[]
  amount: number
  /** When the advance was received (YYYY-MM-DD) — the already-due cutoff. */
  paidDate: string
}): PrepayPlan {
  const live = rows.filter((r) => r.status !== 'waived')
  const pendingPrincipal = r2(live.reduce((s, r) => s + owedPrincipal(r), 0))

  const isSettled = (r: PrepayScheduleRow) =>
    owedPrincipal(r) === 0 && owedInterest(r) === 0
  // Anything the member has already part-paid, or that has already fallen due,
  // keeps its own row. Classified by paid amount and date — never by `status`.
  const survives = (r: PrepayScheduleRow) =>
    Number(r.principal_paid) > 0 ||
    Number(r.interest_paid) > 0 ||
    r.due_date <= paidDate

  const retained: RetainedInstallment[] = live
    .filter((r) => !isSettled(r) && survives(r))
    .sort((a, b) => a.installment_no - b.installment_no)
    .map((r) => ({
      scheduleId: r.id,
      installmentNo: r.installment_no,
      dueDate: r.due_date,
      principalOutstanding: owedPrincipal(r),
      interestOutstanding: owedInterest(r),
      reason: Number(r.principal_paid) > 0 || Number(r.interest_paid) > 0
        ? ('partially_paid' as const)
        : ('already_due' as const),
    }))
  const retainedPrincipal = r2(retained.reduce((s, r) => s + r.principalOutstanding, 0))
  const retainedInterest = r2(retained.reduce((s, r) => s + r.interestOutstanding, 0))

  const replaced = live
    .filter((r) => !isSettled(r) && !survives(r))
    .sort((a, b) => a.installment_no - b.installment_no)
  const replacedPrincipal = r2(replaced.reduce((s, r) => s + owedPrincipal(r), 0))
  const earliestUnpaidDueDate = replaced.reduce<string | null>(
    (min, r) => (min === null || r.due_date < min ? r.due_date : min),
    null,
  )
  // Late fees already charged on rows about to be dropped are real receivables,
  // each with a matching penalty transaction; carry the unwaived total forward.
  const carriedLateFee = r2(
    replaced.reduce((s, r) => (r.late_fee_waived ? s : s + (Number(r.late_fee_charged) || 0)), 0),
  )
  const replacedIds = new Set(replaced.map((r) => r.id))
  const nextInstallmentNo =
    rows
      .filter((r) => !replacedIds.has(r.id))
      .reduce((max, r) => Math.max(max, r.installment_no), 0) + 1

  const fullPayoff = r2(pendingPrincipal - amount) <= 0
  const fingerprint = [
    pendingPrincipal,
    retained.length,
    replaced.length,
    earliestUnpaidDueDate ?? '-',
  ].join('|')

  const base = {
    pendingPrincipal,
    retained,
    retainedPrincipal,
    retainedInterest,
    replacedPrincipal,
    replacedIds: replaced.map((r) => r.id),
    remainingTerm: replaced.length,
    earliestUnpaidDueDate,
    carriedLateFee,
    nextInstallmentNo,
    fingerprint,
  }

  const fail = (error: PrepayPlanError): PrepayPlan => ({
    ...base,
    tailPrincipal: replacedPrincipal,
    fullPayoff: false,
    error,
  })

  if (r2(amount - pendingPrincipal) > 0) return fail('exceeds_outstanding')

  if (fullPayoff) {
    // Closing over unpaid interest silently forgives it — the balances view
    // stops counting interest once a row is `paid`, and no transaction records
    // the write-off. Make the admin settle or waive it first.
    if (retainedInterest > 0) return fail('interest_outstanding')
    return { ...base, tailPrincipal: 0, fullPayoff: true, error: null }
  }

  // Short of a full payoff the advance may only reduce not-yet-due principal;
  // arrears are settled through Pay EMI, which records their interest too.
  if (r2(amount - replacedPrincipal) > 0) return fail('exceeds_future_principal')

  return {
    ...base,
    tailPrincipal: r2(replacedPrincipal - amount),
    fullPayoff: false,
    error: null,
  }
}

/**
 * Admin-facing wording for each reason a plan is refused. Shared so the
 * confirmation screen and the action say exactly the same thing.
 */
export function prepayPlanErrorMessage(plan: PrepayPlan): string {
  const list = (rows: RetainedInstallment[]) => rows.map((r) => `#${r.installmentNo}`).join(', ')
  switch (plan.error) {
    case 'exceeds_outstanding':
      return `Advance exceeds the outstanding principal of ${formatRupees(plan.pendingPrincipal)}.`
    case 'exceeds_future_principal':
      return (
        `Only ${formatRupees(plan.replacedPrincipal)} of principal is not yet due. ` +
        `${formatRupees(plan.retainedPrincipal)} is already owed on ${list(plan.retained)} — record ` +
        `${plan.retained.length > 1 ? 'those installments' : 'that installment'} with Pay EMI first, ` +
        `or pay the full ${formatRupees(plan.pendingPrincipal)} to close the loan.`
      )
    case 'interest_outstanding':
      return (
        `This advance clears the principal, but ${formatRupees(plan.retainedInterest)} of interest ` +
        `is still due on ${list(plan.retained.filter((r) => r.interestOutstanding > 0))}. ` +
        `Record or waive it with Pay EMI before closing the loan.`
      )
    default:
      return 'Prepayment could not be applied.'
  }
}
