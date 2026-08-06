import { describe, it, expect } from 'vitest'
import { cutoverYmdToIso, emiScheduleStart, isCutoverFloored } from './emi-anchor'

const CUTOVER = '2026-07-01'

describe('cutoverYmdToIso', () => {
  it('converts the YYYYMMDD integer held in reference.value', () => {
    expect(cutoverYmdToIso(20260701)).toBe('2026-07-01')
  })

  it('tolerates a numeric value that arrived with a fractional part', () => {
    expect(cutoverYmdToIso(20260701.0)).toBe('2026-07-01')
  })

  it('returns null for an unset / malformed value rather than a bogus date', () => {
    expect(cutoverYmdToIso(0)).toBeNull()
    expect(cutoverYmdToIso(202607)).toBeNull()
  })
})

describe('emiScheduleStart', () => {
  it('floors a pre-cutover loan at the cutover', () => {
    // The production incident: a 2025 loan was scheduled from its own start
    // date, producing installments due 2025-10-10 onward.
    expect(emiScheduleStart('2025-09-15', CUTOVER)).toBe(CUTOVER)
  })

  it('leaves a post-cutover loan on its own start date', () => {
    expect(emiScheduleStart('2026-09-15', CUTOVER)).toBe('2026-09-15')
  })

  it('is a no-op for a loan starting exactly on the cutover', () => {
    expect(emiScheduleStart(CUTOVER, CUTOVER)).toBe(CUTOVER)
  })

  it('applies no floor when the cutover is unconfigured', () => {
    expect(emiScheduleStart('2025-09-15', null)).toBe('2025-09-15')
  })
})

describe('isCutoverFloored', () => {
  it('is true for a converted (pre-cutover) loan', () => {
    expect(isCutoverFloored('2025-09-15', CUTOVER)).toBe(true)
  })

  it('is false for a natively-EMI loan created after the cutover', () => {
    expect(isCutoverFloored('2026-09-15', CUTOVER)).toBe(false)
  })

  it('is false on the cutover date itself', () => {
    expect(isCutoverFloored(CUTOVER, CUTOVER)).toBe(false)
  })

  it('is false when the cutover is unconfigured', () => {
    expect(isCutoverFloored('2025-09-15', null)).toBe(false)
  })
})
