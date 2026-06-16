import { describe, expect, it } from 'vitest'
import { toPrimeButton } from './prime-button'

describe('toPrimeButton', () => {
  it('maps default variant to primary (no severity, not outlined/text)', () => {
    expect(toPrimeButton('default', 'default')).toEqual({
      severity: undefined, outlined: false, text: false, prSize: undefined,
    })
  })
  it('maps destructive to danger severity', () => {
    expect(toPrimeButton('destructive', 'default').severity).toBe('danger')
  })
  it('maps secondary to secondary severity', () => {
    expect(toPrimeButton('secondary', 'default').severity).toBe('secondary')
  })
  it('maps outline to outlined=true', () => {
    expect(toPrimeButton('outline', 'default').outlined).toBe(true)
  })
  it('maps ghost and link to text=true', () => {
    expect(toPrimeButton('ghost', 'default').text).toBe(true)
    expect(toPrimeButton('link', 'default').text).toBe(true)
  })
  it('maps sm and lg sizes; default size stays undefined', () => {
    expect(toPrimeButton('default', 'sm').prSize).toBe('small')
    expect(toPrimeButton('default', 'lg').prSize).toBe('large')
    expect(toPrimeButton('default', 'default').prSize).toBeUndefined()
  })
})
