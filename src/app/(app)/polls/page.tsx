import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getPolls } from '@/lib/queries/polls'
import { getMyVotedPollIds } from '@/lib/actions/polls'
import { describePollDeadline } from '@/lib/poll-format'
import type { PollListRow } from '@/lib/polls-types'
import { PollsTabs, type SerializedRow } from './polls-tabs'

export default async function PollsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user?.id ?? '')
    .maybeSingle()
  const isAdmin = profile?.role === 'admin'

  const [polls, votedSet] = await Promise.all([getPolls(), getMyVotedPollIds()])

  const enriched: PollListRow[] = polls.map((p) => ({
    ...p,
    has_voted: votedSet.has(p.id),
  }))

  const open = enriched.filter((p) => !p.is_closed).map(serialize)
  const closed = enriched.filter((p) => p.is_closed).map(serialize)
  const mine = enriched.filter((p) => p.has_voted).map(serialize)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Polls</h1>
          <p className="text-sm text-gray-500">
            Vote on open polls and see results once they close.
          </p>
        </div>
        {isAdmin ? (
          <Link
            href="/admin/polls/new"
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Create poll
          </Link>
        ) : null}
      </div>

      <PollsTabs open={open} closed={closed} mine={mine} isAdmin={isAdmin} />
    </div>
  )
}

function serialize(p: PollListRow): SerializedRow {
  return {
    id: p.id,
    question: p.question,
    kind: p.kind,
    visibility: p.visibility,
    is_closed: p.is_closed,
    has_voted: p.has_voted,
    voter_count: p.voter_count,
    deadline: describePollDeadline({
      isClosed: p.is_closed,
      closesAt: p.closes_at,
      closedAt: p.closed_at,
    }),
  }
}
