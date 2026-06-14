export type ScheduleInput = {
  principal: number
  annualRatePct: number
  termMonths: number
  startDate: string // YYYY-MM-DD (disbursement date)
  waiverMonths: number
}

export type EmiRow = {
  installmentNo: number
  dueDate: string // YYYY-MM-DD — always the 10th of the month after the accrual month
  openingBalance: number
  emiAmount: number
  principalDue: number
  interestDue: number
  closingBalance: number
  /** True for the pro-rated mid-month disbursement stub installment. */
  isStub?: boolean
}

const round = (n: number) => Math.round(n)

function parseYmd(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m, d }
}

/** Days in the (1-based) month of the given year. */
function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

/** Add `months` to a YYYY-MM-DD date, clamping the day to the target month's last day. */
export function addMonthsClamped(isoDate: string, months: number): string {
  const { y, m, d } = parseYmd(isoDate)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const ty = target.getUTCFullYear()
  const tm = target.getUTCMonth() // 0-based
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * The 10th of the month that is `monthOffset` months after the month of `baseIso`.
 * Due dates are always the 10th, so no clamping is ever needed (every month has a 10th).
 */
export function tenthOfMonth(baseIso: string, monthOffset: number): string {
  const { y, m } = parseYmd(baseIso)
  const target = new Date(Date.UTC(y, m - 1 + monthOffset, 1))
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-10`
}

export function computeEmiAmount(principal: number, annualRatePct: number, termMonths: number): number {
  if (termMonths <= 0) throw new Error('termMonths must be > 0')
  const r = annualRatePct / 100 / 12
  if (r === 0) return round(principal / termMonths)
  const pow = Math.pow(1 + r, termMonths)
  return round((principal * r * pow) / (pow - 1))
}

/**
 * Core reducing-balance amortization loop.
 * - termMonths: concrete schedule length, or null to amortize until balance clears.
 * - dueDateFor(rowIndex0): due date for the row at 0-based index.
 * - startInstallmentNo: first installment number (so a stub can occupy #1).
 */
function amortize(
  principal: number,
  annualRatePct: number,
  termMonths: number | null,
  emiOverride: number | null,
  dueDateFor: (rowIndex0: number) => string,
  startInstallmentNo: number,
): EmiRow[] {
  const r = annualRatePct / 100 / 12
  const emi = emiOverride ?? computeEmiAmount(principal, annualRatePct, termMonths!)
  const rows: EmiRow[] = []
  let balance = principal
  let i = 0
  while (balance > 0 && i < 1000) {
    const interestDue = round(balance * r)
    let emiAmount = emi
    let principalDue = emiAmount - interestDue
    const isLast = principalDue >= balance || (termMonths !== null && i + 1 === termMonths)
    if (isLast) {
      principalDue = balance
      emiAmount = principalDue + interestDue
    }
    const closingBalance = balance - principalDue
    rows.push({
      installmentNo: startInstallmentNo + i,
      dueDate: dueDateFor(i),
      openingBalance: balance,
      emiAmount,
      principalDue,
      interestDue,
      closingBalance,
    })
    balance = closingBalance
    if (isLast) break
    i += 1
  }
  return rows
}

/**
 * Build a full EMI schedule.
 *
 * Due dates: every installment is due on the **10th of the month following its
 * accrual month**. Accrual month #1 is the disbursement month (no waiver) or the
 * first full month after the waiver.
 *
 * Mid-month proration: when there is no waiver and the loan is disbursed after the
 * 1st, the disbursement month is a pro-rated **stub** installment (#1) whose interest
 * AND principal are both scaled by f = (days from disbursement to month-end) / 30.
 * Full monthly EMIs (at the standard EMI on the full principal) follow until cleared.
 */
export function buildSchedule(input: ScheduleInput): EmiRow[] {
  const { principal, annualRatePct, termMonths, startDate, waiverMonths } = input
  if (principal <= 0) throw new Error('principal must be > 0')
  if (annualRatePct < 0) throw new Error('annualRatePct must be >= 0')
  if (termMonths <= 0) throw new Error('termMonths must be > 0')

  const r = annualRatePct / 100 / 12
  const emi = computeEmiAmount(principal, annualRatePct, termMonths)
  const { y, m, d } = parseYmd(startDate)
  const hasWaiver = waiverMonths > 0
  const makeStub = !hasWaiver && d !== 1

  if (makeStub) {
    // Pro-rate the disbursement month: both interest and principal scaled by f.
    const f = Math.min((daysInMonth(y, m) - d + 1) / 30, 1)
    const interest0 = round(principal * r * f)
    const principal0 = Math.min(round((emi - principal * r) * f), principal)
    const stub: EmiRow = {
      installmentNo: 1,
      dueDate: tenthOfMonth(startDate, 1), // accrual = disbursement month → due 10th of next month
      openingBalance: principal,
      emiAmount: interest0 + principal0,
      principalDue: principal0,
      interestDue: interest0,
      closingBalance: principal - principal0,
      isStub: true,
    }
    // Full EMIs: accrual months start the month after disbursement (offset 1);
    // each is due the 10th of the following month → tenthOfMonth(start, 2 + k).
    const fullRows = amortize(
      principal - principal0,
      annualRatePct,
      null,
      emi,
      (k) => tenthOfMonth(startDate, 2 + k),
      2,
    )
    return [stub, ...fullRows]
  }

  // No stub: all full months. First accrual month is offset `waiverMonths`
  // (0 when no waiver); due the 10th of the month after each accrual month.
  const baseOffset = hasWaiver ? waiverMonths : 0
  return amortize(
    principal,
    annualRatePct,
    null,
    emi,
    (k) => tenthOfMonth(startDate, baseOffset + k + 1),
    1,
  )
}

export type PrepaymentInput = {
  outstanding: number
  annualRatePct: number
  remainingTerm: number
  currentEmi: number
  /** The next unpaid installment's due date (a 10th); the rebuilt tail continues monthly from here. */
  firstDueDate: string
  mode: 'reduce_tenure' | 'reduce_emi'
}

export function recomputeAfterPrepayment(input: PrepaymentInput): EmiRow[] {
  const { outstanding, annualRatePct, remainingTerm, currentEmi, firstDueDate, mode } = input
  if (annualRatePct < 0) throw new Error('annualRatePct must be >= 0')
  if (outstanding <= 0) return []
  // The tail keeps the 10th-of-month cadence: row k is due `firstDueDate`'s month + k.
  const dueDateFor = (k: number) => tenthOfMonth(firstDueDate, k)
  if (mode === 'reduce_tenure') {
    // Keep EMI; amortize until cleared (null = no fixed term boundary).
    return amortize(outstanding, annualRatePct, null, currentEmi, dueDateFor, 1)
  }
  // reduce_emi: keep remaining term, recompute a smaller EMI.
  if (remainingTerm <= 0) throw new Error('remainingTerm must be > 0')
  const r = annualRatePct / 100 / 12
  const newEmi = computeEmiAmount(outstanding, annualRatePct, remainingTerm)
  // Clamp: if EMI <= one month's interest the loan never amortizes — pay off in one shot.
  if (newEmi <= round(outstanding * r)) {
    return amortize(outstanding, annualRatePct, 1, outstanding + round(outstanding * r), dueDateFor, 1)
  }
  return amortize(outstanding, annualRatePct, remainingTerm, newEmi, dueDateFor, 1)
}
