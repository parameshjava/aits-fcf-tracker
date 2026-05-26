import { describe, expect, it } from 'vitest'
import {
  formatIndianGroups,
  formatRupees,
  formatRupeesCompact,
  sanitizeAmountInput,
  todayISO,
} from './format'

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

describe('sanitizeAmountInput', () => {
  it('strips letters and symbols', () => {
    expect(sanitizeAmountInput('Rs 1,00,000')).toBe('100000')
    expect(sanitizeAmountInput('₹50000')).toBe('50000')
    expect(sanitizeAmountInput('abc')).toBe('')
  })

  it('keeps a single leading decimal point', () => {
    expect(sanitizeAmountInput('1234.56')).toBe('1234.56')
  })

  it('collapses multiple decimal points', () => {
    expect(sanitizeAmountInput('12.34.56')).toBe('12.3456')
    expect(sanitizeAmountInput('1.2.3.4')).toBe('1.234')
  })

  it('preserves trailing decimal point while typing', () => {
    expect(sanitizeAmountInput('1234.')).toBe('1234.')
  })

  it('returns empty for empty input', () => {
    expect(sanitizeAmountInput('')).toBe('')
  })
})

describe('formatIndianGroups', () => {
  it('returns empty for empty input', () => {
    expect(formatIndianGroups('')).toBe('')
  })

  it('passes through small numbers unchanged', () => {
    expect(formatIndianGroups('5')).toBe('5')
    expect(formatIndianGroups('100')).toBe('100')
    expect(formatIndianGroups('999')).toBe('999')
  })

  it('groups thousands with one comma', () => {
    expect(formatIndianGroups('1000')).toBe('1,000')
    expect(formatIndianGroups('12345')).toBe('12,345')
  })

  it('uses Indian Lakh grouping (last 3 then groups of 2)', () => {
    expect(formatIndianGroups('100000')).toBe('1,00,000')
    expect(formatIndianGroups('1250000')).toBe('12,50,000')
    expect(formatIndianGroups('12500000')).toBe('1,25,00,000')
    expect(formatIndianGroups('112345678')).toBe('11,23,45,678')
  })

  it('preserves decimals', () => {
    expect(formatIndianGroups('12345.6')).toBe('12,345.6')
    expect(formatIndianGroups('100000.50')).toBe('1,00,000.50')
  })

  it('preserves trailing decimal point so users can keep typing', () => {
    expect(formatIndianGroups('1234.')).toBe('1,234.')
    expect(formatIndianGroups('100000.')).toBe('1,00,000.')
  })
})
