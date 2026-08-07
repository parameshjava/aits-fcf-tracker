import { describe, it, expect } from 'vitest'
import { planEmiRecompute, type RecomputeScheduleRow } from './emi-recompute'
import { buildSchedule } from './emi-math'

const TODAY = '2026-08-15'

const fromSchedule = (
  rows: ReturnType<typeof buildSchedule>,
  over: (n: number) => Partial<RecomputeScheduleRow> = () => ({}),
): RecomputeScheduleRow[] =>
  rows.map((r) => ({
    id: `s${r.installmentNo}`,
    installment_no: r.installmentNo,
    due_date: r.dueDate,
    status: 'scheduled' as const,
    opening_balance: r.openingBalance,
    emi_amount: r.emiAmount,
    principal_due: r.principalDue,
    interest_due: r.interestDue,
    closing_balance: r.closingBalance,
    principal_paid: 0,
    interest_paid: 0,
    ...over(r.installmentNo),
  }))

/** 1L / 8% / 12m disbursed on the 1st — no stub. #1 due 10 May, #12 due 10 Apr 27. */
const PLAIN = buildSchedule({
  principal: 100_000,
  annualRatePct: 8,
  termMonths: 12,
  startDate: '2026-04-01',
  waiverMonths: 0,
})

/** Same loan disbursed on the 20th — #1 is a pro-rated stub. */
const WITH_STUB = buildSchedule({
  principal: 100_000,
  annualRatePct: 8,
  termMonths: 12,
  startDate: '2026-04-20',
  waiverMonths: 0,
})

/** #1 (10 May) and #2 (10 Jun) settled. Today is 15 Aug, so #3 (10 Jul) and
 *  #4 (10 Aug) are unpaid but already due; #5 onwards is still ahead. */
const TWO_PAID = fromSchedule(PLAIN, (n) =>
  n <= 2
    ? {
        status: 'paid' as const,
        principal_paid: PLAIN[n - 1].principalDue,
        interest_paid: PLAIN[n - 1].interestDue,
      }
    : {},
)

const plan = (rows: RecomputeScheduleRow[], newRatePct: number, oldRatePct: number | null = 8) =>
  planEmiRecompute({ rows, oldRatePct, newRatePct, todayIso: TODAY })

describe('planEmiRecompute — no change means no change', () => {
  it('reports nothing when the rate has not moved', () => {
    const p = plan(TWO_PAID, 8)
    expect(p.error).toBeNull()
    expect(p.hasChanges).toBe(false)
    expect(p.changed).toEqual([])
  })

  it('reports nothing for a mid-month-disbursed loan either', () => {
    // The pro-rated stub used to be rebuilt as a full month, so a correctly
    // priced loan reported every installment as out of date.
    const rows = fromSchedule(WITH_STUB)
    const p = plan(rows, 8)
    expect(p.hasChanges).toBe(false)
  })
})

describe('planEmiRecompute — re-pricing', () => {
  it('scales interest by the rate ratio and leaves principal alone', () => {
    const p = plan(TWO_PAID, 12)
    expect(p.hasChanges).toBe(true)
    for (const row of p.rows) {
      const original = TWO_PAID.find((r) => r.id === row.scheduleId)!
      expect(row.after.interestDue).toBeCloseTo(original.interest_due * 1.5, 2)
      // Principal is untouched, so the loan still clears for the same total.
      expect(row.principalDue).toBe(original.principal_due)
      expect(row.after.emiAmount).toBeCloseTo(row.principalDue + row.after.interestDue, 2)
    }
    const principalAfter = p.rows.reduce((s, r) => s + r.principalDue, 0)
    const principalBefore = TWO_PAID.filter(
      (r) => r.status === 'scheduled' && r.due_date > TODAY,
    ).reduce((s, r) => s + r.principal_due, 0)
    expect(principalAfter).toBe(principalBefore)
  })

  it('re-prices a pro-rated stub without turning it into a full month', () => {
    // A loan disbursed 2026-04-20 whose stub is still ahead of today.
    const rows = fromSchedule(WITH_STUB)
    const p = planEmiRecompute({
      rows,
      oldRatePct: 8,
      newRatePct: 12,
      todayIso: '2026-04-25',
    })
    const stub = p.rows.find((r) => r.installmentNo === 1)!
    const full = p.rows.find((r) => r.installmentNo === 2)!
    // Still a part month: its interest stays well under a full month's.
    expect(stub.after.interestDue).toBeLessThan(full.after.interestDue)
    expect(stub.after.interestDue).toBeCloseTo(stub.before.interestDue * 1.5, 2)
  })

  it('lowers the EMI when the rate falls', () => {
    const p = plan(TWO_PAID, 4)
    expect(p.interestAfter).toBeLessThan(p.interestBefore)
    expect(p.nextEmiAfter).toBeLessThan(p.nextEmiBefore)
  })
})

describe('planEmiRecompute — what it refuses to touch', () => {
  it('never re-prices paid installments', () => {
    const p = plan(TWO_PAID, 12)
    expect(p.rows.some((r) => r.scheduleId === 's1' || r.scheduleId === 's2')).toBe(false)
  })

  it('never re-prices an already-due installment, however it is flagged', () => {
    // #3 (10 Jul) and #4 (10 Aug) fell due before today. Re-pricing them would
    // change an amount the member has already been billed, and raise the
    // late-fee target fn_apply_emi_late_fees derives from emi_amount.
    const p = plan(TWO_PAID, 12)
    expect(p.rows.map((r) => r.installmentNo)).toEqual([5, 6, 7, 8, 9, 10, 11, 12])

    // Still excluded once the cron flags them, and still excluded before it does.
    const overdue = TWO_PAID.map((r) =>
      r.installment_no === 3 ? { ...r, status: 'overdue' as const } : r,
    )
    expect(plan(overdue, 12).rows.some((r) => r.installmentNo === 3)).toBe(false)
  })

  it('never re-prices a part-paid installment, whatever the cron did to its status', () => {
    const rows = TWO_PAID.map((r) =>
      r.installment_no === 5
        ? { ...r, status: 'overdue' as const, principal_paid: 400 }
        : r,
    )
    expect(plan(rows, 12).rows.some((r) => r.installmentNo === 5)).toBe(false)
  })

  it('skips waived installments', () => {
    const rows = TWO_PAID.map((r) =>
      r.installment_no === 12 ? { ...r, status: 'waived' as const } : r,
    )
    expect(plan(rows, 12).rows.some((r) => r.installmentNo === 12)).toBe(false)
  })

  it('leaves the balance chain alone when a paid installment sits mid-schedule', () => {
    // An admin can settle #7 while #4 is still the next one due.
    const rows = TWO_PAID.map((r) =>
      r.installment_no === 7
        ? {
            ...r,
            status: 'paid' as const,
            principal_paid: r.principal_due,
            interest_paid: r.interest_due,
          }
        : r,
    )
    const p = plan(rows, 12)
    expect(p.rows.some((r) => r.installmentNo === 7)).toBe(false)
    // Re-pricing moves no principal, so every opening/closing balance in the
    // schedule still chains exactly as it did.
    for (const row of p.rows) {
      const original = rows.find((r) => r.id === row.scheduleId)!
      expect(row.principalDue).toBe(original.principal_due)
    }
  })
})

describe('planEmiRecompute — refusals', () => {
  it('refuses when nothing is both unpaid and still ahead of its due date', () => {
    const allPaid = fromSchedule(PLAIN, (n) => ({
      status: 'paid' as const,
      principal_paid: PLAIN[n - 1].principalDue,
      interest_paid: PLAIN[n - 1].interestDue,
    }))
    const p = plan(allPaid, 12)
    expect(p.error).toBe('no_repriceable_installments')
    expect(p.hasChanges).toBe(false)
  })

  it('refuses when the loan has no rate to scale from', () => {
    expect(plan(TWO_PAID, 12, null).error).toBe('rate_unavailable')
    expect(plan(TWO_PAID, 12, 0).error).toBe('rate_unavailable')
  })
})

describe('planEmiRecompute — fingerprint', () => {
  it('changes when the rate changes, so a rate edit cannot slip past the preview', () => {
    const a = plan(TWO_PAID, 12)
    const b = plan(TWO_PAID, 20)
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  it('changes when the schedule moves', () => {
    // #5 is the first still-ahead installment, so paying it moves the plan.
    const oneMorePaid = TWO_PAID.map((r) =>
      r.installment_no === 5
        ? { ...r, status: 'paid' as const, principal_paid: r.principal_due }
        : r,
    )
    expect(plan(oneMorePaid, 12).fingerprint).not.toBe(plan(TWO_PAID, 12).fingerprint)
  })

  it('is stable for the same schedule and rate', () => {
    expect(plan(TWO_PAID, 12).fingerprint).toBe(plan(TWO_PAID, 12).fingerprint)
  })
})
