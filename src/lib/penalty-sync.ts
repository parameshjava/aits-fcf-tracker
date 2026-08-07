/**
 * Late-fee bookkeeping for an EMI installment when a penalty transaction is
 * deleted by an admin.
 *
 * An installment's late fee lives in two places:
 *   • `loan_emi_schedule.late_fee_charged` / `late_fee_txn_id` / `late_fee_waived`
 *   • one `transactions` row per charged month (the cumulative model tops the
 *     fee up monthly), plus an optional negative row when the fee was waived.
 *
 * Deleting one of those transactions has to leave the schedule row consistent,
 * which is what `lateFeeStateAfterDelete` computes.
 */

export type PenaltyTxnRef = {
  id: string
  amount: number
  /** ISO date (YYYY-MM-DD). */
  transaction_date: string
}

export type LateFeeState = {
  late_fee_charged: number
  late_fee_txn_id: string | null
  late_fee_waived: boolean
}

/**
 * Resolve the installment's late-fee columns after one penalty row is removed.
 *
 * We subtract the deleted amount from `late_fee_charged` rather than recomputing
 * the sum from `remaining` — penalties charged before migration 047 have no
 * `loan_emi_schedule_id`, so `remaining` can under-report the real history and a
 * full recompute would silently forgive those older charges.
 *
 * @param currentCharged  the schedule row's `late_fee_charged` before the delete
 * @param deletedAmount   the deleted transaction's amount (negative = a waiver reversal)
 * @param remaining       the installment's other linked penalty transactions
 */
export function lateFeeStateAfterDelete({
  currentCharged,
  deletedAmount,
  remaining,
}: {
  currentCharged: number
  deletedAmount: number
  remaining: PenaltyTxnRef[]
}): LateFeeState {
  // Only a positive row is a charge; a negative one is the waiver reversal and
  // never contributed to late_fee_charged.
  const charged =
    deletedAmount > 0 ? Math.max(currentCharged - deletedAmount, 0) : currentCharged

  const charges = remaining.filter((r) => r.amount > 0)
  const latestCharge = charges.reduce<PenaltyTxnRef | null>(
    (best, r) => (best === null || r.transaction_date >= best.transaction_date ? r : best),
    null,
  )

  return {
    late_fee_charged: charged,
    // Point at the most recent surviving charge so the audit link stays valid.
    late_fee_txn_id: charged > 0 ? (latestCharge?.id ?? null) : null,
    // The installment stays waived only while a reversal row survives; deleting
    // the reversal un-waives it, so the monthly job may charge it again.
    late_fee_waived: remaining.some((r) => r.amount < 0),
  }
}
