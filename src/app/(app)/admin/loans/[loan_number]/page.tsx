import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatRupees } from '@/lib/format'
import { getLoanByNumber, getLoanDetail } from '@/lib/actions/loans'
import {
  getLoanInterestSchedule,
  type LoanInterestAccrual,
} from '@/lib/actions/loan-interest'
import { EditLoanForm } from './edit-loan-form'
import { CloseLoanForm } from './close-loan-form'
import { PendingInterestPanel } from './pending-interest-panel'

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

const ACCRUAL_STATUS_PILL: Record<LoanInterestAccrual['status'], string> = {
  pending:        'bg-amber-50 text-amber-700 ring-amber-200',
  partially_paid: 'bg-amber-50 text-amber-700 ring-amber-200',
  paid:           'bg-emerald-50 text-emerald-700 ring-emerald-200',
  waived:         'bg-gray-100 text-gray-600 ring-gray-200',
}

const ACCRUAL_STATUS_LABEL: Record<LoanInterestAccrual['status'], string> = {
  pending:        'Pending',
  partially_paid: 'Partial',
  paid:           'Paid',
  waived:         'Waived',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`
}

export default async function AdminLoanManagePage({
  params,
}: {
  params: Promise<{ loan_number: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const { loan_number } = await params
  const loan = await getLoanByNumber(decodeURIComponent(loan_number))
  if (!loan) notFound()
  const detail = await getLoanDetail(loan.id)
  const pendingPrincipal = detail?.financials.balance ?? 0
  const pendingInterest = detail?.financials.interestDue ?? 0
  const accruals = await getLoanInterestSchedule(loan.id)
  // Show history newest-first; the panel itself filters to unsettled rows.
  const historyAccruals = [...accruals].sort((a, b) =>
    a.period_end < b.period_end ? 1 : a.period_end > b.period_end ? -1 : 0,
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/loans" className="text-xs font-medium text-blue-600 hover:underline">
            ← All loans (admin)
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-gray-900">
            <span className="font-mono">{loan.loan_number}</span>
            <span className="ml-2 text-base text-gray-500">
              · {loan.member?.name ?? 'No member'}
            </span>
          </h1>
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
              {formatRupees(loan.principal_amount)}
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
            <p className="text-xs uppercase tracking-wider text-gray-400">Bad debt</p>
            <p className="mt-1 text-base text-gray-700 tabular-nums">
              {formatRupees(loan.bad_debt)}
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs text-gray-500">
          Open the public read-only view at{' '}
          <Link
            href={`/dashboard/loans/${encodeURIComponent(loan.loan_number)}`}
            className="text-blue-600 hover:underline"
          >
            /dashboard/loans/{loan.loan_number}
          </Link>{' '}
          to see KPIs and full transaction history.
        </p>
      </section>

      <EditLoanForm
        loanId={loan.id}
        principal={Number(loan.principal_amount)}
        startDate={loan.start_date}
        interestWaiverMonths={Number(loan.interest_waiver_months || 0)}
        notes={loan.notes}
      />

      <PendingInterestPanel loanId={loan.id} accruals={accruals} />

      <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900">Interest history</h3>
        {historyAccruals.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            No interest accruals recorded yet.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="py-2 pr-2">Period</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Due</th>
                  <th className="py-2 pr-2">Paid</th>
                  <th className="py-2 pr-2">Paid on</th>
                  <th className="py-2 pr-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {historyAccruals.map((a) => (
                  <tr key={a.id} className="border-t border-gray-100">
                    <td className="py-2 pr-2 text-gray-700">
                      {a.is_opening_balance ? 'Opening balance' : a.period_end}
                    </td>
                    <td className="py-2 pr-2">
                      <span
                        className={
                          'rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ' +
                          ACCRUAL_STATUS_PILL[a.status]
                        }
                      >
                        {ACCRUAL_STATUS_LABEL[a.status]}
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-gray-900">
                      {formatRupees(a.amount_due)}
                    </td>
                    <td className="py-2 pr-2 text-gray-700">
                      {formatRupees(a.paid_amount)}
                    </td>
                    <td className="py-2 pr-2 text-gray-700">
                      {a.paid_at ? formatDate(a.paid_at) : '—'}
                    </td>
                    <td className="py-2 pr-2 text-gray-500">
                      {a.waiver_reason ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CloseLoanForm
        loanId={loan.id}
        status={loan.status}
        pendingPrincipal={pendingPrincipal}
        pendingInterest={pendingInterest}
      />
    </div>
  )
}
