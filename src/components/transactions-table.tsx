'use client'

import { useCallback } from 'react'
import { formatRupees } from '@/lib/format'
import { PollModal } from '@/components/poll-modal'
import { TableExportMenu } from '@/components/table-export'
import type { Cell, ExportCriterion } from '@/lib/table-export'
import {
  SortableHeader,
  TableSearch,
  useSortable,
  useTableFilter,
} from '@/components/table-controls'

export type TxnRow = {
  id: string
  transaction_id: string
  amount: number | string
  transaction_type: string
  interest_source?: 'loans' | 'bank' | null
  transaction_date: string
  description?: string | null
  member_name?: string | null
  /** Bank's own transaction reference (UPI/NEFT UTR/cheque no). Distinct from
   *  the app's auto-generated `transaction_id`. */
  bank_transaction_id?: string | null
  /** Optional donation-only fields. Surface beneficiary text + linked
   *  approval poll on the donations section table. */
  beneficiary_name?: string | null
  poll?: { id: string; question: string } | null
  /** Optional per-row manage link. When ANY row supplies one, the table
   *  renders an Actions column. Set on the server (strings are serializable;
   *  callbacks would violate the server→client boundary). */
  manage_href?: string | null
}

type SortKey = 'date' | 'member' | 'txn_id' | 'description' | 'amount'

const TYPE_META: Record<string, { label: string; bg: string; emoji: string }> = {
  contribution:   { label: 'Contribution',   bg: 'bg-blue-50',   emoji: '💰' },
  interest:       { label: 'Interest',       bg: 'bg-indigo-50', emoji: '📈' },
  loan_repayment: { label: 'Loan repayment', bg: 'bg-violet-50', emoji: '🤝' },
  penalty:        { label: 'Penalty',        bg: 'bg-amber-50',  emoji: '⚠️' },
  donation:       { label: 'Donation',       bg: 'bg-rose-50',   emoji: '❤️' },
  other:          { label: 'Other',          bg: 'bg-gray-100',  emoji: '📦' },
}

function typeLabel(t: TxnRow): string {
  const meta = TYPE_META[t.transaction_type]
  const base = meta?.label ?? t.transaction_type.replace(/_/g, ' ')
  if (t.transaction_type === 'interest' && t.interest_source) {
    return `${base} · ${t.interest_source}`
  }
  return base
}

export function TransactionsTable({
  rows,
  showType = true,
  emptyLabel = 'No transactions yet',
  enableSearch = true,
  memberColumnLabel = 'Member',
  showDonationColumns = false,
  exportName = 'transactions',
  exportTitle = 'Transactions',
  exportCriteria = [],
}: {
  rows: TxnRow[]
  showType?: boolean
  emptyLabel?: string
  enableSearch?: boolean
  /** Base file name for the CSV/PDF export (without extension). */
  exportName?: string
  /** Heading rendered at the top of the exported PDF. */
  exportTitle?: string
  /** Page-level filters (e.g. date range) recorded atop the export. The live
   *  table search query is appended automatically. */
  exportCriteria?: ExportCriterion[]
  /** Header label for the column rendering `member_name`. Defaults to
   *  "Member"; the Donations section overrides it to "Referred by" since
   *  the joined member there is the referring fund member, not the
   *  recipient (which lives in `beneficiary_name`). */
  memberColumnLabel?: string
  /** When true, render two extra columns after the member column:
   *  "Beneficiary" (from `beneficiary_name`) and "Poll" (from `poll`).
   *  Used by the /dashboard/donations section view. */
  showDonationColumns?: boolean
}) {
  const showActions = rows.some((r) => !!r.manage_href)
  const stringify = useCallback(
    (t: TxnRow) =>
      [
        t.member_name ?? '',
        t.beneficiary_name ?? '',
        t.poll?.question ?? '',
        t.description ?? '',
        t.transaction_id,
        t.bank_transaction_id ?? '',
        typeLabel(t),
        new Date(t.transaction_date).toLocaleDateString('en-IN'),
        String(t.amount),
      ].join(' '),
    [],
  )

  const { filtered, query, setQuery } = useTableFilter(rows, stringify)

  const accessor = useCallback((t: TxnRow, col: SortKey) => {
    if (col === 'date') return new Date(t.transaction_date).getTime()
    if (col === 'member') return t.member_name ?? ''
    if (col === 'txn_id') return t.transaction_id
    if (col === 'description') return t.description ?? ''
    if (col === 'amount') return Number(t.amount) || 0
    return ''
  }, [])

  const { sorted, sort, toggleSort } = useSortable<TxnRow, SortKey>(
    filtered,
    accessor,
  )

  // Export reflects exactly what's on screen (current sort + search filter).
  const exportColumns = [
    'Date',
    memberColumnLabel,
    'Type',
    ...(showDonationColumns ? ['Beneficiary', 'Poll'] : []),
    'Amount (₹)',
    'Transaction ID',
    'Bank reference',
    'Description',
  ]
  const exportRows: Cell[][] = sorted.map((t) => [
    new Date(t.transaction_date).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    }),
    t.member_name ?? '',
    typeLabel(t),
    ...(showDonationColumns ? [t.beneficiary_name ?? '', t.poll?.question ?? ''] : []),
    Number(t.amount) || 0,
    t.transaction_id,
    t.bank_transaction_id ?? '',
    t.description ?? '',
  ])
  const amountIdx = exportColumns.indexOf('Amount (₹)')
  const exportFooter: Cell[] = exportColumns.map((_, i) =>
    i === 0 ? 'Total' : i === amountIdx ? sorted.reduce((s, r) => s + (Number(r.amount) || 0), 0) : '',
  )
  const allCriteria: ExportCriterion[] = [
    ...exportCriteria,
    ...(query.trim() ? [{ label: 'Search', value: query.trim() }] : []),
  ]

  return (
    <div className="overflow-clip rounded-2xl border border-gray-200 bg-white">
      {rows.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50/30 px-3 py-2">
          {enableSearch ? (
            <TableSearch
              value={query}
              onChange={setQuery}
              placeholder={`Search by ${memberColumnLabel.toLowerCase()}, description, ID…`}
              matched={filtered.length}
              total={rows.length}
            />
          ) : (
            <span />
          )}
          <TableExportMenu
            filename={exportName}
            title={exportTitle}
            columns={exportColumns}
            rows={exportRows}
            footer={exportFooter}
            criteria={allCriteria}
          />
        </div>
      )}

      {/* lg:overflow-x-visible drops the local scroll context at desktop
          widths so the .sticky-thead rule pins headers against the
          viewport (under the TopBar) instead of against this wrapper.
          At <lg the wrapper keeps overflow-x:auto so wide tables can
          still scroll horizontally on narrow viewports. */}
      <div className="overflow-x-auto lg:overflow-x-visible">
        <table className="sticky-thead min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <th scope="col" className="w-[40px] px-3 py-2.5"></th>
              <SortableHeader
                col="date"
                label="Date"
                sort={sort}
                onToggle={toggleSort}
                compact
              />
              <SortableHeader
                col="member"
                label={memberColumnLabel}
                sort={sort}
                onToggle={toggleSort}
                compact
              />
              {showDonationColumns && (
                <>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                  >
                    Beneficiary
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                  >
                    Poll
                  </th>
                </>
              )}
              <SortableHeader
                col="amount"
                label="Amount"
                align="right"
                sort={sort}
                onToggle={toggleSort}
                compact
              />
              <SortableHeader
                col="txn_id"
                label="Transaction ID"
                sort={sort}
                onToggle={toggleSort}
                compact
              />
              <SortableHeader
                col="description"
                label="Description"
                sort={sort}
                onToggle={toggleSort}
                compact
              />
              {showActions && (
                <th scope="col" className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={6 + (showActions ? 1 : 0) + (showDonationColumns ? 2 : 0)}
                  className="px-4 py-12 text-center text-sm text-gray-400"
                >
                  {query ? `No matches for "${query}"` : emptyLabel}
                </td>
              </tr>
            ) : (
              sorted.map((t) => {
                const meta = TYPE_META[t.transaction_type] ?? TYPE_META.other
                return (
                  <tr key={t.id} className="transition-colors hover:bg-gray-50">
                    <td className="w-[40px] py-2 pl-3 pr-0">
                      <span
                        className={
                          'grid h-7 w-7 place-items-center rounded-full text-sm ' + meta.bg
                        }
                        aria-hidden="true"
                      >
                        {meta.emoji}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">
                      {new Date(t.transaction_date).toLocaleDateString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                      })}
                    </td>
                    <td className="px-3 py-1.5 align-middle">
                      <div className="text-sm font-medium text-gray-900">
                        {t.member_name ?? <span className="text-gray-400">—</span>}
                      </div>
                      {showType && (
                        <div className="text-xs text-gray-500">{typeLabel(t)}</div>
                      )}
                    </td>
                    {showDonationColumns && (
                      <>
                        <td className="px-3 py-1.5 align-middle text-sm text-gray-700">
                          {t.beneficiary_name || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-1.5 align-middle text-sm">
                          {t.poll ? (
                            <PollModal
                              pollId={t.poll.id}
                              pollQuestion={t.poll.question}
                              variant="icon"
                            />
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      </>
                    )}
                    <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums text-gray-900">
                      {formatRupees(t.amount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-500">
                      <div>{t.transaction_id}</div>
                      {t.bank_transaction_id && (
                        <div className="text-[11px] text-gray-400" title="Bank reference">
                          {t.bank_transaction_id}
                        </div>
                      )}
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-1.5 text-gray-600">
                      {t.description || <span className="text-gray-300">—</span>}
                    </td>
                    {showActions && (
                      <td className="whitespace-nowrap px-3 py-1.5 text-right">
                        {t.manage_href ? (
                          <a
                            href={t.manage_href}
                            className="text-xs font-medium text-blue-600 hover:underline"
                          >
                            Manage →
                          </a>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {sorted.length > 0 && (
        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50/30 px-5 py-3 text-xs text-gray-500">
          <span>
            Showing <span className="font-medium text-gray-900">{sorted.length}</span>{' '}
            {sorted.length === 1 ? 'transaction' : 'transactions'}
            {query && rows.length !== sorted.length && (
              <span className="text-gray-400"> · filtered from {rows.length}</span>
            )}
          </span>
          <span className="font-medium text-gray-400">
            Total{' '}
            <span className="ml-1 tabular-nums text-gray-900">
              {formatRupees(sorted.reduce((s, r) => s + Number(r.amount || 0), 0))}
            </span>
          </span>
        </div>
      )}
    </div>
  )
}
