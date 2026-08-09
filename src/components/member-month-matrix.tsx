'use client'

import { useMemo, useState } from 'react'
import { formatIndianGroups } from '@/lib/format'
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
 *  - It's rendered at SPREADSHEET density (`pr-table-dense` + gridlines +
 *    striping) so all 15 columns fit a laptop viewport instead of pushing the
 *    late months out of view. Two things buy that width back: halved cell
 *    padding (the CSS class) and month amounts printed WITHOUT the ₹ prefix —
 *    the caption carries the unit once, like a spreadsheet.
 *  - Widths follow the spreadsheet convention: the numeric columns are sized
 *    to their digits (a `minWidth` floor only) and the Member column takes
 *    every pixel left over (`width: 100%`), so names show in full and the
 *    slack never turns into gaps between the months. Horizontal scroll is
 *    still there as the fallback when the sum genuinely exceeds the window —
 *    which is always the case on a phone, so the name column is capped below
 *    `sm` to keep the frozen pair from eating the viewport.
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

/**
 * Grid amount: the same en-IN grouping `formatRupees` produces (whole rupees,
 * lakh grouping) MINUS the ₹ prefix, which the table states once in its header
 * instead of repeating in 300+ cells. Twelve of those prefixes per row is the
 * difference between the grid fitting a laptop screen and not.
 */
function gridAmount(n: number): string {
  return formatIndianGroups(String(Math.round(n)))
}

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
      // Frozen with Member below: the two label columns stay put while the
      // months scroll under them, so a number is never orphaned from its row.
      frozen: true,
      style: { width: '2.25rem', minWidth: '2.25rem' },
      bodyClassName: 'whitespace-nowrap text-right tabular-nums text-gray-400',
      headerClassName: 'text-right',
      body: (_r, { rowIndex }) => rowIndex + 1,
      footer: <span />,
    },
    {
      field: 'member_name',
      header: 'Member',
      sortable: true,
      frozen: true,
      // `nowrap` means the column can never be narrower than the longest name,
      // so from `sm` up names always render in full — no ellipsis, no hover.
      bodyClassName: 'whitespace-nowrap font-medium text-gray-900',
      // `width: 100%` is the slack sink. Under `table-layout: auto` the other
      // columns are satisfied at their content width first and everything left
      // over lands here — so the months hug their digits instead of being
      // padded out with dead space when the grid is narrower than the window.
      // The floor matches the phone cap below; on wider screens the names
      // themselves push the column past it.
      style: { width: '100%', minWidth: '9.5rem' },
      // On a phone there is no slack to absorb, so an uncapped name column
      // would take ~233px of a ~358px viewport — and being frozen, it would
      // hold that width permanently, leaving barely two months on screen.
      // Below `sm` only, cap it and ellipsise; `sm:max-w-none` hands the full
      // name back everywhere else. `truncate`'s overflow rules stay harmless
      // once uncapped, since the span still measures at its full text width.
      body: (r) => (
        // The cell shows the alias when the member has one; the tooltip always
        // carries the full name so an unfamiliar alias is one hover from an
        // answer.
        <span
          className="block max-w-[9.5rem] truncate sm:max-w-none"
          title={r.member_full_name}
        >
          {r.member_name}
        </span>
      ),
      footer: <span className="font-medium text-gray-700">Total</span>,
    },
    // One column per month, generated dynamically.
    ...MONTHS.map<PrColumn<Row>>((k, i) => ({
      field: k,
      header: MONTH_LABELS[i],
      align: 'right',
      // A floor, not a target — these size to their widest amount. Anything
      // larger just becomes empty space, since the slack goes to Member.
      style: { minWidth: '2.75rem' },
      headerClassName: 'text-right',
      bodyClassName: 'whitespace-nowrap text-right tabular-nums',
      body: (r) => {
        const v = r[k] ?? 0
        return (
          <span className={v > 0 ? 'text-gray-700' : 'text-gray-300'}>
            {v > 0 ? gridAmount(v) : '—'}
          </span>
        )
      },
      footer: (
        <span className="font-medium tabular-nums text-gray-900">
          {colTotals[k] > 0 ? gridAmount(colTotals[k]) : '—'}
        </span>
      ),
    })),
    {
      field: 'total',
      header: 'Total',
      sortable: true,
      align: 'right',
      dataType: 'numeric',
      style: { minWidth: '4rem' },
      headerClassName: 'text-right',
      bodyClassName: 'whitespace-nowrap text-right font-semibold tabular-nums',
      body: (r) => (
        <span className={r.total > 0 ? 'text-gray-900' : 'text-gray-300'}>
          {r.total > 0 ? gridAmount(r.total) : '—'}
        </span>
      ),
      footer: (
        <span className="font-semibold tabular-nums text-gray-900">
          {gridAmount(grandTotal)}
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
    <div className="pr-table-dense overflow-clip rounded-2xl border border-gray-200 bg-white">
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
        // sense as free-text search targets. Both the alias and the full name
        // are searchable, so either one finds the row.
        globalFilterFields={['member_name', 'member_full_name']}
        globalSearchPlaceholder="Search by member name or alias…"
        header={exportMenu}
        onValueChange={setProcessed}
        onGlobalFilterChange={setSearchQuery}
        // Spreadsheet reading: gridlines + zebra rows make it possible to track
        // a cell back to its member and its month across 12 narrow columns.
        gridlines
        striped
        // Wide 12-month grid → horizontal scroll instead of card stacking.
        scrollable
        // It's a bounded pivot (all members at once, with a footer totals row);
        // paginating it would hide rows and break the column totals reading.
        paginated={false}
      />
      {/* The unit the cells no longer repeat. A caption, not a toolbar chip:
          the toolbar is already tight on a phone, and that's exactly where a
          reader is most likely to need telling. */}
      <p className="border-t border-gray-200 px-3 py-2 text-[0.6875rem] text-gray-400">
        All amounts in ₹.
        <span className="sm:hidden"> Scroll the grid sideways for later months.</span>
      </p>
    </div>
  )
}
