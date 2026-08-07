import { describe, it, expect } from 'vitest'
import { planPrepayment, type PrepayScheduleRow } from './prepay-plan'

const row = (o: Partial<PrepayScheduleRow> & { installment_no: number }): PrepayScheduleRow => ({
  id: `s${o.installment_no}`,
  status: 'scheduled',
  principal_due: 1000,
  principal_paid: 0,
  ...o,
})

describe('planPrepayment', () => {
  it('re-amortizes the whole pending principal when nothing is partially paid', () => {
    const plan = planPrepayment({
      rows: [
        row({ installment_no: 1, status: 'paid', principal_paid: 1000 }),
        row({ installment_no: 2 }),
        row({ installment_no: 3 }),
        row({ installment_no: 4 }),
      ],
      amount: 500,
    })
    expect(plan.pendingPrincipal).toBe(3000)
    expect(plan.arrearsPrincipal).toBe(0)
    expect(plan.arrearsApplied).toBe(0)
    expect(plan.appliedToTail).toBe(500)
    expect(plan.tailPrincipal).toBe(2500)
    expect(plan.remainingTerm).toBe(3)
    expect(plan.fullPayoff).toBe(false)
  })

  it('keeps a partially-paid remainder out of the tail so it is not owed twice', () => {
    const plan = planPrepayment({
      rows: [
        row({ installment_no: 1, status: 'partially_paid', principal_paid: 400 }), // 600 owed
        row({ installment_no: 2 }),
        row({ installment_no: 3 }),
      ],
      amount: 500,
    })
    // The advance never reaches the tail — it all settles the arrear.
    expect(plan.pendingPrincipal).toBe(2600)
    expect(plan.arrearsPrincipal).toBe(600)
    expect(plan.arrearsApplied).toBe(500)
    expect(plan.appliedToTail).toBe(0)
    expect(plan.tailPrincipal).toBe(2000)
    // 100 still owed on #1 + 2000 in the tail = 2100 = 2600 - 500. No double count.
    expect(plan.tailPrincipal + plan.arrearsPrincipal - plan.arrearsApplied).toBe(2100)
    expect(plan.arrears).toEqual([
      { scheduleId: 's1', installmentNo: 1, applied: 500, outstandingAfter: 100 },
    ])
  })

  it('settles arrears oldest first, then reduces the tail with the excess', () => {
    const plan = planPrepayment({
      rows: [
        row({ installment_no: 1, status: 'partially_paid', principal_paid: 700 }), // 300 owed
        row({ installment_no: 2, status: 'partially_paid', principal_paid: 800 }), // 200 owed
        row({ installment_no: 3, status: 'overdue' }),
        row({ installment_no: 4 }),
      ],
      amount: 1500,
    })
    expect(plan.arrears.map((a) => [a.installmentNo, a.applied])).toEqual([
      [1, 300],
      [2, 200],
    ])
    expect(plan.arrears.every((a) => a.outstandingAfter === 0)).toBe(true)
    expect(plan.arrearsApplied).toBe(500)
    expect(plan.appliedToTail).toBe(1000)
    expect(plan.tailPrincipal).toBe(1000)
    expect(plan.remainingTerm).toBe(2)
  })

  it('flags a full payoff only when every rupee of pending principal is covered', () => {
    const rows = [
      row({ installment_no: 1, status: 'partially_paid', principal_paid: 400 }),
      row({ installment_no: 2 }),
    ]
    expect(planPrepayment({ rows, amount: 1600 }).fullPayoff).toBe(true)
    expect(planPrepayment({ rows, amount: 1599 }).fullPayoff).toBe(false)
  })

  it('ignores waived installments', () => {
    const plan = planPrepayment({
      rows: [
        row({ installment_no: 1, status: 'waived' }),
        row({ installment_no: 2 }),
      ],
      amount: 100,
    })
    expect(plan.pendingPrincipal).toBe(1000)
    expect(plan.remainingTerm).toBe(1)
  })

  it('rejects an advance larger than the pending principal', () => {
    const plan = planPrepayment({
      rows: [row({ installment_no: 1 })],
      amount: 1001,
    })
    expect(plan.error).toBe('exceeds_outstanding')
    expect(plan.arrears).toEqual([])
  })

  it('rounds to paise rather than accumulating float drift', () => {
    const plan = planPrepayment({
      rows: [
        row({ installment_no: 1, status: 'partially_paid', principal_due: 1000.1, principal_paid: 999.8 }),
        row({ installment_no: 2, principal_due: 0.2 }),
      ],
      amount: 0.4,
    })
    expect(plan.pendingPrincipal).toBe(0.5)
    expect(plan.arrearsPrincipal).toBe(0.3)
    expect(plan.arrearsApplied).toBe(0.3)
    expect(plan.tailPrincipal).toBe(0.1)
  })
})
