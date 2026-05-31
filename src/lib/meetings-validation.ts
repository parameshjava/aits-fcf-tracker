export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; field?: string }

export type MeetingCreateInput = {
  title: string
  meeting_date: string
  meeting_time: string
  meeting_tz: string
  linked_poll_id: string | null
  agenda_md: string | null
}

import { isValidMeetingTz } from '@/lib/timezones'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateMeetingCreate(
  raw: unknown,
): Validated<MeetingCreateInput> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Invalid payload' }
  }
  const r = raw as Record<string, unknown>

  const title = String(r.title ?? '').trim()
  if (title.length < 3 || title.length > 200) {
    return { ok: false, error: 'Title must be 3–200 characters', field: 'title' }
  }

  const meeting_date = String(r.meeting_date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meeting_date) || Number.isNaN(Date.parse(meeting_date))) {
    return { ok: false, error: 'Pick a valid date', field: 'meeting_date' }
  }

  const meeting_time = String(r.meeting_time ?? '').trim()
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(meeting_time)) {
    return { ok: false, error: 'Pick a valid time', field: 'meeting_time' }
  }

  const meeting_tz = String(r.meeting_tz ?? '').trim()
  if (!isValidMeetingTz(meeting_tz)) {
    return { ok: false, error: 'Pick a valid timezone', field: 'meeting_tz' }
  }

  const linkedRaw = r.linked_poll_id
  let linked_poll_id: string | null = null
  if (linkedRaw && String(linkedRaw).trim()) {
    const v = String(linkedRaw).trim()
    if (!UUID_RE.test(v)) {
      return { ok: false, error: 'Invalid linked poll id', field: 'linked_poll_id' }
    }
    linked_poll_id = v
  }

  const agendaRaw = r.agenda_md
  let agenda_md: string | null = null
  if (agendaRaw != null) {
    const a = String(agendaRaw)
    if (a.length > 10_000) {
      return { ok: false, error: 'Agenda is too long (max 10000 chars)', field: 'agenda_md' }
    }
    agenda_md = a.trim().length === 0 ? null : a
  }

  return { ok: true, value: { title, meeting_date, meeting_time, meeting_tz, linked_poll_id, agenda_md } }
}

export function validateNotes(raw: unknown): Validated<string | null> {
  const s = (raw == null ? '' : String(raw))
  if (s.length > 20_000) {
    return { ok: false, error: 'Notes are too long (max 20000 chars)' }
  }
  const trimmed = s.trim()
  return { ok: true, value: trimmed.length === 0 ? null : s }
}

export function validateAgenda(raw: unknown): Validated<string | null> {
  const s = raw == null ? '' : String(raw)
  if (s.length > 10_000) {
    return { ok: false, error: 'Agenda is too long (max 10000 chars)' }
  }
  return { ok: true, value: s.trim().length === 0 ? null : s }
}

export function validateAttendedFlag(raw: unknown): Validated<boolean> {
  if (raw === 'true')  return { ok: true, value: true }
  if (raw === 'false') return { ok: true, value: false }
  return { ok: false, error: 'attended must be the string "true" or "false"' }
}
