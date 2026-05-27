import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'
import { getMeeting } from '@/lib/actions/meetings-reads'
import { createClient } from '@/lib/supabase/server'
import { ActionItemsPanel } from '@/components/action-items-panel'
import { LinkedPollModal } from '@/components/linked-poll-modal'
import { ConsolidatedView } from './consolidated-view'

async function resolveViewerMemberId(email: string | undefined): Promise<string | null> {
  if (!email) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('members')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

export default async function MeetingDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) redirect('/auth/login')

  const meeting = await getMeeting(id)
  if (!meeting) notFound()

  const viewerMemberId = await resolveViewerMemberId(user.email)
  const isAdmin = user.profile?.role === 'admin'

  return (
    <div className="mx-auto max-w-4xl space-y-3 px-4 py-6 sm:px-6">
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{meeting.title}</h1>
            <div className="mt-1 text-xs text-gray-500">
              {meeting.meeting_date} · {meeting.attendee_count} attendees
              {meeting.linked_poll && (
                <>
                  {' · linked poll: '}
                  <LinkedPollModal poll={meeting.linked_poll} />
                </>
              )}
            </div>
          </div>
          <span
            className={
              'rounded-full px-2 py-0.5 text-xs font-semibold ' +
              (meeting.status === 'open'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-green-100 text-green-800')
            }
          >
            {meeting.status === 'open' ? 'Open' : 'Closed'}
          </span>
        </div>
      </div>

      <ConsolidatedView meeting={meeting} viewerMemberId={viewerMemberId} />

      <ActionItemsPanel
        meetingId={meeting.id}
        meetingStatus={meeting.status}
        source={meeting.action_items_md}
        isAdmin={isAdmin}
        mentionOptions={meeting.attendees.map((a) => ({ slug: a.member_slug, name: a.member_name }))}
      />
    </div>
  )
}
