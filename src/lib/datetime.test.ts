import { describe, it, expect } from 'vitest'
import { zonedWallTimeToInstant, formatInstant } from './datetime'

describe('zonedWallTimeToInstant', () => {
  it('converts an IST wall-clock to the correct UTC instant', () => {
    const d = zonedWallTimeToInstant('2026-05-31', '19:00', 'Asia/Kolkata')
    expect(d.toISOString()).toBe('2026-05-31T13:30:00.000Z')
  })

  it('handles a US zone in daylight saving time', () => {
    const d = zonedWallTimeToInstant('2026-07-01', '09:00', 'America/New_York')
    expect(d.toISOString()).toBe('2026-07-01T13:00:00.000Z')
  })

  it('handles a US zone in standard time', () => {
    const d = zonedWallTimeToInstant('2026-01-01', '09:00', 'America/New_York')
    expect(d.toISOString()).toBe('2026-01-01T14:00:00.000Z')
  })

  it('passes UTC wall-clock through unchanged', () => {
    const d = zonedWallTimeToInstant('2026-05-31', '12:00', 'UTC')
    expect(d.toISOString()).toBe('2026-05-31T12:00:00.000Z')
  })

  it('round-trips: the instant formatted back in its source zone equals the input', () => {
    const d = zonedWallTimeToInstant('2026-03-15', '14:45', 'Asia/Kolkata')
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(d)
    const get = (t: string) => parts.find((p) => p.type === t)?.value
    expect(`${get('year')}-${get('month')}-${get('day')}`).toBe('2026-03-15')
    expect(`${get('hour')}:${get('minute')}`).toBe('14:45')
  })
})

describe('formatInstant', () => {
  it('formats in an explicit zone with date, time and zone label', () => {
    const out = formatInstant('2026-05-31T13:30:00.000Z', 'Asia/Kolkata')
    // 13:30 UTC === 19:00 IST
    expect(out).toMatch(/7:00/)      // 12-hour clock shows 7:00 PM
    expect(out).toMatch(/2026/)
    expect(formatInstant('2026-05-31T13:30:00.000Z', 'America/New_York')).toMatch(/(EDT|GMT|EST)/)
  })

  it('formats the same instant differently in a different zone', () => {
    const ist = formatInstant('2026-05-31T13:30:00.000Z', 'Asia/Kolkata')
    const ny = formatInstant('2026-05-31T13:30:00.000Z', 'America/New_York')
    expect(ist).not.toBe(ny)
  })
})
