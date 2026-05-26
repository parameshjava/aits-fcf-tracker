import type { LoanInterestAccrual } from './loan-interest'
import type { LoanDetailTxn } from './loans'

export type LoanTimelineRow =
  | {
      kind: 'accrual'
      sortDate: string             // period_end (YYYY-MM-DD)
      accrual: LoanInterestAccrual
      settledByTxnIds: string[]    // short txn ids like "20251210-04"; may be empty
    }
  | {
      kind: 'transaction'
      sortDate: string             // transaction_date (YYYY-MM-DD)
      txn: LoanDetailTxn
      settledAccrualPeriods: string[]  // ["Oct 2025", "Nov 2025"] — only for interest payments
    }

export type AccrualPayment = {
  accrualId: string
  transactionId: string  // transactions.id (UUID)
}

/** "Oct 2025" for normal rows; "Opening balance" for opening-balance rows. */
export function accrualPeriodLabel(a: LoanInterestAccrual): string {
  if (a.is_opening_balance) return 'Opening balance'
  const parts = a.period_end.split('-')
  if (parts.length !== 3) return a.period_end
  const year = Number(parts[0])
  const month = Number(parts[1])
  if (!Number.isFinite(year) || !Number.isFinite(month)) return a.period_end
  const name = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  })
  return `${name} ${year}`
}

export function buildLoanTimeline(
  accruals: LoanInterestAccrual[],
  transactions: LoanDetailTxn[],
  payments: AccrualPayment[],
  /** Map from transactions.id (UUID) → short transaction_id (e.g. "20251210-04"). */
  txnShortIdByUuid: Map<string, string>,
): LoanTimelineRow[] {
  const accrualById = new Map(accruals.map((a) => [a.id, a]))
  const settledByAccrual = new Map<string, string[]>()
  const settledByTxn = new Map<string, string[]>()

  for (const p of payments) {
    const short = txnShortIdByUuid.get(p.transactionId)
    if (short) {
      const list = settledByAccrual.get(p.accrualId) ?? []
      list.push(short)
      settledByAccrual.set(p.accrualId, list)
    }
    const acc = accrualById.get(p.accrualId)
    if (acc) {
      const list = settledByTxn.get(p.transactionId) ?? []
      list.push(accrualPeriodLabel(acc))
      settledByTxn.set(p.transactionId, list)
    }
  }

  const rows: LoanTimelineRow[] = []
  for (const a of accruals) {
    rows.push({
      kind: 'accrual',
      sortDate: a.period_end,
      accrual: a,
      settledByTxnIds: settledByAccrual.get(a.id) ?? [],
    })
  }
  for (const t of transactions) {
    rows.push({
      kind: 'transaction',
      sortDate: t.transaction_date,
      txn: t,
      settledAccrualPeriods: settledByTxn.get(t.id) ?? [],
    })
  }

  // Sort: sortDate asc; on ties, accrual before transaction so an end-of-month
  // accrual appears above a same-day settlement transaction.
  rows.sort((x, y) => {
    if (x.sortDate < y.sortDate) return -1
    if (x.sortDate > y.sortDate) return 1
    if (x.kind === y.kind) return 0
    return x.kind === 'accrual' ? -1 : 1
  })

  return rows
}
