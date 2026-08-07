import { describe, it, expect } from 'vitest'
import { planScheduleShift, type ShiftScheduleRow } from './emi-schedule-shift'

const TODAY = '2026-08-07'

/** A 12-installment schedule starting 10 Sep 2026 — one month later than it should. */
const row = (n: number, over: Partial<ShiftScheduleRow> = {}): ShiftScheduleRow => {
  const month = 9 + (n - 1)
  const y = 2026 + Math.floor((month - 1) / 12)
  const m = ((month - 1) % 12) + 1
  return {
    id: `s${n}`,
    installment_no: n,
    due_date: `${y}-${String(m).padStart(2, '0')}-10`,
    status: 'scheduled',
    principal_paid: 0,
    interest_paid: 0,
    ...over,
  }
}
const LATE_BY_ONE = Array.from({ length: 12 }, (_, i) => row(i + 1))

describe('planScheduleShift', () => {
  it('moves every installment back by the drift, keeping the cadence', () => {
    const p = planScheduleShift({ rows: LATE_BY_ONE, monthsOff: 1, todayIso: TODAY })
    expect(p.error).toBeNull()
    expect(p.rows).toHaveLength(12)
    expect(p.firstDueBefore).toBe('2026-09-10')
    expect(p.firstDueAfter).toBe('2026-08-10')
    // Last installment moves by exactly the same amount — the gaps are untouched.
    expect(p.rows[11].from).toBe('2027-08-10')
    expect(p.rows[11].to).toBe('2027-07-10')
    // Still monthly, still the 10th.
    for (const r of p.rows) expect(r.to.endsWith('-10')).toBe(true)
  })

  it('keeps installment numbers attached to their own rows', () => {
    const p = planScheduleShift({ rows: LATE_BY_ONE, monthsOff: 1, todayIso: TODAY })
    for (const r of p.rows) {
      expect(r.scheduleId).toBe(`s${r.installmentNo}`)
    }
  })

  it('moves a back-dated schedule forward', () => {
    const p = planScheduleShift({ rows: LATE_BY_ONE, monthsOff: -2, todayIso: TODAY })
    expect(p.firstDueAfter).toBe('2026-11-10')
  })

  it('rolls across a year boundary', () => {
    const rows = [row(1, { due_date: '2027-01-10' })]
    const p = planScheduleShift({ rows, monthsOff: 1, todayIso: TODAY })
    expect(p.rows[0].to).toBe('2026-12-10')
  })

  it('counts installments that land on or before today', () => {
    // Moved back a month, #1 lands 10 Jul — already past on 7 Aug.
    const p = planScheduleShift({ rows: LATE_BY_ONE, monthsOff: 2, todayIso: TODAY })
    expect(p.firstDueAfter).toBe('2026-07-10')
    expect(p.becomingDue).toBe(1)
  })

  it('reports none becoming due when the whole schedule stays ahead', () => {
    const p = planScheduleShift({ rows: LATE_BY_ONE, monthsOff: 1, todayIso: TODAY })
    expect(p.becomingDue).toBe(0)
  })

  it('refuses once any installment has been paid', () => {
    const rows = LATE_BY_ONE.map((r) =>
      r.installment_no === 1 ? { ...r, status: 'paid' as const, principal_paid: 8000 } : r,
    )
    const p = planScheduleShift({ rows, monthsOff: 1, todayIso: TODAY })
    expect(p.error).toBe('has_settled_installments')
    expect(p.rows).toEqual([])
  })

  it('refuses on a part payment too', () => {
    const rows = LATE_BY_ONE.map((r) =>
      r.installment_no === 3 ? { ...r, status: 'overdue' as const, interest_paid: 120 } : r,
    )
    expect(planScheduleShift({ rows, monthsOff: 1, todayIso: TODAY }).error).toBe(
      'has_settled_installments',
    )
  })

  it('moves waived installments along with the rest', () => {
    // A waived row carries no money but still occupies its slot in the cadence.
    const rows = LATE_BY_ONE.map((r) =>
      r.installment_no === 2 ? { ...r, status: 'waived' as const } : r,
    )
    const p = planScheduleShift({ rows, monthsOff: 1, todayIso: TODAY })
    expect(p.rows.some((r) => r.installmentNo === 2)).toBe(true)
  })

  it('does nothing when there is no drift', () => {
    const p = planScheduleShift({ rows: LATE_BY_ONE, monthsOff: 0, todayIso: TODAY })
    expect(p.error).toBe('no_drift')
  })

  it('fingerprints the schedule it planned against', () => {
    const a = planScheduleShift({ rows: LATE_BY_ONE, monthsOff: 1, todayIso: TODAY })
    const b = planScheduleShift({ rows: LATE_BY_ONE.slice(0, 11), monthsOff: 1, todayIso: TODAY })
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })
})
