'use server'

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

export async function getDonationEligibilitySummary(): Promise<DonationEligibilitySummary> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('donation_eligibility_summary')
    .select('*')
    .single()
  if (error) throw error
  return data as DonationEligibilitySummary
}

export async function getDonationEligibilityLedger(): Promise<DonationEligibilityLedgerRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('donation_eligibility_ledger')
    .select('*')
    .order('period_end', { ascending: false })
  if (error) throw error
  return (data ?? []) as DonationEligibilityLedgerRow[]
}

export async function recomputeDonationEligibility(
  fromDate?: string,
): Promise<ActionResult<{ rows: number }>> {
  return runAction('recomputeDonationEligibility', async () => {
    const user = await getCurrentUser()
    if (!user || user.profile?.role !== 'admin') {
      return actionError('Admin access required')
    }
    const supabase = await createClient()
    if (fromDate) {
      // Recompute a single month
      const { error } = await supabase.rpc('fn_compute_eligibility_for', {
        p_period_end: fromDate,
      })
      if (error) return actionError(error.message)
      return actionOk({ rows: 1 }, 'Recomputed 1 period')
    }
    const { data, error } = await supabase.rpc('fn_backfill_donation_eligibility')
    if (error) return actionError(error.message)
    return actionOk({ rows: data as number }, `Recomputed ${data} periods`)
  })
}
