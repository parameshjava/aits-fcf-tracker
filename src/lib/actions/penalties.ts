'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'
import { actionError, actionOk, runAction, type ActionResult } from './action-result'
import { lateFeeStateAfterDelete } from '@/lib/penalty-sync'

export type LoanPenaltyRow = {
  /** transactions.id (uuid) — what the delete action takes. */
  id: string
  /** Human-facing YYYYMMDD-NNN id. */
  transaction_id: string
  amount: number
  transaction_date: string
  description: string | null
  /** Installment this fee belongs to, when it is linked to an EMI row. */
  installment_no: number | null
  /** Negative amounts are the reversal rows written when a fee is waived. */
  is_reversal: boolean
}

/**
 * Every penalty transaction on a loan — the cumulative late-fee charges written
 * by the monthly job plus any waiver reversals — newest first.
 */
export async function getLoanPenalties(loanId: string): Promise<LoanPenaltyRow[]> {
  const supabase = await createClient()
  const [txnRes, scheduleRes] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, transaction_id, amount, transaction_date, description, loan_emi_schedule_id')
      .eq('loan_id', loanId)
      .eq('transaction_type', 'penalty')
      .order('transaction_date', { ascending: false })
      .order('transaction_id', { ascending: false }),
    supabase
      .from('loan_emi_schedule')
      .select('id, installment_no, late_fee_txn_id')
      .eq('loan_id', loanId),
  ])
  if (txnRes.error) throw new Error(txnRes.error.message)
  if (scheduleRes.error) throw new Error(scheduleRes.error.message)

  const scheduleRows = (scheduleRes.data ?? []) as {
    id: string
    installment_no: number
    late_fee_txn_id: string | null
  }[]
  const byScheduleId = new Map(scheduleRows.map((r) => [r.id, r.installment_no]))
  // Penalties charged before migration 047 carry no link column — the schedule
  // row points back at them instead.
  const byTxnId = new Map(
    scheduleRows
      .filter((r) => r.late_fee_txn_id)
      .map((r) => [r.late_fee_txn_id as string, r.installment_no]),
  )

  return ((txnRes.data ?? []) as {
    id: string
    transaction_id: string
    amount: number | string
    transaction_date: string
    description: string | null
    loan_emi_schedule_id: string | null
  }[]).map((t) => ({
    id: t.id,
    transaction_id: t.transaction_id,
    amount: Number(t.amount),
    transaction_date: t.transaction_date,
    description: t.description,
    installment_no:
      (t.loan_emi_schedule_id ? byScheduleId.get(t.loan_emi_schedule_id) : undefined) ??
      byTxnId.get(t.id) ??
      null,
    is_reversal: Number(t.amount) < 0,
  }))
}

/**
 * Delete one penalty transaction and re-sync the installment it was charged
 * against. Admin-only.
 *
 * The bank balance is deliberately untouched: a late fee only reaches the
 * balance when it is *collected* alongside its EMI (see `payEmi`), so removing
 * the receivable is balance-neutral in the normal case. If the EMI has already
 * been collected with the fee included, correct the balance from
 * /admin/reference.
 */
export async function deleteLoanPenalty(formData: FormData): Promise<ActionResult> {
  return runAction('deleteLoanPenalty', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const id = (formData.get('id') as string | null)?.trim()
    if (!id) return actionError('Missing penalty id')

    const supabase = await createClient()
    const { data: txn, error: txnErr } = await supabase
      .from('transactions')
      .select('id, transaction_id, amount, transaction_type, loan_id, loan_emi_schedule_id')
      .eq('id', id)
      .single()
    if (txnErr || !txn) return actionError(txnErr?.message ?? 'Penalty record not found')
    if (txn.transaction_type !== 'penalty') {
      return actionError('Only penalty records can be deleted here')
    }

    // Resolve the installment: post-047 penalties carry the link column; older
    // ones are only reachable through the schedule row pointing back at them.
    let scheduleId = (txn.loan_emi_schedule_id as string | null) ?? null
    if (!scheduleId) {
      const { data: byTxn } = await supabase
        .from('loan_emi_schedule')
        .select('id')
        .eq('late_fee_txn_id', id)
        .maybeSingle()
      scheduleId = byTxn?.id ?? null
    }

    let schedule: { late_fee_charged: number | string; late_fee_txn_id: string | null } | null = null
    if (scheduleId) {
      const { data, error } = await supabase
        .from('loan_emi_schedule')
        .select('late_fee_charged, late_fee_txn_id')
        .eq('id', scheduleId)
        .single()
      if (error) return actionError(error.message)
      schedule = data
      // late_fee_txn_id references transactions(id) with no ON DELETE action, so
      // the pointer must be cleared before the transaction row can be removed.
      if (schedule?.late_fee_txn_id === id) {
        const { error: clearErr } = await supabase
          .from('loan_emi_schedule')
          .update({ late_fee_txn_id: null })
          .eq('id', scheduleId)
        if (clearErr) return actionError(clearErr.message)
      }
    }

    const { error: delErr } = await supabase.from('transactions').delete().eq('id', id)
    if (delErr) return actionError(delErr.message)

    if (scheduleId && schedule) {
      const { data: remaining, error: remErr } = await supabase
        .from('transactions')
        .select('id, amount, transaction_date')
        .eq('loan_emi_schedule_id', scheduleId)
        .eq('transaction_type', 'penalty')
      if (remErr) return actionError(remErr.message)

      const next = lateFeeStateAfterDelete({
        currentCharged: Number(schedule.late_fee_charged) || 0,
        deletedAmount: Number(txn.amount) || 0,
        remaining: (remaining ?? []).map((r) => ({
          id: r.id as string,
          amount: Number(r.amount),
          transaction_date: r.transaction_date as string,
        })),
      })
      const { error: updErr } = await supabase
        .from('loan_emi_schedule')
        .update(next)
        .eq('id', scheduleId)
      if (updErr) return actionError(updErr.message)
    }

    revalidatePath('/admin')
    revalidatePath('/admin/loans')
    revalidatePath('/admin/transactions')
    revalidatePath('/dashboard')
    updateTag('dashboard')
    return actionOk(undefined, `Penalty ${txn.transaction_id} deleted`)
  })
}
