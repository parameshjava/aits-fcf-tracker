/**
 * Tallies behind the loans list's EMI columns:
 *   • "Total EMI"   — settled / total installments, plus % still pending
 *   • "Pending EMI" — a count of installments payable as of this month
 *   • "Due EMI"     — the rupees owed across those same installments
 *
 * All three derive from ONE pass over a loan's schedule rows, so the columns
 * can never disagree about which installments are payable.
 */

import { UNPAID_EMI_STATUSES } from '@/lib/constants'

export type EmiScheduleRow = {
  loan_id: string
  status: string
  due_date: string
  principal_due: number | string
  interest_due: number | string
  principal_paid: number | string
  interest_paid: number | string
}

/** Set form of the shared unpaid-status list, for O(1) membership per row. */
const UNPAID: ReadonlySet<string> = new Set(UNPAID_EMI_STATUSES)

export type EmiTallies = {
  /** Unpaid installments payable as of this month (due ≤ month end). */
  pendingCount: number
  /** Rupees still owed across those installments. */
  pendingDue: number
  /** Installments no longer owing — paid outright or waived. */
  settledCount: number
  /** Installments on the schedule, whatever their status. */
  totalCount: number
}

const emptyTallies = (): EmiTallies => ({
  pendingCount: 0,
  pendingDue: 0,
  settledCount: 0,
  totalCount: 0,
})

/**
 * Amount still owed on a single installment: the unpaid principal plus the
 * unpaid interest — exactly what `payEmi` charges. Late fees are deliberately
 * excluded: they're a separate penalty receivable, collected (or waived)
 * alongside the EMI rather than being part of it.
 *
 * Clamped at zero so an over-applied payment on one leg can't mask what the
 * other leg still owes.
 */
export function installmentOutstanding(row: EmiScheduleRow): number {
  const principal = Number(row.principal_due) - Number(row.principal_paid)
  const interest = Number(row.interest_due) - Number(row.interest_paid)
  return Math.max(principal, 0) + Math.max(interest, 0)
}

/**
 * Group a loan's full schedule into per-loan tallies.
 *
 * `monthEndIso` is the cut-off for "payable as of this month" — an installment
 * due on the 10th counts from the 1st, not only once the 10th has passed.
 * Waived rows count as settled: they no longer owe anything, so leaving them
 * out of `settledCount` would report them as forever pending.
 */
export function tallyEmiSchedule(
  rows: EmiScheduleRow[],
  monthEndIso: string,
): Map<string, EmiTallies> {
  const byLoan = new Map<string, EmiTallies>()
  for (const row of rows) {
    let t = byLoan.get(row.loan_id)
    if (!t) {
      t = emptyTallies()
      byLoan.set(row.loan_id, t)
    }
    t.totalCount += 1
    if (UNPAID.has(row.status)) {
      if (row.due_date <= monthEndIso) {
        t.pendingCount += 1
        t.pendingDue += installmentOutstanding(row)
      }
    } else {
      // 'paid' or 'waived' — nothing further is owed on this installment.
      t.settledCount += 1
    }
  }
  return byLoan
}

/**
 * Share of the schedule still to settle, 0–100 and rounded. Returns null when
 * there's no schedule at all, so the caller can show a dash instead of "0%".
 */
export function pctPending(tallies: Pick<EmiTallies, 'settledCount' | 'totalCount'>): number | null {
  if (tallies.totalCount <= 0) return null
  const remaining = Math.max(tallies.totalCount - tallies.settledCount, 0)
  return Math.round((remaining / tallies.totalCount) * 100)
}

/** How many days before its due date an installment becomes payable. */
export const PAY_WINDOW_DAYS = 15

/** The 1st of the month an installment falls due in. */
function firstOfDueMonth(dueDateIso: string): string {
  return `${dueDateIso.slice(0, 7)}-01`
}

/** `dueDateIso` minus `days`, as YYYY-MM-DD. */
function daysBefore(dueDateIso: string, days: number): string {
  const [y, m, d] = dueDateIso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d - days))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/**
 * The date an installment starts being collectable: **15 days before it falls
 * due, or the 1st of the month it falls due in — whichever comes first.**
 *
 * Both halves are the same intent stated two ways. The 15-day window is the
 * general rule; the month clause keeps an installment dated late in a month
 * collectable from the start of that month rather than only in its last
 * fortnight.
 *
 * Anything already past its due date is trivially inside the window, so arrears
 * stay collectable — the window bounds how far AHEAD an EMI can be settled, not
 * how far behind.
 *
 * Paying earlier than this saves the member nothing: `payEmi` charges exactly
 * what the installment says, so settling it early moves cash without touching
 * the interest. Money offered ahead of the window belongs in a prepayment,
 * which reduces the principal and does cut the interest.
 */
export function payWindowOpensOn(dueDateIso: string): string {
  const fifteenDaysBefore = daysBefore(dueDateIso, PAY_WINDOW_DAYS)
  const monthStart = firstOfDueMonth(dueDateIso)
  return fifteenDaysBefore < monthStart ? fifteenDaysBefore : monthStart
}

/**
 * The installment "Pay EMI" is offered on — at most one.
 *
 * Two rules combine:
 *
 *   1. **Earliest first.** Only the oldest unpaid installment can be paid.
 *      Offering every open installment at once let an admin settle #2 while #1
 *      was still outstanding, which strands a paid row between unpaid ones: the
 *      schedule reads out of order, re-pricing has to skip around it, and the
 *      date-shift repair refuses outright once anything is settled.
 *
 *   2. **Inside its pay window** — see `payWindowOpensOn`. Not yet collectable
 *      means no button; paying further ahead than that is a prepayment.
 *
 * Returns an array rather than a single id so callers keep a set-membership
 * check and stay indifferent to the cardinality of the rule.
 */
export function payableInstallmentIds({
  rows,
  todayIso,
}: {
  rows: ReadonlyArray<{ id: string; installment_no: number; due_date: string; status: string }>
  /** Today in IST (YYYY-MM-DD). */
  todayIso: string
}): string[] {
  const earliest = rows
    .filter((r) => UNPAID.has(r.status))
    .sort((a, b) =>
      a.due_date === b.due_date
        ? a.installment_no - b.installment_no
        : a.due_date < b.due_date
          ? -1
          : 1,
    )[0]
  if (!earliest) return []
  return todayIso >= payWindowOpensOn(earliest.due_date) ? [earliest.id] : []
}
