'use client'

import { Fragment, useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { formatRupees } from '@/lib/format'
import { getLoanDetail, type LoanDetailData } from '@/lib/actions/loans'
import { LoanDetailPanel } from '@/components/loan-detail-panel'
import { ExpandToggle } from '@/components/ui/expand-toggle'
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
  /** Loan closure date — only relevant for the "past" tab (paid / write_off). */
  end_date?: string | null
  status: 'active' | 'paid' | 'write_off'
  loan_type: 'personal' | 'medical'
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
  | 'end'
  | 'status'
  | 'type'
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
}: {
  loans: LoansListRow[]
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
  const colspan = showEndDate ? 11 : 10
  const stringify = useCallback(
    (l: LoansListRow) =>
      [
        l.loan_number,
        l.member_name ?? '',
        String(l.principal_amount),
        formatDate(l.start_date),
        STATUS_LABEL[l.status] ?? l.status,
        TYPE_LABEL[l.loan_type] ?? l.loan_type,
      ].join(' '),
    [],
  )

  const { filtered, query, setQuery } = useTableFilter(loans, stringify)

  const accessor = useCallback((l: LoansListRow, col: SortKey) => {
    if (col === 'loan_number')    return l.loan_number
    if (col === 'member')         return l.member_name ?? ''
    if (col === 'principal')      return l.principal_amount
    if (col === 'start')          return new Date(l.start_date).getTime()
    if (col === 'end')            return l.end_date ? new Date(l.end_date).getTime() : 0
    if (col === 'status')         return STATUS_RANK[l.status] ?? 99
    if (col === 'type')           return TYPE_LABEL[l.loan_type] ?? l.loan_type
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

  // --- Accordion state -----------------------------------------------------
  // Detail is fetched once per loan and stored in `cache`. Re-expanding the
  // same row reads from cache instantly. `loading` and `errors` drive the
  // expanded-row placeholders. `inflightRef` is the synchronous dedup guard
  // for the fetch — state setters in React 18 run their updaters during the
  // next render, so they can't be used as an immediate "have I started?" lock.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
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

  const toggleExpand = useCallback(
    (id: string) => {
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      // Cached → returns immediately. In flight → de-duplicated. Else fetches.
      void fetchDetail(id)
    },
    [fetchDetail],
  )

  return (
    <div className="overflow-clip rounded-2xl border border-gray-200 bg-white">
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
      <div className="overflow-x-auto lg:overflow-x-visible">
        <table className="sticky-thead min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <SortableHeader compact col="loan_number"   label="Loan #"        sort={sort} onToggle={toggleSort} />
              <SortableHeader compact col="member"        label="Member"        sort={sort} onToggle={toggleSort} />
              <SortableHeader compact col="type"          label="Type"          sort={sort} onToggle={toggleSort} />
              <SortableHeader compact col="principal"     label="Principal"     align="right" sort={sort} onToggle={toggleSort} />
              <SortableHeader compact col="start"         label="Start date"    sort={sort} onToggle={toggleSort} />
              {showEndDate && (
                <SortableHeader compact col="end"         label="End date"      sort={sort} onToggle={toggleSort} />
              )}
              <SortableHeader compact col="status"        label="Status"        sort={sort} onToggle={toggleSort} />
              <SortableHeader compact col="paid_interest" label="Interest paid" align="right" sort={sort} onToggle={toggleSort} />
              <SortableHeader compact col="interest_due"  label="Interest due"  align="right" sort={sort} onToggle={toggleSort} />
              <SortableHeader compact col="balance"       label="Outstanding"   align="right" sort={sort} onToggle={toggleSort} />
              <th scope="col" className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={colspan} className="px-4 py-12 text-center text-sm text-gray-400">
                  {query ? `No matches for "${query}"` : (emptyMessage ?? 'No loans yet.')}
                </td>
              </tr>
            ) : (
              sorted.map((l) => {
                const isOpen = expandable && expanded.has(l.id)
                const isClosedLoan = l.status === 'paid' || l.status === 'write_off'
                const cached = cache.get(l.id)
                const isLoading = loading.has(l.id) && !cached
                const errMsg = errors.get(l.id)
                const rowBaseClasses = 'transition-colors'
                const rowOpenClasses = isOpen
                  ? 'bg-blue-50/40 ring-1 ring-inset ring-blue-100'
                  : 'hover:bg-gray-50'
                return (
                  <Fragment key={l.id}>
                    <tr className={`${rowBaseClasses} ${rowOpenClasses}`}>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-gray-700">
                        {l.loan_number}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-gray-900">
                        {l.member_name ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span
                          className={
                            'rounded-full px-2 py-0.5 text-xs font-medium ring-1 ' +
                            (TYPE_PILL[l.loan_type] ?? TYPE_PILL.personal)
                          }
                        >
                          {TYPE_LABEL[l.loan_type] ?? l.loan_type}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-gray-700">
                        {formatRupees(l.principal_amount)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">
                        {formatDate(l.start_date)}
                      </td>
                      {showEndDate && (
                        <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">
                          {formatDate(l.end_date ?? null)}
                        </td>
                      )}
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span
                          className={
                            'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ' +
                            (STATUS_PILL[l.status] ?? STATUS_PILL.active)
                          }
                        >
                          {STATUS_LABEL[l.status] ?? l.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-gray-700">
                        {formatRupees(l.paid_interest)}
                      </td>
                      <td
                        className={
                          'whitespace-nowrap px-3 py-2.5 text-right tabular-nums ' +
                          (isClosedLoan
                            ? 'text-gray-400'
                            : l.interest_due > 0
                            ? 'font-medium text-amber-700'
                            : 'text-gray-500')
                        }
                      >
                        {isClosedLoan ? '—' : formatRupees(l.interest_due)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-gray-900">
                        {formatRupees(l.balance)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        {expandable ? (
                          <ExpandToggle
                            isOpen={isOpen}
                            onClick={() => toggleExpand(l.id)}
                            controlsId={`loan-detail-${l.id}`}
                            labelOpen={`Hide details for loan ${l.loan_number}`}
                            labelClosed={`Show details for loan ${l.loan_number}`}
                          />
                        ) : (
                          <Link
                            href={l.detail_href}
                            className="text-xs font-medium text-blue-600 hover:text-blue-800"
                          >
                            {linkLabel}
                          </Link>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr
                        id={`loan-detail-${l.id}`}
                        className="border-l-2 border-l-blue-500 bg-gradient-to-b from-blue-50/50 to-white"
                      >
                        <td colSpan={colspan} className="p-0">
                          {isLoading ? (
                            <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
                              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
                              Loading loan details…
                            </div>
                          ) : errMsg && !cached ? (
                            <div className="p-6 text-sm text-rose-600">{errMsg}</div>
                          ) : cached ? (
                            <LoanDetailPanel data={cached} />
                          ) : null}
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
