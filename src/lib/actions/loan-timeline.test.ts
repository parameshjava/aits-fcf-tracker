import { describe, expect, it } from 'vitest'
import {
  accrualPeriodLabel,
  buildLoanTimeline,
  type AccrualPayment,
  type LoanTimelineRow,
} from './loan-timeline'
import type { LoanInterestAccrual } from './loan-interest'
import type { LoanDetailTxn } from './loans'

function accrual(over: Partial<LoanInterestAccrual> = {}): LoanInterestAccrual {
  return {
    id: 'a1',
    loan_id: 'loan-1',
    period_end: '2025-10-31',
    amount_due: 650,
    paid_amount: 0,
    status: 'pending',
    interest_rate_used: 650,
    balance_basis: 100_000,
    is_opening_balance: false,
    waiver_reason: null,
    paid_at: null,
    created_at: '2025-10-31T18:30:00Z',
    ...over,
  }
}

function txn(over: Partial<LoanDetailTxn> = {}): LoanDetailTxn {
  return {
    id: 't1',
    transaction_date: '2025-12-10',
    transaction_id: '20251210-04',
    transaction_type: 'interest',
    interest_source: 'loans',
    amount: 1300,
    description: null,
    ...over,
  }
}

describe('buildLoanTimeline', () => {
  it('returns empty timeline when there are no accruals or transactions', () => {
    expect(buildLoanTimeline([], [], [], new Map())).toEqual([])
  })

  it('assigns 1-based SNO in sorted order', () => {
    const a = accrual({ id: 'a-eom', period_end: '2025-10-31' })
    const t = txn({
      id: 't-repay',
      transaction_date: '2025-11-15',
      transaction_id: '20251115-02',
      transaction_type: 'loan_repayment',
      interest_source: null,
      amount: 25_000,
    })
    const rows = buildLoanTimeline(
      [a],
      [t],
      [],
      new Map([['t-repay', '20251115-02']]),
    )
    expect(rows.map((r) => r.sno)).toEqual([1, 2])
  })

  it('folds an interest-payment transaction into its accrual settlements', () => {
    const oct = accrual({ id: 'a-oct', period_end: '2025-10-31', status: 'paid', paid_amount: 650 })
    const nov = accrual({ id: 'a-nov', period_end: '2025-11-30', status: 'paid', paid_amount: 650 })
    const pay = txn({ id: 't-pay', transaction_date: '2025-12-10', transaction_id: '20251210-04', amount: 1300 })
    const payments: AccrualPayment[] = [
      { accrualId: 'a-oct', transactionId: 't-pay', amount: 650 },
      { accrualId: 'a-nov', transactionId: 't-pay', amount: 650 },
    ]
    const rows = buildLoanTimeline(
      [oct, nov],
      [pay],
      payments,
      new Map([['t-pay', '20251210-04']]),
    )

    // The interest-payment transaction is absorbed into the accruals.
    expect(rows.filter((r) => r.kind === 'transaction')).toHaveLength(0)
    const octRow = rows.find((r) => r.kind === 'accrual' && r.accrual.id === 'a-oct') as Extract<LoanTimelineRow, { kind: 'accrual' }>
    const novRow = rows.find((r) => r.kind === 'accrual' && r.accrual.id === 'a-nov') as Extract<LoanTimelineRow, { kind: 'accrual' }>

    expect(octRow.settlements).toEqual([
      {
        txnUuid: 't-pay',
        txnIdShort: '20251210-04',
        date: '2025-12-10',
        amount: 650,
        description: null,
      },
    ])
    expect(novRow.settlements[0].txnIdShort).toBe('20251210-04')
    expect(novRow.settlements[0].amount).toBe(650)
  })

  it('sorts opening balance row to the top', () => {
    const opening = accrual({
      id: 'a-open',
      period_end: '2024-09-30',
      is_opening_balance: true,
      amount_due: 5000,
    })
    const later = accrual({ id: 'a-oct', period_end: '2025-10-31' })
    const rows = buildLoanTimeline([later, opening], [], [], new Map())
    expect(rows[0].kind === 'accrual' && rows[0].accrual.id).toBe('a-open')
    expect(rows[1].kind === 'accrual' && rows[1].accrual.id).toBe('a-oct')
  })

  it('waived accruals have empty settlements', () => {
    const w = accrual({ id: 'a-w', status: 'waived', waiver_reason: 'loan_closed', period_end: '2025-12-31' })
    const rows = buildLoanTimeline([w], [], [], new Map())
    expect(rows).toHaveLength(1)
    expect(rows[0].kind === 'accrual' && rows[0].settlements).toEqual([])
  })

  it('non-interest transactions remain as standalone rows', () => {
    const repay = txn({
      id: 't-repay',
      transaction_id: '20251115-02',
      transaction_date: '2025-11-15',
      transaction_type: 'loan_repayment',
      interest_source: null,
      amount: 25_000,
    })
    const rows = buildLoanTimeline([], [repay], [], new Map([['t-repay', '20251115-02']]))
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('transaction')
  })

  it('preserves an interest-payment transaction when it has no junction allocation', () => {
    // Legacy seed data: interest transaction exists but no row in
    // loan_interest_payments. We must still surface it as a standalone row.
    const t = txn({ id: 't-legacy', transaction_id: '20200101-01', transaction_date: '2020-01-01' })
    const rows = buildLoanTimeline([], [t], [], new Map([['t-legacy', '20200101-01']]))
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('transaction')
  })

  it('drops payments whose transaction UUID does not match a known transaction', () => {
    const a = accrual({ id: 'a-ghost' })
    const payments: AccrualPayment[] = [
      { accrualId: 'a-ghost', transactionId: 't-missing', amount: 100 },
    ]
    const rows = buildLoanTimeline([a], [], payments, new Map())
    expect(rows).toHaveLength(1)
    expect(rows[0].kind === 'accrual' && rows[0].settlements).toEqual([])
  })
})

describe('accrualPeriodLabel', () => {
  it('returns "Opening balance" for an opening-balance accrual', () => {
    const a = accrual({ is_opening_balance: true })
    expect(accrualPeriodLabel(a)).toBe('Opening balance')
  })

  it('returns the formatted month label for a normal accrual with a valid period_end', () => {
    const a = accrual({ period_end: '2025-10-31', is_opening_balance: false })
    expect(accrualPeriodLabel(a)).toBe('Oct 2025')
  })

  it('falls back to the raw string when period_end is malformed', () => {
    const a = accrual({ period_end: 'not-a-date', is_opening_balance: false })
    expect(accrualPeriodLabel(a)).toBe('not-a-date')
  })
})
