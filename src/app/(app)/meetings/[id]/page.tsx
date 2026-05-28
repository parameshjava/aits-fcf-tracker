import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'
import { getMeeting } from '@/lib/actions/meetings-reads'
import { createClient } from '@/lib/supabase/server'
import { ActionItemsPanel } from '@/components/action-items-panel'
import { LinkedPollModal } from '@/components/linked-poll-modal'
import { MarkdownView } from '@/components/markdown-view'
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

  const present = meeting.attendees.filter((a) => a.attended)
  const absent  = meeting.attendees.filter((a) => !a.attended)

  return (
    <div className="mx-auto max-w-4xl space-y-3 px-4 py-6 sm:px-6">
      {/* Section 1 — Header card */}
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{meeting.title}</h1>
            <div className="mt-1 text-xs text-gray-500">
              {meeting.meeting_date}
              {meeting.linked_poll && (
                <>
                  {' · linked poll: '}
                  <LinkedPollModal poll={meeting.linked_poll} />
                </>
              )}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Created by {meeting.created_by_member?.name ?? '—'} on{' '}
              {new Date(meeting.created_at).toLocaleDateString('en-IN')}
              {meeting.status === 'closed' && meeting.closed_by_member && meeting.closed_at && (
                <>
                  {' · Closed by '}{meeting.closed_by_member.name}{' on '}
                  {new Date(meeting.closed_at).toLocaleDateString('en-IN')}
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

      {/* Section 2 — Agenda card (only when agenda_md is set) */}
      {meeting.agenda_md && (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Agenda</h2>
          <MarkdownView source={meeting.agenda_md} />
        </div>
      )}

      {/* Section 3 — Attendance card */}
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          Attendance{' '}
          <span className="font-normal text-gray-500">
            ({present.length} present{absent.length > 0 ? ` · ${absent.length} absent` : ''})
          </span>
        </h2>
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Present
            </div>
            {present.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {present.map((a) => (
                  <span
                    key={a.member_id}
                    className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-800 ring-1 ring-inset ring-green-200"
                  >
                    {a.member_name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No one marked present.</p>
            )}
          </div>
          {absent.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Absent
              </div>
              <div className="flex flex-wrap gap-1.5">
                {absent.map((a) => (
                  <span
                    key={a.member_id}
                    className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200"
                  >
                    {a.member_name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section 4 — Notes accordion (present attendees only) */}
      <ConsolidatedView
        meeting={{ ...meeting, attendees: present }}
        viewerMemberId={viewerMemberId}
      />

      {/* Section 5 — Action items panel */}
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
