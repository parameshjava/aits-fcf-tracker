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
      description,
      created_by: user.id,
      verified_by: user.id,
    })

    if (error) {
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
    .select('*, beneficiary_name, member:member_id (name, slug)')
    .order('transaction_date', { ascending: false })

  if (error) throw new Error(error.message)

  type MemberRef = { name: string; slug: string } | null
  type DBRow = Record<string, unknown> & {
    transaction_id: string
    transaction_date: string
    amount: number | string
    transaction_type: string
    interest_source?: 'loans' | 'bank' | null
    description?: string | null
    beneficiary_name?: string | null
    member?: MemberRef
    member_name?: string | null
  }
  // Donations are paid to external beneficiaries (not members) — fall back to
  // `beneficiary_name` so the donations page's "Beneficiary" column still
  // renders a name. See migrations/008_seed_donations.sql.
  //
  // The DB is the single source of truth — all historical seed data has been
  // migrated into `public.transactions` via scripts/prod/transactions/{YYYY}.sql
  // and 008_seed_donations.sql. The previous JS-side synthetic merge from
  // seed.json double-counted contributions in section-view (slug-based IDs
  // didn't match the abbrev-based IDs in DB), inflating corpus growth and
  // throwing off the eligibility math.
  return ((data ?? []) as DBRow[]).map((r) => ({
    ...r,
    member_name: r.member?.name ?? r.beneficiary_name ?? null,
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

    const { error } = await supabase
      .from('transactions')
      .update({
        transaction_date: transactionDate,
        amount,
        transaction_type: transactionType,
        interest_source: interestSource,
        member_id: memberId,
        loan_id: loanId,
        description: description?.trim() || null,
      })
      .eq('id', id)

    if (error) return actionError(error.message)

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
