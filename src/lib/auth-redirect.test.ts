import { describe, expect, it } from 'vitest'
import { isSafeNextPath } from './auth-redirect'

describe('isSafeNextPath', () => {
  it('accepts simple internal paths', () => {
    expect(isSafeNextPath('/polls/abc-123')).toBe(true)
    expect(isSafeNextPath('/dashboard')).toBe(true)
    expect(isSafeNextPath('/admin/loans/202501-001')).toBe(true)
  })

  it('accepts internal paths with search and hash', () => {
    expect(isSafeNextPath('/dashboard?year=2024')).toBe(true)
    expect(isSafeNextPath('/polls?tab=open')).toBe(true)
    expect(isSafeNextPath('/contributions#totals')).toBe(true)
  })

  it('rejects protocol-relative URLs (open redirect)', () => {
    expect(isSafeNextPath('//evil.com')).toBe(false)
    expect(isSafeNextPath('//evil.com/polls/abc')).toBe(false)
  })

  it('rejects absolute URLs', () => {
    expect(isSafeNextPath('https://evil.com')).toBe(false)
    expect(isSafeNextPath('http://evil.com/polls')).toBe(false)
  })

  it('rejects javascript: and data: schemes', () => {
    expect(isSafeNextPath('javascript:alert(1)')).toBe(false)
    expect(isSafeNextPath('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('rejects backslash-prefixed weirdness', () => {
    expect(isSafeNextPath('/\\evil.com')).toBe(false)
    expect(isSafeNextPath('\\\\evil.com')).toBe(false)
  })

  it('rejects relative paths without leading slash', () => {
    expect(isSafeNextPath('polls/abc')).toBe(false)
    expect(isSafeNextPath('dashboard')).toBe(false)
  })

  it('rejects empty / nullish input', () => {
    expect(isSafeNextPath('')).toBe(false)
    expect(isSafeNextPath(null)).toBe(false)
    expect(isSafeNextPath(undefined)).toBe(false)
  })
})
