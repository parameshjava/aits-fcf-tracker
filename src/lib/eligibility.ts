export type EligibilityYearInput = {
  year: number
  contributions: number
  donations: number
  /** Loan principal written off this year (sum of `loans.bad_debt` for loans
   *  closed in this year). Subtracted from the corpus. Default 0. */
  badDebts?: number
}

export type EligibilityRow = {
  year: number
  /** Contributions banked into the corpus during this year. */
  contributions: number
  /** Cumulative contributions at end of this year. */
  cumulativeContributions: number
  /** Cumulative donations paid out at end of this year. */
  cumulativeDonations: number
  /** Cumulative loan principal written off at end of this year. */
  cumulativeBadDebts: number
  /** Net corpus at end of this year =
   *  cumulativeContributions − cumulativeDonations − cumulativeBadDebts.
   *  This is what the threshold gate compares against. */
  corpus: number
  /** True once `corpus` has reached `corpusThreshold`. */
  thresholdMet: boolean
  /** Donation-eligibility earned this year = pct% of `contributions`, gated
   *  on the threshold. 0 before the corpus is funded. */
  eligibilityEarned: number
  /** Eligibility carried into this year from prior years (unspent). */
  carryIn: number
  /** Donations actually paid this year. */
  donations: number
  /** Bad debts written off this year. */
  badDebts: number
  /** carryIn + eligibilityEarned − donations. Negative means donations
   *  exceeded what the rule made available. */
  carryOut: number
  /** True if this row represents the current calendar year — its values are
   *  pro-rata "so far" rather than a final yearly total. */
  isCurrentYear: boolean
}

export type EligibilityResult = {
  rows: EligibilityRow[]
  /** Reference parameters as of the CURRENT year (for the header tiles). */
  threshold: number
  pctOfYear: number
  /** Convenience: total eligibility available as of right now. */
  availableNow: number
  /** Convenience: pro-rata eligibility earned in the current year so far. */
  currentYearEligibility: number
  /** Convenience: donations made in the current year so far. */
  currentYearDonations: number
}

/** Per-year resolver — returns the rule that was in effect for that year.
 *  Callers can derive this from `public.reference_history` so historical
 *  threshold / percentage changes are honoured (see getReferenceYearMap). */
export type EligibilityRulesResolver = (year: number) => {
  threshold: number
  pctOfYear: number
}

/**
 * Compute the per-year donation-eligibility ledger.
 *
 * Rule (configurable via /admin/reference):
 *   - Each year, members can donate up to `pctOfYear`% of that year's
 *     contributions, provided the cumulative-contributions corpus has reached
 *     `threshold`.
 *   - Eligibility unspent in a year rolls forward to the next.
 *   - For the current calendar year, the row is naturally pro-rata: it
 *     reflects only the contributions and donations recorded so far.
 */
export function computeEligibility(
  yearly: EligibilityYearInput[],
  opts: {
    /** Today's threshold (used as fallback + as the current-year header
     *  value). Always required. */
    threshold: number
    /** Today's annual percentage (used as fallback + as the current-year
     *  header value). Always required. */
    pctOfYear: number
    /** Optional per-year resolver. When supplied, each year uses the rule
     *  that was in effect that year; otherwise every year uses the
     *  top-level `threshold` + `pctOfYear`. */
    resolveFor?: EligibilityRulesResolver
    today?: Date
  },
): EligibilityResult {
  const today = opts.today ?? new Date()
  const currentYear = today.getUTCFullYear()
  const resolveFor: EligibilityRulesResolver =
    opts.resolveFor ?? (() => ({ threshold: opts.threshold, pctOfYear: opts.pctOfYear }))

  // Index pre-aggregated yearly totals so we can fill in carry-forward years
  // that had no contributions or donations of their own.
  const byYear = new Map<
    number,
    { contributions: number; donations: number; badDebts: number }
  >()
  for (const row of yearly) {
    if (!Number.isFinite(row.year)) continue
    byYear.set(row.year, {
      contributions: Number(row.contributions) || 0,
      donations: Number(row.donations) || 0,
      badDebts: Number(row.badDebts) || 0,
    })
  }

  if (byYear.size === 0) {
    return {
      rows: [],
      threshold: opts.threshold,
      pctOfYear: opts.pctOfYear,
      availableNow: 0,
      currentYearEligibility: 0,
      currentYearDonations: 0,
    }
  }

  const firstYear = Math.min(...byYear.keys())
  const lastYear = Math.max(currentYear, ...byYear.keys())

  const rows: EligibilityRow[] = []
  let cumulativeContributions = 0
  let cumulativeDonations = 0
  let cumulativeBadDebts = 0
  let carryIn = 0

  for (let y = firstYear; y <= lastYear; y++) {
    const slot = byYear.get(y) ?? { contributions: 0, donations: 0, badDebts: 0 }
    cumulativeContributions += slot.contributions
    cumulativeDonations += slot.donations
    cumulativeBadDebts += slot.badDebts
    // Corpus = cumulative contributions − cumulative donations − cumulative
    // bad debts. Donations and write-offs permanently shrink the corpus, so
    // a year that pays out more than it earns can dip back below the
    // threshold and pause future donations until contributions catch up.
    const corpus = cumulativeContributions - cumulativeDonations - cumulativeBadDebts
    // Per-year rule lookup. Defaults to the top-level threshold + pct when
    // no resolver was supplied. Critically, when a resolver IS supplied
    // (driven by reference_history), this lets each year apply its own
    // historical rule — the corpus threshold check uses the threshold
    // that was in effect THAT year, not today's.
    const rule = resolveFor(y)
    const thresholdMet = corpus >= rule.threshold
    const eligibilityEarned = thresholdMet ? slot.contributions * (rule.pctOfYear / 100) : 0
    const carryOut = carryIn + eligibilityEarned - slot.donations
    rows.push({
      year: y,
      contributions: slot.contributions,
      cumulativeContributions,
      cumulativeDonations,
      cumulativeBadDebts,
      corpus,
      thresholdMet,
      eligibilityEarned,
      carryIn,
      donations: slot.donations,
      badDebts: slot.badDebts,
      carryOut,
      isCurrentYear: y === currentYear,
    })
    carryIn = carryOut
  }

  const last = rows[rows.length - 1]
  return {
    rows,
    threshold: opts.threshold,
    pctOfYear: opts.pctOfYear,
    availableNow: last?.carryOut ?? 0,
    currentYearEligibility: last?.isCurrentYear ? last.eligibilityEarned : 0,
    currentYearDonations: last?.isCurrentYear ? last.donations : 0,
  }
}
