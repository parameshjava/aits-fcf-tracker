import { describe, it, expect } from 'vitest'
import { overdueParts, formatDueLabel, formatOverdueDuration } from './due'

describe('overdueParts', () => {
  it('returns null when not yet due', () => {
    expect(overdueParts('2026-06-20', '2026-06-14')).toBeNull()
  })
  it('returns null on the due date itself', () => {
    expect(overdueParts('2026-06-14', '2026-06-14')).toBeNull()
  })
  it('days only when within the same month', () => {
    expect(overdueParts('2026-06-10', '2026-06-14')).toEqual({ months: 0, days: 4 })
  })
  it('whole months plus days', () => {
    expect(overdueParts('2026-04-10', '2026-06-14')).toEqual({ months: 2, days: 4 })
  })
  it('borrows days across a month boundary', () => {
    // Apr 20 → May 20 = 1 month; May 20 → Jun 14 = 25 days
    expect(overdueParts('2026-04-20', '2026-06-14')).toEqual({ months: 1, days: 25 })
  })
  it('rolls across a year', () => {
    expect(overdueParts('2025-12-10', '2026-01-15')).toEqual({ months: 1, days: 5 })
  })
})

describe('formatDueLabel', () => {
  it('omits the months part when zero', () => {
    expect(formatDueLabel({ months: 0, days: 4 })).toBe('Due (4D)')
  })
  it('includes months when present', () => {
    expect(formatDueLabel({ months: 2, days: 4 })).toBe('Due (2M 4D)')
  })
})

describe('formatOverdueDuration', () => {
  it('formats bare duration', () => {
    expect(formatOverdueDuration({ months: 0, days: 4 })).toBe('4D')
    expect(formatOverdueDuration({ months: 1, days: 25 })).toBe('1M 25D')
  })
})
