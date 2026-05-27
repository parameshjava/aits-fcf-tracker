'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from './auth'
import { getReference, applyBalanceDelta } from './reference'
import {
  LOAN_DISBURSEMENT_DEFAULT,
  type BalanceDirection,
} from '@/lib/balance-direction'
import { computeLoanFinancials, type LoanFinancials } from '@/lib/loan-math'
import {
  actionError,
  actionOk,
  runAction,
  type ActionResult,
} from './action-result'
import type { LoanInterestAccrual } from './loan-interest'
import type { LoanTimelineRow } from './loan-timeline'
import {
  buildLoanTimeline,
  type AccrualPayment,
} from './loan-timeline'
import {
  MAX_INTEREST_WAIVER_MONTHS,
  type LoanType,
} from '@/lib/loan-type'

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
  accruals: LoanInterestAccrual[]
  timeline: LoanTimelineRow[]
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
  /** Personal (no waiver) or Medical (admin may waive up to 12 months). */
  loan_type: LoanType
  bad_debt: number
  /** Months from start_date during which no interest accrues. 0 = none. */
  interest_waiver_months: number
  /** Interest forgiven at closure (write_off path). */
  interest_waived: number
  notes: string | null
  /** Optional link to the approval poll that authorised this loan.
   *  Historical loans pre-date the polls feature and will be null. */
  poll_id: string | null
  created_at: string
  member: { id: string; name: string; slug: string } | null
  /** Embedded poll summary for display next to the loan. Null when
   *  `poll_id` is null OR the referenced poll was deleted. */
  poll: { id: string; question: string } | null
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

/** Count of loans with a write-off (status `write_off`, `bad_debt > 0`).
 *  Used alongside donation counts on the donations section so the
 *  "Total Donations" tile reflects every charitable outflow — both
 *  voluntary donations and effective donations via loan write-offs. */
export async function getWriteOffLoanCount(): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('loans')
    .select('id', { count: 'exact', head: true })
    .gt('bad_debt', 0)
    .not('end_date', 'is', null)
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** Map of `pending_interest` from `loans_balances` for the given loan ids.
 *  Sourced from `loan_interest_accruals` (the cron-maintained authoritative
 *  ledger), not from the on-the-fly `interest_per_lakh × months` math in
 *  `computeLoanFinancials`. Use this anywhere "interest due" needs to match
 *  what the Pending-interest panel shows. */
export async function getPendingInterestByLoan(
  loanIds: string[],
): Promise<Map<string, number>> {
  if (loanIds.length === 0) return new Map()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('loans_balances')
    .select('loan_id, pending_interest')
    .in('loan_id', loanIds)
  if (error) throw new Error(error.message)
  const out = new Map<string, number>()
  for (const r of (data ?? []) as { loan_id: string; pending_interest: number | string | null }[]) {
    out.set(r.loan_id, Number(r.pending_interest) || 0)
  }
  return out
}

/** Sum of `pending_principal` across all loans (from the `loans_balances`
 *  view). Used by the dashboard "Available balance" KPI = bank balance +
 *  outstanding loan principal. */
export async function getTotalPendingPrincipal(): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('loans_balances')
    .select('pending_principal')
  if (error) throw new Error(error.message)
  let total = 0
  for (const r of (data ?? []) as { pending_principal: number | string | null }[]) {
    total += Number(r.pending_principal || 0)
  }
  return total
}

const LOAN_ROW_SELECT =
  '*, member:member_id (id, name, slug), poll:poll_id (id, question)'

/** True when the supplied Supabase/Postgres error is the unique-violation
 *  raised by the `loans_poll_id_unique` partial index (one loan per poll).
 *  Used by createLoan/updateLoan to surface a friendly inline error
 *  instead of the raw 23505 message. */
function isPollAlreadyLinkedError(err: {
  code?: string | null
  message?: string | null
}): boolean {
  return (
    err.code === '23505' &&
    typeof err.message === 'string' &&
    err.message.includes('loans_poll_id_unique')
  )
}

export type LoanPollPickerOption = {
  id: string
  question: string
  status: 'open' | 'closed'
  closes_at: string
}

/** Minimal poll list for the loan-form picker. Returns the 50 most recent
 *  polls, ordered by created_at desc, excluding any poll already linked
 *  to a different loan (the loan ↔ poll relationship is 1:1).
 *
 *  Pass `excludeLoanId` from the edit form so the loan's own current
 *  poll stays selectable; omit it on the new-loan form. */
export async function getPollsForLoanPicker(
  opts?: { excludeLoanId?: string },
): Promise<LoanPollPickerOption[]> {
  const supabase = await createClient()
  const [pollsRes, linkedRes] = await Promise.all([
    supabase
      .from('polls')
      .select('id, question, status, closes_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('loans')
      .select('id, poll_id')
      .not('poll_id', 'is', null),
  ])
  if (pollsRes.error) throw new Error(pollsRes.error.message)
  if (linkedRes.error) throw new Error(linkedRes.error.message)

  const excludedPollIds = new Set<string>()
  for (const r of (linkedRes.data ?? []) as { id: string; poll_id: string | null }[]) {
    if (!r.poll_id) continue
    if (opts?.excludeLoanId && r.id === opts.excludeLoanId) continue
    excludedPollIds.add(r.poll_id)
  }

  return ((pollsRes.data ?? []) as LoanPollPickerOption[])
    .filter((p) => !excludedPollIds.has(p.id))
    .map((p) => ({
      id: p.id,
      question: p.question,
      status: p.status,
      closes_at: p.closes_at,
    }))
}

export type LinkedPollDetail = {
  id: string
  question: string
  description: string | null
  kind: 'single' | 'multi'
  visibility: 'sensitive' | 'public'
  status: 'open' | 'closed'
  is_closed: boolean
  closes_at: string
  closed_at: string | null
  options: { id: string; label: string; vote_count: number; voter_names: string[] | null }[]
  total_voters: number
  other_responses: { text: string; author: string | null }[]
}

/** Fetches the full poll detail + results for the modal opened from a
 *  loan's Terms grid. Pulled on demand by the client modal (server action)
 *  so the panel itself stays cheap. Returns null when the poll has been
 *  deleted between page render and click. */
export async function getLinkedPollDetail(
  pollId: string,
): Promise<LinkedPollDetail | null> {
  if (!pollId) return null
  const { getPoll, getPollResults } = await import('@/lib/queries/polls')
  const [poll, results] = await Promise.all([getPoll(pollId), getPollResults(pollId)])
  if (!poll) return null
  const byOptionId = new Map(
    (results?.options ?? []).map((o) => [o.option_id, o]),
  )
  return {
    id: poll.id,
    question: poll.question,
    description: poll.description,
    kind: poll.kind,
    visibility: poll.visibility,
    status: poll.status,
    is_closed: poll.is_closed,
    closes_at: poll.closes_at,
    closed_at: poll.closed_at,
    options: poll.options.map((o) => {
      const r = byOptionId.get(o.id)
      return {
        id: o.id,
        label: o.label,
        vote_count: r?.vote_count ?? 0,
        voter_names: r?.voter_names ?? null,
      }
    }),
    total_voters: results?.total_voters ?? 0,
    other_responses: (results?.other_responses ?? []).map((r) => ({
      text: r.text,
      author: r.author,
    })),
  }
}

export async function getLoans(): Promise<LoanRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('loans')
    .select(LOAN_ROW_SELECT)
    .order('loan_number', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as LoanRow[]
}

export async function getLoanByNumber(loanNumber: string): Promise<LoanRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('loans')
    .select(LOAN_ROW_SELECT)
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
  const [loanRes, txnRes, accrualRes, paymentRes, interestPerLakh] = await Promise.all([
    supabase
      .from('loans')
      .select(LOAN_ROW_SELECT)
      .eq('id', loanId)
      .maybeSingle(),
    supabase
      .from('transactions')
      .select('id, transaction_date, transaction_id, transaction_type, interest_source, amount, description')
      .eq('loan_id', loanId)
      .order('transaction_date', { ascending: true }),
    supabase
      .from('loan_interest_accruals')
      .select('*')
      .eq('loan_id', loanId)
      .order('period_end', { ascending: true }),
    // Fetch only the junction rows whose accrual belongs to THIS loan.
    // The embedded `accrual` selector forces the join + filter; we then
    // discard it client-side because we only need accrual_id + transaction_id
    // + the allocation amount (amount_applied).
    supabase
      .from('loan_interest_payments')
      .select('accrual_id, transaction_id, amount_applied, accrual:accrual_id!inner(loan_id)')
      .eq('accrual.loan_id', loanId),
    getInterestPerLakh(),
  ])
  if (loanRes.error) throw new Error(loanRes.error.message)
  if (!loanRes.data) return null
  if (txnRes.error) throw new Error(txnRes.error.message)
  if (accrualRes.error) throw new Error(accrualRes.error.message)
  if (paymentRes.error) throw new Error(paymentRes.error.message)

  const loan = loanRes.data as LoanRow
  const transactions = (txnRes.data ?? []) as LoanDetailTxn[]

  type RawAccrual = {
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
  const accruals: LoanInterestAccrual[] = ((accrualRes.data ?? []) as RawAccrual[]).map((r) => ({
    id: r.id,
    loan_id: r.loan_id,
    period_end: r.period_end,
    amount_due: Number(r.amount_due),
    paid_amount: Number(r.paid_amount),
    status: r.status,
    interest_rate_used: Number(r.interest_rate_used),
    balance_basis: Number(r.balance_basis),
    is_opening_balance: r.is_opening_balance,
    waiver_reason: r.waiver_reason,
    paid_at: r.paid_at,
    created_at: r.created_at,
  }))

  type RawPayment = {
    accrual_id: string
    transaction_id: string
    amount_applied: number | string | null
  }
  const payments: AccrualPayment[] = ((paymentRes.data ?? []) as RawPayment[]).map((p) => ({
    accrualId: p.accrual_id,
    transactionId: p.transaction_id,
    amount: Number(p.amount_applied) || 0,
  }))

  const txnShortIdByUuid = new Map<string, string>(
    transactions.map((t) => [t.id, t.transaction_id]),
  )

  const timeline = buildLoanTimeline(accruals, transactions, payments, txnShortIdByUuid)
  const baseFinancials = computeLoanFinancials(loan, transactions, interestPerLakh)

  // The accrual ledger (loan_interest_accruals, populated by the EOM cron) is
  // the authoritative source for "interest due" — not the on-the-fly
  // `months_elapsed × interest_per_lakh − paid` math. Override interestDue so
  // the detail page agrees with the Pending-interest panel.
  const pendingFromAccruals = accruals
    .filter((a) => a.status === 'pending' || a.status === 'partially_paid')
    .reduce((s, a) => s + Math.max(a.amount_due - a.paid_amount, 0), 0)
  const financials: LoanFinancials = {
    ...baseFinancials,
    interestDue: baseFinancials.isClosed ? 0 : pendingFromAccruals,
  }
  return { loan, transactions, accruals, timeline, interestPerLakh, financials }
}

export async function createLoan(
  formData: FormData,
): Promise<ActionResult<{ balanceUpdateFailed: boolean }>> {
  return runAction('createLoan', async () => {
    const supabase = await createClient()
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') {
      return actionError('Unauthorized')
    }

    const memberId = (formData.get('member_id') as string) || null
    const principal = parseFloat(formData.get('principal_amount') as string)
    const startDate = formData.get('start_date') as string
    const notes = ((formData.get('notes') as string) || '').trim() || null
    const loanTypeRaw = ((formData.get('loan_type') as string | null) ?? '').trim()
    const loanType: LoanType = loanTypeRaw === 'medical' ? 'medical' : 'personal'
    const waiverRaw = (formData.get('interest_waiver_months') as string | null)?.trim() || ''
    const interestWaiverMonths = waiverRaw === '' ? 0 : Math.floor(Number(waiverRaw))
    const pollId = ((formData.get('poll_id') as string | null) ?? '').trim() || null

    if (!memberId) return actionError('Member is required', 'member_id')
    if (!Number.isFinite(principal) || principal <= 0) {
      return actionError('Principal must be a positive number', 'principal_amount')
    }
    if (!startDate) return actionError('Start date is required', 'start_date')
    if (loanTypeRaw && loanTypeRaw !== 'personal' && loanTypeRaw !== 'medical') {
      return actionError('Loan type must be Personal or Medical', 'loan_type')
    }
    if (!Number.isFinite(interestWaiverMonths) || interestWaiverMonths < 0) {
      return actionError(
        'Interest waiver months must be 0 or a positive integer',
        'interest_waiver_months',
      )
    }
    if (interestWaiverMonths > MAX_INTEREST_WAIVER_MONTHS) {
      return actionError(
        `Interest waiver caps at ${MAX_INTEREST_WAIVER_MONTHS} months`,
        'interest_waiver_months',
      )
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
      loan_type: loanType,
      bad_debt: 0,
      interest_waiver_months: interestWaiverMonths,
      notes,
      poll_id: pollId,
    })

    if (error) {
      if (isPollAlreadyLinkedError(error)) {
        return actionError(
          'That poll is already attached to another loan.',
          'poll_id',
        )
      }
      return actionError(error.message)
    }

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
      if (!result.ok) {
        console.error('applyBalanceDelta failed for createLoan:', result.error)
        balanceUpdateFailed = true
      }
    }

    revalidatePath('/dashboard/loans')
    revalidatePath('/admin/loans')
    revalidatePath('/dashboard')
    revalidatePath('/admin/reference')
    updateTag('dashboard')
    return actionOk({ balanceUpdateFailed }, 'Loan created')
  })
}

export async function updateLoan(formData: FormData): Promise<ActionResult> {
  return runAction('updateLoan', async () => {
    const supabase = await createClient()
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') {
      return actionError('Unauthorized')
    }

    const loanId = formData.get('loan_id') as string
    if (!loanId) return actionError('Loan is required')

    const principalRaw = (formData.get('principal_amount') as string) ?? ''
    const startDate = (formData.get('start_date') as string) || null
    const notesRaw = (formData.get('notes') as string) ?? ''
    const waiverRaw = (formData.get('interest_waiver_months') as string) ?? ''
    const loanTypeRaw = ((formData.get('loan_type') as string | null) ?? '').trim()

    const principal = parseFloat(principalRaw)
    const waiverMonthsInput = waiverRaw === '' ? null : Math.floor(Number(waiverRaw))

    if (principalRaw && (!Number.isFinite(principal) || principal <= 0)) {
      return actionError('Principal must be a positive number', 'principal_amount')
    }
    if (waiverMonthsInput != null && (!Number.isFinite(waiverMonthsInput) || waiverMonthsInput < 0)) {
      return actionError(
        'Interest waiver months must be 0 or a positive integer',
        'interest_waiver_months',
      )
    }
    if (loanTypeRaw && loanTypeRaw !== 'personal' && loanTypeRaw !== 'medical') {
      return actionError('Loan type must be Personal or Medical', 'loan_type')
    }
    if (waiverMonthsInput != null && waiverMonthsInput > MAX_INTEREST_WAIVER_MONTHS) {
      return actionError(
        `Interest waiver caps at ${MAX_INTEREST_WAIVER_MONTHS} months`,
        'interest_waiver_months',
      )
    }

    const patch: Record<string, unknown> = {
      notes: notesRaw.trim() || null,
    }
    if (principalRaw) patch.principal_amount = principal
    if (startDate)    patch.start_date = startDate
    if (loanTypeRaw)  patch.loan_type = loanTypeRaw as LoanType
    if (waiverMonthsInput != null) patch.interest_waiver_months = waiverMonthsInput

    // poll_id is only updated when the form posts the field. An empty
    // string explicitly clears the link; otherwise we set it to the new
    // poll UUID. Forms that don't render the picker simply omit the
    // field and the existing link is preserved.
    if (formData.has('poll_id')) {
      const pollIdRaw = ((formData.get('poll_id') as string | null) ?? '').trim()
      patch.poll_id = pollIdRaw === '' ? null : pollIdRaw
    }

    const { error } = await supabase.from('loans').update(patch).eq('id', loanId)
    if (error) {
      if (isPollAlreadyLinkedError(error)) {
        return actionError(
          'That poll is already attached to another loan.',
          'poll_id',
        )
      }
      return actionError(error.message)
    }

    revalidatePath('/dashboard/loans')
    revalidatePath(`/dashboard/loans/[loan_number]`, 'page')
    updateTag('dashboard')
    return actionOk(undefined, 'Loan updated')
  })
}

export async function closeLoan(formData: FormData): Promise<ActionResult> {
  return runAction('closeLoan', async () => {
    const supabase = await createClient()
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') {
      return actionError('Unauthorized')
    }

    const loanId = formData.get('loan_id') as string
    const endDate = formData.get('end_date') as string
    const finalStatus = formData.get('status') as 'paid' | 'write_off'
    const badDebt = parseFloat((formData.get('bad_debt') as string) || '0') || 0
    const interestWaived =
      parseFloat((formData.get('interest_waived') as string) || '0') || 0

    if (!loanId) return actionError('Loan is required')
    if (!endDate) return actionError('End date is required', 'end_date')
    if (finalStatus !== 'paid' && finalStatus !== 'write_off') {
      return actionError('Final status must be Paid or Write off', 'status')
    }
    if (badDebt < 0) return actionError('Principal write-off must be ≥ 0', 'bad_debt')
    if (interestWaived < 0) return actionError('Interest waived must be ≥ 0', 'interest_waived')

    // Re-fetch + recompute server-side so a stale client form can't bypass
    // the "paid means fully settled" rule. Also gives us up-to-date values
    // to use as the default write-off amounts.
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
      return actionError(loanRes.error?.message ?? 'Loan not found')
    }
    const liveLoan = loanRes.data as Parameters<typeof computeLoanFinancials>[0]
    const txns = (txnRes.data ?? []) as Parameters<typeof computeLoanFinancials>[1]
    const financials: LoanFinancials = computeLoanFinancials(liveLoan, txns, interestPerLakh)

    if (finalStatus === 'paid') {
      if (financials.balance > 0 || financials.interestDue > 0) {
        const parts: string[] = []
        if (financials.balance > 0) parts.push(`₹${financials.balance.toFixed(2)} principal`)
        if (financials.interestDue > 0) parts.push(`₹${financials.interestDue.toFixed(2)} interest`)
        return actionError(
          `Cannot mark as Paid — ${parts.join(' and ')} still pending. ` +
            `Collect the dues or use Write off to waive.`,
        )
      }
      if (badDebt > 0 || interestWaived > 0) {
        return actionError(
          'Paid closures cannot carry a write-off amount. Switch to Write off.',
        )
      }
    } else {
      if (badDebt === 0 && interestWaived === 0) {
        return actionError(
          'Write off requires a principal write-off or interest waived amount.',
        )
      }
      if (badDebt > financials.balance) {
        return actionError(
          `Principal write-off (₹${badDebt}) exceeds pending principal (₹${financials.balance.toFixed(2)}).`,
          'bad_debt',
        )
      }
      if (interestWaived > financials.interestDue) {
        return actionError(
          `Interest waived (₹${interestWaived}) exceeds pending interest (₹${financials.interestDue.toFixed(2)}).`,
          'interest_waived',
        )
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

    if (error) return actionError(error.message)

    // Bank balance is intentionally not adjusted on closure:
    //   - Paid close: every repayment transaction already credited the bank.
    //   - Write-off: the principal was debited at disbursement time, so writing
    //     it off only recognises the loss on the books — it doesn't move cash.
    //     Waived interest was never received, so it never affected the bank.

    revalidatePath('/dashboard/loans')
    revalidatePath(`/dashboard/loans/[loan_number]`, 'page')
    revalidatePath('/dashboard')
    revalidatePath('/admin/reference')
    updateTag('dashboard')
    return actionOk(undefined, 'Loan closed')
  })
}

export async function reopenLoan(loanId: string): Promise<ActionResult> {
  return runAction('reopenLoan', async () => {
    const supabase = await createClient()
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') {
      return actionError('Unauthorized')
    }

    const { error } = await supabase
      .from('loans')
      .update({ end_date: null, status: 'active', bad_debt: 0 })
      .eq('id', loanId)

    if (error) return actionError(error.message)
    revalidatePath('/dashboard/loans')
    revalidatePath(`/dashboard/loans/[loan_number]`, 'page')
    updateTag('dashboard')
    return actionOk(undefined, 'Loan reopened')
  })
}
