import { describe, expect, it } from 'vitest'
import {
  validateMeetingCreate,
  validateNotes,
  validateAgenda,
  validateAttendedFlag,
} from './meetings-validation'

describe('validateMeetingCreate', () => {
  it('rejects empty title', () => {
    const r = validateMeetingCreate({
      title: '   ',
      meeting_date: '2026-05-27',
      meeting_time: '19:00',
      meeting_tz: 'Asia/Kolkata',
      linked_poll_id: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('title')
  })

  it('rejects title shorter than 3 chars', () => {
    const r = validateMeetingCreate({
      title: 'ab',
      meeting_date: '2026-05-27',
      meeting_time: '19:00',
      meeting_tz: 'Asia/Kolkata',
      linked_poll_id: null,
    })
    expect(r.ok).toBe(false)
  })

  it('rejects invalid date', () => {
    const r = validateMeetingCreate({
      title: 'OK title',
      meeting_date: 'nope',
      linked_poll_id: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('meeting_date')
  })

  it('passes a well-formed payload', () => {
    const r = validateMeetingCreate({
      title: 'Fund rules review',
      meeting_date: '2026-05-27',
      meeting_time: '19:00',
      meeting_tz: 'Asia/Kolkata',
      linked_poll_id: '33333333-3333-3333-3333-333333333333',
    })
    expect(r.ok).toBe(true)
  })

  it('rejects an invalid linked_poll_id', () => {
    const r = validateMeetingCreate({
      title: 'OK title',
      meeting_date: '2026-05-27',
      meeting_time: '19:00',
      meeting_tz: 'Asia/Kolkata',
      linked_poll_id: 'not-a-uuid',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('linked_poll_id')
  })

  it('rejects a malformed time', () => {
    const r = validateMeetingCreate({
      title: 'Quarterly review',
      meeting_date: '2026-05-27',
      meeting_time: '7pm',
      meeting_tz: 'Asia/Kolkata',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('meeting_time')
  })

  it('rejects an unknown timezone', () => {
    const r = validateMeetingCreate({
      title: 'Quarterly review',
      meeting_date: '2026-05-27',
      meeting_time: '19:00',
      meeting_tz: 'Mars/Olympus',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('meeting_tz')
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

describe('validateMeetingCreate with agenda', () => {
  it('accepts an empty/null agenda', () => {
    const r = validateMeetingCreate({
      title: 'OK title',
      meeting_date: '2026-05-27',
      meeting_time: '19:00',
      meeting_tz: 'Asia/Kolkata',
      linked_poll_id: null,
      agenda_md: null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.agenda_md).toBeNull()
  })

  it('passes a normal markdown agenda', () => {
    const r = validateMeetingCreate({
      title: 'OK title',
      meeting_date: '2026-05-27',
      meeting_time: '19:00',
      meeting_tz: 'Asia/Kolkata',
      linked_poll_id: null,
      agenda_md: '# Topics\n1. Item one',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.agenda_md).toBe('# Topics\n1. Item one')
  })

  it('rejects agenda longer than 10000 chars', () => {
    const r = validateMeetingCreate({
      title: 'OK title',
      meeting_date: '2026-05-27',
      meeting_time: '19:00',
      meeting_tz: 'Asia/Kolkata',
      linked_poll_id: null,
      agenda_md: 'a'.repeat(10_001),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('agenda_md')
  })
})

describe('validateAgenda', () => {
  it('coerces empty / whitespace to null', () => {
    const r = validateAgenda('   ')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBeNull()
  })

  it('passes a normal markdown string', () => {
    const r = validateAgenda('## Agenda\n- topic one')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('## Agenda\n- topic one')
  })

  it('rejects strings longer than 10000 chars', () => {
    const r = validateAgenda('x'.repeat(10_001))
    expect(r.ok).toBe(false)
  })
})

describe('validateAttendedFlag', () => {
  it('parses the literal string "true"', () => {
    const r = validateAttendedFlag('true')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(true)
  })

  it('parses the literal string "false"', () => {
    const r = validateAttendedFlag('false')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(false)
  })

  it('rejects any other value', () => {
    expect(validateAttendedFlag('yes').ok).toBe(false)
    expect(validateAttendedFlag(undefined).ok).toBe(false)
    expect(validateAttendedFlag(1).ok).toBe(false)
  })
})
