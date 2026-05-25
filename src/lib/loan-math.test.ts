import { describe, expect, it } from 'vitest'
import {
  addMonths,
  computeLoanFinancials,
  monthsBetween,
  monthsBetweenDates,
  type LoanFinancialsInput,
  type LoanTxnInput,
} from './loan-math'

// Test fixtures: ₹1,00,000 loan opened 2024-01-01, no waiver, no bad debt.
// ₹650 / lakh / month is the historical rate from public.reference.
const RATE = 650

function activeLoan(overrides: Partial<LoanFinancialsInput> = {}): LoanFinancialsInput {
  return {
    id: 'loan-1',
    status: 'active',
    principal_amount: 100_000,
    start_date: '2024-01-01',
    end_date: null,
    bad_debt: 0,
    interest_waiver_months: 0,
    ...overrides,
  }
}

function repayment(date: string, amount: number): LoanTxnInput {
  return { transaction_type: 'loan_repayment', interest_source: null, amount, transaction_date: date }
}

function interestPaid(date: string, amount: number): LoanTxnInput {
  return { transaction_type: 'interest', interest_source: 'loans', amount, transaction_date: date }
}

describe('monthsBetweenDates / monthsBetween', () => {
  it('counts calendar months by year + month delta, ignoring day-of-month', () => {
    expect(monthsBetweenDates(new Date('2024-01-15'), new Date('2024-04-15'))).toBe(3)
    expect(monthsBetweenDates(new Date('2024-01-15'), new Date('2024-04-01'))).toBe(3)
    expect(monthsBetweenDates(new Date('2024-01-15'), new Date('2024-04-30'))).toBe(3)
  })

  it('clamps to 0 when the end is before the start', () => {
    expect(monthsBetweenDates(new Date('2024-06-01'), new Date('2024-03-01'))).toBe(0)
  })

  it('works across year boundaries', () => {
    expect(monthsBetween('2023-11-01', new Date('2024-02-01'))).toBe(3)
  })
})

describe('addMonths', () => {
  it('adds months in UTC, preserving day-of-month', () => {
    const out = addMonths(new Date('2024-01-15T00:00:00Z'), 3)
    expect(out.toISOString().slice(0, 10)).toBe('2024-04-15')
  })
})

describe('computeLoanFinancials', () => {
  it('reports a brand-new active loan with no transactions correctly', () => {
    // 6 months elapsed at full principal → 100000/100000 * 650 * 6 = 3900
    const out = computeLoanFinancials(
      activeLoan({ start_date: '2024-01-01', end_date: '2024-07-01' }),
      [],
      RATE,
    )
    expect(out.principal).toBe(100_000)
    expect(out.paidPrincipal).toBe(0)
    expect(out.balance).toBe(100_000)
    expect(out.expectedInterest).toBe(3_900)
    expect(out.interestDue).toBe(3_900)
    expect(out.isClosed).toBe(false)
  })

  it('reduces the running balance after partial repayments', () => {
    // Pay ₹40,000 after 3 months. 3 months at 100k + 3 months at 60k.
    // = 100k/100k*650*3 + 60k/100k*650*3 = 1950 + 1170 = 3120
    const out = computeLoanFinancials(
      activeLoan({ start_date: '2024-01-01', end_date: '2024-07-01' }),
      [repayment('2024-04-01', 40_000)],
      RATE,
    )
    expect(out.paidPrincipal).toBe(40_000)
    expect(out.balance).toBe(60_000)
    expect(out.expectedInterest).toBe(3_120)
  })

  it('zeroes interest due once paid interest catches up', () => {
    const out = computeLoanFinancials(
      activeLoan({ start_date: '2024-01-01', end_date: '2024-07-01' }),
      [interestPaid('2024-07-01', 3_900)],
      RATE,
    )
    expect(out.paidInterestTotal).toBe(3_900)
    expect(out.expectedInterest).toBe(3_900)
    expect(out.interestDue).toBe(0)
  })

  it('reports a paid-status loan with interestDue clamped to 0', () => {
    // Even with expectedInterest > paid, closed loans are settled by definition.
    const out = computeLoanFinancials(
      activeLoan({ status: 'paid', end_date: '2024-07-01' }),
      [],
      RATE,
    )
    expect(out.isClosed).toBe(true)
    expect(out.interestDue).toBe(0)
  })

  it('respects an interest-waiver window — no accrual inside it', () => {
    // 3-month waiver, then accrue for 3 months at full principal = 1950.
    const out = computeLoanFinancials(
      activeLoan({
        start_date: '2024-01-01',
        end_date: '2024-07-01',
        interest_waiver_months: 3,
      }),
      [],
      RATE,
    )
    expect(out.interestWaiverMonths).toBe(3)
    expect(out.interestStartDate.toISOString().slice(0, 10)).toBe('2024-04-01')
    expect(out.expectedInterest).toBe(1_950)
  })

  it('still credits in-window repayments against principal for later accrual', () => {
    // 3-month waiver. Pay ₹40k at month 2 (inside the window). Then accrue
    // from month 3 to month 6 on the reduced ₹60k balance.
    // = 60k/100k * 650 * 3 = 1170
    const out = computeLoanFinancials(
      activeLoan({
        start_date: '2024-01-01',
        end_date: '2024-07-01',
        interest_waiver_months: 3,
      }),
      [repayment('2024-02-15', 40_000)],
      RATE,
    )
    expect(out.balance).toBe(60_000)
    expect(out.expectedInterest).toBe(1_170)
  })

  it('subtracts bad_debt from the balance (without going negative)', () => {
    const out = computeLoanFinancials(
      activeLoan({
        principal_amount: 100_000,
        bad_debt: 60_000,
        end_date: '2024-07-01',
      }),
      [repayment('2024-04-01', 30_000)],
      RATE,
    )
    // 100k - 30k repaid - 60k bad_debt = 10k balance
    expect(out.balance).toBe(10_000)
  })

  it('does not let the running balance go negative after over-repayment', () => {
    const out = computeLoanFinancials(
      activeLoan({ end_date: '2024-04-01' }),
      // Pay more than principal (shouldn't happen in practice but defensive)
      [repayment('2024-02-01', 150_000)],
      RATE,
    )
    expect(out.balance).toBe(0)
    // 2024-01-01 → 2024-02-01: 1 month at full 100k principal = 650.
    // 2024-02-01 → 2024-04-01: 2 months at balance 0 (clamped) = 0.
    // Total: 650 (NOT 0 — the loan still accrued for the month before
    // the over-pay landed).
    expect(out.expectedInterest).toBe(650)
  })
})
