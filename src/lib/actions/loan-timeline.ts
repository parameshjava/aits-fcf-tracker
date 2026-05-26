import type { LoanInterestAccrual } from './loan-interest'
import type { LoanDetailTxn } from './loans'

/** One concrete settlement of an accrual: a slice of a transaction's amount
 *  applied to a single accrual row via `loan_interest_payments`. */
export type AccrualSettlement = {
  txnUuid: string
  txnIdShort: string   // e.g. "20251210-04"
  date: string         // transaction_date (YYYY-MM-DD)
  amount: number       // amount_applied for this allocation
  description: string | null
}

export type LoanTimelineRow =
  | {
      kind: 'accrual'
      sno: number
      sortDate: string             // period_end (YYYY-MM-DD)
      accrual: LoanInterestAccrual
      settlements: AccrualSettlement[]
    }
  | {
      kind: 'transaction'
      sno: number
      sortDate: string             // transaction_date (YYYY-MM-DD)
      txn: LoanDetailTxn
    }

export type AccrualPayment = {
  accrualId: string
  transactionId: string  // transactions.id (UUID)
  amount: number         // amount_applied for this allocation
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
  const txnById = new Map(transactions.map((t) => [t.id, t]))
  const settlementsByAccrual = new Map<string, AccrualSettlement[]>()
  const interestTxnsConsumed = new Set<string>()

  for (const p of payments) {
    const txn = txnById.get(p.transactionId)
    if (!txn) continue
    interestTxnsConsumed.add(p.transactionId)
    const settlement: AccrualSettlement = {
      txnUuid: p.transactionId,
      txnIdShort: txnShortIdByUuid.get(p.transactionId) ?? txn.transaction_id,
      date: txn.transaction_date,
      amount: p.amount,
      description: txn.description,
    }
    const list = settlementsByAccrual.get(p.accrualId) ?? []
    list.push(settlement)
    settlementsByAccrual.set(p.accrualId, list)
  }

  // Stable order inside each settlement bucket: by date, then by short id.
  for (const list of settlementsByAccrual.values()) {
    list.sort((a, b) => {
      if (a.date < b.date) return -1
      if (a.date > b.date) return 1
      return a.txnIdShort < b.txnIdShort ? -1 : a.txnIdShort > b.txnIdShort ? 1 : 0
    })
  }

  type Pending = Omit<Extract<LoanTimelineRow, { kind: 'accrual' }>, 'sno'>
                | Omit<Extract<LoanTimelineRow, { kind: 'transaction' }>, 'sno'>

  const pending: Pending[] = []
  for (const a of accruals) {
    pending.push({
      kind: 'accrual',
      sortDate: a.period_end,
      accrual: a,
      settlements: settlementsByAccrual.get(a.id) ?? [],
    })
  }
  for (const t of transactions) {
    // Interest-payment transactions are folded into their accrual row(s).
    // Only emit them standalone if they have NO junction allocation (e.g.
    // legacy seed data imported before the accruals model existed).
    const isInterestPayment =
      t.transaction_type === 'interest' && t.interest_source === 'loans'
    if (isInterestPayment && interestTxnsConsumed.has(t.id)) continue
    pending.push({
      kind: 'transaction',
      sortDate: t.transaction_date,
      txn: t,
    })
  }

  // Sort: sortDate asc; on ties, accrual before transaction so an end-of-month
  // accrual appears above a same-day settlement transaction.
  pending.sort((x, y) => {
    if (x.sortDate < y.sortDate) return -1
    if (x.sortDate > y.sortDate) return 1
    if (x.kind === y.kind) return 0
    return x.kind === 'accrual' ? -1 : 1
  })

  return pending.map((row, i) => ({ ...row, sno: i + 1 }) as LoanTimelineRow)
}
