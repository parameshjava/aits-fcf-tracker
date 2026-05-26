import { describe, it, expect } from 'vitest'
import { numberToIndianWords } from './number-to-words'

describe('numberToIndianWords', () => {
  it('handles zero', () => {
    expect(numberToIndianWords(0)).toBe('Zero Rupees Only')
  })

  it('handles empty / null / undefined / NaN', () => {
    expect(numberToIndianWords('')).toBe('')
    expect(numberToIndianWords(null)).toBe('')
    expect(numberToIndianWords(undefined)).toBe('')
    expect(numberToIndianWords(NaN)).toBe('')
    expect(numberToIndianWords(Infinity)).toBe('')
  })

  it('handles small integers', () => {
    expect(numberToIndianWords(1)).toBe('One Rupees Only')
    expect(numberToIndianWords(19)).toBe('Nineteen Rupees Only')
    expect(numberToIndianWords(20)).toBe('Twenty Rupees Only')
    expect(numberToIndianWords(23)).toBe('Twenty Three Rupees Only')
    expect(numberToIndianWords(99)).toBe('Ninety Nine Rupees Only')
  })

  it('handles hundreds', () => {
    expect(numberToIndianWords(100)).toBe('One Hundred Rupees Only')
    expect(numberToIndianWords(101)).toBe('One Hundred One Rupees Only')
    expect(numberToIndianWords(999)).toBe('Nine Hundred Ninety Nine Rupees Only')
  })

  it('handles thousands', () => {
    expect(numberToIndianWords(1000)).toBe('One Thousand Rupees Only')
    expect(numberToIndianWords(12345)).toBe('Twelve Thousand Three Hundred Forty Five Rupees Only')
    expect(numberToIndianWords(99999)).toBe('Ninety Nine Thousand Nine Hundred Ninety Nine Rupees Only')
  })

  it('handles lakhs (Indian grouping)', () => {
    expect(numberToIndianWords(100000)).toBe('One Lakh Rupees Only')
    expect(numberToIndianWords(250000)).toBe('Two Lakh Fifty Thousand Rupees Only')
    expect(numberToIndianWords(125075)).toBe(
      'One Lakh Twenty Five Thousand Seventy Five Rupees Only',
    )
  })

  it('handles crores (Indian grouping)', () => {
    expect(numberToIndianWords(10000000)).toBe('One Crore Rupees Only')
    expect(numberToIndianWords(12500000)).toBe(
      'One Crore Twenty Five Lakh Rupees Only',
    )
    expect(numberToIndianWords(112345678)).toBe(
      'Eleven Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees Only',
    )
  })

  it('handles paise', () => {
    expect(numberToIndianWords(0.5)).toBe('Fifty Paise Only')
    expect(numberToIndianWords(0.99)).toBe('Ninety Nine Paise Only')
    expect(numberToIndianWords(100.25)).toBe(
      'One Hundred Rupees and Twenty Five Paise Only',
    )
    expect(numberToIndianWords(125075.5)).toBe(
      'One Lakh Twenty Five Thousand Seventy Five Rupees and Fifty Paise Only',
    )
  })

  it('handles negative values', () => {
    expect(numberToIndianWords(-100)).toBe('Minus One Hundred Rupees Only')
    expect(numberToIndianWords(-100000)).toBe('Minus One Lakh Rupees Only')
  })

  it('accepts string inputs (form values arrive as strings)', () => {
    expect(numberToIndianWords('100000')).toBe('One Lakh Rupees Only')
    expect(numberToIndianWords('100000.5')).toBe('One Lakh Rupees and Fifty Paise Only')
  })
})
