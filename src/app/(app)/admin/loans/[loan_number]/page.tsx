import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatRupees } from '@/lib/format'
import { getLoanByNumber, getLoanDetail, getPollsForLoanPicker } from '@/lib/actions/loans'
import { EditLoanForm } from './edit-loan-form'
import { LoanTimelineSection } from '@/components/loan-timeline-section'
import { CloseLoanForm } from './close-loan-form'
import { PendingInterestPanel } from './pending-interest-panel'
import { RecomputeAccrualsButton } from './recompute-accruals-button'
import { EmiSchedulePanel } from './emi-schedule-panel'
import { ConvertToEmiForm } from './convert-to-emi-form'
import { getEmiSchedule } from '@/lib/actions/emi'
import { getReference } from '@/lib/actions/reference'

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
const TYPE_PILL: Record<string, string> = {
  personal: 'bg-gray-50 text-gray-700 ring-gray-200',
  medical:  'bg-violet-50 text-violet-700 ring-violet-200',
}
const TYPE_LABEL: Record<string, string> = {
  personal: 'Personal',
  medical:  'Medical',
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
  if (!user) redirect('/')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const { loan_number } = await params
  const loan = await getLoanByNumber(decodeURIComponent(loan_number))
  if (!loan) notFound()
  const [detail, polls, schedule, cutoverYmd, maxTerm] = await Promise.all([
    getLoanDetail(loan.id),
    getPollsForLoanPicker({ excludeLoanId: loan.id }),
    getEmiSchedule(loan.id),
    getReference('emi_cutover_date').catch(() => 0),
    getReference('loan_max_term_months').then(Number).catch(() => 30),
  ])
  const pendingPrincipal = detail?.financials.balance ?? 0
  const pendingInterest = detail?.financials.interestDue ?? 0

  // emi_cutover_date is a YYYYMMDD integer; compare against today as an integer.
  const now = new Date()
  const todayYmd =
    now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate()
  const isEmi = loan.repayment_model === 'emi'
  const hasLegacyBacklog = (detail?.accruals ?? []).some(
    (a) => a.status === 'pending' || a.status === 'partially_paid',
  )
  const atOrAfterCutover = Number(cutoverYmd) > 0 && todayYmd >= Number(cutoverYmd)

  // Pay EMI is offered on every unpaid installment whose due cycle has started —
  // i.e. today (IST) is on/after the 1st of its accrual month (the month before
  // its 10th-of-following-month due date). Resolved server-side.
  const todayIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now) // YYYY-MM-DD
  const payableFromIso = (dueIso: string) => {
    const [y, m] = dueIso.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1, 1))
    d.setUTCMonth(d.getUTCMonth() - 1)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
  }
  const payableInstallmentIds = schedule
    .filter(
      (r) =>
        (r.status === 'scheduled' || r.status === 'partially_paid' || r.status === 'overdue') &&
        todayIst >= payableFromIso(r.due_date),
    )
    .map((r) => r.id)

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
        <div className="flex items-center gap-2">
          <span
            className={
              'rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ' +
              (TYPE_PILL[loan.loan_type] ?? TYPE_PILL.personal)
            }
          >
            {TYPE_LABEL[loan.loan_type] ?? loan.loan_type}
          </span>
          <span
            className={
              'rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ' +
              (STATUS_PILL[loan.status] ?? STATUS_PILL.active)
            }
          >
            {STATUS_LABEL[loan.status] ?? loan.status}
          </span>
        </div>
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
        loanType={loan.loan_type}
        interestWaiverMonths={Number(loan.interest_waiver_months || 0)}
        notes={loan.notes}
        pollId={loan.poll_id}
        polls={polls}
      />

      <div className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-600">
            Rebuild this loan&rsquo;s EOM accruals from <span className="font-mono">start_date</span> to today.
            Existing payments are preserved; amount due and status are recomputed. Run this after
            editing principal, start date, or interest waiver.
          </p>
          <RecomputeAccrualsButton loanId={loan.id} />
        </div>
      </div>

      {isEmi ? (
        <>
          <EmiSchedulePanel
            loan={{
              id: loan.id,
              member_id: loan.member_id,
              loan_number: loan.loan_number,
              emi_amount: loan.emi_amount,
              term_months: loan.term_months,
              interest_rate_pct: loan.interest_rate_pct,
            }}
            schedule={schedule}
            payableInstallmentIds={payableInstallmentIds}
            todayIso={todayIst}
          />
          {/* Converted loans may still carry a pre-cutoff accrual backlog — keep it visible. */}
          {hasLegacyBacklog && (
            <PendingInterestPanel loanId={loan.id} accruals={detail?.accruals ?? []} />
          )}
        </>
      ) : (
        <>
          {atOrAfterCutover && <ConvertToEmiForm loanId={loan.id} maxTerm={maxTerm} />}
          <PendingInterestPanel loanId={loan.id} accruals={detail?.accruals ?? []} />
        </>
      )}

      <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900">Timeline</h3>
        <div className="mt-3">
          <LoanTimelineSection timeline={detail?.timeline ?? []} size="md" />
        </div>
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
