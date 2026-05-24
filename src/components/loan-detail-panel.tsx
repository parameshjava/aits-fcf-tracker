import { formatRupees } from '@/lib/format'
import type { LoanDetailData } from '@/lib/actions/loans'

type StatTone = 'blue' | 'gray' | 'indigo' | 'emerald'
const STAT_TONE: Record<StatTone, string> = {
  blue:    'border-blue-200/70 bg-blue-50/40',
  gray:    'border-gray-200 bg-gray-50/40',
  indigo:  'border-indigo-200/70 bg-indigo-50/40',
  emerald: 'border-emerald-200/70 bg-emerald-50/40',
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
    <div className={`rounded-lg border px-3 py-2 ${STAT_TONE[tone]}`}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
        {label}
      </p>
      <p className="mt-0.5 text-base font-semibold tabular-nums text-gray-900">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-500">{hint}</p>}
    </div>
  )
}

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

export function LoanDetailPanel({ data }: { data: LoanDetailData }) {
  const { loan, transactions, interestPerLakh, financials } = data
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

  const metaBits = [
    `Start ${formatDate(loan.start_date)}`,
    `End ${formatDate(loan.end_date)}`,
    `${months} ${months === 1 ? 'month' : 'months'}`,
    `₹${interestPerLakh.toLocaleString('en-IN')}/L/mo on pending principal`,
  ]
  if (interestWaiverMonths > 0) {
    metaBits.push(
      `${interestWaiverMonths}-mo interest waiver → accrual from ${formatDate(interestStartDate.toISOString())}`,
    )
  }
  const badDebt = Number(loan.bad_debt || 0)
  const interestWaivedAtClose = Number(loan.interest_waived || 0)
  if (isClosed) {
    metaBits.push('closed — no further interest')
    if (loan.status === 'write_off' && (badDebt > 0 || interestWaivedAtClose > 0)) {
      const parts: string[] = []
      if (badDebt > 0) parts.push(`${formatRupees(badDebt)} principal`)
      if (interestWaivedAtClose > 0) parts.push(`${formatRupees(interestWaivedAtClose)} interest`)
      metaBits.push(`waived at closure: ${parts.join(' + ')}`)
    }
  } else if (isWithinWaiver) metaBits.push('currently in waiver window')

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          <span className="font-mono">{loan.loan_number}</span>
          <span className="ml-2 text-xs text-gray-500">
            · {loan.member?.name ?? 'No member'}
          </span>
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

      <p className="text-xs text-gray-500">
        {metaBits.join(' · ')}
        {loan.notes ? <span className="text-gray-400"> · {loan.notes}</span> : null}
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Amount Due"
          value={formatRupees(balance)}
          hint={
            Number(loan.bad_debt || 0) > 0
              ? `bad debt ${formatRupees(loan.bad_debt)}`
              : balance === 0
              ? 'fully repaid'
              : 'full or partial'
          }
          tone="blue"
        />
        <Stat
          label="Principal Paid"
          value={formatRupees(paidPrincipal)}
          hint={`of ${formatRupees(principal)}`}
          tone="gray"
        />
        <Stat
          label="Interest Paid"
          value={formatRupees(paidInterestTotal)}
          hint={undefined}
          tone="indigo"
        />
        <Stat
          label="Interest Due"
          value={isClosed || isWithinWaiver ? '—' : formatRupees(interestDue)}
          hint={
            isClosed
              ? interestWaivedAtClose > 0
                ? `${formatRupees(interestWaivedAtClose)} waived`
                : 'settled'
              : isWithinWaiver
              ? 'waiver active'
              : undefined
          }
          tone="emerald"
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Transactions
          </h4>
          <p className="text-[11px] text-gray-400">{transactions.length} entries</p>
        </div>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th scope="col" className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Date</th>
                  <th scope="col" className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Type</th>
                  <th scope="col" className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Txn ID</th>
                  <th scope="col" className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">Description</th>
                  <th scope="col" className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-5 text-center text-xs text-gray-400">
                      No transactions tagged to this loan yet.
                    </td>
                  </tr>
                ) : (
                  transactions.map((t) => {
                    const base = TYPE_LABELS[t.transaction_type] ?? t.transaction_type
                    const label =
                      t.transaction_type === 'interest' && t.interest_source
                        ? `${base} · ${t.interest_source}`
                        : base
                    return (
                      <tr key={t.id} className="transition-colors hover:bg-gray-50">
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                          {formatDate(t.transaction_date)}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{label}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-gray-500">
                          {t.transaction_id}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{t.description ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
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
      </div>
    </div>
  )
}
