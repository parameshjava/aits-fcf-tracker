import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getExitProposals, getActiveMembersForExit } from '@/lib/actions/exits'
import { ExitApprovalPanel } from './exit-approval-panel'
import { AdminExitMemberForm } from './admin-exit-member-form'

export default async function AdminExitsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const [proposals, activeMembers] = await Promise.all([
    getExitProposals(),
    getActiveMembersForExit(),
  ])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Member Exits</h1>
        <p className="text-sm text-gray-500">
          Review exit requests, discuss, then approve as a cohort or reject. Stale requests must be re-locked first.
        </p>
      </header>
      <AdminExitMemberForm members={activeMembers} />
      <ExitApprovalPanel proposals={proposals} />
    </div>
  )
}
