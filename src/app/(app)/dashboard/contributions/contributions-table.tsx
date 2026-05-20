'use client'

import { useCallback } from 'react'
import { formatRupees } from '@/lib/format'
import {
  SortableHeader,
  TableSearch,
  useSortable,
  useTableFilter,
} from '@/components/table-controls'

export type ContributionRow = {
  id: string
  transaction_id: string
  amount: number | string
  contribution_type: string
  interest_source?: 'loans' | 'bank' | null
  transaction_date: string
  description?: string | null
  member_name?: string | null
}

type SortKey = 'date' | 'member' | 'type' | 'reference' | 'amount'

const TYPE_LABELS: Record<string, string> = {
  contribution: 'Contribution',
  interest:     'Interest',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${dd}-${mm}-${yyyy}`
}

function typeLabel(row: ContributionRow): string {
  const base = TYPE_LABELS[row.contribution_type] ?? row.contribution_type.replace(/_/g, ' ')
  if (row.contribution_type === 'interest' && row.interest_source) {
    return `${base} · ${row.interest_source}`
  }
  return base
}

export function ContributionsTable({ rows }: { rows: ContributionRow[] }) {
  const stringify = useCallback(
    (r: ContributionRow) =>
      [
        r.member_name ?? '',
        typeLabel(r),
        r.transaction_id,
        formatDate(r.transaction_date),
        String(r.amount),
      ].join(' '),
    [],
  )

  const { filtered, query, setQuery } = useTableFilter(rows, stringify)

  const accessor = useCallback((r: ContributionRow, col: SortKey) => {
    if (col === 'date')      return new Date(r.transaction_date).getTime()
    if (col === 'member')    return r.member_name ?? ''
    if (col === 'type')      return typeLabel(r)
    if (col === 'reference') return r.transaction_id
    if (col === 'amount')    return Number(r.amount) || 0
    return ''
  }, [])

  const { sorted, sort, toggleSort } = useSortable<ContributionRow, SortKey>(
    filtered,
    accessor,
    { col: 'date', dir: 'desc' }, // default sort: newest first
  )

  const total = sorted.reduce((s, r) => s + Number(r.amount || 0), 0)

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      {rows.length > 0 && (
        <div className="border-b border-gray-200 bg-gray-50/30 px-4 py-2.5">
          <TableSearch
            value={query}
            onChange={setQuery}
            placeholder="Search rows…"
            matched={filtered.length}
            total={rows.length}
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <SortableHeader col="date"      label="Date"             sort={sort} onToggle={toggleSort} />
              <SortableHeader col="member"    label="Member"           sort={sort} onToggle={toggleSort} />
              <SortableHeader col="type"      label="Transaction type" sort={sort} onToggle={toggleSort} />
              <SortableHeader col="reference" label="Transaction ID"   sort={sort} onToggle={toggleSort} />
              <SortableHeader col="amount"    label="Amount" align="right" sort={sort} onToggle={toggleSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400">
                  {query
                    ? `No matches for "${query}"`
                    : 'No contributions matching the current filters'}
                </td>
              </tr>
            ) : (
              sorted.map((t) => (
                <tr key={t.id} className="transition-colors hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {formatDate(t.transaction_date)}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {t.member_name ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{typeLabel(t)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                    {t.transaction_id}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-gray-900">
                    {formatRupees(t.amount)}
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
            {sorted.length === 1 ? 'contribution' : 'contributions'}
            {query && rows.length !== sorted.length && (
              <span className="text-gray-400"> · filtered from {rows.length}</span>
            )}
          </span>
          <span className="font-medium text-gray-400">
            Total{' '}
            <span className="ml-1 tabular-nums text-gray-900">
              {formatRupees(total)}
            </span>
          </span>
        </div>
      )}
    </div>
  )
}
