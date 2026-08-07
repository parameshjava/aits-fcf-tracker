/**
 * Works out what an advance principal payment actually does to a loan's EMI
 * schedule, before anything is written.
 *
 * The rebuild in `prepayLoan` replaces only the `scheduled` / `overdue`
 * installments — a `partially_paid` row survives it, because its payment
 * history is linked through `loan_emi_payments` (ON DELETE RESTRICT). So the
 * principal still owed on such a row must NOT be folded into the tail that gets
 * re-amortized: it is already owed on its own row, and counting it in both
 * places bills the member twice.
 *
 * The advance is therefore applied oldest-debt-first: it settles the arrears
 * sitting on partially-paid installments, and only what is left over reduces
 * the amortizing tail.
 *
 * Both `prepayLoan` and the pre-flight confirmation screen call this, so what
 * the admin approves is exactly what gets applied.
 */

export type PrepayScheduleRow = {
  id: string
  installment_no: number
  status: 'scheduled' | 'paid' | 'partially_paid' | 'overdue' | 'waived'
  principal_due: number
  principal_paid: number
}

export type ArrearAllocation = {
  scheduleId: string
  installmentNo: number
  /** Principal from the advance applied to this installment. */
  applied: number
  /** Principal still owed on it afterwards. */
  outstandingAfter: number
}

export type PrepayPlan = {
  /** Principal still owed across every non-waived installment. */
  pendingPrincipal: number
  /** Of that, the part sitting on partially-paid rows the rebuild can't touch. */
  arrearsPrincipal: number
  /** Part of the advance that settles those arrears. */
  arrearsApplied: number
  arrears: ArrearAllocation[]
  /** Part of the advance that reduces the amortizing tail. */
  appliedToTail: number
  /** Principal the rebuilt tail amortizes. */
  tailPrincipal: number
  /** Installments the rebuild replaces (scheduled + overdue). */
  remainingTerm: number
  /** The advance clears every rupee of pending principal. */
  fullPayoff: boolean
  /** Non-null when the plan can't be applied; callers must check this first. */
  error: 'exceeds_outstanding' | null
}

/** Round to paise — schedule columns are numeric(12,2). */
const r2 = (n: number) => Math.round(n * 100) / 100

const owed = (r: PrepayScheduleRow) =>
  Math.max(r2(Number(r.principal_due) - Number(r.principal_paid)), 0)

export function planPrepayment({
  rows,
  amount,
}: {
  rows: PrepayScheduleRow[]
  amount: number
}): PrepayPlan {
  const pendingPrincipal = r2(
    rows.filter((r) => r.status !== 'waived').reduce((s, r) => s + owed(r), 0),
  )
  const arrearRows = rows
    .filter((r) => r.status === 'partially_paid' && owed(r) > 0)
    .sort((a, b) => a.installment_no - b.installment_no)
  const arrearsPrincipal = r2(arrearRows.reduce((s, r) => s + owed(r), 0))
  const remainingTerm = rows.filter(
    (r) => r.status === 'scheduled' || r.status === 'overdue',
  ).length

  const base = { pendingPrincipal, arrearsPrincipal, remainingTerm }

  if (r2(amount - pendingPrincipal) > 0) {
    return {
      ...base,
      arrearsApplied: 0,
      arrears: [],
      appliedToTail: 0,
      tailPrincipal: r2(pendingPrincipal - arrearsPrincipal),
      fullPayoff: false,
      error: 'exceeds_outstanding',
    }
  }

  // Oldest debt first: clear the arrears, then pay ahead.
  let left = r2(Math.max(amount, 0))
  const arrears: ArrearAllocation[] = []
  for (const row of arrearRows) {
    if (left <= 0) break
    const applied = r2(Math.min(owed(row), left))
    if (applied <= 0) continue
    arrears.push({
      scheduleId: row.id,
      installmentNo: row.installment_no,
      applied,
      outstandingAfter: r2(owed(row) - applied),
    })
    left = r2(left - applied)
  }
  const arrearsApplied = r2(Math.max(amount, 0) - left)

  // Whatever arrears the advance did not reach stay on their own rows, so they
  // are excluded from the tail here and not re-amortized.
  const scheduledPrincipal = r2(pendingPrincipal - arrearsPrincipal)
  return {
    ...base,
    arrearsApplied,
    arrears,
    appliedToTail: left,
    tailPrincipal: r2(scheduledPrincipal - left),
    fullPayoff: r2(pendingPrincipal - amount) <= 0,
    error: null,
  }
}
