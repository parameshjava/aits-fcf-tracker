import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPoll, getPollResults, getPollParticipation } from '@/lib/queries/polls'
import { getMyVoteForPoll } from '@/lib/actions/polls'
import { formatPollDateTime, describePollDeadline } from '@/lib/poll-format'
import { VoteForm } from './vote-form'
import { PollResultsView } from './poll-results'
import { MarkdownView } from '@/components/markdown-view'
import { SharePollButton } from '@/components/share-poll-button'

export default async function PollDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const poll = await getPoll(id)
  if (!poll) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user?.id ?? '')
    .maybeSingle()
  const isAdmin = profile?.role === 'admin'

  const header = (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Link href="/polls" className="text-xs text-blue-600 hover:underline">
          ← All polls
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-gray-900">{poll.question}</h1>
        {poll.description ? (
          <div className="mt-2">
            <MarkdownView source={poll.description} />
          </div>
        ) : null}
        <p className="mt-2 text-xs text-gray-500">
          <span className="font-medium uppercase tracking-wide">{poll.kind === 'single' ? 'Single-select' : 'Multi-select'}</span>
          <span className="mx-2">·</span>
          {poll.visibility === 'public' ? 'Public results' : 'Anonymous results'}
          <span className="mx-2">·</span>
          {describePollDeadline({
            isClosed: poll.is_closed,
            closesAt: poll.closes_at,
            closedAt: poll.closed_at,
          })}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <SharePollButton pollId={poll.id} />
        {isAdmin ? (
          <Link
            href={`/admin/polls/${poll.id}`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Manage poll
          </Link>
        ) : null}
      </div>
    </header>
  )

  if (poll.is_closed) {
    const results = await getPollResults(id)
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        {header}
        <p className="text-xs text-gray-400">
          Closed on {formatPollDateTime(poll.closed_at ?? poll.closes_at)}
        </p>
        {results ? <PollResultsView results={results} /> : (
          <p className="text-sm text-gray-500">No results.</p>
        )}
      </div>
    )
  }

  const [myVote, participation] = await Promise.all([
    getMyVoteForPoll(id),
    getPollParticipation(id),
  ])

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {header}
      <VoteForm
        pollId={poll.id}
        kind={poll.kind}
        maxSelections={poll.max_selections}
        allowOther={poll.allow_other}
        options={poll.options.map((o) => ({ id: o.id, label: o.label }))}
        existingSelection={myVote?.selected_option_ids ?? []}
        existingOtherText={myVote?.other_text ?? ''}
      />
      <p className="text-center text-xs text-gray-500">
        <span className="font-medium text-gray-700">{participation}</span>{' '}
        {participation === 1 ? 'member has' : 'members have'} voted so far.
      </p>
    </div>
  )
}
