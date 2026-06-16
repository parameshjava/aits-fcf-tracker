'use client'

import { useMemo, useState } from 'react'
import { Dropdown } from 'primereact/dropdown'
import { formatRupees } from '@/lib/format'
import { TableExportMenu } from '@/components/table-export'
import { PrDataTable, type PrColumn } from '@/components/ui/pr/data-table'
import type { Cell, ExportCriterion } from '@/lib/table-export'

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

/** Flattened fields baked onto each row so the DataTable can sort / filter /
 *  globally search on flat string/number values. Mirrors the same global-search
 *  coverage the old `useTableFilter` stringify provided. */
type ContributionRowAug = ContributionRow & {
  _date_ts: number
  _amount: number
  _type_label: string
  _member: string
  _search_blob: string
}

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
  // Flatten nested + computed values onto each row so the DataTable can sort,
  // filter and globally search over them (it operates on top-level fields).
  const augmented = useMemo<ContributionRowAug[]>(
    () =>
      rows.map((r) => {
        const label = typeLabel(r)
        const member = r.member_name ?? ''
        return {
          ...r,
          _date_ts: new Date(r.transaction_date).getTime(),
          _amount: Number(r.amount) || 0,
          _type_label: label,
          _member: member,
          _search_blob: [
            member,
            label,
            r.transaction_id,
            r.bank_transaction_id ?? '',
            formatDate(r.transaction_date),
            String(r.amount),
          ].join(' '),
        }
      }),
    [rows],
  )

  // Distinct type labels present in the data → drives the Type dropdown filter.
  const typeOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of augmented) seen.set(r._type_label, r._type_label)
    return Array.from(seen.values())
      .sort((a, b) => a.localeCompare(b))
      .map((label) => ({ label, value: label }))
  }, [augmented])

  // The DataTable reports its current filtered+sorted rows here; export +
  // footer summary are derived from these so they reflect what's on screen.
  // `null` until the first onValueChange fires → fall back to the full set.
  const [processed, setProcessed] = useState<ContributionRowAug[] | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const visible = processed ?? augmented

  const total = visible.reduce((s, r) => s + r._amount, 0)

  // Export reflects exactly what's on screen (current sort + search filter).
  const exportColumns = ['Date', 'Member', 'Transaction type', 'Transaction ID', 'Bank reference', 'Amount (₹)']
  const exportRows: Cell[][] = visible.map((t) => [
    formatDate(t.transaction_date),
    t._member,
    t._type_label,
    t.transaction_id,
    t.bank_transaction_id ?? '',
    t._amount,
  ])
  const exportFooter: Cell[] = ['', '', '', '', 'Total', total]
  const allCriteria: ExportCriterion[] = [
    ...exportCriteria,
    ...(searchQuery.trim() ? [{ label: 'Search', value: searchQuery.trim() }] : []),
  ]

  // --- Columns -------------------------------------------------------------
  const columns: PrColumn<ContributionRowAug>[] = [
    {
      field: '_date_ts',
      header: 'Date',
      sortable: true,
      dataType: 'numeric',
      bodyClassName: 'whitespace-nowrap text-gray-600',
      body: (t) => formatDate(t.transaction_date),
    },
    {
      field: '_member',
      header: 'Member',
      sortable: true,
      filter: true,
      dataType: 'text',
      bodyClassName: 'font-medium text-gray-900',
      body: (t) =>
        t.member_name ?? <span className="text-gray-400">—</span>,
    },
    {
      field: '_type_label',
      header: 'Transaction type',
      sortable: true,
      filter: true,
      filterElement: ({ value, filterApplyCallback }) => (
        <Dropdown
          value={(value as string) ?? null}
          options={typeOptions}
          onChange={(e) => filterApplyCallback(e.value)}
          placeholder="Any type"
          showClear
          className="w-full"
        />
      ),
      bodyClassName: 'text-gray-700',
      body: (t) => t._type_label,
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
    {
      field: '_amount',
      header: 'Amount',
      sortable: true,
      align: 'right',
      dataType: 'numeric',
      bodyClassName: 'whitespace-nowrap text-right font-semibold tabular-nums text-gray-900',
      body: (t) => formatRupees(t.amount),
    },
  ]

  const exportMenu = (
    <TableExportMenu
      filename="contributions"
      title="Contributions"
      columns={exportColumns}
      rows={exportRows}
      footer={exportFooter}
      criteria={allCriteria}
    />
  )

  return (
    <div className="overflow-clip rounded-2xl border border-gray-200 bg-white">
      <PrDataTable<ContributionRowAug>
        value={augmented}
        columns={columns}
        dataKey="id"
        emptyMessage={
          searchQuery
            ? `No matches for "${searchQuery}"`
            : 'No contributions matching the current filters'
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
            <span className="ml-1 tabular-nums text-gray-900">
              {formatRupees(total)}
            </span>
          </span>
        </div>
      )}
    </div>
  )
}
