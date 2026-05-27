import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'
import { getOpenAndRecentPolls } from '@/lib/actions/meetings-reads'
import { getMembersForBankAccountForm } from '@/lib/actions/bank-accounts'
import { NewMeetingForm } from './new-meeting-form'

export default async function NewMeetingPage() {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') redirect('/')

  const rawMembers = await getMembersForBankAccountForm()
  const members = rawMembers.map((m) => ({ id: m.id, name: m.name }))

  const polls = await getOpenAndRecentPolls()
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">New meeting</h1>
      <NewMeetingForm members={members} polls={polls} defaultDate={today} />
    </div>
  )
}
