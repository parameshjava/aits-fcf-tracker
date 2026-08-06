import { describe, it, expect } from 'vitest'
import { installmentOutstanding, tallyEmiSchedule, pctPending } from './emi-due'

const row = (
  loan_id: string,
  status: string,
  due_date: string,
  principal_due = 8000,
  interest_due = 2000,
  principal_paid = 0,
  interest_paid = 0,
) => ({
  loan_id,
  status,
  due_date,
  principal_due,
  interest_due,
  principal_paid,
  interest_paid,
})

const MONTH_END = '2026-08-31'

describe('installmentOutstanding', () => {
  it('sums unpaid principal and unpaid interest', () => {
    expect(installmentOutstanding(row('l1', 'scheduled', '2026-08-10'))).toBe(10000)
  })

  it('nets out what has already been paid on a partial installment', () => {
    expect(
      installmentOutstanding(row('l1', 'partially_paid', '2026-08-10', 8000, 2000, 3000, 2000)),
    ).toBe(5000)
  })

  it('accepts numeric strings (Postgres numeric arrives as text)', () => {
    expect(
      installmentOutstanding({
        loan_id: 'l1',
        status: 'scheduled',
        due_date: '2026-08-10',
        principal_due: '8000.00',
        interest_due: '2000.00',
        principal_paid: '1000.00',
        interest_paid: '0',
      }),
    ).toBe(9000)
  })

  it('clamps an over-applied leg at zero instead of crediting it', () => {
    // Principal overpaid by 500 must not shrink the interest still owed.
    expect(installmentOutstanding(row('l1', 'scheduled', '2026-08-10', 8000, 2000, 8500, 0))).toBe(
      2000,
    )
  })
})

describe('tallyEmiSchedule', () => {
  it('returns an empty map for no rows', () => {
    expect(tallyEmiSchedule([], MONTH_END).size).toBe(0)
  })

  it('counts settled vs total across the whole schedule', () => {
    const t = tallyEmiSchedule(
      [
        row('l1', 'paid', '2026-06-10'),
        row('l1', 'paid', '2026-07-10'),
        row('l1', 'scheduled', '2026-08-10'),
        row('l1', 'scheduled', '2026-09-10'),
      ],
      MONTH_END,
    )
    expect(t.get('l1')).toMatchObject({ settledCount: 2, totalCount: 4 })
  })

  it('counts as pending only what is due on or before month end', () => {
    const t = tallyEmiSchedule(
      [
        row('l1', 'overdue', '2026-07-10'), // carried over
        row('l1', 'scheduled', '2026-08-10'), // this month, 10th not yet reached
        row('l1', 'scheduled', '2026-09-10'), // future — excluded
      ],
      MONTH_END,
    )
    expect(t.get('l1')).toMatchObject({ pendingCount: 2, pendingDue: 20000 })
  })

  it('treats waived installments as settled, not pending', () => {
    const t = tallyEmiSchedule(
      [row('l1', 'paid', '2026-07-10'), row('l1', 'waived', '2026-08-10')],
      MONTH_END,
    )
    expect(t.get('l1')).toMatchObject({ settledCount: 2, pendingCount: 0, pendingDue: 0 })
  })

  it('keeps loans separate', () => {
    const t = tallyEmiSchedule(
      [
        row('l1', 'scheduled', '2026-08-10'),
        row('l2', 'partially_paid', '2026-08-10', 5000, 500, 0, 0),
        row('l2', 'paid', '2026-07-10'),
      ],
      MONTH_END,
    )
    expect(t.get('l1')).toMatchObject({ pendingCount: 1, pendingDue: 10000, totalCount: 1 })
    expect(t.get('l2')).toMatchObject({ pendingCount: 1, pendingDue: 5500, totalCount: 2 })
  })

  it('has no entry for a loan with no schedule rows', () => {
    expect(tallyEmiSchedule([row('l1', 'scheduled', '2026-08-10')], MONTH_END).get('l2')).toBeUndefined()
  })
})

describe('pctPending', () => {
  it('reports the share of the schedule still to settle', () => {
    expect(pctPending({ settledCount: 48, totalCount: 60 })).toBe(20)
  })

  it('is 0 for a fully settled schedule', () => {
    expect(pctPending({ settledCount: 12, totalCount: 12 })).toBe(0)
  })

  it('is 100 when nothing has been paid', () => {
    expect(pctPending({ settledCount: 0, totalCount: 24 })).toBe(100)
  })

  it('rounds to the nearest whole percent', () => {
    expect(pctPending({ settledCount: 1, totalCount: 3 })).toBe(67)
  })

  it('returns null when there is no schedule', () => {
    expect(pctPending({ settledCount: 0, totalCount: 0 })).toBeNull()
  })
})
