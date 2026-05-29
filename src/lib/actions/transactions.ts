'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'
import type { TransactionType } from '../constants'
import { applyBalanceDelta } from './reference'
import {
  actionError,
  actionOk,
  runAction,
  type ActionResult,
} from './action-result'

export async function createTransaction(
  formData: FormData,
): Promise<ActionResult<{ balanceUpdateFailed: boolean }>> {
  return runAction('createTransaction', async () => {
    const supabase = await createClient()
    const user = await getCurrentUser()

    if (!user || user.profile?.role !== 'admin') {
      return actionError('Unauthorized')
    }

    const transactionDate = formData.get('transaction_date') as string
    const amount = parseFloat(formData.get('amount') as string)
    const transactionType = formData.get('transaction_type') as TransactionType
    const description = formData.get('description') as string
    const bankTransactionId =
      (formData.get('bank_transaction_id') as string | null)?.trim() || null
    const interestSourceRaw = formData.get('interest_source')
    const interestSource =
      transactionType === 'interest' && (interestSourceRaw === 'loans' || interestSourceRaw === 'bank')
        ? interestSourceRaw
        : null
    const memberIdRaw = formData.get('member_id') as string | null
    const memberId = memberIdRaw && memberIdRaw.length > 0 ? memberIdRaw : null
    const loanIdRaw = formData.get('loan_id') as string | null
    // Loan is only meaningful for loan-side transactions; ignore otherwise.
    const needsLoan =
      transactionType === 'loan_repayment' ||
      transactionType === 'penalty' ||
      (transactionType === 'interest' && interestSource === 'loans')
    const loanId = needsLoan && loanIdRaw && loanIdRaw.length > 0 ? loanIdRaw : null

    // Donation-only fields: beneficiary_name (text) + poll_id (FK).
    // Persisted ONLY when type=donation; null on every other type so
    // changing a row's type clears them.
    const isDonation = transactionType === 'donation'
    const beneficiaryRaw = (formData.get('beneficiary_name') as string | null)?.trim()
    const beneficiaryName = isDonation && beneficiaryRaw ? beneficiaryRaw : null
    const pollIdRaw = (formData.get('poll_id') as string | null)?.trim()
    const pollId = isDonation && pollIdRaw && pollIdRaw.length > 0 ? pollIdRaw : null

    if (
      transactionType === 'interest' &&
      interestSource === 'loans' &&
      loanId !== null &&
      loanId !== ''
    ) {
      return actionError(
        'Loan interest payments must be recorded via the loan detail page → Pending interest panel.',
        'transaction_type',
      )
    }

    // transaction_id is auto-filled by a Postgres BEFORE INSERT trigger
    // (YYYYMMDD-NNN) — we never send one from the app.
    const { error } = await supabase.from('transactions').insert({
      transaction_date: transactionDate,
      amount,
      transaction_type: transactionType,
      interest_source: interestSource,
      member_id: memberId,
      loan_id: loanId,
      beneficiary_name: beneficiaryName,
      poll_id: pollId,
      description,
      bank_transaction_id: bankTransactionId,
      created_by: user.id,
      verified_by: user.id,
    })

    if (error) {
      if (isPollAlreadyLinkedError(error)) {
        return actionError(
          'That poll is already linked to another donation.',
          'poll_id',
        )
      }
      return actionError(error.message)
    }

    const applyToBankBalance = formData.get('applyToBankBalance') === '1'
    const balanceDirection = formData.get('balanceDirection') as 'add' | 'subtract' | null
    let balanceUpdateFailed = false
    if (applyToBankBalance && (balanceDirection === 'add' || balanceDirection === 'subtract')) {
      const delta = balanceDirection === 'add' ? amount : -amount
      const result = await applyBalanceDelta(delta)
      if (!result.ok) {
        console.error('applyBalanceDelta failed for createTransaction:', result.error)
        balanceUpdateFailed = true
      }
    }

    revalidatePath('/admin')
    revalidatePath('/dashboard')
    revalidatePath('/admin/reference')
    updateTag('dashboard')
    return actionOk({ balanceUpdateFailed }, 'Transaction saved')
  })
}

export async function getTransactions() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('transactions')
    .select(
      '*, beneficiary_name, poll_id, member:member_id (name, slug), poll:poll_id (id, question)',
    )
    .order('transaction_date', { ascending: false })

  if (error) throw new Error(error.message)

  type MemberRef = { name: string; slug: string } | null
  type PollRef = { id: string; question: string } | null
  type DBRow = Record<string, unknown> & {
    id: string
    transaction_id: string
    transaction_date: string
    amount: number | string
    transaction_type: string
    interest_source?: 'loans' | 'bank' | null
    description?: string | null
    beneficiary_name?: string | null
    poll_id?: string | null
    member_id?: string | null
    member?: MemberRef
    poll?: PollRef
    member_name?: string | null
  }
  // member_name reflects the JOINED member only — no more coalesce to
  // beneficiary_name. On donation rows member_id means "referrer", so a
  // donation with no referrer correctly surfaces null for member_name.
  // Consumers that need to show a beneficiary read beneficiary_name
  // explicitly.
  return ((data ?? []) as DBRow[]).map((r) => ({
    ...r,
    member_name: r.member?.name ?? null,
    poll: r.poll ?? null,
  }))
}

export async function getTransactionStats() {
  const rows = await getTransactions()

  const totalAmount = rows.reduce((sum, t) => sum + Number(t.amount), 0)

  const typeBreakdown = rows.reduce<Record<string, number>>((acc, t) => {
    acc[t.transaction_type] = (acc[t.transaction_type] || 0) + Number(t.amount)
    return acc
  }, {})

  return {
    total: rows.length,
    totalAmount,
    typeBreakdown,
  }
}

// DB-only list for the admin manage screen. Excludes seed rows (those are
// synthesized in-memory from the Excel and aren't editable).
export async function getDbTransactions() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('transactions')
    .select('*, member:member_id (name, slug)')
    .order('transaction_date', { ascending: false })

  if (error) throw new Error(error.message)

  type MemberRef = { name: string; slug: string } | null
  type Row = Record<string, unknown> & {
    transaction_id: string
    member?: MemberRef
  }
  return ((data ?? []) as Row[]).map((r) => ({
    ...r,
    member_name: r.member?.name ?? null,
  }))
}

export async function getTransactionByTxnId(transactionId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('transactions')
    .select('*, member:member_id (id, name)')
    .eq('transaction_id', transactionId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function updateTransaction(formData: FormData): Promise<ActionResult> {
  return runAction('updateTransaction', async () => {
    const supabase = await createClient()
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const id = (formData.get('id') as string | null)?.trim()
    if (!id) return actionError('Missing transaction id')

    const transactionDate = (formData.get('transaction_date') as string | null)?.trim()
    const amountRaw = (formData.get('amount') as string | null)?.trim()
    const transactionType = formData.get('transaction_type') as TransactionType
    const description = formData.get('description') as string | null
    const bankTransactionId =
      (formData.get('bank_transaction_id') as string | null)?.trim() || null
    const interestSourceRaw = formData.get('interest_source')
    const memberIdRaw = formData.get('member_id') as string | null
    const loanIdRaw = formData.get('loan_id') as string | null

    if (!transactionDate) return actionError('Date is required', 'transaction_date')
    const amount = parseFloat(amountRaw ?? '')
    if (!Number.isFinite(amount) || amount <= 0) {
      return actionError('Amount must be positive', 'amount')
    }

    const interestSource =
      transactionType === 'interest' && (interestSourceRaw === 'loans' || interestSourceRaw === 'bank')
        ? interestSourceRaw
        : null
    const needsLoan =
      transactionType === 'loan_repayment' ||
      transactionType === 'penalty' ||
      (transactionType === 'interest' && interestSource === 'loans')
    const memberId = memberIdRaw && memberIdRaw.length > 0 ? memberIdRaw : null
    const loanId = needsLoan && loanIdRaw && loanIdRaw.length > 0 ? loanIdRaw : null

    // Donation-only fields. Persisted when type=donation, explicitly
    // null-ed otherwise so switching a row's type clears them.
    const isDonation = transactionType === 'donation'
    const beneficiaryRaw = (formData.get('beneficiary_name') as string | null)?.trim()
    const beneficiaryName = isDonation && beneficiaryRaw ? beneficiaryRaw : null
    const pollIdRaw = (formData.get('poll_id') as string | null)?.trim()
    const pollId = isDonation && pollIdRaw && pollIdRaw.length > 0 ? pollIdRaw : null

    const { error } = await supabase
      .from('transactions')
      .update({
        transaction_date: transactionDate,
        amount,
        transaction_type: transactionType,
        interest_source: interestSource,
        member_id: memberId,
        loan_id: loanId,
        beneficiary_name: beneficiaryName,
        poll_id: pollId,
        description: description?.trim() || null,
        bank_transaction_id: bankTransactionId,
      })
      .eq('id', id)

    if (error) {
      if (isPollAlreadyLinkedError(error)) {
        return actionError(
          'That poll is already linked to another donation.',
          'poll_id',
        )
      }
      return actionError(error.message)
    }

    revalidatePath('/admin')
    revalidatePath('/admin/transactions')
    revalidatePath('/dashboard')
    updateTag('dashboard')
    return actionOk(undefined, 'Transaction updated')
  })
}

export async function deleteTransaction(formData: FormData): Promise<ActionResult> {
  // We wrap in runAction *and* then conditionally redirect on success. The
  // redirect throws a NEXT_REDIRECT error that Next intercepts — Sentry's
  // captureException treats it specially and won't report it.
  const result = await runAction('deleteTransaction', async () => {
    const supabase = await createClient()
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const id = (formData.get('id') as string | null)?.trim()
    if (!id) return actionError('Missing transaction id')

    const { error } = await supabase.from('transactions').delete().eq('id', id)
    if (error) return actionError(error.message)

    revalidatePath('/admin')
    revalidatePath('/admin/transactions')
    revalidatePath('/dashboard')
    updateTag('dashboard')
    return actionOk(undefined, 'Transaction deleted')
  })

  // Exception to the "no redirect() on success" rule: the URL the user is
  // currently on (/admin/transactions/[deleted_id]) no longer resolves, so the
  // auto-refresh after the action would notFound() before a client-side push
  // could fire. Redirecting server-side avoids the 404 flash.
  if (result.ok) {
    redirect('/admin/transactions')
  }
  return result
}

/** True when the supplied Supabase/Postgres error is the unique-violation
 *  raised by the `transactions_poll_id_unique` partial index (one poll per
 *  donation). Used by create/updateTransaction to surface a friendly
 *  inline error instead of the raw 23505 message. */
function isPollAlreadyLinkedError(err: {
  code?: string | null
  message?: string | null
}): boolean {
  return (
    err.code === '23505' &&
    typeof err.message === 'string' &&
    err.message.includes('transactions_poll_id_unique')
  )
}

export type DonationPollPickerOption = {
  id: string
  question: string
  status: 'open' | 'closed'
  closes_at: string
}

/** Minimal poll list for the donation-form picker. Returns the 50 most
 *  recent polls, ordered by created_at desc, excluding any poll already
 *  linked to a different donation transaction (the donation ↔ poll
 *  relationship is 1:1).
 *
 *  Pass `excludeTxnId` from the edit form so the donation's own current
 *  poll stays selectable; omit it on the new-transaction form. */
export async function getPollsForDonationPicker(
  opts?: { excludeTxnId?: string },
): Promise<DonationPollPickerOption[]> {
  const supabase = await createClient()
  const [pollsRes, linkedRes] = await Promise.all([
    supabase
      .from('polls')
      .select('id, question, status, closes_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('transactions')
      .select('id, poll_id')
      .not('poll_id', 'is', null),
  ])
  if (pollsRes.error) throw new Error(pollsRes.error.message)
  if (linkedRes.error) throw new Error(linkedRes.error.message)

  const excludedPollIds = new Set<string>()
  for (const r of (linkedRes.data ?? []) as { id: string; poll_id: string | null }[]) {
    if (!r.poll_id) continue
    if (opts?.excludeTxnId && r.id === opts.excludeTxnId) continue
    excludedPollIds.add(r.poll_id)
  }

  return ((pollsRes.data ?? []) as DonationPollPickerOption[])
    .filter((p) => !excludedPollIds.has(p.id))
    .map((p) => ({
      id: p.id,
      question: p.question,
      status: p.status,
      closes_at: p.closes_at,
    }))
}
