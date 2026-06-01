import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getReferenceRow } from '@/lib/actions/reference'
import { formatRupees } from '@/lib/format'
import { KpiTile } from '@/components/kpi-tile'
import {
  DashboardBars,
  MemberContributionBars,
} from '@/components/charts/dashboard-bars'
import { TransactionsTable, type TxnRow } from '@/components/transactions-table'
import { TableExportMenu } from '@/components/table-export'
import { MemberMonthMatrix } from '@/components/member-month-matrix'
import { YearPicker } from '@/components/year-picker'
import { DASHBOARD_BAR_COLORS } from '@/lib/transaction-groups'
import {
  getDashboardOverall,
  getDashboardYearly,
  getDashboardMonthly,
  getDashboardMemberTotals,
  getDashboardMemberMonthMatrix,
  getDashboardTransactions,
  getDashboardEligibilitySummary,
  getDashboardEligibilityLedger,
  type DashboardTxn,
  type DashboardMemberTotal,
  type DashboardEligibilitySummary,
  type DashboardEligibilityRow,
} from '@/lib/actions/dashboard'
import { getTotalPendingPrincipal } from '@/lib/actions/loans'
import { Admonition } from '@/components/ui/admonition'
import { SubmitPaymentForm } from './submit-payment-form'
import { DashboardTabs } from './dashboard-tabs'
import { EligibilityMonthlyChart } from './eligibility-monthly-chart'

type SeriesKey = 'contributions' | 'loanInterest' | 'bankInterest'

const SERIES_LABELS: Record<SeriesKey, string> = {
  contributions: 'Contributions',
  loanInterest: 'Loan interest',
  bankInterest: 'Bank interest',
}

const MONTH_LABELS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const MONTH_LABELS = [
  'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec',
]

type TabKey = 'inflow' | 'matrix' | 'members' | 'eligibility'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string
    month?: string
    series?: string
    tab?: string
  }>
}) {
  const {
    year: yearParam,
    month: monthParam,
    series: seriesParam,
    tab: tabParam,
  } = await searchParams
  const tab: TabKey =
    tabParam === 'members'
      ? 'members'
      : tabParam === 'matrix'
      ? 'matrix'
      : tabParam === 'eligibility'
      ? 'eligibility'
      : 'inflow'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // All aggregates come from views — see scripts/create-dashboard-views.sql.
  const [overall, yearly, memberTotals, bankBalanceRow, pendingPrincipal] = await Promise.all([
    getDashboardOverall(),
    getDashboardYearly(),
    getDashboardMemberTotals(),
    getReferenceRow('bank_balance'),
    getTotalPendingPrincipal(),
  ])
  const bankBalance = Number(bankBalanceRow?.value ?? 0)
  const availableBalance = bankBalance + pendingPrincipal

  // listYears: every year that appears in the yearly view, plus the current
  // calendar year if it's missing (so the picker always has "this year").
  const yearsFromData = yearly.map((r) => r.year)
  const thisYear = new Date().getUTCFullYear()
  const years = Array.from(new Set([...yearsFromData, thisYear])).sort((a, b) => b - a)
  const year = Number(yearParam) || years[0] || thisYear

  // Per-year totals for the strip above the bar chart + the eligibility tab.
  const yearRow =
    yearly.find((r) => r.year === year) ??
    { year, contributions: 0, loan_interest: 0, bank_interest: 0, donations: 0, loan_repayments: 0, penalty: 0 }

  // Member × month matrix for the selected year (one row per member with
  // jan..dec contribution sums).
  const memberMonthRows = await getDashboardMemberMonthMatrix(year)

  // Monthly buckets for the selected year — Jan..Dec rows always present so
  // the chart renders 12 bars even for empty months.
  const monthlyRows = await getDashboardMonthly(year)
  const monthlyByIdx = new Map(monthlyRows.map((r) => [r.month_index, r]))
  const monthly = MONTH_LABELS.map((label, i) => {
    const m = monthlyByIdx.get(i)
    return {
      month: label,
      monthIndex: i,
      contributions: m?.contributions ?? 0,
      loanInterest:  m?.loan_interest  ?? 0,
      bankInterest:  m?.bank_interest  ?? 0,
    }
  })

  // Donation-eligibility is sourced from the donation_eligibility_periods
  // table + views (migrations 010 + 012). The dashboard tile uses the
  // single-row summary; the per-year ledger table aggregates the per-EOM
  // ledger rows by calendar year.
  const [eligibilitySummary, eligibilityLedger] = await Promise.all([
    getDashboardEligibilitySummary(),
    getDashboardEligibilityLedger(),
  ])
  const eligibilityYears = aggregateEligibilityByYear(eligibilityLedger, thisYear)

  // Monthly stacked bar dataset for the selected year:
  //   • carryIn = lifetime cumulative EARNED eligibility BEFORE this month
  //               (sum of `amount_earned` across all prior EOM rows). January
  //               of the selected year inherits the lifetime total through
  //               end of the prior year; each subsequent month rolls forward.
  //   • earned  = this month's `amount_earned` (fresh accrual)
  // Months without an EOM row render as zero bars. For the CURRENT calendar
  // year we trim the chart at the current IST month; past years still render
  // all 12 months. `period_end` is a date-only ISO string, so we read it via
  // `getUTCMonth()` to stay stable across IST/UTC boundaries.
  const rowsByMonth = new Map<number, { earned: number; donated: number; badDebts: number }>()
  for (const row of eligibilityLedger) {
    const d = new Date(row.period_end)
    if (d.getUTCFullYear() !== year) continue
    rowsByMonth.set(d.getUTCMonth(), {
      earned: Number(row.amount_earned),
      donated: Number(row.donations_in_period),
      badDebts: Number(row.bad_debts_in_period),
    })
  }
  // Use IST so "current month" matches the rest of the app's date semantics.
  const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const currentYear = todayIST.getFullYear()
  const currentMonthIdx = todayIST.getMonth() // 0-indexed
  const eligibilityMonthlyData = buildEligibilityMonthlyData(
    rowsByMonth,
    eligibilityLedger,
    year,
    currentYear,
    currentMonthIdx,
  )

  // Drill-down: bar-segment click sets ?month=YYYY-MM&series=X. The view
  // does the filtering — we just hand it the params and render the result.
  const validMonth = typeof monthParam === 'string' && /^\d{4}-\d{2}$/.test(monthParam)
  const validSeries: SeriesKey | null =
    seriesParam === 'contributions' || seriesParam === 'loanInterest' || seriesParam === 'bankInterest'
      ? (seriesParam as SeriesKey)
      : null

  let recent: TxnRow[]
  let drillHeader: { title: string; subtitle: string; clearHref: string } | null = null

  if (validMonth && validSeries) {
    const rows = await getDashboardTransactions({ monthIso: monthParam, series: validSeries })
    recent = rows.map(toTxnRow)
    const total = recent.reduce((s, r) => s + Number(r.amount || 0), 0)
    const [, mStr] = (monthParam as string).split('-')
    const monthLabel = MONTH_LABELS_LONG[Number(mStr) - 1]
    const yLabel = (monthParam as string).split('-')[0]
    drillHeader = {
      title: `${SERIES_LABELS[validSeries]} · ${monthLabel} ${yLabel}`,
      subtitle: `${recent.length} ${recent.length === 1 ? 'transaction' : 'transactions'} · ${formatRupees(total)}`,
      clearHref: `/dashboard?tab=inflow&year=${year}`,
    }
  } else {
    const rows = await getDashboardTransactions({ limit: 10 })
    recent = rows.map(toTxnRow)
  }

  return (
    <div className="space-y-8">
      <h1 className="text-lg font-semibold text-gray-900">Dashboard</h1>
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiTile
          label="Total contributions"
          value={formatRupees(overall.contributions)}
          hint="All-time member contributions"
          accent="blue"
        />
        <KpiTile
          label="Loan interest"
          value={formatRupees(overall.loan_interest)}
          hint="Interest earned on loans"
          accent="indigo"
        />
        <KpiTile
          label="Bank interest"
          value={formatRupees(overall.bank_interest)}
          hint="Interest earned on bank deposits"
          accent="emerald"
        />
        <KpiTile
          label="FCF Bank Balance"
          value={formatRupees(bankBalance)}
          hint={
            bankBalanceRow?.updated_at
              ? `Updated ${new Date(bankBalanceRow.updated_at).toLocaleDateString('en-IN')}`
              : 'Not set'
          }
          accent="blue"
        />
        <KpiTile
          label="Available balance"
          value={formatRupees(availableBalance)}
          hint="Bank balance + outstanding loan principal"
          accent="amber"
        />
      </section>

      <DashboardTabs
        initialTab={tab}
        yearPicker={<YearPicker years={years} value={year} />}
        inflowChart={
          <div>
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900">Monthly inflow · {year}</h2>
              <p className="text-xs text-gray-500">
                Contributions, loan interest, and bank interest by month.{' '}
                <span className="text-gray-400">Click any bar segment to drill in.</span>
              </p>
            </div>
            <YearTotalsStrip
              year={year}
              contributions={yearRow.contributions}
              loanInterest={yearRow.loan_interest}
              bankInterest={yearRow.bank_interest}
              total={yearRow.contributions + yearRow.loan_interest + yearRow.bank_interest}
            />
            <DashboardBars data={monthly} year={year} />
          </div>
        }
        matrixChart={
          <div>
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900">Member × Month · {year}</h2>
              <p className="text-xs text-gray-500">
                Per-member contribution for each month of {year}. Empty cells mean no
                contribution recorded that month.
              </p>
            </div>
            <MemberMonthMatrix rows={memberMonthRows} year={year} />
          </div>
        }
        membersChart={
          <div>
            <div className="mb-4">
              <h2 className="text-base font-semibold text-gray-900">Total contributions by member</h2>
              <p className="text-xs text-gray-500">
                All-time contributions per member, highest to lowest.
              </p>
            </div>
            <MemberContributionBars
              data={memberTotals.map((m) => ({ member: m.member_name, total: m.total, count: m.count }))}
            />
          </div>
        }
        eligibilityChart={
          <div className="space-y-6">
            <DonationEligibilityHeader
              summary={eligibilitySummary}
              years={eligibilityYears}
              thisYear={thisYear}
            />
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-gray-900">
                  Eligibility by month — {year}
                </h3>
                <p className="text-xs text-gray-500">
                  Cumulative earned eligibility (orange) + this month&apos;s fresh accrual (blue)
                </p>
              </div>
              <EligibilityMonthlyChart data={eligibilityMonthlyData} year={year} />
            </div>
          </div>
        }
        matrixSection={null}
        inflowSection={
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  {drillHeader ? drillHeader.title : 'Recent activity'}
                </h2>
                <p className="text-xs text-gray-500">
                  {drillHeader ? drillHeader.subtitle : 'Latest 10 transactions'}
                </p>
              </div>
              {drillHeader && (
                <Link
                  href={drillHeader.clearHref}
                  className="text-xs font-medium text-blue-600 hover:text-blue-800"
                >
                  ← Back to recent activity
                </Link>
              )}
            </div>
            <TransactionsTable
              rows={recent}
              emptyLabel={
                drillHeader ? 'No transactions in this slice' : 'No transactions yet'
              }
            />
          </div>
        }
        eligibilitySection={<DonationEligibilityLedger years={eligibilityYears} />}
        membersSection={
          <div>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Member leaderboard</h2>
                <p className="text-xs text-gray-500">
                  {memberTotals.length} {memberTotals.length === 1 ? 'member' : 'members'} ·{' '}
                  {formatRupees(memberTotals.reduce((s, m) => s + m.total, 0))} total
                </p>
              </div>
              <TableExportMenu
                filename="member-leaderboard"
                title="Member leaderboard"
                columns={['Rank', 'Member', 'Contributions (count)', 'Total (₹)']}
                rows={memberTotals.map((m, i) => [i + 1, m.member_name, m.count, m.total])}
                footer={['', 'Total', memberTotals.reduce((s, m) => s + m.count, 0), memberTotals.reduce((s, m) => s + m.total, 0)]}
              />
            </div>
            <MemberTotalsTable rows={memberTotals} />
          </div>
        }
        footer={
          user ? (
            <div className="mt-3 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              <span aria-hidden="true" className="text-base leading-none">💡</span>
              <p className="leading-relaxed">
                Don&apos;t see your contribution here?{' '}
                <a href="#submit-payment" className="font-medium underline underline-offset-2 hover:text-blue-700">
                  Submit your payment details
                </a>{' '}
                below — an admin will verify your transaction and approve it into
                the official record.
              </p>
            </div>
          ) : null
        }
      />

      {user && (
        <div id="submit-payment" className="scroll-mt-24">
          <SubmitPaymentForm />
        </div>
      )}
    </div>
  )
}

/**
 * Build the monthly-eligibility dataset for the selected year.
 *
 *   • Bottom segment (carryIn) = LIFETIME cumulative NET eligibility
 *     (earned − donated − bad debts) across all EOM rows whose `period_end`
 *     falls BEFORE this month. So January's carry is the lifetime net total
 *     through end of the prior year, February's carry adds January's net
 *     slice to that, etc. — no reset at year boundaries.
 *   • Top segment (earned) = this month's `amount_earned` (fresh accrual).
 *
 * For the current calendar year we stop at the current IST month so we
 * don't show empty future bars; past years still render Jan..Dec.
 *
 * Note: carryIn is signed (NOT clamped). If donations + bad debts exceed
 * earned eligibility, the orange segment renders below the X-axis. That
 * matches the Total Eligibility KPI tile, which is also signed.
 */
function buildEligibilityMonthlyData(
  rowsByMonth: Map<number, { earned: number; donated: number; badDebts: number }>,
  ledger: DashboardEligibilityRow[],
  year: number,
  currentYear: number,
  currentMonthIdx: number,
): { month: string; carryIn: number; earned: number }[] {
  // Lifetime cumulative NET (earned − donated − bad debts) across all EOM
  // rows BEFORE Jan of `year`.
  let runningCarry = 0
  for (const row of ledger) {
    const d = new Date(row.period_end)
    if (d.getUTCFullYear() < year) {
      runningCarry += Number(row.amount_earned)
                    - Number(row.donations_in_period)
                    - Number(row.bad_debts_in_period)
    }
  }

  // For the current calendar year, real data only exists through the
  // current IST month. Future months still get an X-axis label, but with
  // zero-height bars (carryIn = 0, earned = 0) so the chart keeps a
  // consistent 12-month width across years.
  const lastDataMonth = year === currentYear ? currentMonthIdx : MONTH_LABELS.length - 1

  const out: { month: string; carryIn: number; earned: number }[] = []
  for (let idx = 0; idx <= 11; idx++) {
    if (idx > lastDataMonth) {
      // Future month in the current (or a future) year — zero-height placeholder.
      out.push({ month: MONTH_LABELS[idx], carryIn: 0, earned: 0 })
      continue
    }
    const slot = rowsByMonth.get(idx)
    const earned = slot?.earned ?? 0
    const donated = slot?.donated ?? 0
    const badDebts = slot?.badDebts ?? 0
    // Push the bar BEFORE updating runningCarry — carryIn represents the
    // value going INTO this month (lifetime net through end of prior month).
    out.push({
      month: MONTH_LABELS[idx],
      carryIn: runningCarry,
      earned,
    })
    // Roll lifetime carry forward by this month's net slice.
    runningCarry += earned - donated - badDebts
  }
  return out
}

function toTxnRow(t: DashboardTxn): TxnRow {
  return {
    id: t.id,
    transaction_id: t.transaction_id,
    amount: t.amount,
    transaction_type: t.transaction_type,
    interest_source: (t.interest_source ?? null) as TxnRow['interest_source'],
    transaction_date: t.transaction_date,
    description: t.description,
    member_name: t.member_name ?? null,
    bank_transaction_id: t.bank_transaction_id ?? null,
  }
}

function YearTotalsStrip({
  year,
  contributions,
  loanInterest,
  bankInterest,
  total,
}: {
  year: number
  contributions: number
  loanInterest: number
  bankInterest: number
  total: number
}) {
  const items = [
    { name: 'Contributions', value: contributions, color: DASHBOARD_BAR_COLORS.contributions },
    { name: 'Loan interest', value: loanInterest,  color: DASHBOARD_BAR_COLORS.loanInterest },
    { name: 'Bank interest', value: bankInterest,  color: DASHBOARD_BAR_COLORS.bankInterest },
  ]
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md bg-gray-50/70 px-3 py-2 text-xs">
      <span className="font-medium uppercase tracking-wider text-gray-400">
        {year} totals
      </span>
      {items.map((s) => {
        const pct = total > 0 ? (s.value / total) * 100 : 0
        return (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-gray-500">{s.name}</span>
            <span className="font-semibold tabular-nums text-gray-900">
              {formatRupees(s.value)}
            </span>
            {total > 0 && (
              <span className="text-[10px] tabular-nums text-gray-400">
                ({pct.toFixed(1)}%)
              </span>
            )}
          </span>
        )
      })}
      <span className="ml-auto inline-flex items-center gap-1.5">
        <span className="text-gray-500">Total</span>
        <span className="font-semibold tabular-nums text-gray-900">{formatRupees(total)}</span>
      </span>
    </div>
  )
}

function MemberTotalsTable({ rows }: { rows: DashboardMemberTotal[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
          <tr>
            <th className="w-10 px-3 py-2 text-right">#</th>
            <th className="px-3 py-2">Member</th>
            <th className="px-3 py-2 text-right">Contributions</th>
            <th className="px-3 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white text-sm">
          {rows.map((r, i) => (
            <tr key={r.member_name} className="hover:bg-gray-50">
              <td className="px-3 py-2 text-right tabular-nums text-gray-500">{i + 1}</td>
              <td className="px-3 py-2 text-gray-900">{r.member_name}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.count}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">
                {formatRupees(r.total)}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-500">
                No contributions yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/** One yearly row aggregated from the per-EOM ledger view. */
type EligibilityYearRow = {
  year: number
  /** Sum of `contributions_basis` across all EOM rows in the year. */
  contributions: number
  /** Sum of `amount_earned` in the year. 0 when threshold never met. */
  amountEarned: number
  /** Sum of `donations_in_period` in the year. */
  donations: number
  /** Sum of `bad_debts_in_period` in the year. */
  badDebts: number
  /** Eligibility carried INTO this year — i.e. the previous year-end's
   *  `carry_balance`. 0 for the very first year. */
  carryIn: number
  /** carry_balance from the LATEST EOM row in this year — i.e. carry-out. */
  carryOut: number
  /** From the latest EOM in this year. True once the corpus reached the
   *  configured threshold by that period. */
  thresholdMet: boolean
  /** Threshold + pct in effect for the latest EOM in this year. */
  thresholdUsed: number
  pctUsed: number
  /** Corpus at the latest EOM in this year. */
  corpus: number
  /** True iff this row represents the current calendar year — it's
   *  naturally pro-rata since only EOM rows up to today exist. */
  isCurrentYear: boolean
}

/**
 * Group the per-EOM ledger (ordered newest-first) by year. The ledger is
 * sourced from `donation_eligibility_ledger` (migration 012); `carry_balance`
 * is a running net across all periods.
 *
 *   - Per-year earned / donations / bad debts → sum of monthly slices.
 *   - Year-end carry  → carry_balance of the latest EOM in the year.
 *   - Year-start carry → previous year's year-end carry (or 0 for the first).
 */
function aggregateEligibilityByYear(
  ledger: DashboardEligibilityRow[],
  thisYear: number,
): EligibilityYearRow[] {
  const byYear = new Map<number, DashboardEligibilityRow[]>()
  for (const row of ledger) {
    const y = new Date(row.period_end).getUTCFullYear()
    if (!Number.isFinite(y)) continue
    const list = byYear.get(y) ?? []
    list.push(row)
    byYear.set(y, list)
  }
  // Sort each year's rows oldest-first so [0] is January EOM, [last] is the
  // latest EOM (Dec for closed years, current month for the active year).
  for (const rows of byYear.values()) {
    rows.sort((a, b) => a.period_end.localeCompare(b.period_end))
  }
  const years = Array.from(byYear.keys()).sort((a, b) => a - b)
  let prevCarry = 0
  const yearRows: EligibilityYearRow[] = []
  for (const year of years) {
    const rows = byYear.get(year)!
    const last = rows[rows.length - 1]
    const carryOut = last.carry_balance
    yearRows.push({
      year,
      contributions: rows.reduce((s, r) => s + r.contributions_basis, 0),
      amountEarned: rows.reduce((s, r) => s + r.amount_earned, 0),
      donations: rows.reduce((s, r) => s + r.donations_in_period, 0),
      badDebts: rows.reduce((s, r) => s + r.bad_debts_in_period, 0),
      carryIn: prevCarry,
      carryOut,
      thresholdMet: last.threshold_met,
      thresholdUsed: last.threshold_used,
      pctUsed: last.pct_used,
      corpus: last.corpus_at_period_end,
      isCurrentYear: year === thisYear,
    })
    prevCarry = carryOut
  }
  // Render newest-year first to match the existing UX (latest year up top).
  return yearRows.sort((a, b) => b.year - a.year)
}

function DonationEligibilityHeader({
  summary,
  years,
  thisYear,
}: {
  summary: DashboardEligibilitySummary
  years: EligibilityYearRow[]
  thisYear: number
}) {
  // `years` is sorted newest-first; the first row may not necessarily be the
  // current year (e.g. a brand new year with no contributions yet has no EOM
  // rows in the ledger yet).
  const currentRow = years.find((r) => r.isCurrentYear) ?? null
  const latestRow = years[0] ?? null
  // Latest reference snapshot — threshold/pct as of the latest EOM, falling
  // back to the current-year row when available.
  const headerRow = currentRow ?? latestRow
  const threshold = headerRow?.thresholdUsed ?? 0
  const pctOfYear = headerRow?.pctUsed ?? 0
  const corpus = latestRow?.corpus ?? 0
  const corpusReached = latestRow?.thresholdMet ?? false
  const remainingToThreshold = Math.max(threshold - corpus, 0)
  const availableNow = summary.availableNow
  const currentYearEligibility = currentRow?.amountEarned ?? 0
  const currentYearDonations = currentRow?.donations ?? 0
  const currentYearContributions = currentRow?.contributions ?? 0
  const currentYearCeiling = (currentRow?.carryIn ?? 0) + currentYearEligibility

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">Donation eligibility</h2>
        <ul className="mt-2 space-y-1 text-xs text-gray-500">
          <li>
            <span className="mr-1 text-gray-400">•</span>
            <span className="font-medium text-gray-700">Annual cap</span> ·{' '}
            <span className="font-medium text-gray-700">{pctOfYear}%</span> of that year&apos;s
            contributions.
          </li>
          <li>
            <span className="mr-1 text-gray-400">•</span>
            <span className="font-medium text-gray-700">Corpus threshold</span> ·{' '}
            corpus (contributions − donations − bad debts) must reach{' '}
            <span className="font-medium text-gray-700">{formatRupees(threshold)}</span> before
            eligibility unlocks.
          </li>
          <li>
            <span className="mr-1 text-gray-400">•</span>
            <span className="font-medium text-gray-700">Carry-forward</span> ·{' '}
            unspent eligibility rolls into the next year.
          </li>
        </ul>

        <Admonition kind="note" title="Note" className="mt-3">
          Eligibility depends purely on a year&apos;s total contributions, once the minimum
          corpus is met.
        </Admonition>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
        <Stat
          label="Available now"
          value={formatRupees(Math.max(availableNow, 0))}
          hint={
            availableNow < 0
              ? `over-donated by ${formatRupees(-availableNow)}`
              : corpusReached
              ? 'after carry-forward'
              : 'corpus below threshold'
          }
          tone={availableNow < 0 ? 'rose' : 'blue'}
        />
        <Stat
          label={`Eligible this year (${currentRow?.year ?? thisYear})`}
          value={formatRupees(currentYearEligibility)}
          hint={
            corpusReached
              ? `pro-rata: ${pctOfYear}% × ${formatRupees(currentYearContributions)} contributions so far`
              : 'no eligibility until corpus is funded'
          }
          tone="indigo"
        />
        <Stat
          label="Donated this year"
          value={formatRupees(currentYearDonations)}
          hint={
            currentRow && currentRow.donations > currentYearCeiling
              ? 'exceeds this year’s ceiling'
              : 'against this year’s ceiling'
          }
          tone="emerald"
        />
        <Stat
          label="Corpus so far"
          value={formatRupees(corpus)}
          hint={corpusReached ? 'threshold reached' : `need ${formatRupees(remainingToThreshold)} more`}
          tone="gray"
        />
        {(() => {
          const totalEligibility =
            summary.totalEarned - summary.totalDonated - summary.totalBadDebt
          return (
            <Stat
              label="Total eligibility"
              value={formatRupees(totalEligibility)}
              hint="earned − donated − bad debts"
              tone={totalEligibility < 0 ? 'rose' : 'amber'}
            />
          )
        })()}
        <Stat
          label="Total donations"
          value={formatRupees(summary.totalDonated)}
          hint="lifetime paid out"
          tone="gray"
        />
        <Stat
          label="Total bad debts"
          value={formatRupees(summary.totalBadDebt)}
          hint="lifetime written off"
          tone="gray"
        />
      </div>
    </div>
  )
}

function DonationEligibilityLedger({ years }: { years: EligibilityYearRow[] }) {
  return (
    <div>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-gray-900">Yearly ledger</h2>
        <p className="text-xs text-gray-500">
          Per-year earned, donated, and carried-forward eligibility. The current year is shown
          pro-rata.
        </p>
      </div>
      <EligibilityTable rows={years} />
    </div>
  )
}

type StatTone = 'blue' | 'indigo' | 'emerald' | 'gray' | 'rose' | 'amber'
const STAT_TONES: Record<StatTone, string> = {
  blue:    'border-blue-200/70 bg-blue-50/40',
  indigo:  'border-indigo-200/70 bg-indigo-50/40',
  emerald: 'border-emerald-200/70 bg-emerald-50/40',
  gray:    'border-gray-200 bg-gray-50/40',
  rose:    'border-rose-200/70 bg-rose-50/40',
  amber:   'border-amber-200/70 bg-amber-50/40',
}

function Stat({
  label,
  value,
  hint,
  tone = 'gray',
}: {
  label: string
  value: string
  hint?: string
  tone?: StatTone
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${STAT_TONES[tone]}`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-500">{hint}</p>}
    </div>
  )
}

function EligibilityTable({ rows }: { rows: EligibilityYearRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">
        No contributions or donations recorded yet — the eligibility ledger will start once the
        first contribution lands.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          <tr>
            <th className="px-3 py-2">Year</th>
            <th className="px-3 py-2 text-right">Contributions</th>
            <th className="px-3 py-2 text-right">Eligible</th>
            <th className="px-3 py-2 text-right">Carry in</th>
            <th className="px-3 py-2 text-right">Donations</th>
            <th className="px-3 py-2 text-right">Carry out</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.map((r) => (
            <tr key={r.year} className={r.isCurrentYear ? 'bg-blue-50/40' : 'hover:bg-gray-50'}>
              <td className="px-3 py-2 font-medium text-gray-900">
                {r.year}
                {r.isCurrentYear && (
                  <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                    pro-rata
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                {formatRupees(r.contributions)}
              </td>
              <td
                className={
                  'px-3 py-2 text-right tabular-nums ' +
                  (r.thresholdMet ? 'text-gray-900' : 'text-gray-400')
                }
                title={r.thresholdMet ? undefined : 'Corpus below threshold this year'}
              >
                {r.amountEarned > 0 ? formatRupees(r.amountEarned) : '—'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                {formatRupees(r.carryIn)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                {formatRupees(r.donations)}
              </td>
              <td
                className={
                  'px-3 py-2 text-right tabular-nums font-semibold ' +
                  (r.carryOut < 0 ? 'text-rose-600' : 'text-gray-900')
                }
              >
                {formatRupees(r.carryOut)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
