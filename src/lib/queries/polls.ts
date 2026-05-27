import { cacheLife, cacheTag } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { shapePollResults, type RawOptionVoter, type RawOtherResponse } from '@/lib/poll-results'
import type {
  PollDetail,
  PollKind,
  PollListRow,
  PollOption,
  PollResults,
  PollStatus,
  PollVisibility,
} from '@/lib/polls-types'

/**
 * Fund-wide polls reads. These bypass per-user RLS via the admin client
 * (the same pattern as `lib/actions/dashboard.ts`). User-specific reads
 * — "has the current user voted?" and the like — live in
 * `lib/actions/polls.ts` instead, because Cache Components forbids
 * reading cookies/headers inside a `'use cache'` scope.
 *
 * Caching: every cached read tags itself with `'polls'` (catch-all) and
 * `'poll:<id>'` (per-poll). Mutations in `lib/actions/polls.ts` call
 * `updateTag(...)` on those tags after every write.
 */

type RawPollRow = {
  id: string
  question: string
  description: string | null
  kind: PollKind
  max_selections: number | null
  allow_other: boolean
  visibility: PollVisibility
  status: PollStatus
  closes_at: string
  closed_at: string | null
  created_at: string
}

function isClosed(row: { status: PollStatus; closes_at: string }, now: number): boolean {
  return row.status === 'closed' || new Date(row.closes_at).getTime() < now
}

/** All polls, with per-poll voter counts. Includes the `has_voted` flag
 *  defaulted to false — callers (server components) overlay it from
 *  `getMyVotedPollIds()` because that one is user-scoped and uncached. */
export async function getPolls(): Promise<PollListRow[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('polls')

  const supabase = createAdminClient()
  const [pollsRes, countsRes] = await Promise.all([
    supabase
      .from('polls')
      .select(
        'id, question, description, kind, max_selections, allow_other, visibility, status, closes_at, closed_at, created_at',
      )
      .order('created_at', { ascending: false }),
    supabase.from('poll_voter_counts').select('poll_id, voter_count'),
  ])
  if (pollsRes.error) throw new Error(pollsRes.error.message)
  if (countsRes.error) throw new Error(countsRes.error.message)

  const counts = new Map<string, number>(
    ((countsRes.data ?? []) as { poll_id: string; voter_count: number | string }[]).map((r) => [
      String(r.poll_id),
      Number(r.voter_count) || 0,
    ]),
  )

  const now = Date.now()
  return ((pollsRes.data ?? []) as RawPollRow[]).map((p) => ({
    id: p.id,
    question: p.question,
    description: p.description,
    kind: p.kind,
    max_selections: p.max_selections,
    allow_other: p.allow_other,
    visibility: p.visibility,
    status: p.status,
    closes_at: p.closes_at,
    closed_at: p.closed_at,
    created_at: p.created_at,
    is_closed: isClosed(p, now),
    voter_count: counts.get(p.id) ?? 0,
    has_voted: false,
  }))
}

/** Single poll + ordered options. */
export async function getPoll(pollId: string): Promise<PollDetail | null> {
  'use cache'
  cacheLife('hours')
  cacheTag(`poll:${pollId}`)

  const supabase = createAdminClient()
  const [pollRes, optsRes] = await Promise.all([
    supabase
      .from('polls')
      .select(
        'id, question, description, kind, max_selections, allow_other, visibility, status, closes_at, closed_at, created_at',
      )
      .eq('id', pollId)
      .maybeSingle(),
    supabase
      .from('poll_options')
      .select('id, label, position')
      .eq('poll_id', pollId)
      .order('position', { ascending: true }),
  ])
  if (pollRes.error) throw new Error(pollRes.error.message)
  if (!pollRes.data) return null
  if (optsRes.error) throw new Error(optsRes.error.message)

  const p = pollRes.data as RawPollRow
  const options = (optsRes.data ?? []) as PollOption[]
  return {
    id: p.id,
    question: p.question,
    description: p.description,
    kind: p.kind,
    max_selections: p.max_selections,
    allow_other: p.allow_other,
    visibility: p.visibility,
    status: p.status,
    closes_at: p.closes_at,
    closed_at: p.closed_at,
    created_at: p.created_at,
    is_closed: isClosed(p, Date.now()),
    options,
  }
}

/** Aggregate results for the poll: per-option counts, total voters, Other
 *  responses. Voter names + Other authors are included only when the poll
 *  is effectively closed AND visibility = 'public'. */
export async function getPollResults(pollId: string): Promise<PollResults | null> {
  'use cache'
  cacheLife('hours')
  cacheTag(`poll:${pollId}`)

  const supabase = createAdminClient()
  const [pollRes, optsRes, countsRes, votersRes, votesRes, voterCountRes] =
    await Promise.all([
      supabase
        .from('polls')
        .select('id, visibility, status, closes_at')
        .eq('id', pollId)
        .maybeSingle(),
      supabase
        .from('poll_options')
        .select('id, label, position')
        .eq('poll_id', pollId)
        .order('position', { ascending: true }),
      supabase
        .from('poll_option_counts')
        .select('option_id, vote_count')
        .eq('poll_id', pollId),
      supabase
        .from('poll_vote_options')
        .select('option_id, poll_votes!inner(poll_id, voter_id, other_text, member:voter_id(name))')
        .eq('poll_votes.poll_id', pollId),
      supabase
        .from('poll_votes')
        .select('voter_id, other_text, member:voter_id(name)')
        .eq('poll_id', pollId)
        .not('other_text', 'is', null),
      supabase
        .from('poll_voter_counts')
        .select('voter_count')
        .eq('poll_id', pollId)
        .maybeSingle(),
    ])
  if (pollRes.error) throw new Error(pollRes.error.message)
  if (!pollRes.data) return null
  if (optsRes.error) throw new Error(optsRes.error.message)
  if (countsRes.error) throw new Error(countsRes.error.message)
  if (votersRes.error) throw new Error(votersRes.error.message)
  if (votesRes.error) throw new Error(votesRes.error.message)
  if (voterCountRes.error) throw new Error(voterCountRes.error.message)

  const poll = pollRes.data as { id: string; visibility: PollVisibility; status: PollStatus; closes_at: string }
  const options = (optsRes.data ?? []) as { id: string; label: string; position: number }[]
  const counts = (countsRes.data ?? []) as { option_id: string; vote_count: number | string }[]
  const countByOption = new Map(counts.map((c) => [String(c.option_id), Number(c.vote_count) || 0]))

  type VoteJoin = {
    option_id: string
    poll_votes: { voter_id: string; member: { name: string } | null } | null
  }
  const voterRows = (votersRes.data ?? []) as unknown as VoteJoin[]
  const optionVoters: RawOptionVoter[] = voterRows.map((r) => ({
    option_id: String(r.option_id),
    member_id: r.poll_votes?.voter_id ?? '',
    member_name: r.poll_votes?.member?.name ?? '—',
  }))

  type OtherJoin = { voter_id: string; other_text: string | null; member: { name: string } | null }
  const otherRows = (votesRes.data ?? []) as unknown as OtherJoin[]
  const otherResponses: RawOtherResponse[] = otherRows
    .filter((r) => r.other_text && r.other_text.trim() !== '')
    .map((r) => ({
      member_id: r.voter_id,
      member_name: r.member?.name ?? '—',
      text: String(r.other_text),
    }))

  const totalVoters = Number(
    (voterCountRes.data as { voter_count: number | string } | null)?.voter_count ?? 0,
  ) || 0

  return shapePollResults({
    poll_id: poll.id,
    visibility: poll.visibility,
    is_closed: isClosed(poll, Date.now()),
    total_voters: totalVoters,
    options: options.map((o) => ({
      option_id: o.id,
      option_label: o.label,
      position: o.position,
      vote_count: countByOption.get(o.id) ?? 0,
    })),
    option_voters: optionVoters,
    other_responses: otherResponses,
  })
}

/** Live participation count for a single open poll. NOT cached — voters
 *  expect this to tick up immediately. */
export async function getPollParticipation(pollId: string): Promise<number> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('poll_voter_counts')
    .select('voter_count')
    .eq('poll_id', pollId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return Number((data as { voter_count: number | string } | null)?.voter_count ?? 0) || 0
}
