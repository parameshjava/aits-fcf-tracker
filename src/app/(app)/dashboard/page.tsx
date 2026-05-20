import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getTransactions } from '@/lib/actions/transactions'
import { getReferenceRow } from '@/lib/actions/reference'
import { formatRupees } from '@/lib/format'
import { KpiTile } from '@/components/kpi-tile'
import { DashboardBars, MemberContributionBars } from '@/components/charts/dashboard-bars'
import { TransactionsTable, type TxnRow } from '@/components/transactions-table'
import { YearPicker } from '@/components/year-picker'
import {
  dashboardMonthlySeries,
  listYears,
  memberContributionTotals,
  sumWhere,
  type MemberTotal,
  type RawTxn,
} from '@/lib/aggregate'
import { SubmitPaymentForm } from './submit-payment-form'
import { BankAccountsSection } from './bank-accounts-section'
import { DashboardTabs } from './dashboard-tabs'

type SeriesKey = 'contributions' | 'loanInterest' | 'bankInterest'

const SERIES_LABELS: Record<SeriesKey, string> = {
  contributions: 'Contributions',
  loanInterest: 'Loan interest',
  bankInterest: 'Bank interest',
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function matchesSeries(t: RawTxn, key: SeriesKey): boolean {
  if (key === 'contributions') return t.contribution_type === 'contribution'
  if (key === 'loanInterest')  return t.contribution_type === 'interest' && t.interest_source !== 'bank'
  if (key === 'bankInterest')  return t.contribution_type === 'interest' && t.interest_source === 'bank'
  return false
}

type TabKey = 'inflow' | 'members'

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
  const tab: TabKey = tabParam === 'members' ? 'members' : 'inflow'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const raw = (await getTransactions()) ?? []
  const txns = raw as RawTxn[]
  const bankBalanceRow = await getReferenceRow('bank_balance')
  const years = listYears(txns)
  const year = Number(yearParam) || years[0] || new Date().getUTCFullYear()

  const totalContributions = sumWhere(txns, (t) => t.contribution_type === 'contribution')
  const totalLoanInterest = sumWhere(
    txns,
    (t) => t.contribution_type === 'interest' && t.interest_source !== 'bank',
  )
  const totalBankInterest = sumWhere(
    txns,
    (t) => t.contribution_type === 'interest' && t.interest_source === 'bank',
  )
  const totalLoanRepayment = sumWhere(txns, (t) => t.contribution_type === 'loan_repayment')
  const totalPenalty = sumWhere(txns, (t) => t.contribution_type === 'penalty')
  const totalDonations = sumWhere(txns, (t) => t.contribution_type === 'donation')
  const balance =
    totalContributions + totalLoanInterest + totalBankInterest + totalLoanRepayment + totalPenalty -
    totalDonations

  const monthly = dashboardMonthlySeries(txns, year)
  const memberTotals = memberContributionTotals(txns)

  // Drilldown: if the user clicked a bar, ?month=YYYY-MM&series=X is set.
  // Filter the recent-activity table to that month + series, show everything
  // that matches (not just 10), and replace the heading with context.
  const validMonth = typeof monthParam === 'string' && /^\d{4}-\d{2}$/.test(monthParam)
  const validSeries =
    seriesParam === 'contributions' ||
    seriesParam === 'loanInterest' ||
    seriesParam === 'bankInterest'

  let recent: TxnRow[]
  let drillHeader: { title: string; subtitle: string; clearHref: string } | null = null

  if (validMonth && validSeries) {
    const series = seriesParam as SeriesKey
    const [yStr, mStr] = (monthParam as string).split('-')
    const filtY = Number(yStr)
    const filtM = Number(mStr) - 1
    recent = (raw as TxnRow[]).filter((t) => {
      const d = new Date(t.transaction_date)
      if (d.getUTCFullYear() !== filtY || d.getUTCMonth() !== filtM) return false
      return matchesSeries(t as unknown as RawTxn, series)
    })
    const total = recent.reduce((s, r) => s + Number(r.amount || 0), 0)
    drillHeader = {
      title: `${SERIES_LABELS[series]} · ${MONTH_LABELS[filtM]} ${filtY}`,
      subtitle: `${recent.length} ${recent.length === 1 ? 'transaction' : 'transactions'} · ${formatRupees(total)}`,
      clearHref: `/dashboard?tab=inflow&year=${year}`,
    }
  } else {
    recent = (raw as TxnRow[]).slice(0, 10)
  }

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiTile
          label="Total contributions"
          value={formatRupees(totalContributions)}
          hint="All-time member contributions"
          accent="blue"
        />
        <KpiTile
          label="Loan interest"
          value={formatRupees(totalLoanInterest)}
          hint="Interest earned on loans"
          accent="indigo"
        />
        <KpiTile
          label="Bank interest"
          value={formatRupees(totalBankInterest)}
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
              <h2 className="text-base font-semibold text-gray-900">Monthly inflow</h2>
              <p className="text-xs text-gray-500">
                Contributions, loan interest, and bank interest by month.{' '}
                <span className="text-gray-400">Click any bar segment to drill in.</span>
              </p>
            </div>
            <DashboardBars data={monthly} year={year} />
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
            <MemberContributionBars data={memberTotals} />
          </div>
        }
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
                drillHeader
                  ? 'No transactions in this slice'
                  : 'No transactions yet'
              }
            />
          </div>
        }
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
        <>
          <BankAccountsSection email={user.email ?? null} />
          <div id="submit-payment" className="scroll-mt-24">
            <SubmitPaymentForm />
          </div>
        </>
      )}
    </div>
  )
}

function MemberTotalsTable({ rows }: { rows: MemberTotal[] }) {
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
            <tr key={r.member} className="hover:bg-gray-50">
              <td className="px-3 py-2 text-right tabular-nums text-gray-500">{i + 1}</td>
              <td className="px-3 py-2 text-gray-900">{r.member}</td>
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
