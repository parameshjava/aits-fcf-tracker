import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatRupees } from '@/lib/format'
import { getLoanByNumber, getLoanDetail } from '@/lib/actions/loans'
import { EditLoanForm } from './edit-loan-form'
import { CloseLoanForm } from './close-loan-form'

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

      <CloseLoanForm
        loanId={loan.id}
        status={loan.status}
        pendingPrincipal={pendingPrincipal}
        pendingInterest={pendingInterest}
      />
    </div>
  )
}
