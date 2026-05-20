'use client'

import { useCallback } from 'react'
import Link from 'next/link'
import { formatRupees } from '@/lib/format'
import {
  SortableHeader,
  TableSearch,
  useSortable,
  useTableFilter,
} from '@/components/table-controls'

export type LoansListRow = {
  id: string
  loan_number: string
  member_name: string | null
  principal_amount: number
  start_date: string
  status: 'active' | 'paid' | 'write_off'
  paid_interest: number
  interest_due: number
  balance: number
  detail_href: string
}

type SortKey =
  | 'loan_number'
  | 'member'
  | 'principal'
  | 'start'
  | 'status'
  | 'paid_interest'
  | 'interest_due'
  | 'balance'

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
const STATUS_RANK: Record<string, number> = {
  active:    0, // surface active first when sorted asc
  paid:      1,
  write_off: 2,
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`
}

export function LoansListTable({
  loans,
  linkLabel = 'View →',
  emptyMessage,
}: {
  loans: LoansListRow[]
  /** Action link text per row — "View →" (read-only) or "Manage →" (admin). */
  linkLabel?: string
  /** Custom empty-state message (JSX allowed). */
  emptyMessage?: React.ReactNode
}) {
  const stringify = useCallback(
    (l: LoansListRow) =>
      [
        l.loan_number,
        l.member_name ?? '',
        String(l.principal_amount),
        formatDate(l.start_date),
        STATUS_LABEL[l.status] ?? l.status,
      ].join(' '),
    [],
  )

  const { filtered, query, setQuery } = useTableFilter(loans, stringify)

  const accessor = useCallback((l: LoansListRow, col: SortKey) => {
    if (col === 'loan_number')    return l.loan_number
    if (col === 'member')         return l.member_name ?? ''
    if (col === 'principal')      return l.principal_amount
    if (col === 'start')          return new Date(l.start_date).getTime()
    if (col === 'status')         return STATUS_RANK[l.status] ?? 99
    if (col === 'paid_interest')  return l.paid_interest
    if (col === 'interest_due')   return l.interest_due
    if (col === 'balance')        return l.balance
    return ''
  }, [])

  const { sorted, sort, toggleSort } = useSortable<LoansListRow, SortKey>(
    filtered,
    accessor,
    { col: 'loan_number', dir: 'desc' },
  )

  const totalOutstanding = sorted.reduce((s, l) => s + l.balance, 0)

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      {loans.length > 0 && (
        <div className="border-b border-gray-200 bg-gray-50/30 px-4 py-2.5">
          <TableSearch
            value={query}
            onChange={setQuery}
            placeholder="Search by loan #, member, status…"
            matched={filtered.length}
            total={loans.length}
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <SortableHeader col="loan_number"   label="Loan #"        sort={sort} onToggle={toggleSort} />
              <SortableHeader col="member"        label="Member"        sort={sort} onToggle={toggleSort} />
              <SortableHeader col="principal"     label="Principal"     align="right" sort={sort} onToggle={toggleSort} />
              <SortableHeader col="start"         label="Start"         sort={sort} onToggle={toggleSort} />
              <SortableHeader col="status"        label="Status"        sort={sort} onToggle={toggleSort} />
              <SortableHeader col="paid_interest" label="Interest paid" align="right" sort={sort} onToggle={toggleSort} />
              <SortableHeader col="interest_due"  label="Interest due"  align="right" sort={sort} onToggle={toggleSort} />
              <SortableHeader col="balance"       label="Balance"       align="right" sort={sort} onToggle={toggleSort} />
              <th scope="col" className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">
                  {query ? `No matches for "${query}"` : (emptyMessage ?? 'No loans yet.')}
                </td>
              </tr>
            ) : (
              sorted.map((l) => (
                <tr key={l.id} className="transition-colors hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-700">
                    {l.loan_number}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {l.member_name ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-gray-700">
                    {formatRupees(l.principal_amount)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {formatDate(l.start_date)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        'rounded-full px-2 py-0.5 text-xs font-medium ring-1 ' +
                        (STATUS_PILL[l.status] ?? STATUS_PILL.active)
                      }
                    >
                      {STATUS_LABEL[l.status] ?? l.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-gray-700">
                    {formatRupees(l.paid_interest)}
                  </td>
                  <td
                    className={
                      'whitespace-nowrap px-4 py-3 text-right tabular-nums ' +
                      (l.interest_due > 0 ? 'font-medium text-amber-700' : 'text-gray-500')
                    }
                  >
                    {formatRupees(l.interest_due)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-gray-900">
                    {formatRupees(l.balance)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Link
                      href={l.detail_href}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800"
                    >
                      {linkLabel}
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {sorted.length > 0 && (
        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50/30 px-5 py-3 text-xs text-gray-500">
          <span>
            Showing <span className="font-medium text-gray-900">{sorted.length}</span>{' '}
            {sorted.length === 1 ? 'loan' : 'loans'}
            {query && loans.length !== sorted.length && (
              <span className="text-gray-400"> · filtered from {loans.length}</span>
            )}
          </span>
          <span className="font-medium text-gray-400">
            Outstanding{' '}
            <span className="ml-1 tabular-nums text-gray-900">
              {formatRupees(totalOutstanding)}
            </span>
          </span>
        </div>
      )}
    </div>
  )
}
