'use client'

import { useCallback } from 'react'
import { formatRupees } from '@/lib/format'
import {
  SortableHeader,
  TableSearch,
  useSortable,
  useTableFilter,
} from '@/components/table-controls'
import type { DashboardMemberMonthRow } from '@/lib/actions/dashboard'

/**
 * Member × Month contribution matrix. Reuses the same wrapper shell + hooks
 * as `transactions-table.tsx` (overflow-clip wrapper, sticky-thead, the
 * SortableHeader / TableSearch primitives) so every dashboard table looks and
 * behaves consistently. Sortable on Member (alphabetical) and Total
 * (numeric); months are display-only because sorting by a single month is
 * rarely useful and a row of 12 sort affordances clutters the header.
 */

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'] as const
type MonthKey = (typeof MONTHS)[number]
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

type SortKey = 'member' | 'total'

export function MemberMonthMatrix({ rows }: { rows: DashboardMemberMonthRow[] }) {
  const stringify = useCallback(
    (r: DashboardMemberMonthRow) => r.member_name,
    [],
  )
  const { filtered, query, setQuery } = useTableFilter(rows, stringify)

  const accessor = useCallback(
    (r: DashboardMemberMonthRow, col: SortKey) => {
      if (col === 'member') return r.member_name
      return r.total
    },
    [],
  )
  const { sorted, sort, toggleSort } = useSortable<DashboardMemberMonthRow, SortKey>(
    filtered,
    accessor,
  )

  // Column totals from the FILTERED set so the totals row matches the
  // visible body. Re-computing per-render is fine — there's only one matrix.
  const colTotals = MONTHS.reduce<Record<MonthKey, number>>(
    (acc, k) => {
      acc[k] = filtered.reduce((s, r) => s + (r[k] ?? 0), 0)
      return acc
    },
    {} as Record<MonthKey, number>,
  )
  const grandTotal = filtered.reduce((s, r) => s + r.total, 0)

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-gray-200 px-3 py-6 text-center text-xs text-gray-400">
        No contributions recorded for this year yet.
      </p>
    )
  }

  return (
    <div className="overflow-clip rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 bg-gray-50/30 px-4 py-2.5">
        <TableSearch
          value={query}
          onChange={setQuery}
          placeholder="Search by member name…"
          matched={filtered.length}
          total={rows.length}
        />
      </div>

      {/* lg:overflow-x-visible drops the local scroll context at desktop
          widths so the .sticky-thead rule pins headers against the
          viewport (under the TopBar) instead of against this wrapper.
          At <lg the wrapper keeps overflow-x:auto so the wide matrix
          can still scroll horizontally on narrow viewports. */}
      <div className="overflow-x-auto lg:overflow-x-visible">
        <table className="sticky-thead min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <SortableHeader
                col="member"
                label="Member"
                sort={sort}
                onToggle={toggleSort}
              />
              {MONTH_LABELS.map((m) => (
                <th
                  key={m}
                  scope="col"
                  className="px-2 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                >
                  {m}
                </th>
              ))}
              <SortableHeader
                col="total"
                label="Total"
                align="right"
                sort={sort}
                onToggle={toggleSort}
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={MONTH_LABELS.length + 2}
                  className="px-4 py-12 text-center text-sm text-gray-400"
                >
                  {query ? `No matches for "${query}"` : 'No contributions recorded for this year yet.'}
                </td>
              </tr>
            ) : (
              sorted.map((r) => (
                <tr
                  key={r.member_id ?? r.member_name}
                  className="transition-colors hover:bg-gray-50"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                    {r.member_name}
                  </td>
                  {MONTHS.map((k) => {
                    const v = r[k] ?? 0
                    return (
                      <td
                        key={k}
                        className={
                          'whitespace-nowrap px-2 py-3 text-right tabular-nums ' +
                          (v > 0 ? 'text-gray-700' : 'text-gray-300')
                        }
                      >
                        {v > 0 ? formatRupees(v) : '—'}
                      </td>
                    )
                  })}
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-gray-900">
                    {formatRupees(r.total)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot className="bg-gray-50 text-sm">
              <tr>
                <td className="px-4 py-3 font-medium text-gray-700">Total</td>
                {MONTHS.map((k) => (
                  <td
                    key={k}
                    className="whitespace-nowrap px-2 py-3 text-right tabular-nums font-medium text-gray-900"
                  >
                    {colTotals[k] > 0 ? formatRupees(colTotals[k]) : '—'}
                  </td>
                ))}
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-gray-900">
                  {formatRupees(grandTotal)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
