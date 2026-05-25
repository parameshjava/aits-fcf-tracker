import { getTransactions } from '@/lib/actions/transactions'
import { getReference, getReferenceYearMap } from '@/lib/actions/reference'
import { getBadDebtsByYear, getWriteOffLoanCount } from '@/lib/actions/loans'
import { formatRupees } from '@/lib/format'
import { KpiTile } from '@/components/kpi-tile'
import { SectionBars } from '@/components/charts/dashboard-bars'
import { TransactionsTable, type TxnRow } from '@/components/transactions-table'
import {
  countWhere,
  sectionYearlySeries,
  sumWhere,
  type RawTxn,
} from '@/lib/aggregate'
import { computeEligibility } from '@/lib/eligibility'
import {
  SECTION_DESCRIPTIONS,
  SECTION_LABELS,
  SECTION_TYPES,
  type SectionKey,
} from '@/lib/transaction-groups'

export async function SectionView({
  section,
}: {
  section: SectionKey
}) {
  const raw = (await getTransactions()) ?? []
  // `getTransactions` returns DB rows with a member-join; both RawTxn (for
  // aggregation) and TxnRow (for the table) are structural subsets of that
  // shape. Cast through `unknown` since TS can't widen the join shape
  // automatically.
  const txns = raw as unknown as RawTxn[]
  const allRows = raw as unknown as TxnRow[]
  const typeSet = new Set(SECTION_TYPES[section])
  const matching = txns.filter((t) => typeSet.has(t.transaction_type))
  const matchingRows = allRows.filter((t) =>
    typeSet.has(t.transaction_type as RawTxn['transaction_type']),
  )

  // KPIs default to the current calendar year (no year-picker on this page).
  const currentYear = new Date().getUTCFullYear()
  const total      = sumWhere(matching, () => true)
  const thisYear   = sumWhere(matching, (t) => new Date(t.transaction_date).getUTCFullYear() === currentYear)
  const count      = countWhere(matching, () => true)
  // Average is over the fund's lifetime, not just years this section saw
  // activity — otherwise a single-year section (e.g. donations only in 2024)
  // would report avg = total, which is meaningless. Fund-start year is the
  // earliest transaction year of ANY type (contributions go back to 2016).
  const allYears = txns
    .map((t) => new Date(t.transaction_date).getUTCFullYear())
    .filter(Number.isFinite)
  const firstFundYear = allYears.length ? Math.min(...allYears) : currentYear
  const fundYears = Math.max(1, currentYear - firstFundYear + 1)
  const avgPerYear = total / fundYears

  // Yearly trend — sums across each year the section has activity in.
  const yearly = sectionYearlySeries(txns, SECTION_TYPES[section])

  // Donations get a per-year "eligibility ceiling" line overlay so members
  // can see at a glance whether each year crossed the fund's donation
  // eligibility (carry-in + this year's earned eligibility = cap).
  //
  // Per-year rule lookup comes from public.reference_history so historical
  // years see the corpus_threshold + donation_eligibility_pct that were in
  // effect THAT year, not today's values. Admin manages the windows at
  // /admin/reference/[key].
  let yearlyWithCeiling = yearly
  // `eligibilityEarnedSoFar` = lifetime cap (sum of each year's earned
  // eligibility, ignoring donations). `availableEligibility` = what's left
  // to spend right now (= so-far − total donated − total written-off; can
  // go negative when over-spent). Both are shown as KPI tiles on the
  // donations section.
  let eligibilityEarnedSoFar = 0
  let availableEligibility = 0
  // Donations-section-only bad-debt aggregates. The fund treats a loan
  // write-off as economically equivalent to a donation (the borrower has
  // received the money permanently), so these flow into the same Total /
  // Avg / In-current-year / Yearly-bar metrics as voluntary donations.
  let totalBadDebts = 0
  let thisYearBadDebts = 0
  let writeOffCount = 0
  if (section === 'donations') {
    let fallbackThreshold = 500000
    let fallbackPct = 25
    try { fallbackThreshold = await getReference('corpus_threshold') } catch {}
    try { fallbackPct       = await getReference('donation_eligibility_pct') } catch {}

    // computeEligibility needs both contributions + donations totals per
    // year. We derive them from the raw txns directly so the same source
    // of truth feeds the bars (donations) and the line (eligibility).
    const byYear = new Map<number, { contributions: number; donations: number }>()
    for (const t of txns) {
      const y = new Date(t.transaction_date).getUTCFullYear()
      if (!Number.isFinite(y)) continue
      const slot = byYear.get(y) ?? { contributions: 0, donations: 0 }
      const amt = Number(t.amount) || 0
      if (t.transaction_type === 'contribution') slot.contributions += amt
      else if (t.transaction_type === 'donation') slot.donations += amt
      byYear.set(y, slot)
    }

    const years = Array.from(byYear.keys())
    const fromYear = years.length ? Math.min(...years) : new Date().getUTCFullYear()
    const toYear   = years.length ? Math.max(...years) : new Date().getUTCFullYear()
    const [thresholdByYear, pctByYear, badDebtsByYear, writeOffs] = await Promise.all([
      getReferenceYearMap('corpus_threshold',         fromYear, toYear),
      getReferenceYearMap('donation_eligibility_pct', fromYear, toYear),
      getBadDebtsByYear(),
      getWriteOffLoanCount(),
    ])
    writeOffCount = writeOffs
    for (const [y, v] of badDebtsByYear) {
      totalBadDebts += v
      if (y === currentYear) thisYearBadDebts += v
    }

    const eligibility = computeEligibility(
      Array.from(byYear.entries()).map(([year, v]) => ({
        year,
        contributions: v.contributions,
        donations: v.donations,
        badDebts: badDebtsByYear.get(year) ?? 0,
      })),
      {
        threshold: fallbackThreshold,
        pctOfYear: fallbackPct,
        resolveFor: (y) => ({
          threshold: thresholdByYear.get(y) ?? fallbackThreshold,
          pctOfYear: pctByYear.get(y) ?? fallbackPct,
        }),
      },
    )
    const ceilingByYear = new Map<number, number>()
    for (const r of eligibility.rows) {
      ceilingByYear.set(r.year, r.carryIn + r.eligibilityEarned)
    }
    // Some years have a write-off but zero donation transactions, so the
    // base `yearly` series omits them entirely. Re-add those years so the
    // bar chart shows a write-off bar even when donations were 0.
    //
    // Bars (donations + write-offs) are positive amounts. The eligibility
    // ceiling can mathematically go negative when carryOut < 0 (over-spent),
    // but we clamp it at 0 for the chart so the visual stays in the
    // positive half and lines up with the bars. The true (signed)
    // "Eligible amount" KPI tile still surfaces the negative value when
    // applicable.
    const yearsWithAnyOutflow = new Set<number>([
      ...yearly.map((d) => Number(d.month)),
      ...badDebtsByYear.keys(),
    ])
    yearlyWithCeiling = Array.from(yearsWithAnyOutflow)
      .sort((a, b) => a - b)
      .map((y) => {
        const base = yearly.find((d) => Number(d.month) === y) ?? {
          month: String(y),
          value: 0,
        }
        return {
          ...base,
          writeOff: badDebtsByYear.get(y) ?? 0,
          ceiling: Math.max(0, ceilingByYear.get(y) ?? 0),
        }
      })
    availableEligibility = eligibility.availableNow
    eligibilityEarnedSoFar = eligibility.rows.reduce((s, r) => s + r.eligibilityEarned, 0)
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-gray-500">{SECTION_DESCRIPTIONS[section]}</p>

      {section === 'donations' ? (() => {
        // Treat loan write-offs as donations for the section KPIs — the
        // fund has permanently parted with that money, so it shows up
        // beside voluntary donations in Total / Avg / In-${year}.
        const totalOutflow      = total + totalBadDebts
        const thisYearOutflow   = thisYear + thisYearBadDebts
        const combinedCount     = count + writeOffCount
        const avgPerYearOutflow = totalOutflow / fundYears
        return (
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <KpiTile
            label={`Total donations (${combinedCount.toLocaleString('en-IN')})`}
            value={formatRupees(totalOutflow)}
            hint={
              totalBadDebts > 0
                ? `${formatRupees(total)} donated + ${formatRupees(totalBadDebts)} written off`
                : undefined
            }
            accent="blue"
          />
          <KpiTile
            label="Eligibility so far"
            value={formatRupees(eligibilityEarnedSoFar)}
            hint="lifetime cap earned"
            accent="amber"
          />
          <KpiTile
            label="Avg / year"
            value={formatRupees(avgPerYearOutflow)}
            hint={`across ${fundYears} fund ${fundYears === 1 ? 'year' : 'years'}`}
            accent="emerald"
          />
          <KpiTile
            label={`In ${currentYear}`}
            value={formatRupees(thisYearOutflow)}
            accent="indigo"
          />
          <KpiTile
            label="Eligible amount"
            value={`${availableEligibility < 0 ? '−' : ''}${formatRupees(Math.abs(availableEligibility))}`}
            hint={
              availableEligibility < 0
                ? 'over-spent (donations + write-offs)'
                : 'eligibility so far − donated − written off'
            }
            accent="rose"
          />
        </section>
        )
      })() : (
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiTile label="Total"             value={formatRupees(total)}       accent="blue" />
          <KpiTile label={`In ${currentYear}`} value={formatRupees(thisYear)}    accent="indigo" />
          <KpiTile
            label="Avg / year"
            value={formatRupees(avgPerYear)}
            hint={`across ${fundYears} fund ${fundYears === 1 ? 'year' : 'years'}`}
            accent="emerald"
          />
          <KpiTile label="Count"             value={count.toLocaleString('en-IN')} accent="gray" />
        </section>
      )}

      <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">Yearly trend</h2>
        </div>
        <SectionBars data={yearlyWithCeiling} section={section} />
      </section>

      <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">Transactions</h2>
          <p className="text-xs text-gray-500">{matchingRows.length} total</p>
        </div>
        <TransactionsTable
          rows={matchingRows}
          emptyLabel={`No ${SECTION_LABELS[section].toLowerCase()} yet`}
          memberColumnLabel={section === 'donations' ? 'Beneficiary' : 'Member'}
        />
      </section>
    </div>
  )
}
