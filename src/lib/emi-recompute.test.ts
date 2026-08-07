import { describe, it, expect } from 'vitest'
import { planEmiRecompute, type RecomputeScheduleRow } from './emi-recompute'
import { buildSchedule } from './emi-math'

/** A real 1L / 8% / 12-month schedule, so the fixtures are internally consistent. */
const BASE = buildSchedule({
  principal: 100_000,
  annualRatePct: 8,
  termMonths: 12,
  startDate: '2026-04-01',
  waiverMonths: 0,
})

const toRow = (
  i: number,
  over: Partial<RecomputeScheduleRow> = {},
): RecomputeScheduleRow => {
  const r = BASE[i]
  return {
    id: `s${r.installmentNo}`,
    installment_no: r.installmentNo,
    due_date: r.dueDate,
    status: 'scheduled',
    opening_balance: r.openingBalance,
    emi_amount: r.emiAmount,
    principal_due: r.principalDue,
    interest_due: r.interestDue,
    closing_balance: r.closingBalance,
    principal_paid: 0,
    interest_paid: 0,
    ...over,
  }
}

/** #1 and #2 settled, #3 onwards outstanding. */
const AFTER_TWO_PAID: RecomputeScheduleRow[] = BASE.map((r, i) =>
  i < 2
    ? toRow(i, { status: 'paid', principal_paid: r.principalDue, interest_paid: r.interestDue })
    : toRow(i),
)

describe('planEmiRecompute', () => {
  it('reports no changes when the rate has not moved', () => {
    const plan = planEmiRecompute({ rows: AFTER_TWO_PAID, annualRatePct: 8 })
    expect(plan.error).toBeNull()
    expect(plan.hasChanges).toBe(false)
    expect(plan.changed).toEqual([])
    expect(plan.newEmi).toBe(plan.currentEmi)
  })

  it('re-prices the unpaid installments when the rate rises', () => {
    const plan = planEmiRecompute({ rows: AFTER_TWO_PAID, annualRatePct: 12 })
    expect(plan.error).toBeNull()
    expect(plan.hasChanges).toBe(true)
    expect(plan.newEmi).toBeGreaterThan(plan.currentEmi)
    expect(plan.interestAfter).toBeGreaterThan(plan.interestBefore)
    // 10 unpaid installments, all re-priced, none added or dropped.
    expect(plan.rows).toHaveLength(10)
    expect(plan.changed).toHaveLength(10)
  })

  it('lowers the EMI when the rate falls', () => {
    const plan = planEmiRecompute({ rows: AFTER_TWO_PAID, annualRatePct: 5 })
    expect(plan.newEmi).toBeLessThan(plan.currentEmi)
    expect(plan.interestAfter).toBeLessThan(plan.interestBefore)
  })

  it('never touches paid installments', () => {
    const plan = planEmiRecompute({ rows: AFTER_TWO_PAID, annualRatePct: 12 })
    expect(plan.rows.map((r) => r.installmentNo)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(plan.rows.some((r) => r.scheduleId === 's1' || r.scheduleId === 's2')).toBe(false)
  })

  it('leaves partially-paid installments alone, whatever the cron did to their status', () => {
    const rows = AFTER_TWO_PAID.map((r) =>
      r.installment_no === 3
        ? { ...r, status: 'overdue' as const, principal_paid: 400, interest_paid: 0 }
        : r,
    )
    const plan = planEmiRecompute({ rows, annualRatePct: 12 })
    // #3 has money against its own figures — re-pricing it would strand that.
    expect(plan.rows.map((r) => r.installmentNo)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('re-prices overdue installments — they are unpaid, just late', () => {
    const rows = AFTER_TWO_PAID.map((r) =>
      r.installment_no === 3 ? { ...r, status: 'overdue' as const } : r,
    )
    const plan = planEmiRecompute({ rows, annualRatePct: 12 })
    expect(plan.rows[0].installmentNo).toBe(3)
  })

  it('skips waived installments', () => {
    const rows = AFTER_TWO_PAID.map((r) =>
      r.installment_no === 12 ? { ...r, status: 'waived' as const } : r,
    )
    const plan = planEmiRecompute({ rows, annualRatePct: 12 })
    expect(plan.rows.some((r) => r.installmentNo === 12)).toBe(false)
  })

  it('keeps every due date and installment number exactly as it was', () => {
    const plan = planEmiRecompute({ rows: AFTER_TWO_PAID, annualRatePct: 12 })
    for (const row of plan.rows) {
      const original = AFTER_TWO_PAID.find((r) => r.id === row.scheduleId)!
      expect(row.dueDate).toBe(original.due_date)
      expect(row.installmentNo).toBe(original.installment_no)
    }
  })

  it('re-amortizes only what the unpaid rows still owe', () => {
    const plan = planEmiRecompute({ rows: AFTER_TWO_PAID, annualRatePct: 12 })
    const stillOwed = AFTER_TWO_PAID.filter((r) => r.status === 'scheduled').reduce(
      (s, r) => s + r.principal_due,
      0,
    )
    expect(plan.outstanding).toBe(stillOwed)
    expect(plan.rows[0].after.openingBalance).toBe(stillOwed)
    // The re-priced tail still clears the balance exactly.
    expect(plan.rows[plan.rows.length - 1].after.closingBalance).toBe(0)
    expect(plan.rows.reduce((s, r) => s + r.after.principalDue, 0)).toBe(stillOwed)
  })

  it('refuses when there is nothing left unpaid', () => {
    const rows = BASE.map((r, i) =>
      toRow(i, { status: 'paid', principal_paid: r.principalDue, interest_paid: r.interestDue }),
    )
    const plan = planEmiRecompute({ rows, annualRatePct: 12 })
    expect(plan.error).toBe('no_unpaid_installments')
    expect(plan.hasChanges).toBe(false)
  })

  it('refuses a rate that would never amortize', () => {
    const plan = planEmiRecompute({ rows: AFTER_TWO_PAID, annualRatePct: 5000 })
    expect(plan.error).toBe('rate_too_high')
  })

  it('fingerprints the schedule it planned against', () => {
    const a = planEmiRecompute({ rows: AFTER_TWO_PAID, annualRatePct: 12 })
    const b = planEmiRecompute({ rows: AFTER_TWO_PAID, annualRatePct: 5 })
    // The rate is not part of it — the fingerprint pins the schedule, not the plan.
    expect(a.fingerprint).toBe(b.fingerprint)

    const oneMorePaid = AFTER_TWO_PAID.map((r) =>
      r.installment_no === 3
        ? { ...r, status: 'paid' as const, principal_paid: r.principal_due }
        : r,
    )
    expect(planEmiRecompute({ rows: oneMorePaid, annualRatePct: 12 }).fingerprint).not.toBe(
      a.fingerprint,
    )
  })
})
