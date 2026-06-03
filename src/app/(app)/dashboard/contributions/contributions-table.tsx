'use client'

import { useCallback } from 'react'
import { formatRupees } from '@/lib/format'
import { TableExportMenu } from '@/components/table-export'
import type { Cell, ExportCriterion } from '@/lib/table-export'
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
  transaction_type: string
  interest_source?: 'loans' | 'bank' | null
  transaction_date: string
  description?: string | null
  member_name?: string | null
  bank_transaction_id?: string | null
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
  const base = TYPE_LABELS[row.transaction_type] ?? row.transaction_type.replace(/_/g, ' ')
  if (row.transaction_type === 'interest' && row.interest_source) {
    return `${base} · ${row.interest_source}`
  }
  return base
}

export function ContributionsTable({
  rows,
  exportCriteria = [],
}: {
  rows: ContributionRow[]
  /** Applied page filters (member/type/date range) recorded atop the export.
   *  The live table search query is appended automatically. */
  exportCriteria?: ExportCriterion[]
}) {
  const stringify = useCallback(
    (r: ContributionRow) =>
      [
        r.member_name ?? '',
        typeLabel(r),
        r.transaction_id,
        r.bank_transaction_id ?? '',
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

  // Export reflects exactly what's on screen (current sort + search filter).
  const exportColumns = ['Date', 'Member', 'Transaction type', 'Transaction ID', 'Bank reference', 'Amount (₹)']
  const exportRows: Cell[][] = sorted.map((t) => [
    formatDate(t.transaction_date),
    t.member_name ?? '',
    typeLabel(t),
    t.transaction_id,
    t.bank_transaction_id ?? '',
    Number(t.amount) || 0,
  ])
  const exportFooter: Cell[] = ['', '', '', '', 'Total', total]
  const allCriteria: ExportCriterion[] = [
    ...exportCriteria,
    ...(query.trim() ? [{ label: 'Search', value: query.trim() }] : []),
  ]

  return (
    <div className="overflow-clip rounded-2xl border border-gray-200 bg-white">
      {rows.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50/30 px-3 py-2">
          <TableSearch
            value={query}
            onChange={setQuery}
            placeholder="Search rows…"
            matched={filtered.length}
            total={rows.length}
          />
          <TableExportMenu
            filename="contributions"
            title="Contributions"
            columns={exportColumns}
            rows={exportRows}
            footer={exportFooter}
            criteria={allCriteria}
          />
        </div>
      )}
      <div className="overflow-x-auto lg:overflow-x-visible">
        <table className="sticky-thead min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <SortableHeader compact col="date"      label="Date"             sort={sort} onToggle={toggleSort} />
              <SortableHeader compact col="member"    label="Member"           sort={sort} onToggle={toggleSort} />
              <SortableHeader compact col="type"      label="Transaction type" sort={sort} onToggle={toggleSort} />
              <SortableHeader compact col="reference" label="Transaction ID"   sort={sort} onToggle={toggleSort} />
              <SortableHeader compact col="amount"    label="Amount" align="right" sort={sort} onToggle={toggleSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-12 text-center text-sm text-gray-400">
                  {query
                    ? `No matches for "${query}"`
                    : 'No contributions matching the current filters'}
                </td>
              </tr>
            ) : (
              sorted.map((t) => (
                <tr key={t.id} className="transition-colors hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">
                    {formatDate(t.transaction_date)}
                  </td>
                  <td className="px-3 py-1.5 font-medium text-gray-900">
                    {t.member_name ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-gray-700">{typeLabel(t)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-500">
                    <span>{t.transaction_id}</span>
                    {t.bank_transaction_id && (
                      <span className="ml-2 text-[11px] text-gray-400" title="Bank reference">
                        {t.bank_transaction_id}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums text-gray-900">
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
