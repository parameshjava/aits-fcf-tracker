// src/lib/actions/meetings.ts
'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'
import {
  actionError,
  actionOk,
  runAction,
  type ActionResult,
} from './action-result'
import {
  validateMeetingCreate,
  validateNotes,
  validateAgenda,
  validateAttendedFlag,
} from '@/lib/meetings-validation'
import { seededShuffle } from '@/lib/shuffle'
import { zonedWallTimeToInstant } from '@/lib/datetime'
import { isValidMeetingTz } from '@/lib/timezones'
import { canToggleActionItems, toggleCheckboxAt } from '@/lib/action-items'

async function getCurrentMemberId(): Promise<string | null> {
  const user = await getCurrentUser()
  if (!user?.email) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('members')
    .select('id')
    .eq('email', user.email.toLowerCase())
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

function invalidate(meetingId?: string) {
  updateTag('meetings')
  if (meetingId) updateTag(`meeting:${meetingId}`)
  revalidatePath('/meetings')
  if (meetingId) revalidatePath(`/meetings/${meetingId}`)
  revalidatePath('/admin/meetings')
  if (meetingId) revalidatePath(`/admin/meetings/${meetingId}`)
}

export async function createMeeting(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('createMeeting', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')
    const memberId = await getCurrentMemberId()
    if (!memberId) return actionError('Unauthorized')

    const v = validateMeetingCreate({
      title: formData.get('title'),
      meeting_date: formData.get('meeting_date'),
      meeting_time: formData.get('meeting_time'),
      meeting_tz: formData.get('meeting_tz'),
      linked_poll_id: formData.get('linked_poll_id'),
      agenda_md: formData.get('agenda_md'),
    })
    if (!v.ok) return actionError(v.error, v.field)

    const meetingAt = zonedWallTimeToInstant(
      v.value.meeting_date,
      v.value.meeting_time,
      v.value.meeting_tz,
    ).toISOString()

    const supabase = await createClient()

    // Auto-invite every canonical member as a present attendee. Admin manages
    // actual presence on the capture page via per-row Present toggles.
    const { data: memberRows, error: memErr } = await supabase
      .from('members')
      .select('id')
    if (memErr) return actionError(memErr.message)
    const memberIds = (memberRows ?? []).map((m) => m.id as string)
    if (memberIds.length === 0) return actionError('No members found to invite')

    const random_seed = Math.floor(Math.random() * 0x7fffffff)

    const { data: meeting, error: mErr } = await supabase
      .from('meetings')
      .insert({
        title: v.value.title,
        meeting_at: meetingAt,
        meeting_tz: v.value.meeting_tz,
        random_seed,
        linked_poll_id: v.value.linked_poll_id,
        agenda_md: v.value.agenda_md,
        created_by: memberId,
      })
      .select('id')
      .single()
    if (mErr) return actionError(mErr.message)

    const ordered = seededShuffle(memberIds, random_seed)
    const rows = ordered.map((member_id, idx) => ({
      meeting_id: meeting.id,
      member_id,
      position: idx + 1,
    }))
    const { error: aErr } = await supabase.from('meeting_attendees').insert(rows)
    if (aErr) {
      await supabase.from('meetings').delete().eq('id', meeting.id)
      return actionError(aErr.message)
    }

    invalidate(meeting.id)
    return actionOk({ meetingId: meeting.id }, 'Meeting created')
  })
}

export async function updateMeeting(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('updateMeeting', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const id = String(formData.get('id') ?? '').trim()
    if (!id) return actionError('Missing meeting id')

    const patch: Record<string, unknown> = {}
    const title = formData.get('title')
    if (typeof title === 'string') {
      const t = title.trim()
      if (t.length < 3 || t.length > 200) return actionError('Title must be 3–200 characters', 'title')
      patch.title = t
    }
    const meeting_date = formData.get('meeting_date')
    if (typeof meeting_date === 'string' && meeting_date.trim()) {
      const d = meeting_date.trim()
      const t = String(formData.get('meeting_time') ?? '').trim()
      const tz = String(formData.get('meeting_tz') ?? '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return actionError('Pick a valid date', 'meeting_date')
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return actionError('Pick a valid time', 'meeting_time')
      if (!isValidMeetingTz(tz)) return actionError('Pick a valid timezone', 'meeting_tz')
      patch.meeting_at = zonedWallTimeToInstant(d, t, tz).toISOString()
      patch.meeting_tz = tz
    }
    if (formData.has('linked_poll_id')) {
      const raw = String(formData.get('linked_poll_id') ?? '').trim()
      patch.linked_poll_id = raw === '' ? null : raw
    }

    if (Object.keys(patch).length === 0) return actionError('Nothing to update')

    const supabase = await createClient()
    const { error } = await supabase.from('meetings').update(patch).eq('id', id)
    if (error) return actionError(error.message)

    invalidate(id)
    return actionOk({ meetingId: id }, 'Meeting updated')
  })
}

export async function addAttendee(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('addAttendee', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const meetingId = String(formData.get('meeting_id') ?? '').trim()
    const memberId  = String(formData.get('member_id')  ?? '').trim()
    if (!meetingId || !memberId) return actionError('Missing ids')

    const supabase = await createClient()
    const { data: rows, error: posErr } = await supabase
      .from('meeting_attendees')
      .select('position')
      .eq('meeting_id', meetingId)
      .order('position', { ascending: false })
      .limit(1)
    if (posErr) return actionError(posErr.message)
    const nextPos = (rows?.[0]?.position ?? 0) + 1

    const { error } = await supabase
      .from('meeting_attendees')
      .insert({ meeting_id: meetingId, member_id: memberId, position: nextPos })
    if (error) return actionError(error.message)

    invalidate(meetingId)
    return actionOk({ meetingId }, 'Attendee added')
  })
}

export async function removeAttendee(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('removeAttendee', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const meetingId = String(formData.get('meeting_id') ?? '').trim()
    const memberId  = String(formData.get('member_id')  ?? '').trim()
    if (!meetingId || !memberId) return actionError('Missing ids')

    const supabase = await createClient()
    const { data: row, error: rErr } = await supabase
      .from('meeting_attendees')
      .select('notes_md')
      .eq('meeting_id', meetingId)
      .eq('member_id', memberId)
      .maybeSingle()
    if (rErr) return actionError(rErr.message)
    if (!row) return actionError('Attendee not found')
    if (row.notes_md != null) return actionError('Cannot remove an attendee whose notes are already captured')

    const { error } = await supabase
      .from('meeting_attendees')
      .delete()
      .eq('meeting_id', meetingId)
      .eq('member_id', memberId)
    if (error) return actionError(error.message)

    invalidate(meetingId)
    return actionOk({ meetingId }, 'Attendee removed')
  })
}

export async function saveAttendeeNotes(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('saveAttendeeNotes', async () => {
    const user = await getCurrentUser()
    if (!user) return actionError('Unauthorized')

    const meetingId = String(formData.get('meeting_id') ?? '').trim()
    const memberId  = String(formData.get('member_id')  ?? '').trim()
    if (!meetingId || !memberId) return actionError('Missing ids')

    const currentMemberId = await getCurrentMemberId()
    if (!currentMemberId) return actionError('Unauthorized')

    const isAdmin = user.profile?.role === 'admin'
    const isSelf  = currentMemberId === memberId
    if (!isAdmin && !isSelf) return actionError('Unauthorized')

    const v = validateNotes(formData.get('notes_md'))
    if (!v.ok) return actionError(v.error, 'notes_md')

    const supabase = await createClient()

    if (isSelf && !isAdmin) {
      const { data: m, error: mErr } = await supabase
        .from('meetings').select('status').eq('id', meetingId).maybeSingle()
      if (mErr) return actionError(mErr.message)
      if (!m) return actionError('Meeting not found')
      if (m.status !== 'open') return actionError('This meeting is closed')
    }

    const { error } = await supabase
      .from('meeting_attendees')
      .update({
        notes_md: v.value,
        notes_updated_by: currentMemberId,
      })
      .eq('meeting_id', meetingId)
      .eq('member_id', memberId)
    if (error) return actionError(error.message)

    invalidate(meetingId)
    return actionOk({ meetingId }, 'Notes saved')
  })
}

export async function closeMeeting(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('closeMeeting', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')
    const memberId = await getCurrentMemberId()
    if (!memberId) return actionError('Unauthorized')

    const id = String(formData.get('id') ?? '').trim()
    if (!id) return actionError('Missing meeting id')

    const supabase = await createClient()
    const { error } = await supabase
      .from('meetings')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: memberId,
      })
      .eq('id', id)
    if (error) return actionError(error.message)

    invalidate(id)
    return actionOk({ meetingId: id }, 'Meeting closed')
  })
}

export async function reopenMeeting(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('reopenMeeting', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')
    const id = String(formData.get('id') ?? '').trim()
    if (!id) return actionError('Missing meeting id')

    const supabase = await createClient()
    const { error } = await supabase
      .from('meetings')
      .update({ status: 'open', closed_at: null, closed_by: null })
      .eq('id', id)
    if (error) return actionError(error.message)

    invalidate(id)
    return actionOk({ meetingId: id }, 'Meeting reopened')
  })
}

export async function updateActionItems(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('updateActionItems', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const id = String(formData.get('id') ?? '').trim()
    if (!id) return actionError('Missing meeting id')

    const raw = formData.get('action_items_md')
    // Normalize line endings to LF on the way in — a CRLF value (e.g. pasted
    // text) would otherwise leave a trailing \r that breaks checkbox toggling.
    const text = (raw == null ? '' : String(raw)).replace(/\r\n?/g, '\n')
    if (text.length > 10_000) return actionError('Action items are too long (max 10000 chars)')

    const value = text.trim().length === 0 ? null : text

    const supabase = await createClient()
    const { error } = await supabase
      .from('meetings')
      .update({ action_items_md: value })
      .eq('id', id)
    if (error) return actionError(error.message)

    invalidate(id)
    return actionOk({ meetingId: id }, 'Action items saved')
  })
}

export async function toggleActionItem(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('toggleActionItem', async () => {
    const user = await getCurrentUser()
    if (!user) return actionError('Unauthorized')

    const id = String(formData.get('id') ?? '').trim()
    const lineIndex = Number(formData.get('line_index'))
    const checked = String(formData.get('checked') ?? '') === 'true'
    if (!id || !Number.isInteger(lineIndex)) return actionError('Invalid request')

    const supabase = await createClient()
    const { data: m, error: mErr } = await supabase
      .from('meetings')
      .select('status, action_items_md')
      .eq('id', id)
      .maybeSingle()
    if (mErr) return actionError(mErr.message)
    if (!m) return actionError('Meeting not found')
    const isAdmin = user.profile?.role === 'admin'
    if (!canToggleActionItems(m.status, isAdmin)) {
      return actionError('This meeting is closed')
    }

    const result = toggleCheckboxAt(m.action_items_md ?? '', lineIndex, checked)
    if (!result.ok) return actionError(result.error)

    if (result.value === m.action_items_md) {
      return actionOk({ meetingId: id })
    }

    const { error } = await supabase
      .from('meetings')
      .update({ action_items_md: result.value })
      .eq('id', id)
    if (error) return actionError(error.message)

    invalidate(id)
    return actionOk({ meetingId: id })
  })
}

/**
 * Re-read a single attendee's latest notes_md. Used by the per-row refresh
 * button on the admin capture page — admins can pick up notes that an
 * attendee wrote from their own device without reloading the whole meeting.
 *
 * Invalidates the meeting cache so subsequent server renders see fresh data.
 */
export async function refreshAttendeeNotes(
  formData: FormData,
): Promise<ActionResult<{ notes_md: string | null }>> {
  return runAction('refreshAttendeeNotes', async () => {
    const user = await getCurrentUser()
    if (!user) return actionError('Unauthorized')

    const meetingId = String(formData.get('meeting_id') ?? '').trim()
    const memberId  = String(formData.get('member_id')  ?? '').trim()
    if (!meetingId || !memberId) return actionError('Missing ids')

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('meeting_attendees')
      .select('notes_md')
      .eq('meeting_id', meetingId)
      .eq('member_id', memberId)
      .maybeSingle()
    if (error) return actionError(error.message)

    invalidate(meetingId)
    return actionOk({ notes_md: (data?.notes_md as string | null) ?? null })
  })
}

export async function updateAgenda(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('updateAgenda', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const id = String(formData.get('id') ?? '').trim()
    if (!id) return actionError('Missing meeting id')

    const v = validateAgenda(formData.get('agenda_md'))
    if (!v.ok) return actionError(v.error, 'agenda_md')

    const supabase = await createClient()
    const { error } = await supabase
      .from('meetings')
      .update({ agenda_md: v.value })
      .eq('id', id)
    if (error) return actionError(error.message)

    invalidate(id)
    return actionOk({ meetingId: id }, 'Agenda saved')
  })
}

export async function setAttendance(
  formData: FormData,
): Promise<ActionResult<{ memberId: string; attended: boolean }>> {
  return runAction('setAttendance', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const meetingId = String(formData.get('meeting_id') ?? '').trim()
    const memberId  = String(formData.get('member_id')  ?? '').trim()
    if (!meetingId || !memberId) return actionError('Missing ids')

    const v = validateAttendedFlag(formData.get('attended'))
    if (!v.ok) return actionError(v.error, 'attended')

    const supabase = await createClient()
    const { error } = await supabase
      .from('meeting_attendees')
      .update({ attended: v.value })
      .eq('meeting_id', meetingId)
      .eq('member_id', memberId)
    if (error) return actionError(error.message)

    invalidate(meetingId)
    return actionOk(
      { memberId, attended: v.value },
      v.value ? 'Marked present' : 'Marked absent',
    )
  })
}

export async function reshuffleAttendees(
  formData: FormData,
): Promise<ActionResult<{ meetingId: string }>> {
  return runAction('reshuffleAttendees', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const id = String(formData.get('id') ?? '').trim()
    if (!id) return actionError('Missing meeting id')

    const supabase = await createClient()

    const { data: rows, error: fetchErr } = await supabase
      .from('meeting_attendees')
      .select('member_id')
      .eq('meeting_id', id)
    if (fetchErr) return actionError(fetchErr.message)

    const memberIds = (rows ?? []).map((r) => r.member_id as string)
    if (memberIds.length === 0) return actionError('No attendees to shuffle')

    const newSeed = Math.floor(Math.random() * 2_000_000_000)
    const shuffled = seededShuffle(memberIds, newSeed)

    const { error: seedErr } = await supabase
      .from('meetings')
      .update({ random_seed: newSeed })
      .eq('id', id)
    if (seedErr) return actionError(seedErr.message)

    const { error: rpcErr } = await supabase.rpc('reshuffle_meeting_attendees', {
      p_meeting_id: id,
      p_member_order: shuffled,
    })
    if (rpcErr) return actionError(rpcErr.message)

    invalidate(id)
    return actionOk({ meetingId: id }, 'Attendees reshuffled')
  })
}
