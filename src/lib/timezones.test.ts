import { describe, it, expect } from 'vitest'
import { MEETING_TIMEZONES, isValidMeetingTz } from './timezones'

describe('meeting timezones', () => {
  it('lists IST first as the default', () => {
    expect(MEETING_TIMEZONES[0].value).toBe('Asia/Kolkata')
  })

  it('accepts a known IANA zone', () => {
    expect(isValidMeetingTz('America/New_York')).toBe(true)
  })

  it('rejects an unknown or non-string value', () => {
    expect(isValidMeetingTz('Mars/Olympus')).toBe(false)
    expect(isValidMeetingTz(null)).toBe(false)
    expect(isValidMeetingTz(123)).toBe(false)
  })
})
