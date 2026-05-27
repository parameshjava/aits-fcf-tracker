export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; field?: string }

export type MeetingCreateInput = {
  title: string
  meeting_date: string
  attendee_ids: string[]
  linked_poll_id: string | null
}

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

  const rawIds = Array.isArray(r.attendee_ids) ? r.attendee_ids : []
  const attendee_ids = Array.from(new Set(rawIds.map((x) => String(x).trim()).filter(Boolean)))
  if (attendee_ids.length === 0) {
    return { ok: false, error: 'Pick at least one attendee', field: 'attendees' }
  }
  for (const id of attendee_ids) {
    if (!UUID_RE.test(id)) {
      return { ok: false, error: 'Invalid attendee id', field: 'attendees' }
    }
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

  return { ok: true, value: { title, meeting_date, attendee_ids, linked_poll_id } }
}

export function validateNotes(raw: unknown): Validated<string | null> {
  const s = (raw == null ? '' : String(raw))
  if (s.length > 20_000) {
    return { ok: false, error: 'Notes are too long (max 20000 chars)' }
  }
  const trimmed = s.trim()
  return { ok: true, value: trimmed.length === 0 ? null : s }
}
