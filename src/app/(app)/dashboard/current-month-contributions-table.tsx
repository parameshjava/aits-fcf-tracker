'use client'

import { useMemo, useState } from 'react'
import { formatRupees } from '@/lib/format'
import { TableExportMenu } from '@/components/table-export'
import { PrDataTable, type PrColumn } from '@/components/ui/pr/data-table'
import type { Cell } from '@/lib/table-export'

export type MemberContributionRow = {
  member_id: string
  member_name: string
  total: number
  count: number
  latest_date: string | null
  latest_transaction_id: string | null
  latest_bank_transaction_id: string | null
}

/** Flattened fields baked onto each row so the DataTable can sort / filter /
 *  globally search on flat string/number values. */
type MemberContributionRowAug = MemberContributionRow & {
  _date_ts: number
  _search_blob: string
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${dd}-${mm}-${yyyy}`
}

export function CurrentMonthContributionsTable({
  rows,
}: {
  rows: MemberContributionRow[]
}) {
  const augmented = useMemo<MemberContributionRowAug[]>(
    () =>
      rows.map((r) => ({
        ...r,
        // Sort non-contributors (no date) to the bottom of a date sort.
        _date_ts: r.latest_date ? new Date(r.latest_date).getTime() : 0,
        _search_blob: [
          r.member_name,
          r.latest_transaction_id ?? '',
          r.latest_bank_transaction_id ?? '',
          r.latest_date ? formatDate(r.latest_date) : '',
          String(r.total),
        ].join(' '),
      })),
    [rows],
  )

  // The DataTable reports its current filtered+sorted rows here so the export +
  // footer summary reflect what's on screen. `null` until the first
  // onValueChange fires → fall back to the full set.
  const [processed, setProcessed] = useState<MemberContributionRowAug[] | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const visible = processed ?? augmented

  const total = visible.reduce((s, r) => s + r.total, 0)
  const contributors = visible.filter((r) => r.count > 0).length

  const exportColumns = ['#', 'Person name', 'Contribution (₹)', 'Date', 'Transaction ID']
  const exportRows: Cell[][] = visible.map((r, i) => [
    i + 1,
    r.member_name,
    r.total,
    r.latest_date ? formatDate(r.latest_date) : '',
    r.latest_transaction_id
      ? r.count > 1
        ? `${r.latest_transaction_id} (×${r.count})`
        : r.latest_transaction_id
      : '',
  ])
  const exportFooter: Cell[] = ['', '', total, '', 'Total']

  const columns: PrColumn<MemberContributionRowAug>[] = [
    {
      field: 'member_id',
      header: '#',
      align: 'right',
      bodyClassName: 'w-10 text-right tabular-nums text-gray-500',
      body: (_r, { rowIndex }) => rowIndex + 1,
    },
    {
      field: 'member_name',
      header: 'Person name',
      sortable: true,
      dataType: 'text',
      bodyClassName: 'font-medium text-gray-900',
      body: (r) => r.member_name,
    },
    {
      field: 'total',
      header: 'Contribution',
      sortable: true,
      align: 'right',
      dataType: 'numeric',
      bodyClassName: 'whitespace-nowrap text-right font-semibold tabular-nums',
      body: (r) =>
        r.total > 0 ? (
          <span className="text-gray-900">{formatRupees(r.total)}</span>
        ) : (
          <span className="text-gray-400">{formatRupees(0)}</span>
        ),
    },
    {
      field: '_date_ts',
      header: 'Date',
      sortable: true,
      dataType: 'numeric',
      bodyClassName: 'whitespace-nowrap text-gray-600',
      body: (r) =>
        r.latest_date ? formatDate(r.latest_date) : <span className="text-gray-400">—</span>,
    },
    {
      field: 'latest_transaction_id',
      header: 'Transaction ID',
      sortable: true,
      bodyClassName: 'whitespace-nowrap font-mono text-xs text-gray-500',
      body: (r) =>
        r.latest_transaction_id ? (
          <span>
            <span>{r.latest_transaction_id}</span>
            {r.count > 1 && (
              <span
                className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700"
                title={`${r.count} contributions this month`}
              >
                ×{r.count}
              </span>
            )}
            {r.latest_bank_transaction_id && (
              <span className="ml-2 text-[11px] text-gray-400" title="Bank reference">
                {r.latest_bank_transaction_id}
              </span>
            )}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
  ]

  const exportMenu = (
    <TableExportMenu
      filename="current-month-contributions"
      title="Current month contributions"
      columns={exportColumns}
      rows={exportRows}
      footer={exportFooter}
    />
  )

  return (
    <div className="overflow-clip rounded-2xl border border-gray-200 bg-white">
      <PrDataTable<MemberContributionRowAug>
        value={augmented}
        columns={columns}
        dataKey="member_id"
        fitContent
        emptyMessage={
          searchQuery ? `No matches for "${searchQuery}"` : 'No active members'
        }
        globalFilterFields={rows.length > 0 ? ['_search_blob'] : undefined}
        globalSearchPlaceholder="Search rows…"
        header={rows.length > 0 ? exportMenu : undefined}
        onValueChange={setProcessed}
        onGlobalFilterChange={setSearchQuery}
      />

      {visible.length > 0 && (
        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50/30 px-5 py-3 text-xs text-gray-500">
          <span>
            <span className="font-medium text-gray-900">{contributors}</span> of{' '}
            <span className="font-medium text-gray-900">{visible.length}</span>{' '}
            {visible.length === 1 ? 'member' : 'members'} contributed
          </span>
          <span className="font-medium text-gray-400">
            Total{' '}
            <span className="ml-1 tabular-nums text-gray-900">{formatRupees(total)}</span>
          </span>
        </div>
      )}
    </div>
  )
}
