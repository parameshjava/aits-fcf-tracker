/**
 * Where an EMI schedule starts, and what principal it amortizes.
 *
 * A loan converted from the accrual model to EMI is scheduled from the EMI
 * cutover, not from its original disbursement — and it amortizes the principal
 * still OUTSTANDING at conversion, not the amount originally lent. Neither
 * value is stored on the loan, so any code that regenerates a schedule has to
 * re-derive both. Getting it wrong back-dates the whole schedule (see migration
 * 051 for the production incident).
 *
 * The date rule is mirrored in SQL inside `fn_generate_emi_schedule`, which is
 * the real enforcement point; these helpers keep the app's own decisions (which
 * principal to pass, whether a regeneration is even safe) consistent with it.
 */

/** `emi_cutover_date` is stored in `reference` as a YYYYMMDD integer. */
export function cutoverYmdToIso(ymd: number): string | null {
  const s = String(Math.trunc(ymd))
  if (!/^\d{8}$/.test(s)) return null
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

/**
 * The date an EMI schedule is anchored at: the later of the loan's own start
 * date and the cutover. Mirrors `greatest(p_start, emi_cutover_date)` in
 * migration 051. A null/blank cutover means no floor.
 */
export function emiScheduleStart(startDateIso: string, cutoverIso: string | null): string {
  if (!cutoverIso) return startDateIso
  return startDateIso > cutoverIso ? startDateIso : cutoverIso
}

/**
 * True when the cutover floor engages — i.e. the loan predates the cutover and
 * was therefore CONVERTED to EMI rather than created on it.
 *
 * This is the same test that decides which principal to amortize: a converted
 * loan's schedule covers what is still outstanding, while a natively-EMI loan's
 * covers the full amount lent.
 */
export function isCutoverFloored(startDateIso: string, cutoverIso: string | null): boolean {
  if (!cutoverIso) return false
  return startDateIso < cutoverIso
}

/**
 * The due date a freshly generated schedule would put on its first installment.
 *
 * Mirrors `fn_generate_emi_schedule`: the start is floored at the cutover, a
 * floored (i.e. converted) loan's waiver is dropped to 0 because it was spent
 * long before the cutover, and installment #1 falls due on the 10th of the
 * month after its accrual month — including the pro-rated stub a mid-month
 * disbursement produces, which accrues in the disbursement month itself.
 */
export function expectedFirstDueDate({
  startDateIso,
  waiverMonths,
  cutoverIso,
}: {
  startDateIso: string
  waiverMonths: number
  cutoverIso: string | null
}): string {
  const start = emiScheduleStart(startDateIso, cutoverIso)
  // greatest() floored it → converted loan → the original waiver does not apply.
  const waiver = isCutoverFloored(startDateIso, cutoverIso) ? 0 : Math.max(waiverMonths || 0, 0)
  const [y, m] = start.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + waiver + 1, 1))
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-10`
}

export type AnchorDrift = {
  expectedFirstDue: string
  actualFirstDue: string | null
  /** The schedule does not start where the generator would put it. */
  drifted: boolean
  /** Whole months the schedule sits after where it should (negative = before). */
  monthsOff: number
}

/**
 * Compare where a loan's schedule actually starts with where it should.
 *
 * Re-pricing deliberately never moves a due date, so a schedule generated
 * against the wrong anchor stays wrong and reports "no changes" forever. This
 * is what lets the UI say so instead of staying silent.
 */
export function detectAnchorDrift({
  dueDates,
  startDateIso,
  waiverMonths,
  cutoverIso,
}: {
  /** Every installment's due date, any order. */
  dueDates: string[]
  startDateIso: string
  waiverMonths: number
  cutoverIso: string | null
}): AnchorDrift {
  const expectedFirstDue = expectedFirstDueDate({ startDateIso, waiverMonths, cutoverIso })
  const actualFirstDue = dueDates.reduce<string | null>(
    (min, d) => (min === null || d < min ? d : min),
    null,
  )
  if (actualFirstDue === null) {
    return { expectedFirstDue, actualFirstDue, drifted: false, monthsOff: 0 }
  }
  const [ey, em] = expectedFirstDue.split('-').map(Number)
  const [ay, am] = actualFirstDue.split('-').map(Number)
  const monthsOff = (ay - ey) * 12 + (am - em)
  return { expectedFirstDue, actualFirstDue, drifted: monthsOff !== 0, monthsOff }
}
