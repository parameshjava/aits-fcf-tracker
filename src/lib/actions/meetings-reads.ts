// src/lib/actions/meetings-reads.ts

/**
 * Meetings read accessors. The three cached functions below (`getMeetings`,
 * `getMeeting`, `getOpenAndRecentPolls`) use `createAdminClient` because
 * Cache Components forbids reading cookies inside a `'use cache'` scope.
 * Meetings are org-wide readable per RLS spec, so bypassing RLS in the
 * cached read is safe — auth gating happens in (app)/layout.tsx + each
 * page's getCurrentUser() redirect before these run.
 *
 * `getMyOpenUncapturedMeetingCount` stays on the cookie-aware client because
 * it's per-user (not cached).
 */

import { cacheLife, cacheTag } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'

export type MeetingRow = {
  id: string
  title: string
  meeting_date: string
  status: 'open' | 'closed'
  linked_poll_id: string | null
  agenda_md: string | null
  action_items_md: string | null
  created_by: string
  created_at: string
  closed_at: string | null
  closed_by: string | null
  attendee_count: number
  present_count: number
  captured_count: number
}

export async function getMeetings(): Promise<MeetingRow[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('meetings')

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('meetings_with_progress')
    .select('*')
    .order('meeting_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as MeetingRow[]
}

export type MeetingAttendee = {
  meeting_id: string
  member_id: string
  position: number
  attended: boolean
  notes_md: string | null
  notes_updated_at: string | null
  notes_updated_by: string | null
  member_name: string
  member_slug: string
}

export type MeetingDetail = MeetingRow & {
  attendees: MeetingAttendee[]
  linked_poll: { id: string; question: string; status: 'open' | 'closed' } | null
  created_by_member: { id: string; name: string } | null
  closed_by_member: { id: string; name: string } | null
}

export async function getMeeting(id: string): Promise<MeetingDetail | null> {
  'use cache'
  cacheLife('hours')
  cacheTag('meetings')
  cacheTag(`meeting:${id}`)

  const supabase = createAdminClient()
  const { data: meeting, error: mErr } = await supabase
    .from('meetings_with_progress')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (mErr) throw new Error(mErr.message)
  if (!meeting) return null

  // members table uses `name` (not `full_name`) — see 001_init_schema.sql
  const { data: attendees, error: aErr } = await supabase
    .from('meeting_attendees')
    .select('meeting_id, member_id, position, attended, notes_md, notes_updated_at, notes_updated_by, members:member_id (name, slug)')
    .eq('meeting_id', id)
    .order('position', { ascending: true })
  if (aErr) throw new Error(aErr.message)

  let linked_poll = null as MeetingDetail['linked_poll']
  if (meeting.linked_poll_id) {
    const { data: poll } = await supabase
      .from('polls')
      .select('id, question, status')
      .eq('id', meeting.linked_poll_id)
      .maybeSingle()
    if (poll) linked_poll = poll as MeetingDetail['linked_poll']
  }

  const memberLookupIds = [meeting.created_by, meeting.closed_by].filter(
    (x): x is string => typeof x === 'string',
  )
  let memberNameById: Record<string, string> = {}
  if (memberLookupIds.length > 0) {
    const { data: memberRows } = await supabase
      .from('members')
      .select('id, name')
      .in('id', memberLookupIds)
    memberNameById = Object.fromEntries(
      (memberRows ?? []).map((m) => [m.id as string, m.name as string]),
    )
  }

  const created_by_member = meeting.created_by
    ? { id: meeting.created_by, name: memberNameById[meeting.created_by] ?? '—' }
    : null
  const closed_by_member = meeting.closed_by
    ? { id: meeting.closed_by, name: memberNameById[meeting.closed_by] ?? '—' }
    : null

  return {
    ...(meeting as MeetingRow),
    attendees: (attendees ?? []).map((row) => {
      const m = (row as unknown as { members: { name: string; slug: string } | null }).members
      return {
        meeting_id: row.meeting_id as string,
        member_id: row.member_id as string,
        position: row.position as number,
        attended: row.attended as boolean,
        notes_md: (row.notes_md as string | null) ?? null,
        notes_updated_at: (row.notes_updated_at as string | null) ?? null,
        notes_updated_by: (row.notes_updated_by as string | null) ?? null,
        member_name: m?.name ?? '(unknown)',
        member_slug: m?.slug ?? '',
      }
    }),
    linked_poll,
    created_by_member,
    closed_by_member,
  }
}

/** Open polls (status='open') and recent closed polls, for the linked-poll picker on the create form. */
export async function getOpenAndRecentPolls(): Promise<
  Array<{ id: string; question: string; status: 'open' | 'closed'; closes_at: string }>
> {
  'use cache'
  cacheLife('hours')
  cacheTag('polls')

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('polls')
    .select('id, question, status, closes_at')
    .order('status', { ascending: true })
    .order('closes_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []) as Array<{ id: string; question: string; status: 'open' | 'closed'; closes_at: string }>
}

/**
 * Per-user count of open meetings where the viewer is an attendee with no
 * notes yet. Intentionally NOT cached — varies per user. Used by sidebar.
 *
 * getCurrentUser() returns { ...auth.User, profile } — no .member property.
 * We resolve the member row by matching members.email to the auth user email.
 */
export async function getMyOpenUncapturedMeetingCount(): Promise<number> {
  const user = await getCurrentUser()
  if (!user?.email) return 0

  const supabase = await createClient()

  // Resolve member by email (members.email is the Google login identity)
  const { data: member } = await supabase
    .from('members')
    .select('id')
    .ilike('email', user.email)
    .maybeSingle()
  if (!member?.id) return 0

  const { count, error } = await supabase
    .from('meeting_attendees')
    .select('meeting_id, meetings!inner(status)', { count: 'exact', head: true })
    .eq('member_id', member.id)
    .is('notes_md', null)
    .eq('meetings.status', 'open')

  if (error) return 0
  return count ?? 0
}
