'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'
import { getReference, applyBalanceDelta } from './reference'
import {
  LOAN_DISBURSEMENT_DEFAULT,
  type BalanceDirection,
} from '@/lib/balance-direction'
import { computeLoanFinancials, type LoanFinancials } from '@/lib/loan-math'

export type LoanStatus = 'active' | 'paid' | 'write_off'

export type LoanDetailTxn = {
  id: string
  transaction_date: string
  transaction_id: string
  transaction_type: string
  interest_source: string | null
  amount: number
  description: string | null
}

export type LoanDetailData = {
  loan: LoanRow
  transactions: LoanDetailTxn[]
  interestPerLakh: number
  financials: LoanFinancials
}

export type LoanRow = {
  id: string
  loan_number: string
  member_id: string | null
  principal_amount: number
  start_date: string
  end_date: string | null
  status: LoanStatus
  bad_debt: number
  /** Months from start_date during which no interest accrues. 0 = none. */
  interest_waiver_months: number
  /** Interest forgiven at closure (write_off path). */
  interest_waived: number
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

/** Sum of `loans.bad_debt` per closure year (`end_date`'s year). Loans
 *  without a `bad_debt` value or without an `end_date` are skipped — bad
 *  debt is only realised at write-off close. Used by the donation
 *  eligibility ledger so each year's corpus subtracts the bad debts
 *  written off in that year. */
export async function getBadDebtsByYear(): Promise<Map<number, number>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('loans')
    .select('bad_debt, end_date')
    .gt('bad_debt', 0)
    .not('end_date', 'is', null)
  if (error) throw new Error(error.message)
  const out = new Map<number, number>()
  for (const r of (data ?? []) as { bad_debt: number | null; end_date: string | null }[]) {
    if (!r.end_date) continue
    const y = new Date(r.end_date).getUTCFullYear()
    if (!Number.isFinite(y)) continue
    out.set(y, (out.get(y) ?? 0) + Number(r.bad_debt || 0))
  }
  return out
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

export type ActiveLoanOption = {
  id: string
  loan_number: string
  member_id: string | null
  member_name: string | null
  /** Pending principal: principal − sum(principal portion of payments) − bad_debt. */
  balance: number
}

export async function getActiveLoansWithBalance(): Promise<ActiveLoanOption[]> {
  const supabase = await createClient()
  const { data: loans, error: loansErr } = await supabase
    .from('loans')
    .select('id, loan_number, member_id, member:member_id (id, name), principal_amount, bad_debt')
    .eq('status', 'active')
    .order('start_date', { ascending: false })
  if (loansErr) throw new Error(loansErr.message)

  type LoanLite = {
    id: string
    loan_number: string
    member_id: string | null
    member: { id: string; name: string } | null
    principal_amount: number | string
    bad_debt: number | string | null
  }
  const all = (loans ?? []) as unknown as LoanLite[]
  if (all.length === 0) return []

  const ids = all.map((l) => l.id)
  const { data: txnRaw, error: txnErr } = await supabase
    .from('transactions')
    .select('loan_id, amount, transaction_type')
    .in('loan_id', ids)
    .eq('transaction_type', 'loan_repayment')
  if (txnErr) throw new Error(txnErr.message)

  type TxnLite = {
    loan_id: string | null
    amount: number | string
    transaction_type: string
  }
  const paidByLoan = new Map<string, number>()
  for (const t of (txnRaw ?? []) as TxnLite[]) {
    if (!t.loan_id) continue
    const portion = Number(t.amount) || 0
    if (portion > 0) paidByLoan.set(t.loan_id, (paidByLoan.get(t.loan_id) ?? 0) + portion)
  }

  return all.map((l) => ({
    id: l.id,
    loan_number: l.loan_number,
    member_id: l.member_id,
    member_name: l.member?.name ?? null,
    balance: Math.max(
      Number(l.principal_amount) - (paidByLoan.get(l.id) ?? 0) - (Number(l.bad_debt) || 0),
      0,
    ),
  }))
}

export async function getLoanDetail(loanId: string): Promise<LoanDetailData | null> {
  const supabase = await createClient()
  const [loanRes, txnRes, interestPerLakh] = await Promise.all([
    supabase
      .from('loans')
      .select('*, member:member_id (id, name, slug)')
      .eq('id', loanId)
      .maybeSingle(),
    supabase
      .from('transactions')
      .select('id, transaction_date, transaction_id, transaction_type, interest_source, amount, description')
      .eq('loan_id', loanId)
      .order('transaction_date', { ascending: true }),
    getInterestPerLakh(),
  ])
  if (loanRes.error) throw new Error(loanRes.error.message)
  if (!loanRes.data) return null
  if (txnRes.error) throw new Error(txnRes.error.message)

  const loan = loanRes.data as LoanRow
  const transactions = (txnRes.data ?? []) as LoanDetailTxn[]
  const financials = computeLoanFinancials(loan, transactions, interestPerLakh)
  return { loan, transactions, interestPerLakh, financials }
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
  const waiverRaw = (formData.get('interest_waiver_months') as string | null)?.trim() || ''
  const interestWaiverMonths = waiverRaw === '' ? 0 : Math.floor(Number(waiverRaw))

  if (!memberId) return { error: 'Member is required' }
  if (!Number.isFinite(principal) || principal <= 0) {
    return { error: 'Principal must be a positive number' }
  }
  if (!startDate) return { error: 'Start date is required' }
  if (!Number.isFinite(interestWaiverMonths) || interestWaiverMonths < 0) {
    return { error: 'Interest waiver months must be 0 or a positive integer' }
  }

  // A new loan starts clean: active, no end date, no bad debt. Past payments
  // (including any pre-tracking interest) get added later as transactions
  // tagged to this loan. Close-out happens via the Close form.
  const { error } = await supabase.from('loans').insert({
    member_id: memberId,
    principal_amount: principal,
    start_date: startDate,
    end_date: null,
    status: 'active',
    bad_debt: 0,
    interest_waiver_months: interestWaiverMonths,
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
  const notesRaw = (formData.get('notes') as string) ?? ''
  const waiverRaw = (formData.get('interest_waiver_months') as string) ?? ''

  const principal = parseFloat(principalRaw)
  const waiverMonths = waiverRaw === '' ? null : Math.floor(Number(waiverRaw))

  if (principalRaw && (!Number.isFinite(principal) || principal <= 0)) {
    return { error: 'Principal must be a positive number' }
  }
  if (waiverMonths != null && (!Number.isFinite(waiverMonths) || waiverMonths < 0)) {
    return { error: 'Interest waiver months must be 0 or a positive integer' }
  }

  const patch: Record<string, unknown> = {
    notes: notesRaw.trim() || null,
  }
  if (principalRaw) patch.principal_amount = principal
  if (startDate)    patch.start_date = startDate
  if (waiverMonths != null) patch.interest_waiver_months = waiverMonths

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
  const interestWaived =
    parseFloat((formData.get('interest_waived') as string) || '0') || 0

  if (!loanId) return { error: 'Loan is required' }
  if (!endDate) return { error: 'End date is required' }
  if (finalStatus !== 'paid' && finalStatus !== 'write_off') {
    return { error: 'Final status must be Paid or Write off' }
  }
  if (badDebt < 0) return { error: 'Principal write-off must be ≥ 0' }
  if (interestWaived < 0) return { error: 'Interest waived must be ≥ 0' }

  // Re-fetch + recompute server-side so a stale client form can't bypass the
  // "paid means fully settled" rule. Also gives us up-to-date values to use
  // as the default write-off amounts.
  const [loanRes, txnRes, interestPerLakh] = await Promise.all([
    supabase
      .from('loans')
      .select('id, status, principal_amount, start_date, end_date, bad_debt, interest_waiver_months')
      .eq('id', loanId)
      .maybeSingle(),
    supabase
      .from('transactions')
      .select('transaction_type, interest_source, amount, transaction_date')
      .eq('loan_id', loanId),
    getInterestPerLakh(),
  ])
  if (loanRes.error || !loanRes.data) {
    return { error: loanRes.error?.message ?? 'Loan not found' }
  }
  const liveLoan = loanRes.data as Parameters<typeof computeLoanFinancials>[0]
  const txns = (txnRes.data ?? []) as Parameters<typeof computeLoanFinancials>[1]
  const financials: LoanFinancials = computeLoanFinancials(liveLoan, txns, interestPerLakh)

  if (finalStatus === 'paid') {
    if (financials.balance > 0 || financials.interestDue > 0) {
      const parts: string[] = []
      if (financials.balance > 0) parts.push(`₹${financials.balance.toFixed(2)} principal`)
      if (financials.interestDue > 0) parts.push(`₹${financials.interestDue.toFixed(2)} interest`)
      return {
        error:
          `Cannot mark as Paid — ${parts.join(' and ')} still pending. ` +
          `Collect the dues or use Write off to waive.`,
      }
    }
    // No waive amounts allowed on a clean paid close; force them to zero so
    // the loan row is consistent regardless of what the client sent.
    if (badDebt > 0 || interestWaived > 0) {
      return {
        error: 'Paid closures cannot carry a write-off amount. Switch to Write off.',
      }
    }
  } else {
    // Write off: at least one of the waiver amounts should be non-zero,
    // otherwise the admin should be using Paid.
    if (badDebt === 0 && interestWaived === 0) {
      return {
        error: 'Write off requires a principal write-off or interest waived amount.',
      }
    }
    if (badDebt > financials.balance) {
      return {
        error: `Principal write-off (₹${badDebt}) exceeds pending principal (₹${financials.balance.toFixed(2)}).`,
      }
    }
    if (interestWaived > financials.interestDue) {
      return {
        error: `Interest waived (₹${interestWaived}) exceeds pending interest (₹${financials.interestDue.toFixed(2)}).`,
      }
    }
  }

  const { error } = await supabase
    .from('loans')
    .update({
      end_date: endDate,
      status: finalStatus,
      bad_debt: finalStatus === 'paid' ? 0 : badDebt,
      interest_waived: finalStatus === 'paid' ? 0 : interestWaived,
    })
    .eq('id', loanId)

  if (error) return { error: error.message }

  // Bank balance is intentionally not adjusted on closure:
  //   - Paid close: every repayment transaction already credited the bank.
  //   - Write-off: the principal was debited at disbursement time, so writing
  //     it off only recognises the loss on the books — it doesn't move cash.
  //     Waived interest was never received, so it never affected the bank.

  revalidatePath('/dashboard/loans')
  revalidatePath(`/dashboard/loans/[loan_number]`, 'page')
  revalidatePath('/dashboard')
  revalidatePath('/admin/reference')
  return { success: 'Loan closed' }
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
