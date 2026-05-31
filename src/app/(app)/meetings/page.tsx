import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'
import { getMeetings } from '@/lib/actions/meetings-reads'
import { MeetingTime } from '@/components/meeting-time'

export default async function MeetingsListPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const meetings = await getMeetings()

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Meetings</h1>
      {meetings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No meetings yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {meetings.map((m) => (
            <li key={m.id}>
              <Link
                href={`/meetings/${m.id}`}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-blue-400 hover:bg-blue-50"
              >
                <div>
                  <div className="font-semibold text-gray-900">{m.title}</div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    <MeetingTime meetingAt={m.meeting_at} meetingTz={m.meeting_tz} /> · {m.captured_count} / {m.attendee_count} captured
                  </div>
                </div>
                <span
                  className={
                    'rounded-full px-2 py-0.5 text-xs font-semibold ' +
                    (m.status === 'open'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-green-100 text-green-800')
                  }
                >
                  {m.status === 'open' ? 'Open' : 'Closed'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
