import type { LoanStatus } from '@/lib/actions/loans'

export type LoanFinancialsInput = {
  id: string
  status: LoanStatus
  principal_amount: number | string
  start_date: string
  end_date: string | null
  bad_debt: number | string | null
  /** Months after start_date during which interest does NOT accrue.
   *  Repayments inside this window still reduce the principal that interest
   *  will later accrue on. Default 0. */
  interest_waiver_months?: number | string | null
}

export type LoanTxnInput = {
  transaction_type: string
  interest_source: string | null
  amount: number | string
  transaction_date: string
}

export type LoanFinancials = {
  principal: number
  paidPrincipal: number
  /** Pending principal balance (principal − repayments − bad debt). */
  balance: number
  paidInterestFromTxns: number
  /** Total interest received against this loan (all from transactions —
   *  pre-tracking payments are imported as synthetic transaction rows). */
  paidInterestTotal: number
  /** Piecewise expected interest based on balance over time, respecting any
   *  interest-waiver window. */
  expectedInterest: number
  /** Pending interest. Always 0 for paid/write_off loans. */
  interestDue: number
  months: number
  isClosed: boolean
  /** Configured interest-waiver months (0 if none). */
  interestWaiverMonths: number
  /** When interest actually starts accruing (start_date + waiver). */
  interestStartDate: Date
  /** True if today is still within the waiver window. */
  isWithinWaiver: boolean
}

export function monthsBetweenDates(start: Date, end: Date): number {
  const diff =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth())
  return Math.max(diff, 0)
}

export function monthsBetween(startISO: string, end: Date): number {
  return monthsBetweenDates(new Date(startISO), end)
}

/** Add `months` to a date in UTC, preserving day-of-month. */
export function addMonths(d: Date, months: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()),
  )
}

export function computeLoanFinancials(
  loan: LoanFinancialsInput,
  txns: LoanTxnInput[],
  interestPerLakh: number,
): LoanFinancials {
  const principal = Number(loan.principal_amount) || 0
  const endOrNow = loan.end_date ? new Date(loan.end_date) : new Date()

  // Each transaction is single-purpose: a `loan_repayment` row's full amount
  // is principal; an `interest` row's full amount is interest. To record a
  // mixed payment, insert two rows.
  const repayments = txns
    .filter((t) => t.transaction_type === 'loan_repayment')
    .map((t) => ({ date: t.transaction_date, amount: Number(t.amount) || 0 }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  const paidPrincipal = repayments.reduce((s, r) => s + r.amount, 0)
  const balance = Math.max(principal - paidPrincipal - (Number(loan.bad_debt) || 0), 0)

  const paidInterestFromTxns = txns
    .filter((t) => t.transaction_type === 'interest' && t.interest_source === 'loans')
    .reduce((s, t) => s + (Number(t.amount) || 0), 0)
  const paidInterestTotal = paidInterestFromTxns

  // Resolve interest-waiver window. Interest only accrues from start + waiver.
  const interestWaiverMonths = Math.max(
    Math.floor(Number(loan.interest_waiver_months) || 0),
    0,
  )
  const startDate = new Date(loan.start_date)
  const interestStartDate =
    interestWaiverMonths > 0 ? addMonths(startDate, interestWaiverMonths) : startDate

  // Apply repayments that landed inside the waiver window to the running
  // balance up front — they reduce the principal that interest later accrues
  // on, but nothing is charged for the period itself.
  let runningBalance = principal
  let idx = 0
  while (idx < repayments.length) {
    const rDate = new Date(repayments[idx].date)
    if (rDate >= interestStartDate) break
    runningBalance = Math.max(runningBalance - repayments[idx].amount, 0)
    idx++
  }

  // Piecewise accrual: each period uses the balance outstanding during it.
  // Repayments reduce the balance going forward, so a member who pays down
  // principal early pays less interest.
  let expectedInterest = 0
  if (interestStartDate < endOrNow) {
    let cursor = interestStartDate
    for (; idx < repayments.length; idx++) {
      const rDate = new Date(repayments[idx].date)
      const periodEnd = rDate > endOrNow ? endOrNow : rDate
      if (periodEnd > cursor) {
        const months = monthsBetweenDates(cursor, periodEnd)
        expectedInterest += (runningBalance / 100000) * interestPerLakh * months
      }
      runningBalance = Math.max(runningBalance - repayments[idx].amount, 0)
      cursor = periodEnd
      if (cursor >= endOrNow) break
    }
    if (cursor < endOrNow) {
      const months = monthsBetweenDates(cursor, endOrNow)
      expectedInterest += (runningBalance / 100000) * interestPerLakh * months
    }
  }

  const months = monthsBetween(loan.start_date, endOrNow)
  const isClosed = loan.status === 'paid' || loan.status === 'write_off'
  const isWithinWaiver = interestStartDate > endOrNow
  const interestDue = isClosed ? 0 : Math.max(expectedInterest - paidInterestTotal, 0)

  return {
    principal,
    paidPrincipal,
    balance,
    paidInterestFromTxns,
    paidInterestTotal,
    expectedInterest,
    interestDue,
    months,
    isClosed,
    interestWaiverMonths,
    interestStartDate,
    isWithinWaiver,
  }
}
