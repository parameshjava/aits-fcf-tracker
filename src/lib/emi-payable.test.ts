import { describe, it, expect } from 'vitest'
import { payableInstallmentIds, accrualMonthStart } from './emi-due'

const row = (
  n: number,
  due_date: string,
  status = 'scheduled',
): { id: string; installment_no: number; due_date: string; status: string } => ({
  id: `s${n}`,
  installment_no: n,
  due_date,
  status,
})

/** The reported schedule: #1 due 10 Aug 2026, #2 10 Sep, #3 10 Oct. */
const SCHEDULE = [
  row(1, '2026-08-10'),
  row(2, '2026-09-10'),
  row(3, '2026-10-10'),
]

describe('accrualMonthStart', () => {
  it('is the 1st of the month before the due date', () => {
    expect(accrualMonthStart('2026-08-10')).toBe('2026-07-01')
    expect(accrualMonthStart('2026-09-10')).toBe('2026-08-01')
  })

  it('rolls back across a year boundary', () => {
    expect(accrualMonthStart('2027-01-10')).toBe('2026-12-01')
  })
})

describe('payableInstallmentIds', () => {
  it('offers only the earliest unpaid installment', () => {
    // On 7 Aug both #1 (accrues Jul) and #2 (accrues Aug) have started their
    // cycles. Offering both let an admin settle #2 before #1.
    expect(payableInstallmentIds({ rows: SCHEDULE, todayIso: '2026-08-07' })).toEqual(['s1'])
  })

  it('moves to the next one once the earliest is paid', () => {
    const rows = SCHEDULE.map((r) => (r.installment_no === 1 ? { ...r, status: 'paid' } : r))
    expect(payableInstallmentIds({ rows, todayIso: '2026-08-07' })).toEqual(['s2'])
  })

  it('offers nothing before the earliest installment’s cycle begins', () => {
    // #1 accrues in July, so nothing is payable in June.
    expect(payableInstallmentIds({ rows: SCHEDULE, todayIso: '2026-06-30' })).toEqual([])
  })

  it('offers it from the first day of its accrual month', () => {
    expect(payableInstallmentIds({ rows: SCHEDULE, todayIso: '2026-07-01' })).toEqual(['s1'])
  })

  it('still offers an overdue installment', () => {
    const rows = [row(1, '2026-08-10', 'overdue'), ...SCHEDULE.slice(1)]
    expect(payableInstallmentIds({ rows, todayIso: '2026-11-20' })).toEqual(['s1'])
  })

  it('offers a part-paid installment so the remainder can be collected', () => {
    const rows = [row(1, '2026-08-10', 'partially_paid'), ...SCHEDULE.slice(1)]
    expect(payableInstallmentIds({ rows, todayIso: '2026-08-07' })).toEqual(['s1'])
  })

  it('skips settled and waived installments when picking the earliest', () => {
    const rows = [
      row(1, '2026-08-10', 'paid'),
      row(2, '2026-09-10', 'waived'),
      row(3, '2026-10-10'),
    ]
    expect(payableInstallmentIds({ rows, todayIso: '2026-09-05' })).toEqual(['s3'])
  })

  it('offers nothing when every installment is settled', () => {
    const rows = SCHEDULE.map((r) => ({ ...r, status: 'paid' }))
    expect(payableInstallmentIds({ rows, todayIso: '2027-01-01' })).toEqual([])
  })

  it('picks by due date, not by row order', () => {
    const rows = [row(3, '2026-10-10'), row(1, '2026-08-10'), row(2, '2026-09-10')]
    expect(payableInstallmentIds({ rows, todayIso: '2026-08-07' })).toEqual(['s1'])
  })

  it('handles an empty schedule', () => {
    expect(payableInstallmentIds({ rows: [], todayIso: '2026-08-07' })).toEqual([])
  })
})
