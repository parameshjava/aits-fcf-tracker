import { describe, it, expect } from 'vitest'
import { installmentOutstanding, tallyPendingEmi } from './emi-due'

const row = (
  loan_id: string,
  principal_due: number,
  interest_due: number,
  principal_paid = 0,
  interest_paid = 0,
) => ({ loan_id, principal_due, interest_due, principal_paid, interest_paid })

describe('installmentOutstanding', () => {
  it('sums unpaid principal and unpaid interest', () => {
    expect(installmentOutstanding(row('l1', 8000, 2000))).toBe(10000)
  })

  it('nets out what has already been paid on a partial installment', () => {
    expect(installmentOutstanding(row('l1', 8000, 2000, 3000, 2000))).toBe(5000)
  })

  it('accepts numeric strings (Postgres numeric arrives as text)', () => {
    expect(
      installmentOutstanding({
        loan_id: 'l1',
        principal_due: '8000.00',
        interest_due: '2000.00',
        principal_paid: '1000.00',
        interest_paid: '0',
      }),
    ).toBe(9000)
  })

  it('clamps an over-applied leg at zero instead of crediting it', () => {
    // Principal overpaid by 500 must not shrink the interest still owed.
    expect(installmentOutstanding(row('l1', 8000, 2000, 8500, 0))).toBe(2000)
  })
})

describe('tallyPendingEmi', () => {
  it('returns an empty map for no rows', () => {
    expect(tallyPendingEmi([]).size).toBe(0)
  })

  it('groups count and due amount per loan', () => {
    const result = tallyPendingEmi([
      row('l1', 8000, 2000),
      row('l1', 8200, 1800, 1000, 0),
      row('l2', 5000, 500),
    ])
    expect(result.get('l1')).toEqual({ count: 2, due: 19000 })
    expect(result.get('l2')).toEqual({ count: 1, due: 5500 })
  })

  it('has no entry for a loan with nothing pending', () => {
    expect(tallyPendingEmi([row('l1', 8000, 2000)]).get('l2')).toBeUndefined()
  })
})
