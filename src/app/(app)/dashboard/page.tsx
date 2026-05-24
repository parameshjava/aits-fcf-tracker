import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getReferenceRow, getReference, getReferenceYearMap } from '@/lib/actions/reference'
import { formatRupees } from '@/lib/format'
import { KpiTile } from '@/components/kpi-tile'
import {
  DashboardBars,
  MemberContributionBars,
} from '@/components/charts/dashboard-bars'
import { TransactionsTable, type TxnRow } from '@/components/transactions-table'
import { YearPicker } from '@/components/year-picker'
import { DASHBOARD_BAR_COLORS } from '@/lib/transaction-groups'
import {
  getDashboardOverall,
  getDashboardYearly,
  getDashboardMonthly,
  getDashboardMemberTotals,
  getDashboardMemberMonthMatrix,
  getDashboardTransactions,
  type DashboardTxn,
  type DashboardMemberTotal,
  type DashboardMemberMonthRow,
} from '@/lib/actions/dashboard'
import { computeEligibility, type EligibilityRow } from '@/lib/eligibility'
import { getBadDebtsByYear } from '@/lib/actions/loans'
import { Admonition } from '@/components/ui/admonition'
import { SubmitPaymentForm } from './submit-payment-form'
import { DashboardTabs } from './dashboard-tabs'

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
  const [overall, yearly, memberTotals, bankBalanceRow] = await Promise.all([
    getDashboardOverall(),
    getDashboardYearly(),
    getDashboardMemberTotals(),
    getReferenceRow('bank_balance'),
  ])

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

  // Headline balance — same formula as before, but every input now comes
  // from the views.
  const balance =
    overall.contributions +
    overall.loan_interest +
    overall.bank_interest +
    overall.loan_repayments +
    overall.penalty -
    overall.donations

  // Donation-eligibility ledger. The two rules (corpus_threshold + annual %)
  // are read PER-YEAR from public.reference_history so historical changes
  // to the rule are honoured. Falls back to today's reference value when no
  // history row covers a given year.
  let eligibilityThreshold = 500000
  let eligibilityPct = 25
  try { eligibilityThreshold = await getReference('corpus_threshold') } catch {}
  try { eligibilityPct = await getReference('donation_eligibility_pct') } catch {}

  const eligibilityYears = yearly.map((r) => r.year)
  const fromYear = eligibilityYears.length > 0 ? Math.min(...eligibilityYears) : thisYear
  const toYear = Math.max(thisYear, ...(eligibilityYears.length ? eligibilityYears : [thisYear]))
  const [thresholdByYear, pctByYear, badDebtsByYear] = await Promise.all([
    getReferenceYearMap('corpus_threshold',         fromYear, toYear),
    getReferenceYearMap('donation_eligibility_pct', fromYear, toYear),
    getBadDebtsByYear(),
  ])

  const eligibility = computeEligibility(
    yearly.map((r) => ({
      year: r.year,
      contributions: r.contributions,
      donations: r.donations,
      badDebts: badDebtsByYear.get(r.year) ?? 0,
    })),
    {
      threshold: eligibilityThreshold,
      pctOfYear: eligibilityPct,
      resolveFor: (y) => ({
        threshold: thresholdByYear.get(y) ?? eligibilityThreshold,
        pctOfYear: pctByYear.get(y) ?? eligibilityPct,
      }),
    },
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
          label="Current balance"
          value={formatRupees(balance)}
          hint="Net of donations"
          accent="gray"
        />
        <KpiTile
          label="FCF Bank Balance"
          value={formatRupees(bankBalanceRow?.value ?? 0)}
          hint={
            bankBalanceRow?.updated_at
              ? `Updated ${new Date(bankBalanceRow.updated_at).toLocaleDateString('en-IN')}`
              : 'Not set'
          }
          accent="blue"
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
            <MemberMonthMatrix rows={memberMonthRows} />
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
        eligibilityChart={<DonationEligibilityHeader eligibility={eligibility} />}
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
        eligibilitySection={<DonationEligibilityLedger eligibility={eligibility} />}
        membersSection={
          <div>
            <div className="mb-3">
              <h2 className="text-base font-semibold text-gray-900">Member leaderboard</h2>
              <p className="text-xs text-gray-500">
                {memberTotals.length} {memberTotals.length === 1 ? 'member' : 'members'} ·{' '}
                {formatRupees(memberTotals.reduce((s, m) => s + m.total, 0))} total
              </p>
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
  }
}

function MemberMonthMatrix({ rows }: { rows: DashboardMemberMonthRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-gray-200 px-3 py-6 text-center text-xs text-gray-400">
        No contributions recorded for this year yet.
      </p>
    )
  }

  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'] as const
  const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  // Column totals (footer).
  const colTotals = months.reduce<Record<(typeof months)[number], number>>(
    (acc, k) => {
      acc[k] = rows.reduce((s, r) => s + (r[k] ?? 0), 0)
      return acc
    },
    {} as Record<(typeof months)[number], number>,
  )
  const grandTotal = rows.reduce((s, r) => s + r.total, 0)

  // top-28 = 112px clears the two-row sticky top bar (Row 1 h-16 = 64px +
  // Row 2 min-h-12 + 2×4 py = ~48px). Sticky is applied to each <th> (not
  // just <thead>) for the widest cross-browser support; each cell carries
  // its own bg so it visually covers the rows scrolling underneath.
  const stickyHead =
    'sticky top-28 z-10 bg-gray-50 shadow-[0_1px_0_0_theme(colors.gray.200)]'

  return (
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          <tr>
            <th className={`${stickyHead} px-3 py-2 text-left`}>Member</th>
            {monthLabels.map((m) => (
              <th key={m} className={`${stickyHead} px-2 py-2 text-right`}>{m}</th>
            ))}
            <th className={`${stickyHead} px-3 py-2 text-right`}>Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.map((r) => (
            <tr key={r.member_id ?? r.member_name} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">
                {r.member_name}
              </td>
              {months.map((k) => {
                const v = r[k] ?? 0
                return (
                  <td
                    key={k}
                    className={
                      'whitespace-nowrap px-2 py-2 text-right tabular-nums ' +
                      (v > 0 ? 'text-gray-700' : 'text-gray-300')
                    }
                  >
                    {v > 0 ? formatRupees(v) : '—'}
                  </td>
                )
              })}
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold text-gray-900">
                {formatRupees(r.total)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50 text-sm">
          <tr>
            <td className="px-3 py-2 font-medium text-gray-700">Total</td>
            {months.map((k) => (
              <td
                key={k}
                className="whitespace-nowrap px-2 py-2 text-right tabular-nums font-medium text-gray-900"
              >
                {colTotals[k] > 0 ? formatRupees(colTotals[k]) : '—'}
              </td>
            ))}
            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-bold text-gray-900">
              {formatRupees(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
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

function DonationEligibilityHeader({
  eligibility,
}: {
  eligibility: ReturnType<typeof computeEligibility>
}) {
  const {
    rows,
    threshold,
    pctOfYear,
    availableNow,
    currentYearEligibility,
    currentYearDonations,
  } = eligibility
  const currentRow = rows.find((r) => r.isCurrentYear)
  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null
  const corpusReached = lastRow?.thresholdMet ?? false
  // Corpus = cumulative contributions − cumulative donations − cumulative
  // bad debts (loan principal written off). See computeEligibility.
  const corpus = lastRow?.corpus ?? 0
  const remainingToThreshold = Math.max(threshold - corpus, 0)

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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          label={`Earned this year (${currentRow?.year ?? '—'})`}
          value={formatRupees(currentYearEligibility)}
          hint={
            corpusReached
              ? `pro-rata: ${pctOfYear}% × ${formatRupees(currentRow?.contributions ?? 0)} contributions so far`
              : 'no eligibility until corpus is funded'
          }
          tone="indigo"
        />
        <Stat
          label="Donated this year"
          value={formatRupees(currentYearDonations)}
          hint={
            currentRow && currentRow.donations > currentRow.carryIn + currentRow.eligibilityEarned
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
      </div>
    </div>
  )
}

function DonationEligibilityLedger({
  eligibility,
}: {
  eligibility: ReturnType<typeof computeEligibility>
}) {
  return (
    <div>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-gray-900">Yearly ledger</h2>
        <p className="text-xs text-gray-500">
          Per-year earned, donated, and carried-forward eligibility. The current year is shown
          pro-rata.
        </p>
      </div>
      <EligibilityTable rows={eligibility.rows} />
    </div>
  )
}

type StatTone = 'blue' | 'indigo' | 'emerald' | 'gray' | 'rose'
const STAT_TONES: Record<StatTone, string> = {
  blue:    'border-blue-200/70 bg-blue-50/40',
  indigo:  'border-indigo-200/70 bg-indigo-50/40',
  emerald: 'border-emerald-200/70 bg-emerald-50/40',
  gray:    'border-gray-200 bg-gray-50/40',
  rose:    'border-rose-200/70 bg-rose-50/40',
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

function EligibilityTable({ rows }: { rows: EligibilityRow[] }) {
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
                {r.thresholdMet ? formatRupees(r.eligibilityEarned) : '—'}
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
