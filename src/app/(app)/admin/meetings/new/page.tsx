import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'
import { getOpenAndRecentPolls } from '@/lib/actions/meetings-reads'
import { todayISO } from '@/lib/format'
import { DEFAULT_MEETING_TZ } from '@/lib/timezones'
import { NewMeetingForm } from './new-meeting-form'

export default async function NewMeetingPage() {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') redirect('/')

  const polls = await getOpenAndRecentPolls()
  const today = todayISO()

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">New meeting</h1>
      <NewMeetingForm polls={polls} defaultDate={today} defaultTime="19:00" defaultEndTime="20:00" defaultTz={DEFAULT_MEETING_TZ} />
    </div>
  )
}
