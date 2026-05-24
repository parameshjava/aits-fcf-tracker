'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'
import { applyBalanceDelta } from './reference'
import { defaultDirectionForContribution } from '@/lib/balance-direction'
import type { TransactionType } from '../constants'

export async function submitPayment(formData: FormData) {
  const supabase = await createClient()
  const user = await getCurrentUser()

  if (!user) {
    return { error: 'You must be logged in' }
  }

  const transactionDate = formData.get('transaction_date') as string
  const transactionId = formData.get('transaction_id') as string
  const amount = parseFloat(formData.get('amount') as string)
  const transactionType = formData.get('transaction_type') as TransactionType
  const description = formData.get('description') as string
  const loanIdRaw = (formData.get('loan_id') as string | null)?.trim() || null

  if (transactionType === 'loan_repayment' && !loanIdRaw) {
    return { error: 'Pick the loan this repayment is for' }
  }

  // Auto-attribute to the submitter's canonical member row (matched by email).
  // Without this, the approved transaction ends up with member_id = null and
  // shows as "—" in the Member column — which is what the user reported.
  // Admin can still override during approval if the email doesn't match.
  let memberId: string | null = null
  if (user.email) {
    const { data: member } = await supabase
      .from('members')
      .select('id')
      .ilike('email', user.email)
      .maybeSingle()
    memberId = member?.id ?? null
  }

  const { error } = await supabase.from('pending_payments').insert({
    transaction_date: transactionDate,
    transaction_id: transactionId,
    amount,
    transaction_type: transactionType,
    description,
    submitted_by: user.id,
    member_id: memberId,
    loan_id: loanIdRaw,
    status: 'pending',
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/dashboard')
  return { success: 'Payment submitted for review' }
}

export async function getPendingPayments() {
  const supabase = await createClient()
  const user = await getCurrentUser()

  if (!user || user.profile?.role !== 'admin') {
    throw new Error('Unauthorized')
  }

  // Disambiguate the FK: pending_payments has TWO references to profiles
  // (submitted_by and reviewed_by). The !submitted_by hint tells PostgREST
  // which one to follow. Aliased to `submitter` so the result reads cleanly.
  // Also embed the auto-matched member so the admin can see / override it.
  const { data, error } = await supabase
    .from('pending_payments')
    .select('*, submitter:profiles!submitted_by(full_name), member:member_id(id, name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data
}

export async function getUserPayments() {
  const supabase = await createClient()
  const user = await getCurrentUser()

  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('pending_payments')
    .select('*')
    .eq('submitted_by', user.id)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data
}

/**
 * Approve a pending payment, optionally with edits.
 *
 * FormData fields:
 *   - id                 (required) — pending_payments.id
 *   - transaction_id, transaction_date, amount, description (optional overrides)
 *
 * Each override replaces the corresponding field on the pending row when the
 * transaction is inserted. Missing/blank overrides fall back to the pending
 * row's stored value. The pending row itself is also patched so the admin
 * approval reflects the final values.
 */
export async function approvePayment(formData: FormData) {
  const supabase = await createClient()
  const user = await getCurrentUser()

  if (!user || user.profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }

  const paymentId = (formData.get('id') as string | null)?.trim()
  if (!paymentId) return { error: 'Missing pending payment id' }

  const { data: payment, error: fetchError } = await supabase
    .from('pending_payments')
    .select('*')
    .eq('id', paymentId)
    .single()

  if (fetchError || !payment) {
    return { error: 'Payment not found' }
  }

  // Pull edits (anything blank falls back to the pending row's value).
  const rawTxnId   = (formData.get('transaction_id')   as string | null)?.trim()
  const rawDate    = (formData.get('transaction_date') as string | null)?.trim()
  const rawAmount  = (formData.get('amount')           as string | null)?.trim()
  const rawDesc    = formData.get('description')       as string | null
  // member_id is a special case: '' means "explicit no member", and "__keep__"
  // means "use the pending row's existing member_id" (the dropdown's default).
  const rawMember  = formData.get('member_id')          as string | null

  const finalTxnId = rawTxnId || payment.transaction_id
  const finalDate  = rawDate  || payment.transaction_date
  const finalAmount = rawAmount ? parseFloat(rawAmount) : Number(payment.amount)
  const finalDesc  = rawDesc !== null ? (rawDesc.trim() || null) : payment.description
  let finalMemberId =
    rawMember === null || rawMember === '__keep__'
      ? payment.member_id
      : rawMember === ''
        ? null
        : rawMember

  // Defensive auto-link: if we still don't have a member at approval time
  // (e.g., pending row was created before the submit-side fix), try to find
  // the submitter's member by joining profiles → auth.users.email → members.
  // Looks expensive but it's two cheap lookups and only runs when needed.
  if (finalMemberId == null && payment.submitted_by) {
    const { data: { user: approver } } = await supabase.auth.getUser()
    // The current user is the admin, not the submitter — but the submitter
    // is a profile we can read. We can't query auth.users directly from a
    // cookies-based client, so we match through the email recorded on members.
    // Fallback: match members.email ilike any email field on the submitter's
    // profile. If profile carries no email column, this is a no-op.
    const { data: submitterProfile } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('id', payment.submitted_by)
      .maybeSingle()
    void approver
    if (submitterProfile) {
      // Last-resort: match member.name to profile.full_name (handles cases
      // where members.email isn't seeded but profile.full_name and
      // members.name align).
      const { data: matchByName } = await supabase
        .from('members')
        .select('id')
        .ilike('name', submitterProfile.full_name ?? '')
        .maybeSingle()
      if (matchByName) finalMemberId = matchByName.id
    }
  }

  if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
    return { error: 'Amount must be a positive number' }
  }

  const { error: insertError } = await supabase.from('transactions').insert({
    transaction_date: finalDate,
    transaction_id: finalTxnId,
    amount: finalAmount,
    transaction_type: payment.transaction_type,
    interest_source: payment.interest_source,
    member_id: finalMemberId,
    loan_id: payment.loan_id,
    description: finalDesc,
    created_by: payment.submitted_by,
    verified_by: user.id,
  })

  if (insertError) {
    return { error: insertError.message }
  }

  // Mirror the final values onto the pending row so the audit trail shows
  // what was actually approved.
  const { error: updateError } = await supabase
    .from('pending_payments')
    .update({
      transaction_id: finalTxnId,
      transaction_date: finalDate,
      amount: finalAmount,
      description: finalDesc,
      member_id: finalMemberId,
      status: 'approved',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', paymentId)

  if (updateError) {
    return { error: updateError.message }
  }

  const applyToBankBalance = formData.get('applyToBankBalance') === '1'
  const balanceDirectionRaw = formData.get('balanceDirection') as 'add' | 'subtract' | null
  let balanceUpdateFailed = false
  if (applyToBankBalance) {
    const direction =
      balanceDirectionRaw === 'add' || balanceDirectionRaw === 'subtract'
        ? balanceDirectionRaw
        : defaultDirectionForContribution(payment.transaction_type as import('@/lib/constants').TransactionType)
    const delta = direction === 'add' ? finalAmount : -finalAmount
    const result = await applyBalanceDelta(delta)
    if (result.error) {
      console.error('applyBalanceDelta failed for approvePayment:', result.error)
      balanceUpdateFailed = true
    }
  }

  revalidatePath('/admin/pending')
  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/admin/reference')
  return { success: 'Payment approved and recorded', balanceUpdateFailed }
}

export async function rejectPayment(paymentId: string, notes: string) {
  const supabase = await createClient()
  const user = await getCurrentUser()

  if (!user || user.profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }

  const { error } = await supabase
    .from('pending_payments')
    .update({
      status: 'rejected',
      admin_notes: notes,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', paymentId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/admin/pending')
  return { success: 'Payment rejected' }
}
