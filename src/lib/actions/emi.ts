'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'
import { getReference, applyBalanceDelta } from './reference'
import { actionError, actionOk, runAction, type ActionResult } from './action-result'
import { recomputeAfterPrepayment, prepaymentAnchorDate } from '@/lib/emi-math'
import {
  planPrepayment,
  prepayPlanErrorMessage,
  type PrepayScheduleRow,
} from '@/lib/prepay-plan'
import {
  cutoverYmdToIso,
  isCutoverFloored,
  detectAnchorDrift,
  type AnchorDrift,
} from '@/lib/emi-anchor'
import {
  planEmiRecompute,
  emiRecomputeErrorMessage,
  type EmiRecomputePlan,
  type RecomputeScheduleRow,
} from '@/lib/emi-recompute'

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

/**
 * Prepay extra principal; rebuild the not-yet-due installments by tenure or EMI
 * reduction.
 *
 * `planPrepayment` decides what the advance may touch: it reduces future
 * principal only, while partially-paid and already-due installments keep their
 * own rows and are settled through `payEmi`. See `@/lib/prepay-plan`.
 *
 * Every write goes through `fn_apply_prepayment` (migration 052) so the
 * transaction, the bank credit and the schedule rebuild land together or not at
 * all — a part-applied prepayment used to leave booked money that a retry
 * duplicated.
 */
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
    // Fingerprint of the plan the admin actually reviewed, if it came from the
    // confirmation screen.
    const reviewedFingerprint = (formData.get('plan_fingerprint') as string | null) ?? null
    if (!loanId || !(amount > 0) || !paidDate || !['reduce_tenure', 'reduce_emi'].includes(mode)) {
      return actionError('Invalid prepayment input')
    }

    const supabase = await createClient()
    const { data: bal } = await supabase
      .from('loan_emi_balances')
      .select('interest_rate_pct, emi_amount')
      .eq('loan_id', loanId)
      .single()
    if (!bal) return actionError('Loan not on EMI model')

    const { data: scheduleRows, error: schedErr } = await supabase
      .from('loan_emi_schedule')
      .select(
        'id, installment_no, due_date, status, principal_due, principal_paid, interest_due, interest_paid, late_fee_charged, late_fee_waived',
      )
      .eq('loan_id', loanId)
    if (schedErr) return actionError(schedErr.message)

    const plan = planPrepayment({
      rows: (scheduleRows ?? []) as PrepayScheduleRow[],
      amount,
      paidDate,
    })
    if (plan.error) return actionError(prepayPlanErrorMessage(plan))

    // The confirmation screen plans against the page-load snapshot; the cron or
    // another admin can move the schedule before Confirm is pressed. Refuse
    // rather than apply numbers nobody approved.
    if (reviewedFingerprint && reviewedFingerprint !== plan.fingerprint) {
      return actionError(
        'The schedule changed while you were reviewing this prepayment. Reload the page and try again.',
      )
    }

    // Resume at the earliest not-yet-due date, but never at a date already gone
    // by on the payment date — see `prepaymentAnchorDate`.
    const tail = plan.fullPayoff
      ? []
      : recomputeAfterPrepayment({
          outstanding: plan.tailPrincipal,
          annualRatePct: Number(bal.interest_rate_pct),
          remainingTerm: Math.max(plan.remainingTerm, 1),
          currentEmi: Number(bal.emi_amount),
          firstDueDate: prepaymentAnchorDate(paidDate, plan.earliestUnpaidDueDate),
          mode,
        })

    const newRows = tail.map((r, idx) => ({
      installment_no: plan.nextInstallmentNo + idx,
      due_date: r.dueDate,
      opening_balance: r.openingBalance,
      emi_amount: r.emiAmount,
      principal_due: r.principalDue,
      interest_due: r.interestDue,
      closing_balance: r.closingBalance,
      // Unwaived fees from the dropped rows ride on the first new installment.
      // `late_fee_txn_id` stays null — it is a single FK and the carried total
      // may span several penalty transactions, which remain in `transactions`
      // as the audit trail.
      late_fee_charged: idx === 0 ? plan.carriedLateFee : 0,
    }))

    const { error: rpcErr } = await supabase.rpc('fn_apply_prepayment', {
      p_loan_id: loanId,
      p_member_id: memberId || null,
      p_amount: amount,
      p_paid_date: paidDate,
      p_description: `Advance principal (${mode})`,
      p_bank_txn_id: bankTransactionId,
      p_created_by: user.id,
      p_apply_balance: applyToBankBalance,
      // A payoff completes the principal on every surviving installment; short
      // of that they are left exactly as they are.
      p_settle_ids: plan.fullPayoff ? plan.retained.map((r) => r.scheduleId) : [],
      p_delete_ids: plan.replacedIds,
      p_new_rows: newRows,
      // Keep loans.emi_amount in step with the schedule, or a later prepayment
      // re-amortizes at the stale original EMI and pushes the member's
      // installment back up.
      p_new_emi: newRows.length > 0 ? newRows[0].emi_amount : null,
      p_close_loan: plan.fullPayoff,
    })
    if (rpcErr) return actionError(rpcErr.message)

    updateTag('dashboard')
    revalidatePath('/admin/loans')
    revalidatePath('/admin/reference')
    revalidatePath('/admin/transactions')
    return actionOk(
      undefined,
      plan.fullPayoff ? 'Prepayment applied; loan closed' : 'Prepayment applied',
    )
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

    // A loan that predates the cutover was CONVERTED to EMI, so its schedule
    // amortizes what is still outstanding — passing principal_amount here was
    // the second half of the back-dating incident (migration 051): it rebuilt
    // the schedule against the full amount originally lent, ignoring every
    // repayment made under the accrual model. The generator floors the START
    // date itself; only the principal is the caller's job.
    const cutoverIso = cutoverYmdToIso(await getReference('emi_cutover_date').catch(() => 0))
    let principal = Number(loan.principal_amount)
    if (isCutoverFloored(loan.start_date, cutoverIso)) {
      const { data: lb } = await supabase
        .from('loans_balances')
        .select('pending_principal')
        .eq('loan_id', loanId)
        .single()
      if (!lb) return actionError('Cannot read outstanding principal for this loan')
      principal = Number(lb.pending_principal)
    }
    if (!(principal > 0)) return actionError('Loan has no outstanding principal to schedule')

    const { error } = await supabase.rpc('fn_generate_emi_schedule', {
      p_loan_id: loanId,
      p_principal: principal,
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

const RECOMPUTE_COLUMNS =
  'id, installment_no, due_date, status, opening_balance, emi_amount, principal_due, interest_due, closing_balance, principal_paid, interest_paid'

/** Today in IST — the already-due cutoff, resolved server-side. */
function todayIst(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/**
 * Read everything `planEmiRecompute` needs. The rate is NOT defaulted: this
 * feeds a write path, and committing a guessed rate to the ledger would be
 * worse than refusing (AGENTS.md — never hardcode a reference value).
 */
async function loadRecomputeInputs(loanId: string) {
  const supabase = await createClient()
  const [scheduleRes, loanRes, newRatePct, cutoverYmd] = await Promise.all([
    supabase.from('loan_emi_schedule').select(RECOMPUTE_COLUMNS).eq('loan_id', loanId),
    supabase
      .from('loans')
      .select('interest_rate_pct, start_date, interest_waiver_months')
      .eq('id', loanId)
      .maybeSingle(),
    getReference('loan_interest_rate_pct').then(Number),
    getReference('emi_cutover_date').catch(() => 0),
  ])
  if (scheduleRes.error) throw new Error(scheduleRes.error.message)
  const rows = (scheduleRes.data ?? []) as RecomputeScheduleRow[]
  const loan = loanRes.data as
    | { interest_rate_pct: number | null; start_date: string; interest_waiver_months: number | null }
    | null
  // Re-pricing never moves a due date, so a schedule built against the wrong
  // anchor would otherwise report "no changes" forever. Surface it instead.
  const anchor = loan
    ? detectAnchorDrift({
        dueDates: rows.map((r) => r.due_date),
        startDateIso: loan.start_date,
        waiverMonths: Number(loan.interest_waiver_months ?? 0),
        cutoverIso: cutoverYmdToIso(Number(cutoverYmd)),
      })
    : null
  return {
    supabase,
    rows,
    oldRatePct: loan?.interest_rate_pct,
    newRatePct,
    anchor,
  }
}

/**
 * What re-pricing this loan at the current reference rate would do — read-only,
 * for the confirmation screen. Returns `hasChanges: false` when the schedule is
 * already priced correctly.
 */
export async function getEmiRecomputePreview(
  loanId: string,
): Promise<EmiRecomputePlan & { anchor: AnchorDrift | null }> {
  const { rows, oldRatePct, newRatePct, anchor } = await loadRecomputeInputs(loanId)
  return {
    ...planEmiRecompute({ rows, oldRatePct, newRatePct, todayIso: todayIst() }),
    anchor,
  }
}

/**
 * Apply that re-pricing. Only unpaid installments are rewritten, in place, so a
 * paid one can never be modified — `fn_reprice_emi_schedule` (migration 053)
 * enforces that in SQL as well as here.
 */
export async function recomputeEmiSchedule(formData: FormData): Promise<ActionResult> {
  return runAction('recomputeEmiSchedule', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') return actionError('Unauthorized')

    const loanId = String(formData.get('loan_id') ?? '')
    if (!loanId) return actionError('Loan is required')
    // Required, not optional: without it there is no concurrency guard at all,
    // which is the one thing it exists to provide.
    const reviewedFingerprint = (formData.get('plan_fingerprint') as string | null)?.trim()
    if (!reviewedFingerprint) return actionError('Missing the reviewed plan; reload and try again')

    const { supabase, rows, oldRatePct, newRatePct } = await loadRecomputeInputs(loanId)
    const plan = planEmiRecompute({ rows, oldRatePct, newRatePct, todayIso: todayIst() })
    if (plan.error) return actionError(emiRecomputeErrorMessage(plan))

    // Re-planned against a fresh read. The fingerprint carries both rates, so
    // this also catches the rate itself moving under an open preview.
    if (reviewedFingerprint !== plan.fingerprint) {
      return actionError(
        'This changed while you were reviewing it — the schedule or the interest rate has moved. Reload the page and try again.',
      )
    }
    if (!plan.hasChanges) return actionOk(undefined, 'No changes to apply')

    const { error: rpcErr } = await supabase.rpc('fn_reprice_emi_schedule', {
      p_loan_id: loanId,
      p_rows: plan.changed.map((r) => ({
        id: r.scheduleId,
        emi_amount: r.after.emiAmount,
        interest_due: r.after.interestDue,
      })),
      // All-or-nothing: the function raises, and rolls back, if it matches fewer
      // rows than this — otherwise a row paid in the meantime would be skipped
      // silently and the schedule would mix old and new rates.
      p_expect: plan.changed.length,
      p_new_rate: newRatePct,
    })
    if (rpcErr) return actionError(rpcErr.message)

    updateTag('dashboard')
    revalidatePath('/admin/loans')
    return actionOk(
      undefined,
      `${plan.changed.length} installment${plan.changed.length === 1 ? '' : 's'} re-priced`,
    )
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
    const cutover = cutoverYmdToIso(await getReference('emi_cutover_date'))
    if (!cutover) return actionError('emi_cutover_date is not configured')
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
