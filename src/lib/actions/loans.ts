'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'
import { getReference, applyBalanceDelta } from './reference'
import {
  LOAN_DISBURSEMENT_DEFAULT,
  LOAN_WRITE_OFF_DEFAULT,
  type BalanceDirection,
} from '@/lib/balance-direction'

export type LoanStatus = 'active' | 'paid' | 'write_off'

export type LoanRow = {
  id: string
  loan_number: string
  member_id: string | null
  principal_amount: number
  start_date: string
  end_date: string | null
  status: LoanStatus
  bad_debt: number
  historical_interest_paid: number
  notes: string | null
  created_at: string
  member: { id: string; name: string; slug: string } | null
}

export async function getInterestPerLakh(): Promise<number> {
  try {
    return await getReference('interest_per_lakh')
  } catch {
    // If the reference row is missing (shouldn't happen post-migration),
    // fall back to the historical default rather than crashing loan pages.
    return 650
  }
}

export async function getLoans(): Promise<LoanRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('loans')
    .select('*, member:member_id (id, name, slug)')
    .order('loan_number', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as LoanRow[]
}

export async function getLoanByNumber(loanNumber: string): Promise<LoanRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('loans')
    .select('*, member:member_id (id, name, slug)')
    .eq('loan_number', loanNumber)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data ?? null) as LoanRow | null
}

export async function getLoanTransactions(loanId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('transactions')
    .select('*, member:member_id (name, slug)')
    .eq('loan_id', loanId)
    .order('transaction_date', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createLoan(formData: FormData) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }

  const memberId = (formData.get('member_id') as string) || null
  const principal = parseFloat(formData.get('principal_amount') as string)
  const startDate = formData.get('start_date') as string
  const notes = ((formData.get('notes') as string) || '').trim() || null

  if (!memberId) return { error: 'Member is required' }
  if (!Number.isFinite(principal) || principal <= 0) {
    return { error: 'Principal must be a positive number' }
  }
  if (!startDate) return { error: 'Start date is required' }

  // A new loan starts clean: active, no end date, no bad debt, no historical
  // interest. Past payments and the close-out get added later via the loan
  // detail page (Edit + Close flows).
  const { error } = await supabase.from('loans').insert({
    member_id: memberId,
    principal_amount: principal,
    start_date: startDate,
    end_date: null,
    status: 'active',
    bad_debt: 0,
    historical_interest_paid: 0,
    notes,
  })

  if (error) return { error: error.message }

  const applyToBankBalance = formData.get('applyToBankBalance') === '1'
  const balanceDirectionRaw = formData.get('balanceDirection') as BalanceDirection | null
  let balanceUpdateFailed = false
  if (applyToBankBalance) {
    const direction =
      balanceDirectionRaw === 'add' || balanceDirectionRaw === 'subtract'
        ? balanceDirectionRaw
        : LOAN_DISBURSEMENT_DEFAULT
    const delta = direction === 'add' ? principal : -principal
    const result = await applyBalanceDelta(delta)
    if (result.error) {
      console.error('applyBalanceDelta failed for createLoan:', result.error)
      balanceUpdateFailed = true
    }
  }

  revalidatePath('/dashboard/loans')
  revalidatePath('/admin/loans')
  revalidatePath('/dashboard')
  revalidatePath('/admin/reference')
  return { success: 'Loan created', balanceUpdateFailed }
}

export async function updateLoan(formData: FormData) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }

  const loanId = formData.get('loan_id') as string
  if (!loanId) return { error: 'Loan is required' }

  const principalRaw = (formData.get('principal_amount') as string) ?? ''
  const startDate = (formData.get('start_date') as string) || null
  const historicalRaw = (formData.get('historical_interest_paid') as string) ?? ''
  const notesRaw = (formData.get('notes') as string) ?? ''

  const principal = parseFloat(principalRaw)
  const historical = parseFloat(historicalRaw) || 0

  if (principalRaw && (!Number.isFinite(principal) || principal <= 0)) {
    return { error: 'Principal must be a positive number' }
  }
  if (historicalRaw && (!Number.isFinite(historical) || historical < 0)) {
    return { error: 'Historical interest paid must be ≥ 0' }
  }

  const patch: Record<string, unknown> = {
    historical_interest_paid: historical,
    notes: notesRaw.trim() || null,
  }
  if (principalRaw) patch.principal_amount = principal
  if (startDate)    patch.start_date = startDate

  const { error } = await supabase.from('loans').update(patch).eq('id', loanId)
  if (error) return { error: error.message }

  revalidatePath('/dashboard/loans')
  revalidatePath(`/dashboard/loans/[loan_number]`, 'page')
  return { success: 'Loan updated' }
}

export async function closeLoan(formData: FormData) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }

  const loanId = formData.get('loan_id') as string
  const endDate = formData.get('end_date') as string
  const finalStatus = formData.get('status') as 'paid' | 'write_off'
  const badDebt = parseFloat((formData.get('bad_debt') as string) || '0') || 0

  if (!loanId) return { error: 'Loan is required' }
  if (!endDate) return { error: 'End date is required' }
  if (finalStatus !== 'paid' && finalStatus !== 'write_off') {
    return { error: 'Final status must be Paid or Write off' }
  }

  const { error } = await supabase
    .from('loans')
    .update({
      end_date: endDate,
      status: finalStatus,
      bad_debt: badDebt,
    })
    .eq('id', loanId)

  if (error) return { error: error.message }

  const applyToBankBalance = formData.get('applyToBankBalance') === '1'
  const balanceDirectionRaw = formData.get('balanceDirection') as BalanceDirection | null
  let balanceUpdateFailed = false
  // Only apply when admin opts in AND the close is a write-off — paying a loan
  // off normally doesn't move cash (the repayment transactions already did).
  if (applyToBankBalance && finalStatus === 'write_off' && badDebt > 0) {
    const direction =
      balanceDirectionRaw === 'add' || balanceDirectionRaw === 'subtract'
        ? balanceDirectionRaw
        : LOAN_WRITE_OFF_DEFAULT
    const delta = direction === 'add' ? badDebt : -badDebt
    const result = await applyBalanceDelta(delta)
    if (result.error) {
      console.error('applyBalanceDelta failed for closeLoan:', result.error)
      balanceUpdateFailed = true
    }
  }

  revalidatePath('/dashboard/loans')
  revalidatePath(`/dashboard/loans/[loan_number]`, 'page')
  revalidatePath('/dashboard')
  revalidatePath('/admin/reference')
  return { success: 'Loan closed', balanceUpdateFailed }
}

export async function reopenLoan(loanId: string) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    return { error: 'Unauthorized' }
  }

  const { error } = await supabase
    .from('loans')
    .update({ end_date: null, status: 'active', bad_debt: 0 })
    .eq('id', loanId)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/loans')
  revalidatePath(`/dashboard/loans/[loan_number]`, 'page')
  return { success: 'Loan reopened' }
}
