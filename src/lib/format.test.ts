import { describe, expect, it } from 'vitest'
import { formatRupees, formatRupeesCompact, todayISO } from './format'

describe('formatRupees', () => {
  it('formats whole rupees with the en-IN lakh grouping', () => {
    // 1,00,000 (1 lakh) — not 100,000 — verifies the en-IN locale is pinned.
    expect(formatRupees(100_000)).toBe('₹1,00,000')
    expect(formatRupees(50_000)).toBe('₹50,000')
    expect(formatRupees(1_23_45_678)).toBe('₹1,23,45,678')
  })

  it('drops fractional digits (zero maximumFractionDigits)', () => {
    expect(formatRupees(1234.56)).toBe('₹1,235') // banker's-style rounding via Intl
    expect(formatRupees(0.4)).toBe('₹0')
  })

  it('handles 0, null, undefined as ₹0', () => {
    expect(formatRupees(0)).toBe('₹0')
    expect(formatRupees(null)).toBe('₹0')
    expect(formatRupees(undefined)).toBe('₹0')
  })

  it('coerces numeric strings', () => {
    expect(formatRupees('500')).toBe('₹500')
    expect(formatRupees('100000')).toBe('₹1,00,000')
  })

  it('returns ₹0 for non-finite inputs (NaN, Infinity)', () => {
    expect(formatRupees('not-a-number')).toBe('₹0')
    expect(formatRupees(Number.POSITIVE_INFINITY)).toBe('₹0')
    expect(formatRupees(Number.NaN)).toBe('₹0')
  })

  it('formats negatives with a leading minus', () => {
    expect(formatRupees(-12345)).toBe('₹-12,345')
  })
})

describe('formatRupeesCompact', () => {
  it('uses raw rupees below ₹1,000', () => {
    expect(formatRupeesCompact(500)).toBe('₹500')
    expect(formatRupeesCompact(0)).toBe('₹0')
  })

  it('uses K suffix between ₹1,000 and ₹1,00,000', () => {
    expect(formatRupeesCompact(1_500)).toBe('₹1.5K')
    expect(formatRupeesCompact(99_000)).toBe('₹99.0K')
  })

  it('uses L (lakh) suffix between ₹1L and ₹1Cr', () => {
    expect(formatRupeesCompact(1_00_000)).toBe('₹1.0L')
    expect(formatRupeesCompact(5_50_000)).toBe('₹5.5L')
  })

  it('uses Cr (crore) suffix at and above ₹1Cr', () => {
    expect(formatRupeesCompact(1_00_00_000)).toBe('₹1.0Cr')
    expect(formatRupeesCompact(2_50_00_000)).toBe('₹2.5Cr')
  })

  it('returns ₹0 for non-finite inputs', () => {
    expect(formatRupeesCompact('garbage')).toBe('₹0')
    expect(formatRupeesCompact(null)).toBe('₹0')
  })
})

describe('todayISO', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
