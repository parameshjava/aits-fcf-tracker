import { describe, it, expect } from 'vitest'
import {
  computeEmiAmount,
  buildSchedule,
  recomputeAfterPrepayment,
  tenthOfMonth,
} from './emi-math'

describe('computeEmiAmount', () => {
  it('reducing-balance EMI for 1L over 18 months at 8% ≈ 5914', () => {
    expect(computeEmiAmount(100000, 8, 18)).toBe(5914)
  })
  it('zero-term throws', () => {
    expect(() => computeEmiAmount(100000, 8, 0)).toThrow()
  })
})

describe('tenthOfMonth', () => {
  it('returns the 10th of the month at the given offset', () => {
    expect(tenthOfMonth('2026-06-27', 1)).toBe('2026-07-10')
    expect(tenthOfMonth('2026-06-27', 2)).toBe('2026-08-10')
  })
  it('rolls over the year', () => {
    expect(tenthOfMonth('2026-12-15', 1)).toBe('2027-01-10')
  })
})

describe('buildSchedule — full first month (disbursed on the 1st, no stub)', () => {
  const rows = buildSchedule({
    principal: 100000, annualRatePct: 8, termMonths: 18,
    startDate: '2026-01-01', waiverMonths: 0,
  })
  it('has no stub and one row per month', () => {
    expect(rows.some((r) => r.isStub)).toBe(false)
    expect(rows).toHaveLength(18)
  })
  it('first EMI is due the 10th of the month after the accrual month', () => {
    expect(rows[0].dueDate).toBe('2026-02-10')
    expect(rows[1].dueDate).toBe('2026-03-10')
  })
  it('clears to exactly zero and totals 6451 interest', () => {
    expect(rows[rows.length - 1].closingBalance).toBe(0)
    expect(rows.reduce((s, r) => s + r.principalDue, 0)).toBe(100000)
    expect(rows.reduce((s, r) => s + r.interestDue, 0)).toBe(6451)
  })
  it('every emiAmount equals principalDue + interestDue', () => {
    for (const r of rows) expect(r.emiAmount).toBe(r.principalDue + r.interestDue)
  })
})

describe('buildSchedule — mid-month disbursement (pro-rated stub)', () => {
  const rows = buildSchedule({
    principal: 240000, annualRatePct: 8, termMonths: 30,
    startDate: '2026-06-27', waiverMonths: 0,
  })
  it('prepends a pro-rated stub installment #1 (f = 4/30)', () => {
    const stub = rows[0]
    expect(stub.isStub).toBe(true)
    expect(stub.installmentNo).toBe(1)
    expect(stub.dueDate).toBe('2026-07-10') // 10th of the month after disbursement
    expect(stub.interestDue).toBe(213) // 240000 × 0.6667% × 4/30
    expect(stub.principalDue).toBe(967) // (8853 − 1600) × 4/30
    expect(stub.emiAmount).toBe(1180)
  })
  it('full EMIs follow at the standard 8853 and are due the 10th each month', () => {
    expect(rows[1].dueDate).toBe('2026-08-10')
    expect(rows[1].emiAmount).toBe(8853)
    expect(rows[2].dueDate).toBe('2026-09-10')
  })
  it('totals 31 rows (1 stub + 30 full) and clears to zero', () => {
    expect(rows).toHaveLength(31)
    expect(rows[rows.length - 1].closingBalance).toBe(0)
    expect(rows.reduce((s, r) => s + r.principalDue, 0)).toBe(240000)
  })
})

describe('buildSchedule — disbursed on the 1st has no stub', () => {
  it('treats the disbursement month as a full month', () => {
    const rows = buildSchedule({
      principal: 240000, annualRatePct: 8, termMonths: 30,
      startDate: '2026-06-01', waiverMonths: 0,
    })
    expect(rows.some((r) => r.isStub)).toBe(false)
    expect(rows[0].dueDate).toBe('2026-07-10')
  })
})

describe('buildSchedule — waiver absorbs the partial month (no stub)', () => {
  const rows = buildSchedule({
    principal: 100000, annualRatePct: 8, termMonths: 18,
    startDate: '2026-01-31', waiverMonths: 6,
  })
  it('has no stub; first EMI starts after the waiver, due on a 10th', () => {
    expect(rows.some((r) => r.isStub)).toBe(false)
    // accrual month = start month + 6; due = 10th of the following month
    expect(rows[0].dueDate).toBe('2026-08-10')
  })
  it('still amortizes the full principal to zero', () => {
    expect(rows).toHaveLength(18)
    expect(rows[rows.length - 1].closingBalance).toBe(0)
  })
})

describe('buildSchedule — input validation', () => {
  it('throws on non-positive principal', () => {
    expect(() =>
      buildSchedule({ principal: 0, annualRatePct: 8, termMonths: 12, startDate: '2026-01-01', waiverMonths: 0 }),
    ).toThrow()
  })
})

describe('recomputeAfterPrepayment', () => {
  it('reduce_tenure keeps EMI, shortens the schedule, due dates stay on the 10th', () => {
    const r = recomputeAfterPrepayment({
      outstanding: 50000, annualRatePct: 8, remainingTerm: 10,
      currentEmi: 5914, firstDueDate: '2026-07-10', mode: 'reduce_tenure',
    })
    expect(r[0].emiAmount).toBe(5914)
    expect(r[0].dueDate).toBe('2026-07-10')
    expect(r[1].dueDate).toBe('2026-08-10')
    expect(r).toHaveLength(9)
    expect(r[r.length - 1].closingBalance).toBe(0)
  })
  it('reduce_emi keeps tenure and lowers EMI', () => {
    const r = recomputeAfterPrepayment({
      outstanding: 50000, annualRatePct: 8, remainingTerm: 10,
      currentEmi: 5914, firstDueDate: '2026-07-10', mode: 'reduce_emi',
    })
    expect(r).toHaveLength(10)
    expect(r[0].emiAmount).toBeLessThan(5914)
    expect(r[0].dueDate).toBe('2026-07-10')
  })
  it('reduce_emi clamps to a single payoff when EMI <= one month interest', () => {
    const r = recomputeAfterPrepayment({
      outstanding: 100, annualRatePct: 8, remainingTerm: 120,
      currentEmi: 5914, firstDueDate: '2026-07-10', mode: 'reduce_emi',
    })
    expect(r).toHaveLength(1)
    expect(r[0].closingBalance).toBe(0)
  })
})
