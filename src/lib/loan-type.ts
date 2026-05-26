/** Loan-type vocabulary shared by client + server.
 *
 *  Lives outside `@/lib/actions/loans.ts` because that file is a
 *  `'use server'` module — Next.js requires every export there to be an
 *  async server action, so types and constants must live elsewhere to be
 *  importable from client components.
 */

export type LoanType = 'personal' | 'medical'

/** Max waiver months admin may grant on any loan (personal or medical).
 *  Mirrors the SQL CHECK constraint enforced in migration 019. */
export const MAX_INTEREST_WAIVER_MONTHS = 12

/** @deprecated Use MAX_INTEREST_WAIVER_MONTHS — waiver is no longer
 *  medical-specific. Kept as an alias to avoid churn. */
export const MEDICAL_LOAN_MAX_WAIVER_MONTHS = MAX_INTEREST_WAIVER_MONTHS
