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
