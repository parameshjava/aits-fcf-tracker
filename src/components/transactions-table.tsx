'use client'

import { useMemo, useState } from 'react'
import { Dropdown } from 'primereact/dropdown'
import { formatRupees } from '@/lib/format'
import { PollModal } from '@/components/poll-modal'
import { TableExportMenu } from '@/components/table-export'
import { PrDataTable, type PrColumn } from '@/components/ui/pr/data-table'
import type { Cell, ExportCriterion } from '@/lib/table-export'

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

/** Derived fields baked onto each row so DataTable can sort/filter/global-search
 *  on flat string/number values (it can't reach into `poll.question` etc.). */
type TxnRowAug = TxnRow & {
  _date_ts: number
  _amount: number
  _type_label: string
  _member: string
  _beneficiary: string
  _poll_question: string
  _description: string
  _bank_ref: string
  _search_blob: string
}

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

function formatTxnDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
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

  // Flatten nested + computed values onto each row so the DataTable can sort,
  // filter and globally search over them (it operates on top-level fields).
  const augmented = useMemo<TxnRowAug[]>(
    () =>
      rows.map((t) => {
        const label = typeLabel(t)
        const member = t.member_name ?? ''
        const beneficiary = t.beneficiary_name ?? ''
        const pollQ = t.poll?.question ?? ''
        const description = t.description ?? ''
        const bankRef = t.bank_transaction_id ?? ''
        return {
          ...t,
          _date_ts: new Date(t.transaction_date).getTime(),
          _amount: Number(t.amount) || 0,
          _type_label: label,
          _member: member,
          _beneficiary: beneficiary,
          _poll_question: pollQ,
          _description: description,
          _bank_ref: bankRef,
          _search_blob: [
            member,
            beneficiary,
            pollQ,
            description,
            t.transaction_id,
            bankRef,
            label,
            formatTxnDate(t.transaction_date),
            String(t.amount),
          ].join(' '),
        }
      }),
    [rows],
  )

  // Distinct type labels present in the data → drives the Type dropdown filter.
  const typeOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const t of augmented) seen.set(t._type_label, t._type_label)
    return Array.from(seen.values())
      .sort((a, b) => a.localeCompare(b))
      .map((label) => ({ label, value: label }))
  }, [augmented])

  // The DataTable reports its current filtered+sorted rows here; export +
  // footer summary are derived from these so they reflect what's on screen.
  // `null` until the first onValueChange fires → fall back to the full set.
  const [processed, setProcessed] = useState<TxnRowAug[] | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const visible = processed ?? augmented

  // --- Export (reflects the filtered + sorted rows) ------------------------
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
  const exportRows: Cell[][] = visible.map((t) => [
    formatTxnDate(t.transaction_date),
    t._member,
    t._type_label,
    ...(showDonationColumns ? [t._beneficiary, t._poll_question] : []),
    t._amount,
    t.transaction_id,
    t._bank_ref,
    t._description,
  ])
  const amountIdx = exportColumns.indexOf('Amount (₹)')
  const total = visible.reduce((s, r) => s + r._amount, 0)
  const exportFooter: Cell[] = exportColumns.map((_, i) =>
    i === 0 ? 'Total' : i === amountIdx ? total : '',
  )
  const allCriteria: ExportCriterion[] = [
    ...exportCriteria,
    ...(searchQuery.trim() ? [{ label: 'Search', value: searchQuery.trim() }] : []),
  ]

  // --- Columns -------------------------------------------------------------
  const columns: PrColumn<TxnRowAug>[] = [
    {
      field: 'transaction_type',
      header: '',
      style: { width: '44px' },
      bodyClassName: 'py-2 pl-3 pr-0',
      body: (t) => {
        const meta = TYPE_META[t.transaction_type] ?? TYPE_META.other
        return (
          <span
            className={'grid h-7 w-7 place-items-center rounded-full text-sm ' + meta.bg}
            aria-hidden="true"
          >
            {meta.emoji}
          </span>
        )
      },
    },
    {
      field: '_date_ts',
      header: 'Date',
      sortable: true,
      dataType: 'numeric',
      bodyClassName: 'whitespace-nowrap text-gray-600',
      body: (t) => formatTxnDate(t.transaction_date),
    },
    {
      field: '_member',
      header: memberColumnLabel,
      sortable: true,
      filter: true,
      dataType: 'text',
      body: (t) => (
        <div>
          <div className="text-sm font-medium text-gray-900">
            {t.member_name ?? <span className="text-gray-400">—</span>}
          </div>
          {/* When the Type column is hidden (showType=false), keep the type as
              a subtitle here so the info isn't lost. */}
          {!showType && (
            <div className="text-xs text-gray-500">{t._type_label}</div>
          )}
        </div>
      ),
    },
    // Type column — only rendered when showType. Carries the dropdown filter.
    ...(showType
      ? ([
          {
            field: '_type_label',
            header: 'Type',
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
            bodyClassName: 'whitespace-nowrap text-xs text-gray-500',
            body: (t: TxnRowAug) => t._type_label,
          },
        ] as PrColumn<TxnRowAug>[])
      : []),
    ...(showDonationColumns
      ? ([
          {
            field: '_beneficiary',
            header: 'Beneficiary',
            sortable: true,
            bodyClassName: 'text-sm text-gray-700',
            body: (t: TxnRowAug) =>
              t.beneficiary_name || <span className="text-gray-300">—</span>,
          },
          {
            field: '_poll_question',
            header: 'Poll',
            bodyClassName: 'text-sm',
            body: (t: TxnRowAug) =>
              t.poll ? (
                <PollModal pollId={t.poll.id} pollQuestion={t.poll.question} variant="icon" />
              ) : (
                <span className="text-gray-300">—</span>
              ),
          },
        ] as PrColumn<TxnRowAug>[])
      : []),
    {
      field: '_amount',
      header: 'Amount',
      sortable: true,
      align: 'right',
      dataType: 'numeric',
      bodyClassName: 'whitespace-nowrap text-right font-semibold tabular-nums text-gray-900',
      body: (t) => formatRupees(t.amount),
    },
    {
      field: 'transaction_id',
      header: 'Transaction ID',
      sortable: true,
      bodyClassName: 'whitespace-nowrap font-mono text-xs text-gray-500',
      body: (t) => (
        <div>
          <div>{t.transaction_id}</div>
          {t.bank_transaction_id && (
            <div className="text-[11px] text-gray-400" title="Bank reference">
              {t.bank_transaction_id}
            </div>
          )}
        </div>
      ),
    },
    {
      field: '_description',
      header: 'Description',
      sortable: true,
      style: { maxWidth: '280px' },
      bodyClassName: 'truncate text-gray-600',
      body: (t) => t.description || <span className="text-gray-300">—</span>,
    },
    ...(showActions
      ? ([
          {
            field: 'manage_href',
            header: 'Actions',
            align: 'right',
            bodyClassName: 'whitespace-nowrap text-right',
            body: (t: TxnRowAug) =>
              t.manage_href ? (
                <a
                  href={t.manage_href}
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  Manage →
                </a>
              ) : (
                <span className="text-xs text-gray-300">—</span>
              ),
          },
        ] as PrColumn<TxnRowAug>[])
      : []),
  ]

  const globalFilterFields: (keyof TxnRowAug & string)[] = ['_search_blob']

  const exportMenu = (
    <TableExportMenu
      filename={exportName}
      title={exportTitle}
      columns={exportColumns}
      rows={exportRows}
      footer={exportFooter}
      criteria={allCriteria}
    />
  )

  return (
    <div className="overflow-clip rounded-2xl border border-gray-200 bg-white">
      <PrDataTable<TxnRowAug>
        value={augmented}
        columns={columns}
        dataKey="id"
        emptyMessage={emptyLabel}
        globalFilterFields={enableSearch ? globalFilterFields : undefined}
        globalSearchPlaceholder={`Search by ${memberColumnLabel.toLowerCase()}, description, ID…`}
        header={exportMenu}
        onValueChange={setProcessed}
        onGlobalFilterChange={setSearchQuery}
      />

      {visible.length > 0 && (
        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50/30 px-5 py-3 text-xs text-gray-500">
          <span>
            Showing <span className="font-medium text-gray-900">{visible.length}</span>{' '}
            {visible.length === 1 ? 'transaction' : 'transactions'}
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
