import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/actions/auth'
import { getMeeting } from '@/lib/actions/meetings-reads'
import { ActionItemsPanel } from '@/components/action-items-panel'
import { CapturePage } from './capture-page'
import { MeetingControls } from './meeting-controls'

export default async function AdminMeetingDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') redirect('/')

  const meeting = await getMeeting(id)
  if (!meeting) notFound()

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
                  <Link href={`/polls/${meeting.linked_poll.id}`} className="text-blue-600 underline">
                    {meeting.linked_poll.question}
                  </Link>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={
                'rounded-full px-2 py-0.5 text-xs font-semibold ' +
                (meeting.status === 'open'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-green-100 text-green-800')
              }
            >
              {meeting.status === 'open' ? 'In progress' : 'Closed'}
            </span>
            <MeetingControls meetingId={meeting.id} status={meeting.status} />
          </div>
        </div>
      </div>

      <CapturePage meeting={meeting} />

      <ActionItemsPanel
        meetingId={meeting.id}
        meetingStatus={meeting.status}
        source={meeting.action_items_md}
        isAdmin={true}
        mentionOptions={meeting.attendees.map((a) => ({ slug: a.member_slug, name: a.member_name }))}
      />
    </div>
  )
}
