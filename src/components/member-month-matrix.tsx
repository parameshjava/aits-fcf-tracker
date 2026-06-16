'use client'

import { useMemo, useState } from 'react'
import { formatRupees } from '@/lib/format'
import { TableExportMenu } from '@/components/table-export'
import { PrDataTable, type PrColumn } from '@/components/ui/pr/data-table'
import type { Cell } from '@/lib/table-export'
import type { DashboardMemberMonthRow } from '@/lib/actions/dashboard'

/**
 * Member × Month contribution matrix. Migrated onto the shared PrDataTable for
 * consistency with the other dashboard tables, with two deliberate deviations
 * from a plain list table:
 *  - It's a PIVOT (members × 12 months) so columns are generated dynamically;
 *    per-column month filters make no sense, so the global search is scoped to
 *    MEMBER NAME only (`globalFilterFields={['member_name']}`).
 *  - The 12-month grid is wide, so we opt into horizontal scrolling
 *    (`scrollable`) rather than card-stacking — a 12-column pivot stacks
 *    poorly. The shared wrapper doesn't expose PrimeReact's `frozen` column
 *    prop, so the member column scrolls with the rest (plain scrollable);
 *    a `minWidth` keeps it readable.
 * Sortable on Member (alphabetical) and Total (numeric); month columns are
 * display-only because sorting by a single month is rarely useful.
 *
 * Column totals (footer row) are derived from the table's current
 * filtered+sorted rows via `onValueChange` so they always match the visible
 * body, matching the previous behaviour.
 */

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'] as const
type MonthKey = (typeof MONTHS)[number]
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function MemberMonthMatrix({
  rows,
  year,
}: {
  rows: DashboardMemberMonthRow[]
  /** Contribution year, used to label the export file. */
  year?: number
}) {
  // dataKey must be a stable, unique, non-null string field. member_id can be
  // null for orphaned rows, so bake a guaranteed key onto each row.
  const augmented = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        _key: r.member_id ?? r.member_name,
      })),
    [rows],
  )

  // The DataTable reports its current filtered+sorted rows here; the footer
  // totals + export derive from these so they reflect what's on screen.
  // `null` until the first onValueChange fires → fall back to the full set.
  const [processed, setProcessed] = useState<typeof augmented | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const visible = processed ?? augmented

  // Column totals from the visible set so the totals row matches the body.
  const colTotals = MONTHS.reduce<Record<MonthKey, number>>(
    (acc, k) => {
      acc[k] = visible.reduce((s, r) => s + (r[k] ?? 0), 0)
      return acc
    },
    {} as Record<MonthKey, number>,
  )
  const grandTotal = visible.reduce((s, r) => s + r.total, 0)

  // Export reflects the current sort + search filter (uses `visible`).
  const exportColumns = ['Member', ...MONTH_LABELS.map((m) => `${m} (₹)`), 'Total (₹)']
  const exportRows: Cell[][] = visible.map((r) => [
    r.member_name,
    ...MONTHS.map((k) => r[k] ?? 0),
    r.total,
  ])
  const exportFooter: Cell[] = ['Total', ...MONTHS.map((k) => colTotals[k]), grandTotal]
  const exportCriteria = [
    ...(year ? [{ label: 'Year', value: String(year) }] : []),
    ...(searchQuery.trim() ? [{ label: 'Search', value: searchQuery.trim() }] : []),
  ]

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-gray-200 px-3 py-6 text-center text-xs text-gray-400">
        No contributions recorded for this year yet.
      </p>
    )
  }

  type Row = (typeof augmented)[number]

  const columns: PrColumn<Row>[] = [
    {
      // Display-only serial number; follows the current sort/filter order.
      field: '_key',
      header: '#',
      style: { width: '3rem', minWidth: '3rem' },
      bodyClassName: 'whitespace-nowrap text-right tabular-nums text-gray-400',
      headerClassName: 'text-right',
      body: (_r, { rowIndex }) => rowIndex + 1,
      footer: <span />,
    },
    {
      field: 'member_name',
      header: 'Member',
      sortable: true,
      bodyClassName: 'whitespace-nowrap text-sm font-medium text-gray-900',
      style: { minWidth: '11rem' },
      footer: <span className="font-medium text-gray-700">Total</span>,
    },
    // One column per month, generated dynamically.
    ...MONTHS.map<PrColumn<Row>>((k, i) => ({
      field: k,
      header: MONTH_LABELS[i],
      align: 'right',
      style: { minWidth: '5.5rem' },
      headerClassName: 'text-right',
      bodyClassName: 'whitespace-nowrap text-right tabular-nums',
      body: (r) => {
        const v = r[k] ?? 0
        return (
          <span className={v > 0 ? 'text-gray-700' : 'text-gray-300'}>
            {v > 0 ? formatRupees(v) : '—'}
          </span>
        )
      },
      footer: (
        <span className="font-medium tabular-nums text-gray-900">
          {colTotals[k] > 0 ? formatRupees(colTotals[k]) : '—'}
        </span>
      ),
    })),
    {
      field: 'total',
      header: 'Total',
      sortable: true,
      align: 'right',
      dataType: 'numeric',
      style: { minWidth: '6.5rem' },
      headerClassName: 'text-right',
      bodyClassName: 'whitespace-nowrap text-right font-semibold tabular-nums',
      body: (r) => (
        <span className={r.total > 0 ? 'text-gray-900' : 'text-gray-300'}>
          {r.total > 0 ? formatRupees(r.total) : '—'}
        </span>
      ),
      footer: (
        <span className="font-semibold tabular-nums text-gray-900">
          {formatRupees(grandTotal)}
        </span>
      ),
    },
  ]

  const exportMenu = (
    <TableExportMenu
      filename={year ? `member-month-${year}` : 'member-month-matrix'}
      title={year ? `Member × Month contributions — ${year}` : 'Member × Month contributions'}
      columns={exportColumns}
      rows={exportRows}
      footer={exportFooter}
      criteria={exportCriteria}
    />
  )

  return (
    <div className="overflow-clip rounded-2xl border border-gray-200 bg-white">
      <PrDataTable<Row>
        value={augmented}
        columns={columns}
        dataKey="_key"
        emptyMessage={
          searchQuery
            ? `No matches for "${searchQuery}"`
            : 'No contributions recorded for this year yet.'
        }
        // Global search filters by member name ONLY — month amounts make no
        // sense as free-text search targets.
        globalFilterFields={['member_name']}
        globalSearchPlaceholder="Search by member name…"
        header={exportMenu}
        onValueChange={setProcessed}
        onGlobalFilterChange={setSearchQuery}
        // Wide 12-month grid → horizontal scroll instead of card stacking.
        scrollable
        // It's a bounded pivot (all members at once, with a footer totals row);
        // paginating it would hide rows and break the column totals reading.
        paginated={false}
      />
    </div>
  )
}
