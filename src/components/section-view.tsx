import { getTransactions } from '@/lib/actions/transactions'
import { formatRupees } from '@/lib/format'
import { KpiTile } from '@/components/kpi-tile'
import { SectionBars } from '@/components/charts/dashboard-bars'
import { TransactionsTable, type TxnRow } from '@/components/transactions-table'
import { YearPicker } from '@/components/year-picker'
import {
  countWhere,
  listYears,
  sectionMonthlySeries,
  sumWhere,
  type RawTxn,
} from '@/lib/aggregate'
import {
  SECTION_DESCRIPTIONS,
  SECTION_LABELS,
  SECTION_TYPES,
  type SectionKey,
} from '@/lib/transaction-groups'

export async function SectionView({
  section,
  searchParams,
}: {
  section: SectionKey
  searchParams: Promise<{ year?: string }>
}) {
  const { year: yearParam } = await searchParams
  const raw = (await getTransactions()) ?? []
  const txns = raw as RawTxn[]
  const allRows = raw as TxnRow[]
  const years = listYears(txns)
  const year = Number(yearParam) || years[0] || new Date().getUTCFullYear()
  const typeSet = new Set(SECTION_TYPES[section])
  const matching = txns.filter((t) => typeSet.has(t.contribution_type))
  const matchingRows = allRows.filter((t) =>
    typeSet.has(t.contribution_type as RawTxn['contribution_type']),
  )

  const total       = sumWhere(matching, () => true)
  const thisYear    = sumWhere(matching, (t) => new Date(t.transaction_date).getUTCFullYear() === year)
  const count       = countWhere(matching, () => true)
  const monthsWith  = new Set(
    matching
      .filter((t) => new Date(t.transaction_date).getUTCFullYear() === year)
      .map((t) => new Date(t.transaction_date).getUTCMonth()),
  ).size
  const avgPerMonth = monthsWith > 0 ? thisYear / monthsWith : 0

  const monthly = sectionMonthlySeries(txns, year, SECTION_TYPES[section])

  return (
    <div className="space-y-8">
      <p className="text-sm text-gray-500">{SECTION_DESCRIPTIONS[section]}</p>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile label="Total"     value={formatRupees(total)}       accent="blue" />
        <KpiTile label={`In ${year}`} value={formatRupees(thisYear)}    accent="indigo" />
        <KpiTile label="Avg / month" value={formatRupees(avgPerMonth)} hint={`${year} active months: ${monthsWith}`} accent="emerald" />
        <KpiTile label="Count"     value={count.toLocaleString('en-IN')} accent="gray" />
      </section>

      <section className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Transactions</h2>
            <p className="text-xs text-gray-500">{matchingRows.length} total</p>
          </div>
          <TransactionsTable rows={matchingRows} emptyLabel={`No ${SECTION_LABELS[section].toLowerCase()} yet`} />
        </div>

        <div className="rounded-2xl border border-gray-200/80 bg-white p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-900">Monthly trend</h2>
            <YearPicker years={years} value={year} />
          </div>
          <SectionBars data={monthly} section={section} />
        </div>
      </section>
    </div>
  )
}
