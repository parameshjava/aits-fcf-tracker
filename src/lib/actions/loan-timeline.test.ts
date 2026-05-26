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

  it('sorts by sortDate ascending and puts accruals before transactions on the same date', () => {
    const a = accrual({ id: 'a-eom', period_end: '2025-10-31' })
    const t = txn({ id: 't-eom', transaction_date: '2025-10-31', transaction_id: '20251031-01' })
    const rows = buildLoanTimeline(
      [a],
      [t],
      [],
      new Map([['t-eom', '20251031-01']]),
    )
    expect(rows.map((r) => r.kind)).toEqual(['accrual', 'transaction'])
  })

  it('cross-references accruals and a single multi-allocation payment', () => {
    const oct = accrual({ id: 'a-oct', period_end: '2025-10-31', status: 'paid', paid_amount: 650 })
    const nov = accrual({ id: 'a-nov', period_end: '2025-11-30', status: 'paid', paid_amount: 650 })
    const pay = txn({ id: 't-pay', transaction_date: '2025-12-10', transaction_id: '20251210-04', amount: 1300 })
    const payments: AccrualPayment[] = [
      { accrualId: 'a-oct', transactionId: 't-pay' },
      { accrualId: 'a-nov', transactionId: 't-pay' },
    ]
    const rows = buildLoanTimeline(
      [oct, nov],
      [pay],
      payments,
      new Map([['t-pay', '20251210-04']]),
    )

    const octRow = rows.find((r) => r.kind === 'accrual' && r.accrual.id === 'a-oct') as Extract<LoanTimelineRow, { kind: 'accrual' }>
    const novRow = rows.find((r) => r.kind === 'accrual' && r.accrual.id === 'a-nov') as Extract<LoanTimelineRow, { kind: 'accrual' }>
    const payRow = rows.find((r) => r.kind === 'transaction') as Extract<LoanTimelineRow, { kind: 'transaction' }>

    expect(octRow.settledByTxnIds).toEqual(['20251210-04'])
    expect(novRow.settledByTxnIds).toEqual(['20251210-04'])
    expect(payRow.settledAccrualPeriods).toEqual(['Oct 2025', 'Nov 2025'])
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

  it('marks waived accruals without settledByTxnIds', () => {
    const w = accrual({ id: 'a-w', status: 'waived', waiver_reason: 'loan_closed', period_end: '2025-12-31' })
    const rows = buildLoanTimeline([w], [], [], new Map())
    expect(rows).toHaveLength(1)
    expect(rows[0].kind === 'accrual' && rows[0].settledByTxnIds).toEqual([])
  })

  it('non-interest transactions appear with empty settledAccrualPeriods', () => {
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
    expect(rows[0].kind === 'transaction' && rows[0].settledAccrualPeriods).toEqual([])
  })

  it('skips settledByTxnIds when payment txn UUID is absent from the lookup map', () => {
    const a = accrual({ id: 'a-ghost' })
    const payments: AccrualPayment[] = [{ accrualId: 'a-ghost', transactionId: 't-missing' }]
    const rows = buildLoanTimeline([a], [], payments, new Map())
    expect(rows).toHaveLength(1)
    expect(rows[0].kind === 'accrual' && rows[0].settledByTxnIds).toEqual([])
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
