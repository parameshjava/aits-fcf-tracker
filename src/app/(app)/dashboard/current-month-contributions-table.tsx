'use client'

import { useMemo, useState } from 'react'
import { formatRupees } from '@/lib/format'
import { TableExportMenu } from '@/components/table-export'
import { PrDataTable, type PrColumn } from '@/components/ui/pr/data-table'
import type { Cell } from '@/lib/table-export'

export type CurrentMonthRow = {
  id: string
  transaction_id: string
  amount: number | string
  transaction_date: string
  member_name?: string | null
  bank_transaction_id?: string | null
}

/** Flattened fields baked onto each row so the DataTable can sort / filter /
 *  globally search on flat string/number values. */
type CurrentMonthRowAug = CurrentMonthRow & {
  _date_ts: number
  _amount: number
  _member: string
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
  rows: CurrentMonthRow[]
}) {
  const augmented = useMemo<CurrentMonthRowAug[]>(
    () =>
      rows.map((r) => {
        const member = r.member_name ?? ''
        return {
          ...r,
          _date_ts: new Date(r.transaction_date).getTime(),
          _amount: Number(r.amount) || 0,
          _member: member,
          _search_blob: [
            member,
            r.transaction_id,
            r.bank_transaction_id ?? '',
            formatDate(r.transaction_date),
            String(r.amount),
          ].join(' '),
        }
      }),
    [rows],
  )

  // The DataTable reports its current filtered+sorted rows here so the export +
  // footer summary reflect what's on screen. `null` until the first
  // onValueChange fires → fall back to the full set.
  const [processed, setProcessed] = useState<CurrentMonthRowAug[] | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const visible = processed ?? augmented

  const total = visible.reduce((s, r) => s + r._amount, 0)

  const exportColumns = ['#', 'Person name', 'Contribution (₹)', 'Date', 'Transaction ID']
  const exportRows: Cell[][] = visible.map((t, i) => [
    i + 1,
    t._member,
    t._amount,
    formatDate(t.transaction_date),
    t.transaction_id,
  ])
  const exportFooter: Cell[] = ['', '', total, '', 'Total']

  const columns: PrColumn<CurrentMonthRowAug>[] = [
    {
      field: 'id',
      header: '#',
      align: 'right',
      bodyClassName: 'w-10 text-right tabular-nums text-gray-500',
      body: (_t, { rowIndex }) => rowIndex + 1,
    },
    {
      field: '_member',
      header: 'Person name',
      sortable: true,
      dataType: 'text',
      bodyClassName: 'font-medium text-gray-900',
      body: (t) => t.member_name ?? <span className="text-gray-400">—</span>,
    },
    {
      field: '_amount',
      header: 'Contribution',
      sortable: true,
      align: 'right',
      dataType: 'numeric',
      bodyClassName: 'whitespace-nowrap text-right font-semibold tabular-nums text-gray-900',
      body: (t) => formatRupees(t.amount),
    },
    {
      field: '_date_ts',
      header: 'Date',
      sortable: true,
      dataType: 'numeric',
      bodyClassName: 'whitespace-nowrap text-gray-600',
      body: (t) => formatDate(t.transaction_date),
    },
    {
      field: 'transaction_id',
      header: 'Transaction ID',
      sortable: true,
      bodyClassName: 'whitespace-nowrap font-mono text-xs text-gray-500',
      body: (t) => (
        <span>
          <span>{t.transaction_id}</span>
          {t.bank_transaction_id && (
            <span className="ml-2 text-[11px] text-gray-400" title="Bank reference">
              {t.bank_transaction_id}
            </span>
          )}
        </span>
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
      <PrDataTable<CurrentMonthRowAug>
        value={augmented}
        columns={columns}
        dataKey="id"
        emptyMessage={
          searchQuery
            ? `No matches for "${searchQuery}"`
            : 'No contributions recorded this month yet'
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
            Showing <span className="font-medium text-gray-900">{visible.length}</span>{' '}
            {visible.length === 1 ? 'contribution' : 'contributions'}
            {augmented.length !== visible.length && (
              <span className="text-gray-400"> · filtered from {augmented.length}</span>
            )}
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
