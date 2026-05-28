'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'
import {
  actionError,
  actionOk,
  runAction,
  type ActionResult,
} from './action-result'
import { validatePollCreate, validatePollUpdateLight, validateVote } from '@/lib/polls-validation'
import type {
  AdminLivePoll,
  MyVote,
  PollKind,
  PollStatus,
} from '@/lib/polls-types'

function invalidatePolls(pollId?: string) {
  updateTag('polls')
  if (pollId) updateTag(`poll:${pollId}`)
  revalidatePath('/polls')
  if (pollId) revalidatePath(`/polls/${pollId}`)
  revalidatePath('/admin/polls')
  if (pollId) revalidatePath(`/admin/polls/${pollId}`)
}

// ----------------------------------------------------------------------------
// Writes
// ----------------------------------------------------------------------------

export async function createPoll(
  formData: FormData,
): Promise<ActionResult<{ pollId: string }>> {
  return runAction('createPoll', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') {
      return actionError('Unauthorized')
    }

    const v = validatePollCreate({
      question: formData.get('question'),
      description: formData.get('description'),
      kind: formData.get('kind'),
      max_selections: formData.get('max_selections'),
      allow_other: formData.get('allow_other'),
      visibility: formData.get('visibility'),
      closes_at: formData.get('closes_at'),
      options: formData.getAll('option'),
    })
    if (!v.ok) return actionError(v.error, v.field)

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('create_poll', {
      p_question: v.value.question,
      p_description: v.value.description,
      p_kind: v.value.kind,
      p_max_selections: v.value.max_selections,
      p_allow_other: v.value.allow_other,
      p_visibility: v.value.visibility,
      p_closes_at: v.value.closes_at,
      p_option_labels: v.value.options,
    })
    if (error) return actionError(error.message)

    const pollId = String(data ?? '')
    invalidatePolls(pollId)
    return actionOk({ pollId }, 'Poll created')
  })
}

export async function castVote(
  formData: FormData,
): Promise<ActionResult<{ pollId: string }>> {
  return runAction('castVote', async () => {
    const user = await getCurrentUser()
    if (!user) return actionError('Unauthorized')

    const pollId = (formData.get('poll_id') as string | null)?.trim() ?? ''
    if (!pollId) return actionError('Poll id required')

    const supabase = await createClient()

    // Look up the poll context so we can field-tag validation errors before
    // hitting the RPC. The RPC repeats every check authoritatively.
    const { data: pollRow, error: pollErr } = await supabase
      .from('polls')
      .select('id, kind, max_selections, allow_other, status, closes_at')
      .eq('id', pollId)
      .maybeSingle()
    if (pollErr) return actionError(pollErr.message)
    if (!pollRow) return actionError('Poll not found')

    const status = pollRow.status as PollStatus
    const closesAt = new Date(pollRow.closes_at as string)
    if (status === 'closed' || closesAt.getTime() < Date.now()) {
      return actionError('This poll has closed')
    }

    const { data: optionRows, error: optErr } = await supabase
      .from('poll_options')
      .select('id')
      .eq('poll_id', pollId)
    if (optErr) return actionError(optErr.message)
    const validIds = new Set((optionRows ?? []).map((r) => String(r.id)))

    const v = validateVote(
      {
        poll_id: pollId,
        option_ids: formData.getAll('option_id'),
        other_text: formData.get('other_text'),
      },
      {
        kind: pollRow.kind as PollKind,
        max_selections: (pollRow.max_selections as number | null) ?? null,
        allow_other: Boolean(pollRow.allow_other),
        valid_option_ids: validIds,
      },
    )
    if (!v.ok) return actionError(v.error, v.field)

    const { error } = await supabase.rpc('cast_vote', {
      p_poll_id: v.value.poll_id,
      p_option_ids: v.value.option_ids,
      p_other_text: v.value.other_text,
    })
    if (error) return actionError(error.message)

    invalidatePolls(pollId)
    return actionOk({ pollId }, 'Vote recorded')
  })
}

export async function closePoll(
  formData: FormData,
): Promise<ActionResult<{ pollId: string }>> {
  return runAction('closePoll', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') {
      return actionError('Unauthorized')
    }
    const pollId = (formData.get('poll_id') as string | null)?.trim() ?? ''
    if (!pollId) return actionError('Poll id required')

    const supabase = await createClient()
    const { error } = await supabase.rpc('close_poll', { p_poll_id: pollId })
    if (error) return actionError(error.message)

    invalidatePolls(pollId)
    return actionOk({ pollId }, 'Poll closed')
  })
}

export async function updatePoll(
  formData: FormData,
): Promise<ActionResult<{ pollId: string }>> {
  return runAction('updatePoll', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') {
      return actionError('Unauthorized')
    }

    const pollId = (formData.get('poll_id') as string | null)?.trim() ?? ''
    if (!pollId) return actionError('Poll id required')

    const supabase = await createClient()

    // Fetch the poll to check status
    const { data: pollRow, error: pollErr } = await supabase
      .from('polls')
      .select('id, status, kind, max_selections, allow_other, visibility')
      .eq('id', pollId)
      .maybeSingle()
    if (pollErr) return actionError(pollErr.message)
    if (!pollRow) return actionError('Poll not found')

    const status = pollRow.status as PollStatus
    if (status === 'closed') return actionError('Closed polls cannot be edited')

    // Count votes to determine edit scope
    const { count } = await supabase
      .from('poll_votes')
      .select('id', { count: 'exact', head: true })
      .eq('poll_id', pollId)
    const hasVotes = (count ?? 0) > 0

    if (hasVotes) {
      // Light path: only question, description, closes_at are editable
      const v = validatePollUpdateLight({
        question: formData.get('question'),
        description: formData.get('description'),
        closes_at: formData.get('closes_at'),
      })
      if (!v.ok) return actionError(v.error, v.field)

      const { error } = await supabase
        .from('polls')
        .update({
          question: v.value.question,
          description: v.value.description,
          closes_at: v.value.closes_at,
        })
        .eq('id', pollId)
      if (error) return actionError(error.message)
    } else {
      // Full path: all scalar fields + options are editable.
      // Note: delete-then-insert of poll_options is not transactional from the
      // action layer. This is accepted risk — it's admin-only on an unvoted poll.
      const v = validatePollCreate({
        question: formData.get('question'),
        description: formData.get('description'),
        kind: formData.get('kind'),
        max_selections: formData.get('max_selections'),
        allow_other: formData.get('allow_other'),
        visibility: formData.get('visibility'),
        closes_at: formData.get('closes_at'),
        options: formData.getAll('option'),
      })
      if (!v.ok) return actionError(v.error, v.field)

      // Update the polls row
      const { error: updateErr } = await supabase
        .from('polls')
        .update({
          question: v.value.question,
          description: v.value.description,
          kind: v.value.kind,
          max_selections: v.value.max_selections,
          allow_other: v.value.allow_other,
          visibility: v.value.visibility,
          closes_at: v.value.closes_at,
        })
        .eq('id', pollId)
      if (updateErr) return actionError(updateErr.message)

      // Delete existing options then re-insert
      const { error: deleteErr } = await supabase
        .from('poll_options')
        .delete()
        .eq('poll_id', pollId)
      if (deleteErr) return actionError(deleteErr.message)

      const { error: insertErr } = await supabase.from('poll_options').insert(
        v.value.options.map((label, i) => ({
          poll_id: pollId,
          label,
          position: i + 1,
        })),
      )
      if (insertErr) return actionError(insertErr.message)
    }

    invalidatePolls(pollId)
    return actionOk({ pollId }, 'Poll updated')
  })
}

// ----------------------------------------------------------------------------
// User-specific reads (NOT cached; depend on the current session)
// ----------------------------------------------------------------------------

/** Set of poll IDs the current user has voted in. */
export async function getMyVotedPollIds(): Promise<Set<string>> {
  const user = await getCurrentUser()
  if (!user?.email) return new Set()
  const supabase = await createClient()
  const { data: member } = await supabase
    .from('members')
    .select('id')
    .ilike('email', user.email)
    .maybeSingle()
  if (!member?.id) return new Set()
  const { data, error } = await supabase
    .from('poll_votes')
    .select('poll_id')
    .eq('voter_id', member.id)
  if (error) throw new Error(error.message)
  return new Set((data ?? []).map((r) => String(r.poll_id)))
}

/** The current user's vote on a single poll (null if none). */
export async function getMyVoteForPoll(pollId: string): Promise<MyVote | null> {
  const user = await getCurrentUser()
  if (!user?.email) return null
  const supabase = await createClient()
  const { data: member } = await supabase
    .from('members')
    .select('id')
    .ilike('email', user.email)
    .maybeSingle()
  if (!member?.id) return null
  const { data: vote, error } = await supabase
    .from('poll_votes')
    .select('id, other_text, poll_vote_options(option_id)')
    .eq('poll_id', pollId)
    .eq('voter_id', member.id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!vote) return null
  const links = (vote.poll_vote_options ?? []) as { option_id: string }[]
  return {
    selected_option_ids: links.map((l) => String(l.option_id)),
    other_text: (vote.other_text as string | null) ?? null,
  }
}

/** Count of open polls the current user hasn't voted in (for the sidebar badge). */
export async function getOpenPollsBadgeCount(): Promise<number> {
  const supabase = await createClient()
  const nowIso = new Date().toISOString()
  const { data: openPolls } = await supabase
    .from('polls')
    .select('id')
    .eq('status', 'open')
    .gt('closes_at', nowIso)
  if (!openPolls || openPolls.length === 0) return 0
  const voted = await getMyVotedPollIds()
  let count = 0
  for (const p of openPolls) if (!voted.has(String(p.id))) count++
  return count
}

// ----------------------------------------------------------------------------
// Admin live view (uncached, gated by admin role)
// ----------------------------------------------------------------------------

export async function getAdminLivePoll(pollId: string): Promise<AdminLivePoll> {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    throw new Error('Unauthorized')
  }
  const supabase = await createClient()

  const [pollRes, optionsRes, votesRes, voteOptsRes, membersRes] = await Promise.all([
    supabase
      .from('polls')
      .select('id, visibility')
      .eq('id', pollId)
      .maybeSingle(),
    supabase
      .from('poll_options')
      .select('id, label, position')
      .eq('poll_id', pollId)
      .order('position', { ascending: true }),
    supabase
      .from('poll_votes')
      .select('id, voter_id, other_text, updated_at, member:voter_id(name)')
      .eq('poll_id', pollId),
    supabase
      .from('poll_vote_options')
      .select('vote_id, option_id, poll_votes!inner(poll_id, voter_id, member:voter_id(name))')
      .eq('poll_votes.poll_id', pollId),
    supabase
      .from('members')
      .select('id, name')
      .eq('status', 'active')
      .order('name', { ascending: true }),
  ])
  if (pollRes.error || !pollRes.data) throw new Error(pollRes.error?.message ?? 'Poll not found')
  if (optionsRes.error) throw new Error(optionsRes.error.message)
  if (votesRes.error) throw new Error(votesRes.error.message)
  if (voteOptsRes.error) throw new Error(voteOptsRes.error.message)
  if (membersRes.error) throw new Error(membersRes.error.message)

  type VoteRow = {
    id: string
    voter_id: string
    other_text: string | null
    updated_at: string
    member: { name: string } | null
  }
  type VoteOptRow = {
    vote_id: string
    option_id: string
    poll_votes: { voter_id: string; member: { name: string } | null } | null
  }

  const votes = (votesRes.data ?? []) as unknown as VoteRow[]
  const voteOpts = (voteOptsRes.data ?? []) as unknown as VoteOptRow[]
  const options = (optionsRes.data ?? []) as { id: string; label: string; position: number }[]
  const members = (membersRes.data ?? []) as { id: string; name: string }[]

  const voterIds = new Set(votes.map((v) => v.voter_id))
  const voterById = new Map(votes.map((v) => [v.voter_id, v]))

  const voted = members
    .filter((m) => voterIds.has(m.id))
    .map((m) => ({
      member_id: m.id,
      member_name: m.name,
      voted_at: voterById.get(m.id)?.updated_at ?? '',
    }))
  const notVoted = members
    .filter((m) => !voterIds.has(m.id))
    .map((m) => ({ member_id: m.id, member_name: m.name }))

  const breakdown = options.map((o) => {
    const links = voteOpts.filter((vo) => vo.option_id === o.id)
    const voters = links.map((vo) => {
      const voterId = vo.poll_votes?.voter_id ?? ''
      const name = vo.poll_votes?.member?.name ?? '—'
      return { member_id: voterId, member_name: name }
    })
    voters.sort((a, b) => a.member_name.localeCompare(b.member_name))
    return {
      option_id: o.id,
      option_label: o.label,
      position: o.position,
      vote_count: voters.length,
      voters,
    }
  })

  const otherResponses = votes
    .filter((v) => v.other_text && v.other_text.trim() !== '')
    .map((v) => ({
      member_id: v.voter_id,
      member_name: v.member?.name ?? '—',
      text: String(v.other_text),
    }))
    .sort((a, b) => a.member_name.localeCompare(b.member_name))

  return {
    voter_count: voterIds.size,
    total_members: members.length,
    voted: voted.sort((a, b) => a.member_name.localeCompare(b.member_name)),
    not_voted: notVoted,
    option_breakdown: breakdown,
    other_responses: otherResponses,
  }
}

