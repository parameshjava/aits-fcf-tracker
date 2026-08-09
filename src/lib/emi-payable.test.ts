import { describe, it, expect } from 'vitest'
import { payableInstallmentIds, payWindowOpensOn, PAY_WINDOW_DAYS } from './emi-due'

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
const SCHEDULE = [row(1, '2026-08-10'), row(2, '2026-09-10'), row(3, '2026-10-10')]

describe('payWindowOpensOn', () => {
  it('opens 15 days before the due date', () => {
    expect(PAY_WINDOW_DAYS).toBe(15)
    expect(payWindowOpensOn('2026-09-10')).toBe('2026-08-26')
    expect(payWindowOpensOn('2026-08-10')).toBe('2026-07-26')
  })

  it('opens at the start of the due month when that comes first', () => {
    // Dated late in the month, so the whole month is inside the window.
    expect(payWindowOpensOn('2026-08-28')).toBe('2026-08-01')
    expect(payWindowOpensOn('2026-08-20')).toBe('2026-08-01')
  })

  it('rolls back across month and year boundaries', () => {
    expect(payWindowOpensOn('2027-01-10')).toBe('2026-12-26')
    expect(payWindowOpensOn('2026-03-10')).toBe('2026-02-23')
  })
})

describe('payableInstallmentIds', () => {
  it('offers nothing while the next installment is further off than the window', () => {
    // #1 is due 10 Aug; on 20 Jul it is 21 days away.
    expect(payableInstallmentIds({ rows: SCHEDULE, todayIso: '2026-07-20' })).toEqual([])
  })

  it('offers it from the day the window opens', () => {
    expect(payableInstallmentIds({ rows: SCHEDULE, todayIso: '2026-07-26' })).toEqual(['s1'])
  })

  it('offers the current month’s installment', () => {
    expect(payableInstallmentIds({ rows: SCHEDULE, todayIso: '2026-08-07' })).toEqual(['s1'])
  })

  it('offers only the earliest, even when a later one is inside its own window', () => {
    // On 30 Aug, #2 (due 10 Sep) is 11 days off — but #1 is still unpaid.
    expect(payableInstallmentIds({ rows: SCHEDULE, todayIso: '2026-08-30' })).toEqual(['s1'])
  })

  it('moves to the next one once the earliest is paid', () => {
    const rows = SCHEDULE.map((r) => (r.installment_no === 1 ? { ...r, status: 'paid' } : r))
    // 20 Aug: #2 is due 10 Sep, 21 days off — outside the window, so nothing yet.
    expect(payableInstallmentIds({ rows, todayIso: '2026-08-20' })).toEqual([])
    expect(payableInstallmentIds({ rows, todayIso: '2026-08-26' })).toEqual(['s2'])
  })

  it('keeps arrears collectable however old', () => {
    // The window bounds how far ahead an EMI can be settled, not how far behind.
    const rows = [row(1, '2026-08-10', 'overdue'), ...SCHEDULE.slice(1)]
    expect(payableInstallmentIds({ rows, todayIso: '2027-05-01' })).toEqual(['s1'])
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
    expect(payableInstallmentIds({ rows, todayIso: '2026-09-26' })).toEqual(['s3'])
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
