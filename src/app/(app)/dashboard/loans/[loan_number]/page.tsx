import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatRupees } from '@/lib/format'
import { KpiTile } from '@/components/kpi-tile'
import {
  getLoanByNumber,
  getLoanTransactions,
  getInterestPerLakh,
} from '@/lib/actions/loans'
import { computeLoanFinancials } from '@/lib/loan-math'

const STATUS_PILL: Record<string, string> = {
  active:    'bg-blue-50 text-blue-700 ring-blue-200',
  paid:      'bg-emerald-50 text-emerald-700 ring-emerald-200',
  write_off: 'bg-rose-50 text-rose-700 ring-rose-200',
}
const STATUS_LABEL: Record<string, string> = {
  active:    'Active',
  paid:      'Paid',
  write_off: 'Write off',
}

const TYPE_LABELS: Record<string, string> = {
  contribution:   'Contribution',
  interest:       'Interest',
  loan_repayment: 'Loan repayment',
  penalty:        'Penalty',
  donation:       'Donation',
  other:          'Other',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`
}

export default async function LoanDetailPage({
  params,
}: {
  params: Promise<{ loan_number: string }>
}) {
  const { loan_number } = await params
  const loan = await getLoanByNumber(decodeURIComponent(loan_number))
  if (!loan) notFound()

  // This is a read-only view for every member. Admins manage loans (edit
  // fields, close, reopen) via /admin/loans/[loan_number].
  const [txns, interestPerLakh] = await Promise.all([
    getLoanTransactions(loan.id),
    getInterestPerLakh(),
  ])

  const f = computeLoanFinancials(loan, txns, interestPerLakh)
  const {
    principal,
    months,
    expectedInterest,
    paidInterestTotal,
    interestDue: pendingInterest,
    paidPrincipal,
    balance,
    isClosed,
  } = f

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/loans" className="text-xs font-medium text-blue-600 hover:underline">
            ← Back to loans
          </Link>
          <h2 className="mt-1 text-lg font-semibold text-gray-900">
            <span className="font-mono">{loan.loan_number}</span>{' '}
            <span className="ml-2 text-base text-gray-500">
              · {loan.member?.name ?? 'No member'}
            </span>
          </h2>
        </div>
        <span
          className={
            'rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ' +
            (STATUS_PILL[loan.status] ?? STATUS_PILL.active)
          }
        >
          {STATUS_LABEL[loan.status] ?? loan.status}
        </span>
      </div>

      <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">Principal</p>
            <p className="mt-1 text-base font-semibold text-gray-900 tabular-nums">
              {formatRupees(principal)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">Start</p>
            <p className="mt-1 text-base text-gray-700">{formatDate(loan.start_date)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">End</p>
            <p className="mt-1 text-base text-gray-700">{formatDate(loan.end_date)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">Months elapsed</p>
            <p className="mt-1 text-base font-medium text-gray-900">{months}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs uppercase tracking-wider text-gray-400">
              Interest rate
            </p>
            <p className="mt-1 text-sm text-gray-700">
              ₹{interestPerLakh.toLocaleString('en-IN')} per ₹1L per month, accrued on{' '}
              <span className="font-medium">pending principal</span>
              {isClosed ? ' (loan closed — no further interest)' : ''}
            </p>
          </div>
          {loan.notes && (
            <div className="sm:col-span-2">
              <p className="text-xs uppercase tracking-wider text-gray-400">Notes</p>
              <p className="mt-1 text-sm text-gray-700">{loan.notes}</p>
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          label="Pending principal"
          value={formatRupees(balance)}
          hint={
            Number(loan.bad_debt || 0) > 0
              ? `bad debt ${formatRupees(loan.bad_debt)}`
              : balance === 0
              ? 'fully repaid'
              : 'amount you can pay (full or partial)'
          }
          accent="blue"
        />
        <KpiTile
          label="Paid principal"
          value={formatRupees(paidPrincipal)}
          hint={`of ${formatRupees(principal)}`}
          accent="gray"
        />
        <KpiTile
          label="Paid interest"
          value={formatRupees(paidInterestTotal)}
          hint="tracked transactions"
          accent="indigo"
        />
        <KpiTile
          label="Pending interest"
          value={formatRupees(pendingInterest)}
          hint={
            isClosed
              ? 'loan closed — settled'
              : `expected ${formatRupees(expectedInterest)} on balance`
          }
          accent="emerald"
        />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Transaction history</h3>
          <p className="text-xs text-gray-500">{txns.length} entries</p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th scope="col" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Date</th>
                  <th scope="col" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Type</th>
                  <th scope="col" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Transaction ID</th>
                  <th scope="col" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Description</th>
                  <th scope="col" className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {txns.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400">
                      No transactions tagged to this loan yet.
                    </td>
                  </tr>
                ) : (
                  txns.map((t) => {
                    const base = TYPE_LABELS[t.transaction_type] ?? t.transaction_type
                    const label =
                      t.transaction_type === 'interest' && t.interest_source
                        ? `${base} · ${t.interest_source}`
                        : base
                    return (
                      <tr key={t.id} className="transition-colors hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                          {formatDate(t.transaction_date)}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{label}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                          {t.transaction_id}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{t.description ?? '—'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-gray-900">
                          {formatRupees(t.amount)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
