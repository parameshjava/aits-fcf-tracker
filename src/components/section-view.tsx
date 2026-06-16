import { getTransactions } from '@/lib/actions/transactions'
import {
  getWriteOffLoanCount,
  getWriteOffDonationRows,
} from '@/lib/actions/loans'
import {
  getDashboardEligibilitySummary,
  getDashboardEligibilityLedger,
} from '@/lib/actions/dashboard'
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
  // Loan write-offs rendered as donation-style rows, appended to the
  // Donations transactions table so bad debts list beside voluntary donations.
  let writeOffRows: TxnRow[] = []
  if (section === 'donations') {
    // Donation eligibility is sourced from migration 010/012's table+views.
    // The ledger is per-EOM; we aggregate by year here to feed both the
    // chart's ceiling line and the donations-section KPIs.
    const [summary, ledger, writeOffs, writeOffTxns] = await Promise.all([
      getDashboardEligibilitySummary(),
      getDashboardEligibilityLedger(),
      getWriteOffLoanCount(),
      getWriteOffDonationRows(),
    ])
    writeOffCount = writeOffs
    writeOffRows = writeOffTxns as unknown as TxnRow[]

    // Roll the per-EOM ledger up into yearly buckets. `carry_balance` is a
    // running net across all periods — so the latest EOM in each year holds
    // that year's carry-out, and the previous year's carry-out is this
    // year's carry-in.
    const byYear = new Map<
      number,
      {
        amountEarned: number
        donations: number
        badDebts: number
        latestEom: string
        latestCarry: number
      }
    >()
    for (const row of ledger) {
      const y = new Date(row.period_end).getUTCFullYear()
      if (!Number.isFinite(y)) continue
      const slot = byYear.get(y)
      if (!slot) {
        byYear.set(y, {
          amountEarned: row.amount_earned,
          donations: row.donations_in_period,
          badDebts: row.bad_debts_in_period,
          latestEom: row.period_end,
          latestCarry: row.carry_balance,
        })
      } else {
        slot.amountEarned += row.amount_earned
        slot.donations   += row.donations_in_period
        slot.badDebts    += row.bad_debts_in_period
        // `ledger` is ordered newest-first (see action), so the FIRST row
        // we see for a year is the latest EOM in that year.
      }
    }

    // Per-year bad-debt totals (drives KPIs + chart writeOff bar).
    const badDebtsByYear = new Map<number, number>()
    for (const [y, slot] of byYear) {
      badDebtsByYear.set(y, slot.badDebts)
      totalBadDebts += slot.badDebts
      if (y === currentYear) thisYearBadDebts += slot.badDebts
    }

    // Build per-year ceiling: carry_at_year_start + amount_earned_in_year.
    // `carry_at_year_start` = previous year's carry-out (0 for the first
    // year). Walk years oldest-first to thread the running carry.
    const yearsAsc = Array.from(byYear.keys()).sort((a, b) => a - b)
    const ceilingByYear = new Map<number, number>()
    let prevCarry = 0
    for (const y of yearsAsc) {
      const slot = byYear.get(y)!
      const carryIn = prevCarry
      ceilingByYear.set(y, carryIn + slot.amountEarned)
      prevCarry = slot.latestCarry
    }

    // Some years have a write-off but zero donation transactions, so the
    // base `yearly` series omits them entirely. Re-add those years so the
    // bar chart shows a write-off bar even when donations were 0.
    //
    // Bars (donations + write-offs) are positive amounts. The eligibility
    // ceiling can mathematically go negative when carry goes underwater
    // (over-spent), but we clamp it at 0 for the chart so the visual
    // stays in the positive half and lines up with the bars. The signed
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

    // `summary.availableNow` from the view is clamped at 0 (see migration
    // 012). The donations section KPI used to surface the SIGNED value so
    // members could see "over-spent" — derive that signed value here so
    // the tile keeps its existing semantics:
    //   signed availableNow = total_earned − total_donated − total_bad_debt.
    availableEligibility =
      summary.totalEarned - summary.totalDonated - summary.totalBadDebt
    eligibilityEarnedSoFar = summary.totalEarned
  }

  // Rows for the transactions table. Donations fold in loan write-offs as
  // bad-debt rows; everything is sorted newest-first to match the table's
  // default date ordering.
  const tableRows: TxnRow[] = [...matchingRows, ...writeOffRows].sort(
    (a, b) =>
      new Date(b.transaction_date).getTime() -
      new Date(a.transaction_date).getTime(),
  )

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
          <p className="text-xs text-gray-500">{tableRows.length} total</p>
        </div>
        <TransactionsTable
          rows={tableRows}
          emptyLabel={`No ${SECTION_LABELS[section].toLowerCase()} yet`}
          memberColumnLabel={section === 'donations' ? 'Referred by' : 'Member'}
          showDonationColumns={section === 'donations'}
          exportName={section}
          exportTitle={SECTION_LABELS[section]}
        />
      </section>
    </div>
  )
}
