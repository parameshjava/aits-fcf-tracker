import type { TransactionType } from './constants'

export type RawTxn = {
  id: string
  amount: number | string
  transaction_type: TransactionType
  interest_source?: 'loans' | 'bank' | null
  transaction_date: string
  member_name?: string | null
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function listYears(txns: RawTxn[]): number[] {
  const set = new Set<number>()
  for (const t of txns) set.add(new Date(t.transaction_date).getUTCFullYear())
  const arr = Array.from(set).filter((y) => Number.isFinite(y)).sort((a, b) => b - a)
  if (!arr.includes(new Date().getUTCFullYear())) arr.unshift(new Date().getUTCFullYear())
  return arr
}

export type DashboardMonth = {
  month: string
  /** 0-based month index (0 = Jan). Carried through to the chart so click
   *  handlers can construct a YYYY-MM filter without parsing the label. */
  monthIndex: number
  contributions: number
  loanInterest:  number
  bankInterest:  number
}

export function dashboardMonthlySeries(txns: RawTxn[], year: number): DashboardMonth[] {
  const buckets: DashboardMonth[] = MONTH_LABELS.map((m, i) => ({
    month: m,
    monthIndex: i,
    contributions: 0,
    loanInterest:  0,
    bankInterest:  0,
  }))

  for (const t of txns) {
    const d = new Date(t.transaction_date)
    if (d.getUTCFullYear() !== year) continue
    const bucket = buckets[d.getUTCMonth()]
    const amt = Number(t.amount) || 0

    if (t.transaction_type === 'contribution') {
      bucket.contributions += amt
    } else if (t.transaction_type === 'interest') {
      if (t.interest_source === 'bank') bucket.bankInterest += amt
      else bucket.loanInterest += amt
    }
  }

  return buckets
}

export type SectionMonth = { month: string; value: number }

export function sectionMonthlySeries(
  txns: RawTxn[],
  year: number,
  types: TransactionType[],
): SectionMonth[] {
  const set = new Set<TransactionType>(types)
  const buckets: SectionMonth[] = MONTH_LABELS.map((m) => ({ month: m, value: 0 }))
  for (const t of txns) {
    if (!set.has(t.transaction_type)) continue
    const d = new Date(t.transaction_date)
    if (d.getUTCFullYear() !== year) continue
    buckets[d.getUTCMonth()].value += Number(t.amount) || 0
  }
  return buckets
}

/** Per-year totals for a section's transaction types. Returns a fixed-
 *  length window (default: the current year + 9 preceding years = 10 bars)
 *  so the chart always shows a consistent timeline — years with no activity
 *  appear as empty bars rather than disappearing entirely. Field is named
 *  `month` only to match the shape <SectionBars> expects; the value is a
 *  year label like "2024".
 */
export function sectionYearlySeries(
  txns: RawTxn[],
  types: TransactionType[],
  windowSize = 10,
): SectionMonth[] {
  const set = new Set<TransactionType>(types)
  const byYear = new Map<number, number>()
  for (const t of txns) {
    if (!set.has(t.transaction_type)) continue
    const y = new Date(t.transaction_date).getUTCFullYear()
    if (!Number.isFinite(y)) continue
    byYear.set(y, (byYear.get(y) ?? 0) + (Number(t.amount) || 0))
  }

  const currentYear = new Date().getUTCFullYear()
  const startYear = currentYear - (windowSize - 1)
  const result: SectionMonth[] = []
  for (let y = startYear; y <= currentYear; y++) {
    result.push({ month: String(y), value: byYear.get(y) ?? 0 })
  }
  return result
}

export type MemberTotal = { member: string; total: number; count: number }

/** Sum all `transaction_type === 'contribution'` rows per member,
 *  sorted from highest to lowest. Rows with no linked member fall under
 *  "Unassigned" so the total still reconciles with the headline KPI. */
export function memberContributionTotals(txns: RawTxn[]): MemberTotal[] {
  const totals = new Map<string, { total: number; count: number }>()
  for (const t of txns) {
    if (t.transaction_type !== 'contribution') continue
    const name = (t.member_name ?? '').trim() || 'Unassigned'
    const cur = totals.get(name) ?? { total: 0, count: 0 }
    cur.total += Number(t.amount) || 0
    cur.count += 1
    totals.set(name, cur)
  }
  return Array.from(totals, ([member, v]) => ({ member, total: v.total, count: v.count })).sort(
    (a, b) => b.total - a.total,
  )
}

export function sumWhere(
  txns: RawTxn[],
  predicate: (t: RawTxn) => boolean,
): number {
  let s = 0
  for (const t of txns) if (predicate(t)) s += Number(t.amount) || 0
  return s
}

export function countWhere(
  txns: RawTxn[],
  predicate: (t: RawTxn) => boolean,
): number {
  let c = 0
  for (const t of txns) if (predicate(t)) c++
  return c
}
