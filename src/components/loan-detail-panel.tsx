import { formatRupees } from '@/lib/format'
import type { LoanDetailData } from '@/lib/actions/loans'
import { LoanTimelineSection } from '@/components/loan-timeline-section'
import { PollModal } from '@/components/poll-modal'
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

/** Label cell inside the Terms grid. */
function TermLabel({ children }: { children: React.ReactNode }) {
  return (
    <dt className="self-baseline text-[11px] font-medium uppercase tracking-wider text-gray-500">
      {children}
    </dt>
  )
}

/** Value cell inside the Terms grid. Pass `span` to widen across columns
 *  (used for the Purpose row, which is one wide cell on its own line). */
function TermValue({
  children,
  span = 1,
}: {
  children: React.ReactNode
  span?: 1 | 3
}) {
  return (
    <dd
      className={
        'self-baseline text-xs text-gray-800 ' +
        (span === 3 ? 'sm:col-span-3' : '')
      }
    >
      {children}
    </dd>
  )
}

type LedgerRow = {
  label: string
  value: number
  /** When true, the row is visually emphasised (bold, separator above). */
  emphasis?: boolean
  /** Optional tone: 'rose' for forgiven/written-off rows. */
  tone?: 'rose' | 'default'
}

function LedgerCard({ title, rows }: { title: string; rows: LedgerRow[] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-3 py-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          {title}
        </p>
      </div>
      <dl className="px-3 py-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className={
              'flex items-baseline justify-between gap-3 py-1 text-xs ' +
              (row.emphasis
                ? 'mt-1 border-t border-gray-100 pt-2 font-semibold text-gray-900'
                : 'text-gray-700')
            }
          >
            <dt
              className={
                row.tone === 'rose'
                  ? 'text-rose-700'
                  : row.emphasis
                  ? 'text-gray-900'
                  : 'text-gray-600'
              }
            >
              {row.label}
            </dt>
            <dd
              className={
                'tabular-nums ' +
                (row.tone === 'rose'
                  ? 'text-rose-700'
                  : row.emphasis
                  ? 'text-gray-900'
                  : 'text-gray-800')
              }
            >
              {formatRupees(row.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function LoanDetailPanel({ data, todayIso }: { data: LoanDetailData; todayIso?: string }) {
  const { loan, interestPerLakh, financials } = data
  const isEmi = loan.repayment_model === 'emi'
  const {
    principal,
    paidPrincipal,
    balance,
    paidInterestTotal,
    interestDue,
    months,
    isClosed,
    interestWaiverMonths,
    interestStartDate,
    isWithinWaiver,
  } = financials

  const badDebt = Number(loan.bad_debt || 0)
  const interestWaivedAtClose = Number(loan.interest_waived || 0)
  const isWriteOff = loan.status === 'write_off'
  // Conservation: every rupee of interest the loan ever owed.
  const interestAccrued = paidInterestTotal + interestDue + interestWaivedAtClose

  const principalRows: LedgerRow[] = [
    { label: 'Original',     value: principal },
    { label: 'Repaid',       value: paidPrincipal },
    ...(isWriteOff
      ? [{ label: 'Written off', value: badDebt, tone: 'rose' as const }]
      : []),
    { label: 'Outstanding',  value: balance, emphasis: true },
  ]

  const interestRows: LedgerRow[] = [
    { label: 'Accrued',      value: interestAccrued },
    { label: 'Paid',         value: paidInterestTotal },
    ...(isWriteOff
      ? [{ label: 'Waived', value: interestWaivedAtClose, tone: 'rose' as const }]
      : []),
    { label: 'Outstanding',  value: isClosed ? 0 : interestDue, emphasis: true },
  ]

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
          <span className="font-mono">{loan.loan_number}</span>
          <span className="text-xs font-normal text-gray-500">
            · {loan.member?.name ?? 'No member'}
          </span>
          <span
            className={
              'rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ' +
              (TYPE_PILL[loan.loan_type] ?? TYPE_PILL.personal)
            }
          >
            {TYPE_LABEL[loan.loan_type] ?? loan.loan_type}
          </span>
          {loan.poll ? (
            <PollModal
              pollId={loan.poll.id}
              pollQuestion={loan.poll.question}
            />
          ) : null}
        </h3>
        <span
          className={
            'rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ' +
            (STATUS_PILL[loan.status] ?? STATUS_PILL.active)
          }
        >
          {STATUS_LABEL[loan.status] ?? loan.status}
        </span>
      </div>

      {/* Terms — 2 columns of (label, value) on ≥ sm, single column on
          mobile. Purpose, when present, takes its own full-width row at
          the bottom regardless of status. */}
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 rounded-lg border border-gray-200 bg-gray-50/40 px-3 py-2.5 sm:grid-cols-[7rem_1fr_7rem_1fr]">
        <TermLabel>Principal</TermLabel>
        <TermValue>{formatRupees(principal)}</TermValue>

        <TermLabel>Interest rate</TermLabel>
        <TermValue>
          {isEmi
            ? `${Number(loan.interest_rate_pct ?? 0).toLocaleString('en-IN')}% per annum · EMI`
            : `₹${interestPerLakh.toLocaleString('en-IN')} per ₹1L · per month`}
        </TermValue>

        <TermLabel>Period</TermLabel>
        <TermValue>
          {formatDate(loan.start_date)}{' → '}
          {isClosed ? formatDate(loan.end_date) : 'ongoing'}
          <span className="ml-1 text-gray-500">
            ({months} {months === 1 ? 'month' : 'months'}
            {!isClosed ? ' elapsed' : ''})
          </span>
        </TermValue>

        <TermLabel>Waiver</TermLabel>
        <TermValue>
          {interestWaiverMonths > 0 ? (
            <>
              {interestWaiverMonths}{' '}
              {interestWaiverMonths === 1 ? 'month' : 'months'} interest-free
              {!isClosed && isWithinWaiver && (
                <span className="ml-1 text-gray-500">
                  · accrual begins {formatDate(interestStartDate.toISOString())}
                </span>
              )}
            </>
          ) : (
            <span className="text-gray-500">None</span>
          )}
        </TermValue>

        {/* Purpose row: always shown when a note is set, regardless of
            loan status. The value cell spans the remaining 3 columns on
            wide layouts so long sentences don't wrap awkwardly.
            The linked approval poll is surfaced inline in the header
            (next to the type pill), not here. */}
        {loan.notes ? (
          <>
            <TermLabel>Purpose</TermLabel>
            <TermValue span={3}>{loan.notes}</TermValue>
          </>
        ) : null}
      </dl>

      {/* Status callouts (active in waiver only — close-state info is
          already conveyed by the ledger rows). */}
      {!isClosed && isWithinWaiver && (
        <div className="rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2 text-xs text-blue-900">
          <span className="font-medium">◆ Interest waiver active</span>
          <span className="ml-1 text-blue-800">
            — no interest accrues until {formatDate(interestStartDate.toISOString())}.
          </span>
        </div>
      )}

      {isEmi ? (
        /* EMI loans: show the installment schedule (read-only) instead of the
           accrual-based ledgers, which don't apply to the EMI model. */
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
          schedule={data.emiSchedule}
          todayIso={todayIso}
        />
      ) : (
        <>
          {/* Two-ledger view */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LedgerCard title="Principal" rows={principalRows} />
            <LedgerCard title="Interest" rows={interestRows} />
          </div>

          <LoanTimelineSection timeline={data.timeline} size="sm" />
        </>
      )}
    </div>
  )
}
