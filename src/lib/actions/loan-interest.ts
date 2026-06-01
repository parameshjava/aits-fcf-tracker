'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { runAction, actionOk, actionError } from '@/lib/actions/action-result'
import type { ActionResult } from '@/lib/actions/action-result'
import { getCurrentUser } from '@/lib/actions/auth'
import { applyBalanceDelta } from '@/lib/actions/reference'
import type { BalanceDirection } from '@/lib/balance-direction'

export type LoanInterestAccrual = {
  id: string
  loan_id: string
  period_end: string
  amount_due: number
  paid_amount: number
  status: 'pending' | 'partially_paid' | 'paid' | 'waived'
  interest_rate_used: number
  balance_basis: number
  is_opening_balance: boolean
  waiver_reason: string | null
  paid_at: string | null
  created_at: string
}

export type InterestAllocation = {
  accrualId: string
  amount: number
}

type RawLoanInterestAccrual = {
  id: string
  loan_id: string
  period_end: string
  amount_due: number | string
  paid_amount: number | string
  status: 'pending' | 'partially_paid' | 'paid' | 'waived'
  interest_rate_used: number | string
  balance_basis: number | string
  is_opening_balance: boolean
  waiver_reason: string | null
  paid_at: string | null
  created_at: string
}

function toNumber(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) throw new Error(`Loan interest value is not numeric: ${String(raw)}`)
  return n
}

export async function getLoanInterestSchedule(
  loanId: string,
): Promise<LoanInterestAccrual[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('loan_interest_accruals')
    .select('*')
    .eq('loan_id', loanId)
    .order('period_end', { ascending: true })
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as RawLoanInterestAccrual[]
  return rows.map((r) => ({
    id: r.id,
    loan_id: r.loan_id,
    period_end: r.period_end,
    amount_due: toNumber(r.amount_due),
    paid_amount: toNumber(r.paid_amount),
    status: r.status,
    interest_rate_used: toNumber(r.interest_rate_used),
    balance_basis: toNumber(r.balance_basis),
    is_opening_balance: r.is_opening_balance,
    waiver_reason: r.waiver_reason,
    paid_at: r.paid_at,
    created_at: r.created_at,
  }))
}

export async function payLoanInterest(
  loanId: string,
  allocations: InterestAllocation[],
  transactionDate: string,
  notes?: string,
  bankBalance?: { apply: boolean; direction: BalanceDirection },
  bankTransactionId?: string,
): Promise<ActionResult<{ transactionId: string; balanceUpdateFailed: boolean }>> {
  return runAction('payLoanInterest', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    if (allocations.length === 0) return actionError('No allocations provided')
    for (const a of allocations) {
      if (!a.accrualId) return actionError('Missing accrualId in allocation')
      if (!(a.amount > 0)) return actionError('Allocation amount must be positive', 'amount')
    }

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('fn_apply_interest_payment', {
      p_loan_id: loanId,
      p_transaction_date: transactionDate,
      p_allocations: allocations.map((a) => ({ accrual_id: a.accrualId, amount: a.amount })),
      p_notes: notes ?? null,
      p_created_by: user.id,
    })
    if (error) return actionError(error.message)

    const txnId = data as string

    // The RPC doesn't set the bank reference; stamp it on the created row.
    const bankRef = bankTransactionId?.trim() || null
    if (bankRef) {
      const { error: refErr } = await supabase
        .from('transactions')
        .update({ bank_transaction_id: bankRef })
        .eq('id', txnId)
      if (refErr) return actionError(refErr.message)
    }

    let balanceUpdateFailed = false
    if (bankBalance?.apply) {
      const total = allocations.reduce((s, a) => s + a.amount, 0)
      const delta = bankBalance.direction === 'subtract' ? -total : total
      const result = await applyBalanceDelta(delta)
      if (!result.ok) {
        console.error('applyBalanceDelta failed for payLoanInterest:', result.error)
        balanceUpdateFailed = true
      }
    }

    revalidatePath(`/admin/loans/${loanId}`)
    revalidatePath('/admin/loans')
    revalidatePath('/admin/reference')
    updateTag('dashboard')

    return actionOk(
      { transactionId: txnId, balanceUpdateFailed },
      'Interest payment recorded',
    )
  })
}

export async function reverseInterestPayment(
  transactionId: string,
): Promise<ActionResult<{ loanId: string | null }>> {
  return runAction('reverseInterestPayment', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const supabase = await createClient()

    // Look up loan_id for the revalidation path BEFORE we delete.
    const { data: txn, error: txnErr } = await supabase
      .from('transactions')
      .select('loan_id')
      .eq('id', transactionId)
      .single()
    if (txnErr) return actionError(txnErr.message)
    const loanId = (txn?.loan_id ?? null) as string | null

    // Delete junction rows first (trigger recomputes accrual paid_amount/status), then the txn.
    const { error: delJunctionErr } = await supabase
      .from('loan_interest_payments')
      .delete()
      .eq('transaction_id', transactionId)
    if (delJunctionErr) return actionError(delJunctionErr.message)

    const { error: delTxnErr } = await supabase
      .from('transactions')
      .delete()
      .eq('id', transactionId)
    if (delTxnErr) return actionError(delTxnErr.message)

    if (loanId) {
      revalidatePath(`/admin/loans/${loanId}`)
      revalidatePath('/admin/loans')
    }
    updateTag('dashboard')

    return actionOk({ loanId }, 'Payment reversed')
  })
}

/**
 * Surgical per-loan accrual recompute. Loops every EOM from the loan's
 * start_date through today and idempotently upserts each accrual row,
 * preserving prior payments (status is recomputed from paid_amount).
 *
 * Use this after editing principal, start_date, or interest_waiver_months
 * on a single loan — far less invasive than `recomputeLoanInterest`, which
 * touches every active loan for a given EOM.
 */
export async function recomputeLoanAccruals(
  loanId: string,
): Promise<ActionResult<{ rows: number }>> {
  return runAction('recomputeLoanAccruals', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')
    if (!loanId) return actionError('Loan id required')

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('fn_recompute_loan_accruals', {
      p_loan_id: loanId,
    })
    if (error) return actionError(error.message)

    revalidatePath(`/admin/loans/${loanId}`)
    revalidatePath('/admin/loans')
    updateTag('dashboard')
    return actionOk({ rows: toNumber(data ?? 0) }, 'Accruals recomputed')
  })
}

/**
 * Manual recompute. When `periodEnd` is provided, recomputes that specific
 * EOM (used after a `reference_history` correction). When omitted, recomputes
 * the most recent EOM date in IST (i.e. the last day of the previous month).
 */
export async function recomputeLoanInterest(
  periodEnd?: string,
): Promise<ActionResult<{ rows: number; periodEnd: string }>> {
  return runAction('recomputeLoanInterest', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    // Default: last EOM in IST. Day-0 of the current month rolls back to the
    // last day of the previous month.
    const target =
      periodEnd ??
      (() => {
        const now = new Date()
        const eom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
        return eom.toISOString().slice(0, 10)
      })()

    const supabase = await createClient()
    const { data, error } = await supabase.rpc('fn_compute_loan_interest_for', {
      p_period_end: target,
    })
    if (error) return actionError(error.message)

    const rows = toNumber(data ?? 0)

    revalidatePath('/admin/loans')
    updateTag('dashboard')
    return actionOk(
      { rows, periodEnd: target },
      `Recomputed ${rows} accrual rows for ${target}`,
    )
  })
}
