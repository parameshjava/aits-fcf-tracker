import { describe, it, expect } from 'vitest'
import {
  cutoverYmdToIso,
  emiScheduleStart,
  isCutoverFloored,
  expectedFirstDueDate,
  detectAnchorDrift,
} from './emi-anchor'

const CUTOVER = cutoverYmdToIso(20260701)

describe('cutoverYmdToIso', () => {
  it('reads the YYYYMMDD integer the reference stores', () => {
    expect(CUTOVER).toBe('2026-07-01')
    expect(cutoverYmdToIso(0)).toBeNull()
  })
})

describe('expectedFirstDueDate', () => {
  it('puts a converted loan on the 10th of the month after the cutover', () => {
    // Disbursed years before the cutover → floored to 2026-07-01 → due 10 Aug.
    expect(
      expectedFirstDueDate({ startDateIso: '2021-03-15', waiverMonths: 0, cutoverIso: CUTOVER }),
    ).toBe('2026-08-10')
  })

  it('ignores a converted loan’s original waiver', () => {
    // The waiver belonged to a disbursement years ago and was spent long before
    // the cutover; fn_generate_emi_schedule zeroes it when the floor engages.
    expect(
      expectedFirstDueDate({ startDateIso: '2021-03-15', waiverMonths: 3, cutoverIso: CUTOVER }),
    ).toBe('2026-08-10')
  })

  it('keeps its own start date for a loan disbursed after the cutover', () => {
    expect(
      expectedFirstDueDate({ startDateIso: '2026-08-20', waiverMonths: 0, cutoverIso: CUTOVER }),
    ).toBe('2026-09-10')
  })

  it('shifts a natively-EMI loan by its waiver', () => {
    expect(
      expectedFirstDueDate({ startDateIso: '2026-08-01', waiverMonths: 2, cutoverIso: CUTOVER }),
    ).toBe('2026-11-10')
  })

  it('applies no floor when the cutover is unset', () => {
    expect(
      expectedFirstDueDate({ startDateIso: '2025-01-01', waiverMonths: 0, cutoverIso: null }),
    ).toBe('2025-02-10')
  })
})

describe('detectAnchorDrift', () => {
  const converted = { startDateIso: '2021-03-15', waiverMonths: 0, cutoverIso: CUTOVER }

  it('is quiet when the schedule starts where it should', () => {
    const d = detectAnchorDrift({ dueDates: ['2026-08-10', '2026-09-10'], ...converted })
    expect(d.drifted).toBe(false)
    expect(d.monthsOff).toBe(0)
  })

  it('flags a schedule that starts a month late', () => {
    // The reported case: a converted loan whose EMIs start in September.
    const d = detectAnchorDrift({ dueDates: ['2026-09-10', '2026-10-10'], ...converted })
    expect(d.drifted).toBe(true)
    expect(d.monthsOff).toBe(1)
    expect(d.expectedFirstDue).toBe('2026-08-10')
    expect(d.actualFirstDue).toBe('2026-09-10')
  })

  it('flags a back-dated schedule too', () => {
    const d = detectAnchorDrift({ dueDates: ['2025-10-10', '2025-11-10'], ...converted })
    expect(d.drifted).toBe(true)
    expect(d.monthsOff).toBe(-10)
  })

  it('takes the earliest due date, whatever order the rows arrive in', () => {
    const d = detectAnchorDrift({
      dueDates: ['2026-11-10', '2026-08-10', '2026-09-10'],
      ...converted,
    })
    expect(d.actualFirstDue).toBe('2026-08-10')
    expect(d.drifted).toBe(false)
  })

  it('says nothing about a loan with no schedule at all', () => {
    const d = detectAnchorDrift({ dueDates: [], ...converted })
    expect(d.drifted).toBe(false)
    expect(d.actualFirstDue).toBeNull()
  })
})

describe('emiScheduleStart / isCutoverFloored', () => {
  it('floors a pre-cutover loan and leaves a later one alone', () => {
    expect(emiScheduleStart('2021-03-15', CUTOVER)).toBe('2026-07-01')
    expect(emiScheduleStart('2026-09-01', CUTOVER)).toBe('2026-09-01')
    expect(isCutoverFloored('2021-03-15', CUTOVER)).toBe(true)
    expect(isCutoverFloored('2026-09-01', CUTOVER)).toBe(false)
  })
})
