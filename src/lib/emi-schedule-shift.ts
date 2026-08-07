/**
 * Move a whole EMI schedule to the month it should have started in.
 *
 * A schedule generated against the wrong anchor sits a whole number of months
 * away from where `fn_generate_emi_schedule` would put it (see
 * `detectAnchorDrift`). Re-pricing cannot fix that — it never moves a due date
 * — and regenerating rebuilds every amount as well, which is far more than the
 * problem calls for.
 *
 * This moves the dates and nothing else: same installment numbers, same
 * principal, same interest, same EMI. Only `due_date` shifts, by the same whole
 * number of months for every row, so the cadence is preserved exactly.
 *
 * It is refused outright once any installment carries money. A settled
 * installment's date is the date it was settled against, and shifting the rows
 * around it would interleave them with history.
 */

import { tenthOfMonth } from './emi-math'

export type ShiftScheduleRow = {
  id: string
  installment_no: number
  due_date: string
  status: 'scheduled' | 'paid' | 'partially_paid' | 'overdue' | 'waived'
  principal_paid: number
  interest_paid: number
}

export type ShiftedRow = {
  scheduleId: string
  installmentNo: number
  from: string
  to: string
}

export type ScheduleShiftPlan = {
  /** Months to move: positive = earlier, negative = later. */
  monthsEarlier: number
  rows: ShiftedRow[]
  firstDueBefore: string | null
  firstDueAfter: string | null
  /** How many land on or before today once moved — immediately due. */
  becomingDue: number
  fingerprint: string
  error: ScheduleShiftError | null
}

export type ScheduleShiftError =
  /** The schedule already starts where it should. */
  | 'no_drift'
  /** Something has been paid; the dates are load-bearing history now. */
  | 'has_settled_installments'
  /** Nothing left to move. */
  | 'nothing_to_shift'

const settled = (r: ShiftScheduleRow) =>
  Number(r.principal_paid) > 0 || Number(r.interest_paid) > 0 || r.status === 'paid'

export function planScheduleShift({
  rows,
  monthsOff,
  todayIso,
}: {
  rows: ShiftScheduleRow[]
  /** From `detectAnchorDrift`: positive when the schedule starts too late. */
  monthsOff: number
  todayIso: string
}): ScheduleShiftPlan {
  const movable = rows
    .filter((r) => !settled(r))
    .sort((a, b) => a.installment_no - b.installment_no)

  const base = {
    monthsEarlier: monthsOff,
    rows: [] as ShiftedRow[],
    firstDueBefore: movable[0]?.due_date ?? null,
    firstDueAfter: null as string | null,
    becomingDue: 0,
    fingerprint: '',
  }

  if (monthsOff === 0) return { ...base, error: 'no_drift' }
  if (rows.some(settled)) return { ...base, error: 'has_settled_installments' }
  if (movable.length === 0) return { ...base, error: 'nothing_to_shift' }

  // Every due date is a 10th, so shifting by whole months keeps it one.
  const shifted: ShiftedRow[] = movable.map((r) => ({
    scheduleId: r.id,
    installmentNo: r.installment_no,
    from: r.due_date,
    to: tenthOfMonth(r.due_date, -monthsOff),
  }))

  return {
    monthsEarlier: monthsOff,
    rows: shifted,
    firstDueBefore: shifted[0].from,
    firstDueAfter: shifted[0].to,
    becomingDue: shifted.filter((r) => r.to <= todayIso).length,
    fingerprint: [monthsOff, shifted.length, shifted[0].from, shifted[shifted.length - 1].from].join(
      '|',
    ),
    error: null,
  }
}

export function scheduleShiftErrorMessage(plan: ScheduleShiftPlan): string {
  switch (plan.error) {
    case 'no_drift':
      return 'This schedule already starts in the right month.'
    case 'has_settled_installments':
      return 'Some installments on this loan have already been paid, so the dates cannot be moved — an installment’s due date is what it was settled against. Correct this one by hand.'
    case 'nothing_to_shift':
      return 'There are no installments left to move.'
    default:
      return 'The schedule could not be moved.'
  }
}
