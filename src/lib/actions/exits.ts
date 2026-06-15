// src/lib/actions/exits.ts
'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/actions/auth'
import { computeExit, type ExitMathInput, type ExitMathResult } from '@/lib/exit-math'
import { actionOk, actionError, runAction, type ActionResult } from '@/lib/actions/action-result'

type Basis = ExitMathInput & { member_id: string; name: string }

/** Maps the logged-in user to their active member row (by email, like submitPayment). */
export async function getCurrentMember() {
  const user = await getCurrentUser()
  if (!user?.email) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('members')
    .select('id, name, status, email')
    .ilike('email', user.email)
    .eq('status', 'active')
    .maybeSingle()
  return data ?? null
}

/**
 * PostgREST returns PGRST205 ("Could not find the table … in the schema cache")
 * when the exit objects aren't provisioned yet — e.g. migration 048 hasn't been
 * applied to this environment. The exit feature is an optional addition to the
 * dashboard, so a missing relation should degrade gracefully (no card / no tile)
 * rather than 500 the whole page. Genuine errors still throw.
 */
function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST205' || /Could not find the table/i.test(error.message ?? '')
}

async function readBasis(memberId: string): Promise<Basis | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('member_exit_basis')
    .select('*')
    .eq('member_id', memberId)
    .maybeSingle()
  if (error) {
    if (isMissingRelation(error)) return null
    throw new Error(error.message)
  }
  if (!data) return null
  return {
    member_id: data.member_id,
    name: data.name,
    totalDonations: Number(data.total_donations),
    totalBadDebt: Number(data.total_bad_debt),
    settled: Number(data.settled_before),
    activeCount: Number(data.active_count),
    contributions: Number(data.total_contributions),
    loanBalance: Number(data.loan_balance),
  }
}

/** Read-only preview for the member-facing card. Returns null if not an active member. */
export async function getExitEstimate(
  memberId: string,
): Promise<(ExitMathResult & { basis: Basis }) | null> {
  const basis = await readBasis(memberId)
  if (!basis) return null
  return { ...computeExit(basis), basis }
}

export async function proposeExit(formData: FormData): Promise<ActionResult> {
  return runAction('proposeExit', async () => {
    const member = await getCurrentMember()
    if (!member) return actionError('No active member is linked to your account')

    const disposition = String(formData.get('disposition') ?? '')
    if (disposition !== 'refund' && disposition !== 'donate') {
      return actionError('Choose refund or donate', 'disposition')
    }

    const reasonsForLeaving = String(formData.get('reasons_for_leaving') ?? '').trim()
    const retentionSuggestions = String(formData.get('retention_suggestions') ?? '').trim()
    if (reasonsForLeaving.length === 0) {
      return actionError('Please share your reasons for leaving', 'reasons_for_leaving')
    }

    const basis = await readBasis(member.id)
    if (!basis) return actionError('Could not load your exit basis')
    const calc = computeExit(basis)
    if (!calc.eligible) {
      return actionError(
        `Repay your outstanding loan first — short by ₹${calc.shortfall}`,
        'disposition',
      )
    }

    const user = await getCurrentUser()
    const supabase = await createClient()
    const { error } = await supabase.from('member_exits').insert({
      member_id: member.id,
      disposition,
      proposed_by: user!.id,
      reasons_for_leaving: reasonsForLeaving,
      retention_suggestions: retentionSuggestions.length > 0 ? retentionSuggestions : null,
      total_donations: basis.totalDonations,
      total_bad_debt: basis.totalBadDebt,
      settled_before: basis.settled,
      active_count: basis.activeCount,
      total_contributions: basis.contributions,
      loan_balance: basis.loanBalance,
      exit_share: calc.exitShare,
      settled_amount: calc.settledAmount,
      refund_amount: calc.refund,
    })
    if (error) {
      if (error.code === '23505') return actionError('You already have a pending exit request')
      return actionError(error.message)
    }

    revalidatePath('/dashboard')
    revalidatePath('/admin/exits')
    return actionOk(undefined, 'Exit request submitted for review')
  })
}

export type ExitProposal = {
  id: string
  member_id: string
  member_name: string
  status: string
  disposition: string
  exit_share: number
  settled_amount: number
  refund_amount: number
  total_contributions: number
  loan_balance: number
  reasons_for_leaving: string | null
  retention_suggestions: string | null
  proposed_at: string
  stale: boolean
}

/** Admin: all proposals with a freshly-derived `stale` flag (locked != recomputed). */
export async function getExitProposals(): Promise<ExitProposal[]> {
  const supabase = await createClient()
  const { data: rows, error } = await supabase
    .from('member_exits')
    .select('*')
    .order('proposed_at', { ascending: false })
  if (error) {
    if (isMissingRelation(error)) return []
    throw new Error(error.message)
  }

  const proposals: ExitProposal[] = []
  for (const r of rows ?? []) {
    let stale = false
    if (r.status === 'pending') {
      const basis = await readBasis(r.member_id)
      if (!basis) {
        stale = true
      } else {
        const fresh = computeExit(basis)
        stale =
          basis.totalDonations !== Number(r.total_donations) ||
          basis.totalBadDebt !== Number(r.total_bad_debt) ||
          basis.settled !== Number(r.settled_before) ||
          basis.activeCount !== Number(r.active_count) ||
          basis.contributions !== Number(r.total_contributions) ||
          basis.loanBalance !== Number(r.loan_balance) ||
          fresh.exitShare !== Number(r.exit_share) ||
          fresh.refund !== Number(r.refund_amount)
      }
    }
    const { data: m } = await supabase.from('members').select('name').eq('id', r.member_id).maybeSingle()
    proposals.push({
      id: r.id,
      member_id: r.member_id,
      member_name: m?.name ?? '—',
      status: r.status,
      disposition: r.disposition,
      exit_share: Number(r.exit_share),
      settled_amount: Number(r.settled_amount),
      refund_amount: Number(r.refund_amount),
      total_contributions: Number(r.total_contributions),
      loan_balance: Number(r.loan_balance),
      reasons_for_leaving: r.reasons_for_leaving ?? null,
      retention_suggestions: r.retention_suggestions ?? null,
      proposed_at: r.proposed_at,
      stale,
    })
  }
  return proposals
}

export async function approveExitCohort(exitIds: string[]): Promise<ActionResult> {
  return runAction('approveExitCohort', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Not authorized')
    if (exitIds.length === 0) return actionError('Select at least one exit to approve')

    const supabase = await createClient()
    const { error } = await supabase.rpc('fn_approve_member_exits', { p_exit_ids: exitIds })
    if (error) {
      if (error.message.includes('stale')) {
        return actionError('One or more requests changed since proposal — re-lock them first')
      }
      return actionError(error.message)
    }

    revalidatePath('/admin/exits')
    revalidatePath('/admin')
    revalidatePath('/dashboard')
    updateTag('dashboard')
    return actionOk(undefined, `Approved ${exitIds.length} exit(s)`)
  })
}

export async function rejectExit(exitId: string, notes: string): Promise<ActionResult> {
  return runAction('rejectExit', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Not authorized')

    const supabase = await createClient()
    const { error } = await supabase
      .from('member_exits')
      .update({ status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString(), discussion_notes: notes })
      .eq('id', exitId)
      .eq('status', 'pending')
    if (error) return actionError(error.message)

    revalidatePath('/admin/exits')
    return actionOk(undefined, 'Exit request rejected')
  })
}

export async function relockExit(exitId: string): Promise<ActionResult> {
  return runAction('relockExit', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Not authorized')

    const supabase = await createClient()
    const { data: row, error: readErr } = await supabase
      .from('member_exits').select('member_id, status').eq('id', exitId).maybeSingle()
    if (readErr) return actionError(readErr.message)
    if (!row || row.status !== 'pending') return actionError('Only pending requests can be re-locked')

    const basis = await readBasis(row.member_id)
    if (!basis) return actionError('Member is no longer active')
    const calc = computeExit(basis)

    const { error } = await supabase.from('member_exits').update({
      total_donations: basis.totalDonations,
      total_bad_debt: basis.totalBadDebt,
      settled_before: basis.settled,
      active_count: basis.activeCount,
      total_contributions: basis.contributions,
      loan_balance: basis.loanBalance,
      exit_share: calc.exitShare,
      settled_amount: calc.settledAmount,
      refund_amount: calc.refund,
    }).eq('id', exitId)
    if (error) return actionError(error.message)

    revalidatePath('/admin/exits')
    return actionOk(undefined, 'Exit request re-locked to current figures')
  })
}

export async function getSocialContributionReserve(): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('social_contribution_reserve')
    .select('reserve_amount')
    .maybeSingle()
  if (error) {
    if (isMissingRelation(error)) return 0
    throw new Error(error.message)
  }
  return Number(data?.reserve_amount ?? 0)
}

/** Active members eligible to be picked for an admin-initiated exit:
 * status='active' and no existing pending exit. */
export async function getActiveMembersForExit(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient()
  const { data: members, error } = await supabase
    .from('members')
    .select('id, name')
    .eq('status', 'active')
    .order('name')
  if (error) {
    if (isMissingRelation(error)) return []
    throw new Error(error.message)
  }
  const { data: pendingRows, error: pErr } = await supabase
    .from('member_exits')
    .select('member_id')
    .eq('status', 'pending')
  if (pErr && !isMissingRelation(pErr)) throw new Error(pErr.message)
  const pendingIds = new Set((pendingRows ?? []).map((p) => p.member_id))
  return (members ?? []).filter((m) => !pendingIds.has(m.id))
}

/** Admin-initiated exit: create a pending exit request on a member's behalf.
 * Requires a reason. The request then flows through the normal approve. */
export async function proposeExitForMember(formData: FormData): Promise<ActionResult> {
  return runAction('proposeExitForMember', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Not authorized')

    const memberId = String(formData.get('member_id') ?? '')
    const disposition = String(formData.get('disposition') ?? '')
    const reason = String(formData.get('reason') ?? '').trim()
    if (!memberId) return actionError('Select a member', 'member_id')
    if (disposition !== 'refund' && disposition !== 'donate') {
      return actionError('Choose refund or donate', 'disposition')
    }
    if (reason.length === 0) return actionError('A reason is required', 'reason')

    const basis = await readBasis(memberId)
    if (!basis) return actionError('That member is not active', 'member_id')
    const calc = computeExit(basis)
    if (!calc.eligible) {
      return actionError(
        `Member must repay their loan first — short by ₹${calc.shortfall}`,
        'member_id',
      )
    }

    const supabase = await createClient()
    const { error } = await supabase.from('member_exits').insert({
      member_id: memberId,
      disposition,
      proposed_by: user.id,
      reasons_for_leaving: reason,
      total_donations: basis.totalDonations,
      total_bad_debt: basis.totalBadDebt,
      settled_before: basis.settled,
      active_count: basis.activeCount,
      total_contributions: basis.contributions,
      loan_balance: basis.loanBalance,
      exit_share: calc.exitShare,
      settled_amount: calc.settledAmount,
      refund_amount: calc.refund,
    })
    if (error) {
      if (error.code === '23505') return actionError('That member already has a pending exit request')
      return actionError(error.message)
    }

    revalidatePath('/admin/exits')
    revalidatePath('/dashboard')
    return actionOk(undefined, 'Exit request created for member')
  })
}
