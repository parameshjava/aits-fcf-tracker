import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPoll, getPollResults } from '@/lib/queries/polls'
import { getAdminLivePoll } from '@/lib/actions/polls'
import {
  describePollDeadline,
  formatPollDateTime,
} from '@/lib/poll-format'
import { PollResultsView } from '../../../polls/[id]/poll-results'
import { ClosePollButton } from './close-poll-button'
import { MarkdownView } from '@/components/markdown-view'
import { SharePollButton } from '@/components/share-poll-button'

export default async function AdminPollDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect(`/polls/${id}`)

  const poll = await getPoll(id)
  if (!poll) notFound()

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
          <span className="font-medium uppercase tracking-wide">
            {poll.kind === 'single' ? 'Single-select' : 'Multi-select'}
          </span>
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
        {!poll.is_closed && (
          <Link
            href={`/admin/polls/${poll.id}/edit`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Edit poll
          </Link>
        )}
        <Link
          href={`/polls/${poll.id}`}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          Go vote →
        </Link>
      </div>
    </header>
  )

  if (poll.is_closed) {
    const results = await getPollResults(id)
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {header}
        <p className="text-xs text-gray-400">
          Closed on {formatPollDateTime(poll.closed_at ?? poll.closes_at)}
        </p>
        {results ? <PollResultsView results={results} /> : <p className="text-sm text-gray-500">No results.</p>}
      </div>
    )
  }

  const live = await getAdminLivePoll(id)
  const total = live.voter_count

  // Compute leaderboard ranking. For multi-select, percentages are share of
  // voters (so they can sum to > 100%) — easier to read than share of total
  // selections, which is meaningless when voters pick a variable number.
  const ranked = [...live.option_breakdown].sort(
    (a, b) => b.vote_count - a.vote_count || a.position - b.position,
  )
  const topCount = ranked[0]?.vote_count ?? 0
  const leadingIds = new Set(
    ranked.filter((o) => o.vote_count > 0 && o.vote_count === topCount).map((o) => o.option_id),
  )
  const leadingLabel =
    topCount === 0
      ? '—'
      : leadingIds.size === 1
        ? ranked[0].option_label
        : `Tied (${leadingIds.size})`
  const leadingDetail =
    topCount === 0
      ? 'No votes yet'
      : `${topCount} ${topCount === 1 ? 'vote' : 'votes'} · ${
          total > 0 ? Math.round((topCount / total) * 100) : 0
        }%`

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {header}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Voted"
          value={`${live.voter_count} / ${live.total_members}`}
          accent="text-green-600"
        />
        <Tile
          label="Not voted"
          value={live.not_voted.length.toString()}
          accent="text-yellow-600"
        />
        <Tile
          label="Leading"
          value={leadingLabel}
          subtle={leadingDetail}
          accent="text-blue-700"
          truncate
        />
        <Tile
          label="Closes"
          value={formatPollDateTime(poll.closes_at)}
          accent="text-gray-700"
          small
        />
      </section>

      <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Live breakdown</h2>
          <ClosePollButton pollId={poll.id} />
        </div>

        <ul className="mt-4 space-y-3">
          {ranked.map((o) => {
            const pct = total > 0 ? Math.round((o.vote_count / total) * 100) : 0
            const isLeading = leadingIds.has(o.option_id)
            return (
              <li
                key={o.option_id}
                className={
                  'rounded-md border p-3 ' +
                  (isLeading
                    ? 'border-blue-200 bg-blue-50/40'
                    : 'border-gray-200 bg-white')
                }
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
                    <span>{o.option_label}</span>
                    {isLeading ? (
                      <span
                        className="inline-flex items-center rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                        title="Leading option"
                      >
                        ★ Leading
                      </span>
                    ) : null}
                  </p>
                  <p className="whitespace-nowrap text-xs text-gray-500 tabular-nums">
                    {o.vote_count} {o.vote_count === 1 ? 'vote' : 'votes'} · {pct}%
                  </p>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={'h-full ' + (isLeading ? 'bg-blue-600' : 'bg-blue-400')}
                    style={{ width: `${pct}%` }}
                    aria-hidden
                  />
                </div>
                {o.voters.length > 0 ? (
                  <ul className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {o.voters.map((v) => (
                      <li
                        key={v.member_id}
                        className="truncate rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-800"
                        title={v.member_name}
                      >
                        {v.member_name}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>

        {live.other_responses.length > 0 ? (
          <div className="mt-5">
            <p className="text-sm font-semibold text-gray-900">
              Other responses ({live.other_responses.length})
            </p>
            <ul className="mt-2 space-y-2">
              {live.other_responses.map((r, i) => (
                <li key={i} className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800">
                  <p>{r.text}</p>
                  <p className="mt-1 text-xs text-gray-500">— {r.member_name}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {live.not_voted.length > 0 ? (
        <section className="rounded-lg border bg-white p-5">
          <p className="text-sm font-semibold text-gray-900">
            Haven&apos;t voted yet ({live.not_voted.length})
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {live.not_voted.map((m) => (
              <li
                key={m.member_id}
                className="truncate rounded-md bg-yellow-50 px-2 py-1 text-xs text-yellow-800"
                title={m.member_name}
              >
                {m.member_name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function Tile({
  label,
  value,
  accent,
  subtle,
  small,
  truncate,
}: {
  label: string
  value: string
  accent: string
  subtle?: string
  small?: boolean
  truncate?: boolean
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p
        className={
          'mt-1 font-bold ' +
          accent +
          ' ' +
          (small ? 'text-sm' : 'text-xl') +
          (truncate ? ' truncate' : '')
        }
        title={truncate ? value : undefined}
      >
        {value}
      </p>
      {subtle ? (
        <p className="mt-0.5 text-xs text-gray-500 tabular-nums">{subtle}</p>
      ) : null}
    </div>
  )
}
