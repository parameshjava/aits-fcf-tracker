import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'
import { getMeeting } from '@/lib/actions/meetings-reads'
import { ActionItemsPanel } from '@/components/action-items-panel'
import { LinkedPollModal } from '@/components/linked-poll-modal'
import { MeetingTime } from '@/components/meeting-time'
import { instantToZonedParts } from '@/lib/datetime'
import { CapturePage } from './capture-page'
import { MeetingControls } from './meeting-controls'
import { EditMeetingTimeDialog } from './edit-meeting-time-dialog'

export default async function AdminMeetingDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') redirect('/')

  const meeting = await getMeeting(id)
  if (!meeting) notFound()

  // Prefill the edit form in the meeting's own timezone (the Google model:
  // edit the originally-scheduled wall time). End falls back to start if the
  // end instant is somehow absent (e.g. before migration 036).
  const startParts = instantToZonedParts(meeting.meeting_at, meeting.meeting_tz)
  const endParts = meeting.meeting_ends_at
    ? instantToZonedParts(meeting.meeting_ends_at, meeting.meeting_tz)
    : startParts

  return (
    <div className="mx-auto max-w-4xl space-y-3 px-4 py-6 sm:px-6">
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{meeting.title}</h1>
            <div className="mt-1 text-xs text-gray-500">
              <MeetingTime meetingAt={meeting.meeting_at} meetingEndsAt={meeting.meeting_ends_at} meetingTz={meeting.meeting_tz} /> · {meeting.attendee_count} attendees
              {meeting.linked_poll && (
                <>
                  {' · linked poll: '}
                  <LinkedPollModal poll={meeting.linked_poll} />
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
            {meeting.status === 'open' && (
              <EditMeetingTimeDialog
                meetingId={meeting.id}
                defaultDate={startParts.date}
                defaultStartTime={startParts.time}
                defaultEndTime={endParts.time}
                defaultTz={meeting.meeting_tz}
              />
            )}
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
