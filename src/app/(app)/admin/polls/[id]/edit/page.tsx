import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPoll } from '@/lib/queries/polls'
import { EditPollForm } from './edit-poll-form'

export default async function EditPollPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') redirect(`/polls/${id}`)

  const poll = await getPoll(id)
  if (!poll) notFound()
  if (poll.is_closed) redirect(`/admin/polls/${id}`)

  // Count votes to decide edit scope
  const { count } = await supabase
    .from('poll_votes')
    .select('id', { count: 'exact', head: true })
    .eq('poll_id', id)
  const hasVotes = (count ?? 0) > 0

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-2 text-xl font-semibold text-gray-900">Edit poll</h1>
      {hasVotes && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Votes have already been cast. Only the question, description, and closing time
          can be edited — options, voting mode, and visibility are locked to preserve
          vote integrity.
        </div>
      )}
      <EditPollForm poll={poll} hasVotes={hasVotes} />
    </div>
  )
}
