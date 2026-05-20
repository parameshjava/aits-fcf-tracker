'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'
import { seedToTransactions } from '../seed-to-transactions'
import type { ContributionType } from '../constants'
import { applyBalanceDelta } from './reference'

export async function createTransaction(formData: FormData) {
  const supabase = await createClient()
  const user = await getCurrentUser()

  if (!user || user.profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }

  const transactionDate = formData.get('transaction_date') as string
  const amount = parseFloat(formData.get('amount') as string)
  const contributionType = formData.get('contribution_type') as ContributionType
  const description = formData.get('description') as string
  const interestSourceRaw = formData.get('interest_source')
  const interestSource =
    contributionType === 'interest' && (interestSourceRaw === 'loans' || interestSourceRaw === 'bank')
      ? interestSourceRaw
      : null
  const memberIdRaw = formData.get('member_id') as string | null
  const memberId = memberIdRaw && memberIdRaw.length > 0 ? memberIdRaw : null
  const loanIdRaw = formData.get('loan_id') as string | null
  // Loan is only meaningful for loan-side transactions; ignore otherwise.
  const needsLoan =
    contributionType === 'loan_repayment' ||
    contributionType === 'penalty' ||
    (contributionType === 'interest' && interestSource === 'loans')
  const loanId = needsLoan && loanIdRaw && loanIdRaw.length > 0 ? loanIdRaw : null

  // transaction_id is auto-filled by a Postgres BEFORE INSERT trigger
  // (YYYYMMDD-NNN) — we never send one from the app.
  const { error } = await supabase.from('transactions').insert({
    transaction_date: transactionDate,
    amount,
    contribution_type: contributionType,
    interest_source: interestSource,
    member_id: memberId,
    loan_id: loanId,
    description,
    created_by: user.id,
    verified_by: user.id,
  })

  if (error) {
    return { error: error.message }
  }

  const applyToBankBalance = formData.get('applyToBankBalance') === '1'
  const balanceDirection = formData.get('balanceDirection') as 'add' | 'subtract' | null
  let balanceUpdateFailed = false
  if (applyToBankBalance && (balanceDirection === 'add' || balanceDirection === 'subtract')) {
    const delta = balanceDirection === 'add' ? amount : -amount
    const result = await applyBalanceDelta(delta)
    if (result.error) {
      console.error('applyBalanceDelta failed for createTransaction:', result.error)
      balanceUpdateFailed = true
    }
  }

  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/admin/reference')
  return { success: 'Transaction saved', balanceUpdateFailed }
}

export async function getTransactions() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('transactions')
    .select('*, member:member_id (name, slug)')
    .order('transaction_date', { ascending: false })

  if (error) throw new Error(error.message)

  type MemberRef = { name: string; slug: string } | null
  type DBRow = Record<string, unknown> & {
    transaction_id: string
    transaction_date: string
    amount: number | string
    contribution_type: string
    interest_source?: 'loans' | 'bank' | null
    description?: string | null
    member?: MemberRef
    member_name?: string | null
  }
  const dbRows = ((data ?? []) as DBRow[]).map((r) => ({
    ...r,
    member_name: r.member?.name ?? null,
  }))

  // Merge in historical rows synthesized from the seed Excel so the dashboard
  // / section pages show a full picture before users add anything in the DB.
  // DB rows take precedence by transaction_id (same id → seed row is dropped).
  const dbIds = new Set(dbRows.map((r) => r.transaction_id))
  const synthetic = seedToTransactions().filter((r) => !dbIds.has(r.transaction_id))

  const merged = [...dbRows, ...synthetic].sort(
    (a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime(),
  )
  return merged
}

export async function getTransactionStats() {
  const rows = await getTransactions()

  const totalAmount = rows.reduce((sum, t) => sum + Number(t.amount), 0)

  const typeBreakdown = rows.reduce<Record<string, number>>((acc, t) => {
    acc[t.contribution_type] = (acc[t.contribution_type] || 0) + Number(t.amount)
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

export async function updateTransaction(formData: FormData) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') return { error: 'Unauthorized' }

  const id = (formData.get('id') as string | null)?.trim()
  if (!id) return { error: 'Missing transaction id' }

  const transactionDate = (formData.get('transaction_date') as string | null)?.trim()
  const amountRaw = (formData.get('amount') as string | null)?.trim()
  const contributionType = formData.get('contribution_type') as ContributionType
  const description = formData.get('description') as string | null
  const interestSourceRaw = formData.get('interest_source')
  const memberIdRaw = formData.get('member_id') as string | null
  const loanIdRaw = formData.get('loan_id') as string | null

  if (!transactionDate) return { error: 'Date is required' }
  const amount = parseFloat(amountRaw ?? '')
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Amount must be positive' }

  const interestSource =
    contributionType === 'interest' && (interestSourceRaw === 'loans' || interestSourceRaw === 'bank')
      ? interestSourceRaw
      : null
  const needsLoan =
    contributionType === 'loan_repayment' ||
    contributionType === 'penalty' ||
    (contributionType === 'interest' && interestSource === 'loans')
  const memberId = memberIdRaw && memberIdRaw.length > 0 ? memberIdRaw : null
  const loanId = needsLoan && loanIdRaw && loanIdRaw.length > 0 ? loanIdRaw : null

  const { error } = await supabase
    .from('transactions')
    .update({
      transaction_date: transactionDate,
      amount,
      contribution_type: contributionType,
      interest_source: interestSource,
      member_id: memberId,
      loan_id: loanId,
      description: description?.trim() || null,
    })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/admin')
  revalidatePath('/admin/transactions')
  revalidatePath('/dashboard')
  return { success: 'Transaction updated' }
}

export async function deleteTransaction(formData: FormData) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') return { error: 'Unauthorized' }

  const id = (formData.get('id') as string | null)?.trim()
  if (!id) return { error: 'Missing transaction id' }

  const { error } = await supabase.from('transactions').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/admin')
  revalidatePath('/admin/transactions')
  revalidatePath('/dashboard')
  // Exception to the "no redirect() on success" rule: the URL the user is
  // currently on (/admin/transactions/[deleted_id]) no longer resolves, so the
  // auto-refresh after the action would notFound() before a client-side push
  // could fire. Redirecting server-side avoids the 404 flash.
  redirect('/admin/transactions')
}
