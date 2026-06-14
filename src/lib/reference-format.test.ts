import { describe, it, expect } from 'vitest'
import {
  formatReferenceValue,
  asReferenceDatatype,
  isReferenceDatatype,
  ymdIntToInputDate,
  inputDateToYmdInt,
  formatYmdInt,
} from './reference-format'

describe('formatReferenceValue', () => {
  it('renders INR with the en-IN rupee symbol and grouping', () => {
    expect(formatReferenceValue(500000, 'inr')).toBe('₹5,00,000')
    expect(formatReferenceValue(-99500, 'inr')).toBe('₹-99,500')
  })

  it('appends a % suffix for percentages', () => {
    expect(formatReferenceValue(25, 'percentage')).toBe('25%')
    expect(formatReferenceValue(2.5, 'percentage')).toBe('2.5%')
  })

  it('formats YYYYMMDD-encoded dates', () => {
    expect(formatReferenceValue(20260701, 'date')).toBe('01 Jul 2026')
  })

  it('renders plain numbers with en-IN grouping, no symbol', () => {
    expect(formatReferenceValue(500000, 'number')).toBe('5,00,000')
    expect(formatReferenceValue(30, 'number')).toBe('30')
  })
})

describe('datatype coercion', () => {
  it('accepts the four known datatypes', () => {
    for (const dt of ['inr', 'percentage', 'date', 'number']) {
      expect(isReferenceDatatype(dt)).toBe(true)
    }
  })

  it('rejects unknown values', () => {
    expect(isReferenceDatatype('currency')).toBe(false)
    expect(isReferenceDatatype(null)).toBe(false)
    expect(isReferenceDatatype(undefined)).toBe(false)
  })

  it('coerces unknown values to number', () => {
    expect(asReferenceDatatype('inr')).toBe('inr')
    expect(asReferenceDatatype('bogus')).toBe('number')
    expect(asReferenceDatatype(null)).toBe('number')
  })
})

describe('YYYYMMDD <-> date-input conversion', () => {
  it('round-trips a valid date', () => {
    expect(ymdIntToInputDate(20260701)).toBe('2026-07-01')
    expect(inputDateToYmdInt('2026-07-01')).toBe(20260701)
  })

  it('returns empty / NaN for invalid input', () => {
    expect(ymdIntToInputDate(5000)).toBe('')
    expect(Number.isNaN(inputDateToYmdInt('not-a-date'))).toBe(true)
  })

  it('falls back to the raw value when not a valid YYYYMMDD', () => {
    expect(formatYmdInt(5000)).toBe('5000')
  })
})
