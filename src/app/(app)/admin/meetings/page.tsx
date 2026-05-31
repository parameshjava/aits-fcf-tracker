import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'
import { getMeetings } from '@/lib/actions/meetings-reads'
import { MeetingTime } from '@/components/meeting-time'

export default async function AdminMeetingsListPage() {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') redirect('/')

  const meetings = await getMeetings()

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Manage meetings</h1>
        <Link href="/admin/meetings/new" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">
          New meeting
        </Link>
      </div>

      {meetings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No meetings yet. <Link href="/admin/meetings/new" className="text-blue-600 underline">Create one</Link>.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Progress</th>
                <th className="px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {meetings.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2 whitespace-nowrap"><MeetingTime meetingAt={m.meeting_at} meetingEndsAt={m.meeting_ends_at} meetingTz={m.meeting_tz} /></td>
                  <td className="px-4 py-2 font-medium text-gray-900">{m.title}</td>
                  <td className="px-4 py-2">
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
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {m.captured_count} / {m.attendee_count}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/meetings/${m.id}`} className="text-blue-600 hover:underline">
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
