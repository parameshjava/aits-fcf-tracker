// src/lib/exit-math.ts
// Pure exit-policy math. No DB, no I/O — the single source of truth for the
// formula (spec docs/superpowers/specs/2026-06-14-member-exit-policy-design.md).
// The SQL layer supplies the inputs and validates input-equality; it never
// re-implements this formula.

export type ExitMathInput = {
  /** P component: all-time SUM of donation transactions. */
  totalDonations: number
  /** P component: all-time SUM of loans.bad_debt on write-off loans. */
  totalBadDebt: number
  /** S: SUM of settled_amount across already-approved exits. */
  settled: number
  /** N: count of members with status='active' (incl. co-proposers). */
  activeCount: number
  /** C: this member's all-time SUM of contribution transactions. */
  contributions: number
  /** L: this member's outstanding loan principal (excl. waived interest). */
  loanBalance: number
}

export type ExitMathResult = {
  lossPool: number       // P
  exitShare: number      // E = max(0, round2((P - S) / N))
  settledAmount: number  // min(E, C - L), >= 0 — what S accrues on approval
  refund: number         // max(0, C - E - L)
  eligible: boolean      // C >= L
  shortfall: number      // max(0, L - C)
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function computeExit(input: ExitMathInput): ExitMathResult {
  const { totalDonations, totalBadDebt, settled, activeCount, contributions, loanBalance } = input

  const lossPool = round2(totalDonations + totalBadDebt)
  // `settled` is assumed to be a sum of round2'd settled_amount values, so the subtraction stays exact.
  const unsettled = lossPool - settled
  const exitShare = activeCount > 0 ? Math.max(0, round2(unsettled / activeCount)) : 0

  const eligible = contributions >= loanBalance
  const shortfall = Math.max(0, round2(loanBalance - contributions))

  const coverable = contributions - loanBalance
  const settledAmount = Math.max(0, round2(Math.min(exitShare, coverable)))
  // Derive refund from the already-rounded settledAmount so the conservation
  // identity (refund + settledAmount + loanBalance == contributions) is exact.
  const refund = Math.max(0, round2(coverable - settledAmount))

  return { lossPool, exitShare, settledAmount, refund, eligible, shortfall }
}
