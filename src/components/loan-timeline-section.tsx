import { formatRupees } from '@/lib/format'
import { accrualPeriodLabel, type LoanTimelineRow } from '@/lib/actions/loan-timeline'
import type { LoanInterestAccrual } from '@/lib/actions/loan-interest'

type Props = {
  timeline: LoanTimelineRow[]
  /** Optional total-row count shown in the header (defaults to timeline.length). */
  countOverride?: number
  /** "sm" matches the panel embedded inside expandable list rows;
   *  "md" matches the standalone detail pages with more breathing room. */
  size?: 'sm' | 'md'
}

const TYPE_LABELS: Record<string, string> = {
  contribution:   'Contribution',
  interest:       'Interest',
  loan_repayment: 'Loan repayment',
  penalty:        'Penalty',
  donation:       'Donation',
  other:          'Other',
}

const STATUS_PILL: Record<LoanInterestAccrual['status'], string> = {
  pending:        'bg-gray-50 text-gray-600 ring-gray-200',
  partially_paid: 'bg-amber-50 text-amber-700 ring-amber-200',
  paid:           'bg-emerald-50 text-emerald-700 ring-emerald-200',
  waived:         'bg-slate-50 text-slate-600 ring-slate-200',
}
const STATUS_LABEL: Record<LoanInterestAccrual['status'], string> = {
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

function accrualDescription(
  accrual: LoanInterestAccrual,
  settledByTxnIds: string[],
): string {
  if (accrual.status === 'waived') {
    const reason = accrual.waiver_reason ? ` — ${accrual.waiver_reason}` : ''
    return `Waived${reason}`
  }
  if (accrual.is_opening_balance) {
    const base = 'Carried over from pre-cutover months'
    return settledByTxnIds.length > 0
      ? `${base} · Settled via ${settledByTxnIds.join(', ')}`
      : base
  }
  const base = `${accrualPeriodLabel(accrual)} · ${formatRupees(accrual.interest_rate_used)}/L on ${formatRupees(accrual.balance_basis)} pending`
  return settledByTxnIds.length > 0
    ? `${base} · Settled via ${settledByTxnIds.join(', ')}`
    : base
}

function transactionDescription(
  description: string | null,
  settledAccrualPeriods: string[],
): string {
  const alloc =
    settledAccrualPeriods.length > 0
      ? `Allocated to ${settledAccrualPeriods.join(' + ')}`
      : ''
  if (description && alloc) return `${description} · ${alloc}`
  return description ?? alloc ?? ''
}

function transactionTypeLabel(
  type: string,
  source: string | null,
): string {
  if (type === 'interest' && source === 'loans') return 'Interest payment'
  const base = TYPE_LABELS[type] ?? type
  return type === 'interest' && source ? `${base} · ${source}` : base
}

export function LoanTimelineSection({ timeline, countOverride, size = 'sm' }: Props) {
  const count = countOverride ?? timeline.length
  const isMd = size === 'md'
  const cellY = isMd ? 'py-3' : 'py-2'
  const cellX = isMd ? 'px-4' : 'px-3'
  const headerText = isMd ? 'text-[11px]' : 'text-[10px]'
  const bodyText = isMd ? 'text-sm' : 'text-xs'

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Transactions
        </h4>
        <p className="text-[11px] text-gray-400">{count} {count === 1 ? 'entry' : 'entries'}</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className={`min-w-full ${bodyText}`}>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                <th scope="col" className={`${cellX} ${cellY} text-left ${headerText} font-semibold uppercase tracking-wider text-gray-500`}>Date</th>
                <th scope="col" className={`${cellX} ${cellY} text-left ${headerText} font-semibold uppercase tracking-wider text-gray-500`}>Type</th>
                <th scope="col" className={`${cellX} ${cellY} text-left ${headerText} font-semibold uppercase tracking-wider text-gray-500`}>Txn ID</th>
                <th scope="col" className={`${cellX} ${cellY} text-left ${headerText} font-semibold uppercase tracking-wider text-gray-500`}>Description</th>
                <th scope="col" className={`${cellX} ${cellY} text-right ${headerText} font-semibold uppercase tracking-wider text-gray-500`}>Amount</th>
                <th scope="col" className={`${cellX} ${cellY} text-left ${headerText} font-semibold uppercase tracking-wider text-gray-500`}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {timeline.length === 0 ? (
                <tr>
                  <td colSpan={6} className={`${cellX} py-5 text-center text-xs text-gray-400`}>
                    No accruals or transactions yet.
                  </td>
                </tr>
              ) : (
                timeline.map((row) => {
                  if (row.kind === 'accrual') {
                    const a = row.accrual
                    const typeLabel = a.is_opening_balance
                      ? 'Interest accrual (opening)'
                      : 'Interest accrual'
                    return (
                      <tr key={`a:${a.id}`} className="transition-colors hover:bg-gray-50">
                        <td className={`whitespace-nowrap ${cellX} ${cellY} text-gray-600`}>
                          {formatDate(a.period_end)}
                        </td>
                        <td className={`${cellX} ${cellY} text-gray-700`}>{typeLabel}</td>
                        <td className={`whitespace-nowrap ${cellX} ${cellY} text-gray-400`}>—</td>
                        <td className={`${cellX} ${cellY} text-gray-500`}>
                          {accrualDescription(a, row.settledByTxnIds)}
                        </td>
                        <td className={`whitespace-nowrap ${cellX} ${cellY} text-right font-semibold text-gray-900`}>
                          {formatRupees(a.amount_due)}
                        </td>
                        <td className={`${cellX} ${cellY}`}>
                          <span
                            className={
                              'rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ' +
                              STATUS_PILL[a.status]
                            }
                          >
                            {STATUS_LABEL[a.status]}
                          </span>
                        </td>
                      </tr>
                    )
                  }
                  const t = row.txn
                  return (
                    <tr key={`t:${t.id}`} className="transition-colors hover:bg-gray-50">
                      <td className={`whitespace-nowrap ${cellX} ${cellY} text-gray-600`}>
                        {formatDate(t.transaction_date)}
                      </td>
                      <td className={`${cellX} ${cellY} text-gray-700`}>
                        {transactionTypeLabel(t.transaction_type, t.interest_source)}
                      </td>
                      <td className={`whitespace-nowrap ${cellX} ${cellY} font-mono text-[11px] text-gray-500`}>
                        {t.transaction_id}
                      </td>
                      <td className={`${cellX} ${cellY} text-gray-500`}>
                        {transactionDescription(t.description, row.settledAccrualPeriods) || '—'}
                      </td>
                      <td className={`whitespace-nowrap ${cellX} ${cellY} text-right font-semibold text-gray-900`}>
                        {formatRupees(t.amount)}
                      </td>
                      <td className={`${cellX} ${cellY} text-gray-400`}>—</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
