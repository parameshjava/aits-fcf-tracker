'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'
import { getReference, applyBalanceDelta } from './reference'
import { actionError, actionOk, runAction, type ActionResult } from './action-result'
import { recomputeAfterPrepayment } from '@/lib/emi-math'

export type EmiScheduleRow = {
  id: string
  installment_no: number
  due_date: string
  opening_balance: number
  emi_amount: number
  principal_due: number
  interest_due: number
  closing_balance: number
  principal_paid: number
  interest_paid: number
  status: 'scheduled' | 'paid' | 'partially_paid' | 'overdue' | 'waived'
  late_fee_charged: number
  late_fee_waived: boolean
}

export async function getEmiSchedule(loanId: string): Promise<EmiScheduleRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('loan_emi_schedule')
    .select(
      'id, installment_no, due_date, opening_balance, emi_amount, principal_due, interest_due, closing_balance, principal_paid, interest_paid, status, late_fee_charged, late_fee_waived',
    )
    .eq('loan_id', loanId)
    .order('installment_no')
  if (error) throw new Error(error.message)
  return (data ?? []) as EmiScheduleRow[]
}

/** Pay one EMI installment in full: creates a loan_repayment + an interest txn, links both. */
export async function payEmi(formData: FormData): Promise<ActionResult> {
  return runAction('payEmi', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const scheduleId = String(formData.get('schedule_id') ?? '')
    const loanId = String(formData.get('loan_id') ?? '')
    const memberId = String(formData.get('member_id') ?? '')
    const paidDate = String(formData.get('paid_date') ?? '')
    const bankTransactionId = (formData.get('bank_transaction_id') as string | null)?.trim() || null
    // EMI payments are cash IN → add to the bank balance when the admin opts in.
    const applyToBankBalance = formData.get('applyToBankBalance') === '1'
    const waiveLateFee = formData.get('waive_late_fee') === '1'
    if (!scheduleId || !loanId || !paidDate) return actionError('Missing fields')

    const supabase = await createClient()
    const { data: row, error: rowErr } = await supabase
      .from('loan_emi_schedule')
      .select('installment_no, principal_due, interest_due, principal_paid, interest_paid, late_fee_charged, late_fee_waived')
      .eq('id', scheduleId)
      .single()
    if (rowErr || !row) return actionError(rowErr?.message ?? 'EMI row not found')

    const principalPortion = Number(row.principal_due) - Number(row.principal_paid)
    const interestPortion = Number(row.interest_due) - Number(row.interest_paid)
    if (principalPortion <= 0 && interestPortion <= 0) return actionError('EMI already paid')

    const txnIds: { id: string; principal: number; interest: number }[] = []
    if (principalPortion > 0) {
      const { data: t, error } = await supabase
        .from('transactions')
        .insert({
          member_id: memberId || null,
          loan_id: loanId,
          transaction_type: 'loan_repayment',
          amount: principalPortion,
          transaction_date: paidDate,
          description: 'EMI principal',
          bank_transaction_id: bankTransactionId,
          created_by: user.id,
          verified_by: user.id,
        })
        .select('id')
        .single()
      if (error || !t) return actionError(error?.message ?? 'Failed to record principal')
      txnIds.push({ id: t.id, principal: principalPortion, interest: 0 })
    }
    if (interestPortion > 0) {
      const { data: t, error } = await supabase
        .from('transactions')
        .insert({
          member_id: memberId || null,
          loan_id: loanId,
          transaction_type: 'interest',
          interest_source: 'loans',
          amount: interestPortion,
          transaction_date: paidDate,
          description: 'EMI interest',
          bank_transaction_id: bankTransactionId,
          created_by: user.id,
          verified_by: user.id,
        })
        .select('id')
        .single()
      if (error || !t) return actionError(error?.message ?? 'Failed to record interest')
      txnIds.push({ id: t.id, principal: 0, interest: interestPortion })
    }
    for (const t of txnIds) {
      const { error } = await supabase.from('loan_emi_payments').insert({
        schedule_id: scheduleId,
        transaction_id: t.id,
        principal_applied: t.principal,
        interest_applied: t.interest,
      })
      if (error) return actionError(error.message)
    }

    // The late fee (already recorded as a penalty receivable) is collected with the
    // EMI unless the admin waives it. The penalty txn never bumped the bank balance,
    // so adding it here at collection is the first and only time → no double count.
    const outstandingLateFee = row.late_fee_waived ? 0 : Math.max(Number(row.late_fee_charged) || 0, 0)
    const lateFeeCollected = waiveLateFee ? 0 : outstandingLateFee

    // Cash received → increase the bank balance by the effective amount paid
    // (EMI principal + interest + collected late fee).
    if (applyToBankBalance) {
      const total = Math.max(principalPortion, 0) + Math.max(interestPortion, 0) + lateFeeCollected
      const result = await applyBalanceDelta(total)
      if (!result.ok) console.error('applyBalanceDelta failed for payEmi:', result.error)
    }

    // Optional: waive this installment's late fee. We KEEP the original penalty
    // charge(s) for audit and record a reversal entry (a negative penalty linked to
    // the installment) so the waiver shows in recent activity and nets the penalty
    // income to zero. The installment is flagged waived so the monthly job won't
    // re-charge, and late_fee_charged is retained so the per-loan "late fees waived"
    // total stays computable.
    if (waiveLateFee && outstandingLateFee > 0) {
      const { error: wErr } = await supabase.from('transactions').insert({
        member_id: memberId || null,
        loan_id: loanId,
        loan_emi_schedule_id: scheduleId,
        transaction_type: 'penalty',
        amount: -outstandingLateFee,
        transaction_date: paidDate,
        description: `Late fee waived: EMI #${row.installment_no}`,
        created_by: user.id,
        verified_by: user.id,
      })
      if (wErr) return actionError(wErr.message)
      const { error: updErr } = await supabase
        .from('loan_emi_schedule')
        .update({ late_fee_waived: true })
        .eq('id', scheduleId)
      if (updErr) return actionError(updErr.message)
    }

    updateTag('dashboard')
    revalidatePath('/admin/loans')
    revalidatePath('/admin/reference')
    return actionOk(undefined, waiveLateFee ? 'EMI recorded; late fee waived' : 'EMI recorded')
  })
}

/** Prepay extra principal; rebuild remaining schedule by tenure or EMI reduction. */
export async function prepayLoan(formData: FormData): Promise<ActionResult> {
  return runAction('prepayLoan', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const loanId = String(formData.get('loan_id') ?? '')
    const memberId = String(formData.get('member_id') ?? '')
    const amount = Number(formData.get('amount'))
    const mode = String(formData.get('mode') ?? '') as 'reduce_tenure' | 'reduce_emi'
    const paidDate = String(formData.get('paid_date') ?? '')
    const bankTransactionId = (formData.get('bank_transaction_id') as string | null)?.trim() || null
    const applyToBankBalance = formData.get('applyToBankBalance') === '1'
    if (!loanId || !(amount > 0) || !['reduce_tenure', 'reduce_emi'].includes(mode)) {
      return actionError('Invalid prepayment input')
    }

    const supabase = await createClient()
    // Outstanding = pending principal from the EMI balances view minus this advance.
    const { data: bal } = await supabase
      .from('loan_emi_balances')
      .select('pending_principal, interest_rate_pct, emi_amount, next_due_date')
      .eq('loan_id', loanId)
      .single()
    if (!bal) return actionError('Loan not on EMI model')
    const newOutstanding = Number(bal.pending_principal) - amount
    if (newOutstanding < 0) return actionError('Advance exceeds outstanding principal')

    // Record the advance as a principal repayment.
    const { error: txnErr } = await supabase.from('transactions').insert({
      member_id: memberId || null,
      loan_id: loanId,
      transaction_type: 'loan_repayment',
      amount,
      transaction_date: paidDate,
      description: `Advance principal (${mode})`,
      bank_transaction_id: bankTransactionId,
      created_by: user.id,
      verified_by: user.id,
    })
    if (txnErr) return actionError(txnErr.message)

    // Cash received → increase the bank balance by the advance amount.
    if (applyToBankBalance) {
      const result = await applyBalanceDelta(amount)
      if (!result.ok) console.error('applyBalanceDelta failed for prepayLoan:', result.error)
    }

    if (newOutstanding === 0) {
      // Fully paid off. The advance covers the entire outstanding principal,
      // which includes the unpaid remainder of any partially-paid installment —
      // complete those rows so they stop reporting a dangling balance, then
      // drop the never-paid rows entirely (cleaner than leaving "waived" rows
      // for installments the member actually settled in cash).
      const { data: partials, error: partialsErr } = await supabase
        .from('loan_emi_schedule')
        .select('id, principal_due')
        .eq('loan_id', loanId)
        .eq('status', 'partially_paid')
      if (partialsErr) return actionError(partialsErr.message)
      const settledAt = new Date().toISOString()
      for (const row of partials ?? []) {
        const { error } = await supabase
          .from('loan_emi_schedule')
          .update({ principal_paid: row.principal_due, status: 'paid', paid_at: settledAt })
          .eq('id', row.id)
        if (error) return actionError(error.message)
      }

      // Delete remaining scheduled/overdue rows. They have no payment junction
      // rows, so the ON DELETE RESTRICT FK on loan_emi_payments won't block this.
      const { error: delErr } = await supabase
        .from('loan_emi_schedule')
        .delete()
        .eq('loan_id', loanId)
        .in('status', ['scheduled', 'overdue'])
      if (delErr) return actionError(delErr.message)

      // Formally close the loan.
      const { error: closeErr } = await supabase
        .from('loans')
        .update({ status: 'paid' })
        .eq('id', loanId)
      if (closeErr) return actionError(closeErr.message)
    } else {
      // Count remaining unpaid installments for reduce_emi tenure.
      const { count } = await supabase
        .from('loan_emi_schedule')
        .select('id', { count: 'exact', head: true })
        .eq('loan_id', loanId)
        .in('status', ['scheduled', 'overdue'])
      const rows = recomputeAfterPrepayment({
        outstanding: newOutstanding,
        annualRatePct: Number(bal.interest_rate_pct),
        remainingTerm: count ?? 1,
        currentEmi: Number(bal.emi_amount),
        firstDueDate: String(bal.next_due_date),
        mode,
      })
      // Replace unpaid rows with the recomputed schedule (delete + reinsert).
      const { error: delErr } = await supabase
        .from('loan_emi_schedule')
        .delete()
        .eq('loan_id', loanId)
        .in('status', ['scheduled', 'overdue'])
      if (delErr) return actionError(delErr.message)
      // Compute the max installment number AFTER deleting scheduled/overdue rows so
      // that waived rows are included — avoids unique(loan_id, installment_no) collisions.
      const { data: maxRow } = await supabase
        .from('loan_emi_schedule')
        .select('installment_no')
        .eq('loan_id', loanId)
        .order('installment_no', { ascending: false })
        .limit(1)
        .maybeSingle()
      let n = maxRow?.installment_no ?? 0
      const insertRows = rows.map((r) => ({
        loan_id: loanId,
        installment_no: ++n,
        due_date: r.dueDate,
        opening_balance: r.openingBalance,
        emi_amount: r.emiAmount,
        principal_due: r.principalDue,
        interest_due: r.interestDue,
        closing_balance: r.closingBalance,
      }))
      if (insertRows.length > 0) {
        const { error } = await supabase.from('loan_emi_schedule').insert(insertRows)
        if (error) return actionError(error.message)
      }
    }
    updateTag('dashboard')
    revalidatePath('/admin/loans')
    revalidatePath('/admin/reference')
    return actionOk(undefined, 'Prepayment applied')
  })
}

/** Recalculate the schedule using the live reference rate (admin-triggered). */
export async function recalculateSchedule(formData: FormData): Promise<ActionResult> {
  return runAction('recalculateSchedule', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')
    const loanId = String(formData.get('loan_id') ?? '')
    if (!loanId) return actionError('Loan is required')

    const supabase = await createClient()
    // Guard: recalculation rebuilds the whole schedule from the original principal,
    // so it is only safe before any EMI payment exists. After payments, use prepayment.
    const { count: paidCount } = await supabase
      .from('loan_emi_schedule')
      .select('id', { count: 'exact', head: true })
      .eq('loan_id', loanId)
      .in('status', ['paid', 'partially_paid'])
    if ((paidCount ?? 0) > 0) {
      return actionError(
        'Cannot recalculate after EMIs have been paid; use prepayment to re-shape the schedule',
      )
    }
    const { data: loan } = await supabase
      .from('loans')
      .select('principal_amount, start_date, interest_waiver_months, term_months')
      .eq('id', loanId)
      .single()
    if (!loan?.term_months) return actionError('Loan has no term')
    const ratePct = await getReference('loan_interest_rate_pct').catch(() => 8)
    const { error } = await supabase.rpc('fn_generate_emi_schedule', {
      p_loan_id: loanId,
      p_principal: loan.principal_amount,
      p_start: loan.start_date,
      p_term: loan.term_months,
      p_waiver_months: loan.interest_waiver_months,
      p_rate_pct: ratePct,
    })
    if (error) return actionError(error.message)

    // Apply any due late fees now (the scheduled job runs on the 11th; this lets
    // an admin surface them on demand). Idempotent via the late_fee_charged guard,
    // and the generator above preserves existing fees, so no double-charging.
    const { error: feeErr } = await supabase.rpc('fn_apply_emi_late_fees')
    if (feeErr) console.error('fn_apply_emi_late_fees failed during recalculate:', feeErr.message)

    updateTag('dashboard')
    revalidatePath('/admin/loans')
    revalidatePath('/admin/reference')
    return actionOk(undefined, 'Schedule recalculated at current rate')
  })
}

/** Convert a legacy accrual loan to EMI from the cutover date over a chosen term. */
export async function convertToEmi(formData: FormData): Promise<ActionResult> {
  return runAction('convertToEmi', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')
    const loanId = String(formData.get('loan_id') ?? '')
    const termMonths = Number(formData.get('term_months'))
    if (!loanId || !Number.isInteger(termMonths) || termMonths < 1) {
      return actionError('Loan and a valid term are required', 'term_months')
    }
    const supabase = await createClient()
    // Current outstanding principal from the legacy balances view.
    const { data: lb } = await supabase
      .from('loans_balances')
      .select('pending_principal')
      .eq('loan_id', loanId)
      .single()
    if (!lb) return actionError('Loan not found')
    // emi_cutover_date is stored as a YYYYMMDD integer (reference.value is numeric).
    const cutoverYmd = await getReference('emi_cutover_date')
    const cutover = `${String(cutoverYmd).slice(0, 4)}-${String(cutoverYmd).slice(4, 6)}-${String(cutoverYmd).slice(6, 8)}`
    const ratePct = await getReference('loan_interest_rate_pct').catch(() => 8)

    // NOTE (spec §10): legacy accrued interest is PRESERVED — do NOT waive or roll it.
    // The member keeps paying pre-cutoff loan_interest_accruals one-by-one via payLoanInterest.
    // The EMI schedule covers ONLY the outstanding principal, dated from the cutoff. The accrual
    // cron skips repayment_model='emi' loans (see migration 039 patch), so there is no double-count.
    const { error } = await supabase.rpc('fn_generate_emi_schedule', {
      p_loan_id: loanId,
      p_principal: Number(lb.pending_principal),
      p_start: cutover,
      p_term: termMonths,
      p_waiver_months: 0,
      p_rate_pct: ratePct,
    })
    if (error) return actionError(error.message)
    updateTag('dashboard')
    revalidatePath('/admin/loans')
    return actionOk(undefined, 'Converted to EMI')
  })
}
