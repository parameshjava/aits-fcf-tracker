import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatRupees } from '@/lib/format'
import { KpiTile } from '@/components/kpi-tile'
import { getLoanByNumber, getLoanDetail } from '@/lib/actions/loans'
import { getEmiSchedule } from '@/lib/actions/emi'
import { LoanTimelineSection } from '@/components/loan-timeline-section'
import { EmiSchedulePanel } from '@/app/(app)/admin/loans/[loan_number]/emi-schedule-panel'

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
  const detail = await getLoanDetail(loan.id)
  if (!detail) notFound()

  const isEmi = loan.repayment_model === 'emi'
  const emiSchedule = isEmi ? await getEmiSchedule(loan.id) : []
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  const { financials: f, interestPerLakh, timeline } = detail
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
          <h1 className="mt-1 text-lg font-semibold text-gray-900">
            <span className="font-mono">{loan.loan_number}</span>{' '}
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

      {isEmi && (
        <EmiSchedulePanel
          readOnly
          loan={{
            id: loan.id,
            member_id: loan.member_id,
            loan_number: loan.loan_number,
            emi_amount: loan.emi_amount,
            term_months: loan.term_months,
            interest_rate_pct: loan.interest_rate_pct,
          }}
          schedule={emiSchedule}
          todayIso={todayIso}
        />
      )}

      <section>
        <LoanTimelineSection timeline={timeline} size="md" />
      </section>
    </div>
  )
}
