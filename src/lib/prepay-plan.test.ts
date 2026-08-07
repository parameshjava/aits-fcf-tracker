import { describe, it, expect } from 'vitest'
import { planPrepayment, prepayPlanErrorMessage, type PrepayScheduleRow } from './prepay-plan'

const PAID_DATE = '2026-07-07'

/** #1 is due 2026-01-10, #2 2026-02-10, … so #1–#7 are past due on PAID_DATE. */
const row = (o: Partial<PrepayScheduleRow> & { installment_no: number }): PrepayScheduleRow => ({
  id: `s${o.installment_no}`,
  due_date: `2026-${String(o.installment_no).padStart(2, '0')}-10`,
  status: 'scheduled',
  principal_due: 1000,
  principal_paid: 0,
  interest_due: 0,
  interest_paid: 0,
  late_fee_charged: 0,
  late_fee_waived: false,
  ...o,
})

/** Three not-yet-due installments: #8 (Aug), #9 (Sep), #10 (Oct). */
const FUTURE = [8, 9, 10].map((n) => row({ installment_no: n }))

describe('planPrepayment — the ordinary case', () => {
  it('re-amortizes every not-yet-due installment', () => {
    const plan = planPrepayment({
      rows: [row({ installment_no: 1, status: 'paid', principal_paid: 1000 }), ...FUTURE],
      amount: 500,
    paidDate: PAID_DATE,
    })
    expect(plan.pendingPrincipal).toBe(3000)
    expect(plan.retained).toEqual([])
    expect(plan.replacedPrincipal).toBe(3000)
    expect(plan.replacedIds).toEqual(['s8', 's9', 's10'])
    expect(plan.tailPrincipal).toBe(2500)
    expect(plan.remainingTerm).toBe(3)
    expect(plan.earliestUnpaidDueDate).toBe('2026-08-10')
    expect(plan.fullPayoff).toBe(false)
    expect(plan.error).toBeNull()
  })

  it('numbers the rebuilt tail past the highest surviving installment', () => {
    const plan = planPrepayment({
      rows: [
        row({ installment_no: 1, status: 'paid', principal_paid: 1000 }),
        row({ installment_no: 6, status: 'partially_paid', principal_paid: 400 }),
        ...FUTURE,
      ],
      amount: 500,
      paidDate: PAID_DATE,
    })
    expect(plan.nextInstallmentNo).toBe(7)
  })

  it('carries unwaived late fees off the replaced rows and drops waived ones', () => {
    const plan = planPrepayment({
      rows: [
        row({ installment_no: 8, late_fee_charged: 300 }),
        row({ installment_no: 9, late_fee_charged: 500, late_fee_waived: true }),
        row({ installment_no: 10, late_fee_charged: 200 }),
      ],
      amount: 500,
      paidDate: PAID_DATE,
    })
    expect(plan.carriedLateFee).toBe(500)
  })
})

describe('planPrepayment — installments that survive the rebuild', () => {
  it('keeps a partially-paid remainder out of the tail so it is not owed twice', () => {
    const plan = planPrepayment({
      // #9 is not yet due but half paid — it keeps its own row either way.
      rows: [row({ installment_no: 9, status: 'partially_paid', principal_paid: 400 }), row({ installment_no: 10 })],
      amount: 500,
      paidDate: PAID_DATE,
    })
    expect(plan.retained).toEqual([
      {
        scheduleId: 's9',
        installmentNo: 9,
        dueDate: '2026-09-10',
        principalOutstanding: 600,
        interestOutstanding: 0,
        reason: 'partially_paid',
      },
    ])
    expect(plan.retainedPrincipal).toBe(600)
    expect(plan.replacedPrincipal).toBe(1000)
    expect(plan.tailPrincipal).toBe(500)
    // 600 still owed on #9 + 500 in the tail = 1100 = 1600 − 500. No double count.
    expect(plan.tailPrincipal + plan.retainedPrincipal).toBe(plan.pendingPrincipal - 500)
  })

  it('leaves already-due installments alone instead of re-dating them forward', () => {
    const plan = planPrepayment({
      // #5 and #6 fell due in May and June and were never paid.
      rows: [row({ installment_no: 5 }), row({ installment_no: 6 }), ...FUTURE],
      amount: 500,
      paidDate: PAID_DATE,
    })
    expect(plan.retained.map((r) => r.installmentNo)).toEqual([5, 6])
    expect(plan.retained.every((r) => r.reason === 'already_due')).toBe(true)
    // The rebuild only touches the three future rows.
    expect(plan.replacedIds).toEqual(['s8', 's9', 's10'])
    expect(plan.tailPrincipal).toBe(2500)
  })

  it('classifies by date and paid amount, never by status', () => {
    // The late-fee cron rewrites a settled-principal row from partially_paid to
    // overdue. A status-based rule handed it to the delete, where the
    // ON DELETE RESTRICT foreign key on loan_emi_payments aborted everything.
    const plan = planPrepayment({
      rows: [
        row({ installment_no: 9, status: 'overdue', principal_paid: 400, interest_paid: 50 }),
        row({ installment_no: 10 }),
      ],
      amount: 500,
      paidDate: PAID_DATE,
    })
    expect(plan.retained.map((r) => r.installmentNo)).toEqual([9])
    expect(plan.replacedIds).toEqual(['s10'])
  })

  it('treats an installment due on the payment date as already due', () => {
    const plan = planPrepayment({
      rows: [row({ installment_no: 7, due_date: PAID_DATE }), ...FUTURE],
      amount: 500,
      paidDate: PAID_DATE,
    })
    expect(plan.retained.map((r) => r.installmentNo)).toEqual([7])
    expect(plan.retained[0].reason).toBe('already_due')
  })

  it('ignores waived and fully settled installments', () => {
    const plan = planPrepayment({
      rows: [
        row({ installment_no: 1, status: 'waived' }),
        row({ installment_no: 2, status: 'paid', principal_paid: 1000 }),
        ...FUTURE,
      ],
      amount: 100,
      paidDate: PAID_DATE,
    })
    expect(plan.pendingPrincipal).toBe(3000)
    expect(plan.retained).toEqual([])
    expect(plan.remainingTerm).toBe(3)
  })
})

describe('planPrepayment — refusals', () => {
  it('rejects an advance larger than the whole outstanding principal', () => {
    const plan = planPrepayment({ rows: FUTURE, amount: 3001, paidDate: PAID_DATE })
    expect(plan.error).toBe('exceeds_outstanding')
    expect(prepayPlanErrorMessage(plan)).toMatch(/exceeds the outstanding principal/i)
  })

  it('rejects an advance that would spill past the not-yet-due principal', () => {
    // 2,000 already due on #5/#6 + 3,000 not yet due. 3,500 overshoots the tail
    // without clearing the loan, so it has nowhere correct to land.
    const plan = planPrepayment({
      rows: [row({ installment_no: 5 }), row({ installment_no: 6 }), ...FUTURE],
      amount: 3500,
      paidDate: PAID_DATE,
    })
    expect(plan.error).toBe('exceeds_future_principal')
    expect(prepayPlanErrorMessage(plan)).toMatch(/#5, #6/)
    expect(prepayPlanErrorMessage(plan)).toMatch(/Pay EMI first/)
  })

  it('refuses to close a loan over unpaid interest', () => {
    const plan = planPrepayment({
      rows: [
        row({ installment_no: 6, principal_due: 1000, principal_paid: 1000, interest_due: 800 }),
        row({ installment_no: 8 }),
      ],
      amount: 1000,
      paidDate: PAID_DATE,
    })
    // Principal is fully covered, so this would have closed the loan and taken
    // the ₹800 of earned interest with it.
    expect(plan.error).toBe('interest_outstanding')
    expect(plan.retainedInterest).toBe(800)
    expect(prepayPlanErrorMessage(plan)).toMatch(/800/)
  })

  it('allows the payoff once no interest is outstanding', () => {
    const plan = planPrepayment({
      rows: [
        row({ installment_no: 6, principal_paid: 400, interest_due: 800, interest_paid: 800 }),
        row({ installment_no: 8 }),
      ],
      amount: 1600,
      paidDate: PAID_DATE,
    })
    expect(plan.error).toBeNull()
    expect(plan.fullPayoff).toBe(true)
    expect(plan.tailPrincipal).toBe(0)
    // The payoff settles the surviving row too.
    expect(plan.retained.map((r) => r.scheduleId)).toEqual(['s6'])
  })
})

describe('planPrepayment — arithmetic', () => {
  it('does not clamp an over-applied installment, matching loan_emi_balances', () => {
    // A schedule regeneration can lower principal_due below principal_paid.
    // The balances view nets the excess off; clamping at zero here made the
    // guard looser than the number the rest of the app reports.
    const plan = planPrepayment({
      rows: [
        row({ installment_no: 8, principal_due: 1000, principal_paid: 1200 }),
        row({ installment_no: 9 }),
      ],
      amount: 800,
      paidDate: PAID_DATE,
    })
    expect(plan.pendingPrincipal).toBe(800)
    expect(plan.error).toBeNull()

    const overshoot = planPrepayment({
      rows: [
        row({ installment_no: 8, principal_due: 1000, principal_paid: 1200 }),
        row({ installment_no: 9 }),
      ],
      amount: 801,
      paidDate: PAID_DATE,
    })
    expect(overshoot.error).toBe('exceeds_outstanding')
  })

  it('rounds to paise rather than accumulating float drift', () => {
    const plan = planPrepayment({
      rows: [
        row({ installment_no: 9, status: 'partially_paid', principal_due: 1000.1, principal_paid: 999.8 }),
        row({ installment_no: 10, principal_due: 0.2 }),
      ],
      amount: 0.1,
      paidDate: PAID_DATE,
    })
    expect(plan.pendingPrincipal).toBe(0.5)
    expect(plan.retainedPrincipal).toBe(0.3)
    expect(plan.tailPrincipal).toBe(0.1)
  })

  it('fingerprints the schedule it planned against', () => {
    const before = planPrepayment({ rows: FUTURE, amount: 500, paidDate: PAID_DATE })
    const afterAPayment = planPrepayment({
      rows: [row({ installment_no: 8, status: 'paid', principal_paid: 1000 }), ...FUTURE.slice(1)],
      amount: 500,
      paidDate: PAID_DATE,
    })
    expect(before.fingerprint).not.toBe(afterAPayment.fingerprint)
    // Same schedule, same fingerprint — a different advance must not change it.
    expect(planPrepayment({ rows: FUTURE, amount: 900, paidDate: PAID_DATE }).fingerprint).toBe(
      before.fingerprint,
    )
  })
})
