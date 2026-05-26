'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { runAction, actionOk, actionError } from '@/lib/actions/action-result'
import type { ActionResult } from '@/lib/actions/action-result'
import { getCurrentUser } from '@/lib/actions/auth'

export type DonationEligibilitySummary = {
  total_earned: number
  total_donated: number
  total_bad_debt: number
  available_now: number
}

export type DonationEligibilityLedgerRow = {
  period_end: string
  contributions_basis: number
  pct_used: number
  threshold_used: number
  corpus_at_period_end: number
  threshold_met: boolean
  amount_earned: number
  donations_in_period: number
  bad_debts_in_period: number
  carry_balance: number
}

function toNumber(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) throw new Error(`Eligibility value is not numeric: ${String(raw)}`)
  return n
}

type RawSummary = {
  total_earned: number | string
  total_donated: number | string
  total_bad_debt: number | string
  available_now: number | string
}

type RawLedgerRow = {
  period_end: string
  contributions_basis: number | string
  pct_used: number | string
  threshold_used: number | string
  corpus_at_period_end: number | string
  threshold_met: boolean
  amount_earned: number | string
  donations_in_period: number | string
  bad_debts_in_period: number | string
  carry_balance: number | string
}

export async function getDonationEligibilitySummary(): Promise<DonationEligibilitySummary> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('donation_eligibility_summary')
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  const row = data as RawSummary
  return {
    total_earned: toNumber(row.total_earned),
    total_donated: toNumber(row.total_donated),
    total_bad_debt: toNumber(row.total_bad_debt),
    available_now: toNumber(row.available_now),
  }
}

export async function getDonationEligibilityLedger(): Promise<DonationEligibilityLedgerRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('donation_eligibility_ledger')
    .select('*')
    .order('period_end', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as RawLedgerRow[]).map((r) => ({
    period_end: r.period_end,
    contributions_basis: toNumber(r.contributions_basis),
    pct_used: toNumber(r.pct_used),
    threshold_used: toNumber(r.threshold_used),
    corpus_at_period_end: toNumber(r.corpus_at_period_end),
    threshold_met: r.threshold_met,
    amount_earned: toNumber(r.amount_earned),
    donations_in_period: toNumber(r.donations_in_period),
    bad_debts_in_period: toNumber(r.bad_debts_in_period),
    carry_balance: toNumber(r.carry_balance),
  }))
}

/** Recompute eligibility for one period (EOM date) or backfill the full history.
 *  @param fromDate Optional EOM date in YYYY-MM-DD. If omitted, the full backfill runs. */
export async function recomputeDonationEligibility(
  fromDate?: string,
): Promise<ActionResult<{ rows: number }>> {
  return runAction('recomputeDonationEligibility', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') {
      return actionError('Unauthorized')
    }
    const supabase = await createClient()
    if (fromDate) {
      // Recompute a single month
      const { error } = await supabase.rpc('fn_compute_eligibility_for', {
        p_period_end: fromDate,
      })
      if (error) return actionError(error.message)
      revalidatePath('/dashboard')
      updateTag('dashboard')
      return actionOk({ rows: 1 }, 'Recomputed 1 period')
    }
    const { data, error } = await supabase.rpc('fn_backfill_donation_eligibility')
    if (error) return actionError(error.message)
    const rows = toNumber(data)
    revalidatePath('/dashboard')
    updateTag('dashboard')
    return actionOk({ rows }, `Recomputed ${rows} periods`)
  })
}
