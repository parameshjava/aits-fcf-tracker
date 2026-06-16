'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Dropdown } from 'primereact/dropdown'
import { formatRupees } from '@/lib/format'
import { overdueParts, formatOverdueDuration } from '@/lib/due'
import { getLoanDetail, type LoanDetailData } from '@/lib/actions/loans'
import { LoanDetailPanel } from '@/components/loan-detail-panel'
import { TableExportMenu } from '@/components/table-export'
import { PrDataTable, type PrColumn } from '@/components/ui/pr/data-table'
import type { Cell } from '@/lib/table-export'

export type LoansListRow = {
  id: string
  loan_number: string
  member_name: string | null
  principal_amount: number
  start_date: string
  /** Loan closure date — only relevant for the "past" tab (paid / write_off). */
  end_date?: string | null
  status: 'active' | 'paid' | 'write_off'
  loan_type: 'personal' | 'medical'
  /** Repayment model. EMI loans get an "EMI" badge + a next-due hint;
   *  the full read-only schedule lives on the detail page. */
  repayment_model?: 'accrual' | 'emi'
  /** Next unpaid EMI due date (ISO) — only set for EMI loans. */
  next_due_date?: string | null
  /** Count of EMI installments past their due date (overdue by date). */
  overdue_count?: number
  /** Earliest past-due installment's due date (drives the overdue duration). */
  oldest_overdue_date?: string | null
  paid_interest: number
  interest_due: number
  balance: number
  detail_href: string
}

/** Flattened fields baked onto each row so the DataTable can sort / filter /
 *  globally search on flat values. */
type LoansListRowAug = LoansListRow & {
  _start_ts: number
  _end_ts: number
  _status_label: string
  _status_rank: number
  _type_label: string
  _search_blob: string
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
const STATUS_RANK: Record<string, number> = {
  active:    0, // surface active first when sorted asc
  paid:      1,
  write_off: 2,
}
const TYPE_PILL: Record<string, string> = {
  personal: 'bg-gray-50 text-gray-700 ring-gray-200',
  medical:  'bg-violet-50 text-violet-700 ring-violet-200',
}
const TYPE_LABEL: Record<string, string> = {
  personal: 'Personal',
  medical:  'Medical',
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
  expandable = false,
  mode,
  todayIso,
}: {
  loans: LoansListRow[]
  /** Server's IST date (YYYY-MM-DD) used to compute overdue durations. */
  todayIso?: string
  /** Action link text per row — "View →" (read-only) or "Manage →" (admin). */
  linkLabel?: string
  /** Custom empty-state message (JSX allowed). */
  emptyMessage?: React.ReactNode
  /** When true, replaces the per-row link with an inline accordion that
   *  fetches loan detail once and caches it for instant re-expansion. */
  expandable?: boolean
  /** "past" adds an End date column after Start and assumes all rows are
   *  closed loans (paid / write_off). Omit for the default mixed view. */
  mode?: 'active' | 'past'
}) {
  const showEndDate = mode === 'past'

  const augmented = useMemo<LoansListRowAug[]>(
    () =>
      loans.map((l) => {
        const statusLabel = STATUS_LABEL[l.status] ?? l.status
        const typeLabel = TYPE_LABEL[l.loan_type] ?? l.loan_type
        return {
          ...l,
          _start_ts: new Date(l.start_date).getTime(),
          _end_ts: l.end_date ? new Date(l.end_date).getTime() : 0,
          _status_label: statusLabel,
          _status_rank: STATUS_RANK[l.status] ?? 99,
          _type_label: typeLabel,
          _search_blob: [
            l.loan_number,
            l.member_name ?? '',
            String(l.principal_amount),
            formatDate(l.start_date),
            statusLabel,
            typeLabel,
          ].join(' '),
        }
      }),
    [loans],
  )

  // Distinct status labels present → drives the Status dropdown filter.
  const statusOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const l of augmented) seen.set(l._status_label, l._status_label)
    return Array.from(seen.values())
      .sort((a, b) => a.localeCompare(b))
      .map((label) => ({ label, value: label }))
  }, [augmented])

  // The DataTable reports its current filtered+sorted rows here; export, the
  // count strip and the totals footer all derive from these so they reflect
  // what's on screen. `null` until the first onValueChange → full set.
  const [processed, setProcessed] = useState<LoansListRowAug[] | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const visible = processed ?? augmented

  const totalOutstanding = visible.reduce((s, l) => s + l.balance, 0)

  // --- Export (reflects the current filter + sort) -------------------------
  const exportColumns = [
    'Loan #', 'Member', 'Type', 'Principal (₹)', 'Start date',
    ...(showEndDate ? ['End date'] : []),
    'Status', 'Interest paid (₹)', 'Interest due (₹)', 'Outstanding (₹)',
  ]
  const exportRows: Cell[][] = visible.map((l) => [
    l.loan_number,
    l.member_name ?? '',
    l._type_label,
    l.principal_amount,
    formatDate(l.start_date),
    ...(showEndDate ? [formatDate(l.end_date ?? null)] : []),
    l._status_label,
    l.paid_interest,
    l.status === 'paid' || l.status === 'write_off' ? '' : l.interest_due,
    l.balance,
  ])
  const exportFooter: Cell[] = exportColumns.map((c, i) =>
    i === 0 ? 'Total' : c === 'Outstanding (₹)' ? totalOutstanding : '',
  )
  const exportCriteria = searchQuery.trim()
    ? [{ label: 'Search', value: searchQuery.trim() }]
    : []

  // --- Lazy-loaded accordion state -----------------------------------------
  // Detail is fetched once per loan and stored in `cache`. Re-expanding the
  // same row reads from cache instantly. `inflightRef` is the synchronous
  // dedup guard — state setters can't be used as an immediate "started?" lock.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [cache, setCache] = useState<Map<string, LoanDetailData>>(() => new Map())
  const [loading, setLoading] = useState<Set<string>>(() => new Set())
  const [errors, setErrors] = useState<Map<string, string>>(() => new Map())
  const inflightRef = useRef<Set<string>>(new Set())

  const fetchDetail = useCallback(
    async (id: string) => {
      if (cache.has(id) || inflightRef.current.has(id)) return
      inflightRef.current.add(id)
      setLoading((prev) => {
        if (prev.has(id)) return prev
        const next = new Set(prev)
        next.add(id)
        return next
      })
      setErrors((prev) => {
        if (!prev.has(id)) return prev
        const next = new Map(prev)
        next.delete(id)
        return next
      })
      try {
        const data = await getLoanDetail(id)
        if (data) setCache((prev) => new Map(prev).set(id, data))
        else setErrors((prev) => new Map(prev).set(id, 'Loan not found.'))
      } catch (e) {
        setErrors((prev) =>
          new Map(prev).set(
            id,
            e instanceof Error ? e.message : 'Failed to load loan details.',
          ),
        )
      } finally {
        inflightRef.current.delete(id)
        setLoading((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [cache],
  )

  // PrimeReact controlled expansion object derived from the id Set.
  const expandedRows = useMemo(() => {
    const obj: Record<string, boolean> = {}
    for (const id of expandedIds) obj[id] = true
    return obj
  }, [expandedIds])

  const onRowToggle = useCallback(
    (rows: unknown) => {
      const nextIds = new Set(Object.keys(rows as Record<string, boolean>))
      // Diff against current state to find the single toggled row; trigger a
      // lazy fetch for any newly-opened loan.
      setExpandedIds((prev) => {
        for (const id of nextIds) {
          if (!prev.has(id)) void fetchDetail(id)
        }
        return nextIds
      })
    },
    [fetchDetail],
  )

  // --- Columns -------------------------------------------------------------
  const columns: PrColumn<LoansListRowAug>[] = [
    {
      field: 'loan_number',
      header: 'Loan #',
      sortable: true,
      filter: true,
      dataType: 'text',
      bodyClassName: 'whitespace-nowrap px-3 py-2.5 font-mono text-xs text-gray-700',
      body: (l) => (
        <span className="inline-flex items-center gap-1.5">
          {l.loan_number}
          {(l.overdue_count ?? 0) > 0 &&
            (() => {
              const parts =
                todayIso && l.oldest_overdue_date
                  ? overdueParts(l.oldest_overdue_date, todayIso)
                  : null
              const dur = parts ? formatOverdueDuration(parts) : null
              const n = l.overdue_count ?? 0
              const title =
                `${n} EMI ${n === 1 ? 'payment is' : 'payments are'} overdue` +
                (dur ? ` · oldest overdue by ${dur}` : '')
              return (
                <span
                  title={title}
                  aria-label={title}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-100 text-rose-600"
                >
                  <AlertIcon />
                </span>
              )
            })()}
        </span>
      ),
      footer: 'Total',
    },
    {
      field: 'member_name',
      header: 'Member',
      sortable: true,
      filter: true,
      dataType: 'text',
      bodyClassName: 'px-3 py-2.5 font-medium text-gray-900',
      body: (l) => l.member_name ?? <span className="text-gray-400">—</span>,
    },
    {
      field: '_type_label',
      header: 'Type',
      sortable: true,
      bodyClassName: 'whitespace-nowrap px-3 py-2.5',
      body: (l) => (
        <div className="flex items-center gap-1.5">
          <span
            className={
              'rounded-full px-2 py-0.5 text-xs font-medium ring-1 ' +
              (TYPE_PILL[l.loan_type] ?? TYPE_PILL.personal)
            }
          >
            {l._type_label}
          </span>
          {l.repayment_model === 'emi' && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200">
              EMI
            </span>
          )}
        </div>
      ),
    },
    {
      field: 'principal_amount',
      header: 'Principal',
      sortable: true,
      align: 'right',
      dataType: 'numeric',
      bodyClassName: 'whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-gray-700',
      body: (l) => formatRupees(l.principal_amount),
    },
    {
      field: '_start_ts',
      header: 'Start date',
      sortable: true,
      dataType: 'numeric',
      bodyClassName: 'whitespace-nowrap px-3 py-2.5 text-gray-600',
      body: (l) => (
        <>
          {formatDate(l.start_date)}
          {l.repayment_model === 'emi' && l.next_due_date && (
            <span className="mt-0.5 block text-[11px] text-gray-400">
              next EMI {formatDate(l.next_due_date)}
            </span>
          )}
        </>
      ),
    },
    ...(showEndDate
      ? ([
          {
            field: '_end_ts',
            header: 'End date',
            sortable: true,
            dataType: 'numeric',
            bodyClassName: 'whitespace-nowrap px-3 py-2.5 text-gray-600',
            body: (l: LoansListRowAug) => formatDate(l.end_date ?? null),
          },
        ] as PrColumn<LoansListRowAug>[])
      : []),
    {
      field: '_status_label',
      header: 'Status',
      sortable: true,
      sortField: '_status_rank',
      filter: true,
      filterField: '_status_label',
      filterElement: ({ value, filterApplyCallback }) => (
        <Dropdown
          value={(value as string) ?? null}
          options={statusOptions}
          onChange={(e) => filterApplyCallback(e.value)}
          placeholder="Any status"
          showClear
          className="w-full"
        />
      ),
      bodyClassName: 'whitespace-nowrap px-3 py-2.5',
      body: (l) => (
        <span
          className={
            'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ' +
            (STATUS_PILL[l.status] ?? STATUS_PILL.active)
          }
        >
          {l._status_label}
        </span>
      ),
    },
    {
      field: 'paid_interest',
      header: 'Interest paid',
      sortable: true,
      align: 'right',
      dataType: 'numeric',
      bodyClassName: 'whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-gray-700',
      body: (l) => formatRupees(l.paid_interest),
    },
    {
      field: 'interest_due',
      header: 'Interest due',
      sortable: true,
      align: 'right',
      dataType: 'numeric',
      body: (l) => {
        const isClosedLoan = l.status === 'paid' || l.status === 'write_off'
        return (
          <span
            className={
              'whitespace-nowrap text-right tabular-nums ' +
              (isClosedLoan
                ? 'text-gray-400'
                : l.interest_due > 0
                ? 'font-medium text-amber-700'
                : 'text-gray-500')
            }
          >
            {isClosedLoan ? '—' : formatRupees(l.interest_due)}
          </span>
        )
      },
      bodyClassName: 'whitespace-nowrap px-3 py-2.5 text-right',
    },
    {
      field: 'balance',
      header: 'Outstanding',
      sortable: true,
      align: 'right',
      dataType: 'numeric',
      bodyClassName:
        'whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-gray-900',
      body: (l) => formatRupees(l.balance),
      footer: (
        <span className="font-semibold tabular-nums text-gray-900">
          {formatRupees(totalOutstanding)}
        </span>
      ),
    },
  ]

  // When not expandable, append an Actions column with the per-row link.
  // (Expandable mode uses the wrapper's expander column instead.)
  if (!expandable) {
    columns.push({
      field: 'detail_href',
      header: '',
      align: 'right',
      bodyClassName: 'whitespace-nowrap px-3 py-2.5 text-right',
      body: (l) => (
        <Link
          href={l.detail_href}
          className="text-xs font-medium text-blue-600 hover:text-blue-800"
        >
          {linkLabel}
        </Link>
      ),
    })
  } else {
    columns.push({
      field: 'id',
      header: '',
      expander: true,
      style: { width: '3.5rem' },
    })
  }

  const exportMenu = (
    <TableExportMenu
      filename={mode === 'past' ? 'loans-closed' : 'loans'}
      title={mode === 'past' ? 'Closed loans' : 'Loans'}
      columns={exportColumns}
      rows={exportRows}
      footer={exportFooter}
      criteria={exportCriteria}
    />
  )

  return (
    <div className="overflow-clip rounded-2xl border border-gray-200 bg-white">
      <PrDataTable<LoansListRowAug>
        value={augmented}
        columns={columns}
        dataKey="id"
        emptyMessage={emptyMessage ?? 'No loans yet.'}
        globalFilterFields={loans.length > 0 ? ['_search_blob'] : undefined}
        globalSearchPlaceholder="Search by loan #, member, status…"
        header={loans.length > 0 ? exportMenu : undefined}
        onValueChange={setProcessed}
        onGlobalFilterChange={setSearchQuery}
        expandedRows={expandable ? expandedRows : undefined}
        onRowToggle={expandable ? onRowToggle : undefined}
        rowExpansion={
          expandable
            ? (l) => {
                const cached = cache.get(l.id)
                const isLoading = loading.has(l.id) && !cached
                const errMsg = errors.get(l.id)
                return (
                  <div className="border-l-2 border-l-blue-500 bg-gradient-to-b from-blue-50/50 to-white">
                    {isLoading ? (
                      <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
                        Loading loan details…
                      </div>
                    ) : errMsg && !cached ? (
                      <div className="p-6 text-sm text-rose-600">{errMsg}</div>
                    ) : cached ? (
                      <LoanDetailPanel data={cached} todayIso={todayIso} />
                    ) : null}
                  </div>
                )
              }
            : undefined
        }
      />

      {visible.length > 0 && (
        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50/30 px-5 py-3 text-xs text-gray-500">
          <span>
            Showing <span className="font-medium text-gray-900">{visible.length}</span>{' '}
            {visible.length === 1 ? 'loan' : 'loans'}
            {augmented.length !== visible.length && (
              <span className="text-gray-400"> · filtered from {augmented.length}</span>
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

function AlertIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-3 w-3"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z"
        clipRule="evenodd"
      />
    </svg>
  )
}
