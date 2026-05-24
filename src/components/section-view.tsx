import { getTransactions } from '@/lib/actions/transactions'
import { getReference, getReferenceYearMap } from '@/lib/actions/reference'
import { getBadDebtsByYear } from '@/lib/actions/loans'
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
  const txns = raw as RawTxn[]
  const allRows = raw as TxnRow[]
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
  const yearsWith  = new Set(matching.map((t) => new Date(t.transaction_date).getUTCFullYear())).size
  const avgPerYear = yearsWith > 0 ? total / yearsWith : 0

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
    const [thresholdByYear, pctByYear, badDebtsByYear] = await Promise.all([
      getReferenceYearMap('corpus_threshold',         fromYear, toYear),
      getReferenceYearMap('donation_eligibility_pct', fromYear, toYear),
      getBadDebtsByYear(),
    ])

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
    yearlyWithCeiling = yearly.map((d) => ({
      ...d,
      ceiling: ceilingByYear.get(Number(d.month)) ?? 0,
    }))
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-gray-500">{SECTION_DESCRIPTIONS[section]}</p>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile label="Total"             value={formatRupees(total)}       accent="blue" />
        <KpiTile label={`In ${currentYear}`} value={formatRupees(thisYear)}    accent="indigo" />
        <KpiTile label="Avg / year"        value={formatRupees(avgPerYear)}  hint={`across ${yearsWith} active ${yearsWith === 1 ? 'year' : 'years'}`} accent="emerald" />
        <KpiTile label="Count"             value={count.toLocaleString('en-IN')} accent="gray" />
      </section>

      <section className="grid gap-6 lg:grid-cols-5">
        {/* Transactions card — same styling as the trend panel on the right
            so they read as siblings at the same visual level. */}
        <div className="rounded-2xl border border-gray-200/80 bg-white p-5 lg:col-span-3">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-900">Transactions</h2>
            <p className="text-xs text-gray-500">{matchingRows.length} total</p>
          </div>
          <TransactionsTable
            rows={matchingRows}
            emptyLabel={`No ${SECTION_LABELS[section].toLowerCase()} yet`}
          />
        </div>

        <div className="rounded-2xl border border-gray-200/80 bg-white p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-900">Yearly trend</h2>
          </div>
          <SectionBars data={yearlyWithCeiling} section={section} />
        </div>
      </section>
    </div>
  )
}
