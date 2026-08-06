/**
 * Tallies for the loans list's "Pending EMI" (a count) and "Due EMI" (rupees)
 * columns. Both derive from the SAME set of schedule rows — unpaid installments
 * due on or before the current month's end — so the two columns can never
 * disagree about which installments are payable.
 */

export type PendingEmiScheduleRow = {
  loan_id: string
  principal_due: number | string
  interest_due: number | string
  principal_paid: number | string
  interest_paid: number | string
}

export type PendingEmiTotals = {
  /** Unpaid installments payable as of this month. */
  count: number
  /** Rupees still owed across those installments. */
  due: number
}

/**
 * Amount still owed on a single installment: the unpaid principal plus the
 * unpaid interest — exactly what `payEmi` charges. Late fees are deliberately
 * excluded: they're a separate penalty receivable, collected (or waived)
 * alongside the EMI rather than being part of it.
 *
 * Clamped at zero so an over-applied payment on one row can't mask what another
 * row still owes.
 */
export function installmentOutstanding(row: PendingEmiScheduleRow): number {
  const principal = Number(row.principal_due) - Number(row.principal_paid)
  const interest = Number(row.interest_due) - Number(row.interest_paid)
  return Math.max(principal, 0) + Math.max(interest, 0)
}

/** Group pending installments by loan into `{ count, due }`. */
export function tallyPendingEmi(
  rows: PendingEmiScheduleRow[],
): Map<string, PendingEmiTotals> {
  const byLoan = new Map<string, PendingEmiTotals>()
  for (const row of rows) {
    const prev = byLoan.get(row.loan_id) ?? { count: 0, due: 0 }
    byLoan.set(row.loan_id, {
      count: prev.count + 1,
      due: prev.due + installmentOutstanding(row),
    })
  }
  return byLoan
}
