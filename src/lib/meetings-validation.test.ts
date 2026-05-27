import { describe, expect, it } from 'vitest'
import {
  validateMeetingCreate,
  validateNotes,
} from './meetings-validation'

describe('validateMeetingCreate', () => {
  it('rejects empty title', () => {
    const r = validateMeetingCreate({
      title: '   ',
      meeting_date: '2026-05-27',
      attendee_ids: ['m1'],
      linked_poll_id: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('title')
  })

  it('rejects title shorter than 3 chars', () => {
    const r = validateMeetingCreate({
      title: 'ab',
      meeting_date: '2026-05-27',
      attendee_ids: ['m1'],
      linked_poll_id: null,
    })
    expect(r.ok).toBe(false)
  })

  it('rejects empty attendees list', () => {
    const r = validateMeetingCreate({
      title: 'Fund rules review',
      meeting_date: '2026-05-27',
      attendee_ids: [],
      linked_poll_id: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('attendees')
  })

  it('rejects invalid date', () => {
    const r = validateMeetingCreate({
      title: 'OK title',
      meeting_date: 'nope',
      attendee_ids: ['m1'],
      linked_poll_id: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('meeting_date')
  })

  it('deduplicates attendee ids', () => {
    const r = validateMeetingCreate({
      title: 'OK title',
      meeting_date: '2026-05-27',
      attendee_ids: ['11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222'],
      linked_poll_id: null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.attendee_ids).toEqual(['11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222'])
  })

  it('passes a well-formed payload', () => {
    const r = validateMeetingCreate({
      title: 'Fund rules review',
      meeting_date: '2026-05-27',
      attendee_ids: ['11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222'],
      linked_poll_id: '33333333-3333-3333-3333-333333333333',
    })
    expect(r.ok).toBe(true)
  })
})

describe('validateNotes', () => {
  it('coerces empty/whitespace to null', () => {
    const r = validateNotes('   ')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBeNull()
  })

  it('rejects notes longer than 20000 chars', () => {
    const r = validateNotes('a'.repeat(20_001))
    expect(r.ok).toBe(false)
  })

  it('passes a normal markdown string', () => {
    const r = validateNotes('## Notes\n- point one')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('## Notes\n- point one')
  })
})
