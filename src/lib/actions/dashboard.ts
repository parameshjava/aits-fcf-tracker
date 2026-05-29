import { cacheLife, cacheTag } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Dashboard data accessors. All of these read from the dashboard_* views
 * created by scripts/prod/migrations/003_views.sql — never from the raw
 * `transactions` table — so aggregation happens in Postgres, not JS.
 *
 * Every export is cached via `'use cache'` + cacheTag('dashboard'). Write
 * actions in the rest of `@/lib/actions/*` call `updateTag('dashboard')` to
 * invalidate the cache after a mutation. The cache key automatically
 * includes the function arguments, so `getDashboardMonthly(2024)` and
 * `getDashboardMonthly(2025)` are separate entries.
 *
 * Cache lifetime is "hours" — even if a write fails to invalidate the
 * cache, the data refreshes within the hour. For the 22-member traffic
 * profile this trades a small staleness risk for a large response-time win.
 *
 * Why this file is NOT 'use server': `'use cache'` and `'use server'` are
 * mutually exclusive directives. Server Components import these as plain
 * async helpers, so the `'use server'` annotation was never load-bearing
 * here. Mutating actions still live in their `'use server'` files
 * (transactions.ts, loans.ts, etc.).
 *
 * Why these use createAdminClient (NOT createClient): Cache Components
 * forbids reading dynamic data sources (cookies, headers, request) inside
 * a `'use cache'` scope — and `createClient()` calls `await cookies()` to
 * thread the user's session. Since the dashboard data is fund-wide
 * (identical for every authenticated user), we use the secret-key admin
 * client instead. Auth gating still happens in `(app)/layout.tsx` BEFORE
 * these functions run, so anonymous users never see this cached data.
 *
 * Requires `SUPABASE_SECRET_KEY` in env (or legacy `SUPABASE_SERVICE_ROLE_KEY`).
 * See docs/sentry-setup.md / docs/cron-setup.md for the env-var conventions.
 */

export type DashboardOverall = {
  contributions: number
  loan_interest: number
  bank_interest: number
  donations: number
  loan_repayments: number
  penalty: number
}

export type DashboardYearly = DashboardOverall & {
  year: number
}

export type DashboardMonthly = {
  year: number
  month_index: number
  contributions: number
  loan_interest: number
  bank_interest: number
}

export type DashboardMemberTotal = {
  member_name: string
  count: number
  total: number
}

/** One row per (year, member) with each calendar month's contribution sum. */
export type DashboardMemberMonthRow = {
  year: number
  member_id: string | null
  member_name: string
  jan: number; feb: number; mar: number; apr: number
  may: number; jun: number; jul: number; aug: number
  sep: number; oct: number; nov: number; dec: number
  total: number
}

export type DashboardTxn = {
  id: string
  transaction_id: string
  transaction_date: string
  amount: number
  transaction_type: string
  interest_source: string | null
  description: string | null
  member_id: string | null
  loan_id: string | null
  created_at: string
  member_name: string | null
  member_slug: string | null
  bank_transaction_id: string | null
}

/** One-row dashboard tile data sourced from `donation_eligibility_summary`. */
export type DashboardEligibilitySummary = {
  totalEarned: number
  totalDonated: number
  totalBadDebt: number
  availableNow: number
}

/** Per-EOM eligibility ledger row from `donation_eligibility_ledger`. */
export type DashboardEligibilityRow = {
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

function asNum(x: unknown): number {
  return typeof x === 'number' ? x : Number(x ?? 0)
}

export async function getDashboardOverall(): Promise<DashboardOverall> {
  'use cache'
  cacheLife('hours')
  cacheTag('dashboard')

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('dashboard_overall')
    .select('*')
    .maybeSingle()
  if (error) throw new Error(error.message)
  const row = data as Partial<DashboardOverall> | null
  return {
    contributions:   asNum(row?.contributions),
    loan_interest:   asNum(row?.loan_interest),
    bank_interest:   asNum(row?.bank_interest),
    donations:       asNum(row?.donations),
    loan_repayments: asNum(row?.loan_repayments),
    penalty:         asNum(row?.penalty),
  }
}

export async function getDashboardYearly(): Promise<DashboardYearly[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('dashboard')

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('dashboard_yearly')
    .select('*')
    .order('year', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as Partial<DashboardYearly>
    return {
      year:            asNum(row.year),
      contributions:   asNum(row.contributions),
      loan_interest:   asNum(row.loan_interest),
      bank_interest:   asNum(row.bank_interest),
      donations:       asNum(row.donations),
      loan_repayments: asNum(row.loan_repayments),
      penalty:         asNum(row.penalty),
    }
  })
}

export async function getDashboardMonthly(year: number): Promise<DashboardMonthly[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('dashboard')

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('dashboard_monthly')
    .select('*')
    .eq('year', year)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as Partial<DashboardMonthly>
    return {
      year:          asNum(row.year),
      month_index:   asNum(row.month_index),
      contributions: asNum(row.contributions),
      loan_interest: asNum(row.loan_interest),
      bank_interest: asNum(row.bank_interest),
    }
  })
}

export async function getDashboardMemberMonthMatrix(
  year: number,
): Promise<DashboardMemberMonthRow[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('dashboard')

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('dashboard_member_month_matrix')
    .select('*')
    .eq('year', year)
    .order('member_name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as Partial<DashboardMemberMonthRow>
    return {
      year:        asNum(row.year),
      member_id:   (row.member_id as string | null) ?? null,
      member_name: String(row.member_name ?? '—'),
      jan: asNum(row.jan), feb: asNum(row.feb), mar: asNum(row.mar), apr: asNum(row.apr),
      may: asNum(row.may), jun: asNum(row.jun), jul: asNum(row.jul), aug: asNum(row.aug),
      sep: asNum(row.sep), oct: asNum(row.oct), nov: asNum(row.nov), dec: asNum(row.dec),
      total: asNum(row.total),
    }
  })
}

export async function getDashboardMemberTotals(): Promise<DashboardMemberTotal[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('dashboard')

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('dashboard_member_totals')
    .select('*')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as Partial<DashboardMemberTotal>
    return {
      member_name: String(row.member_name ?? '—'),
      count:       asNum(row.count),
      total:       asNum(row.total),
    }
  })
}

/**
 * Returns either the latest N transactions (default 10) or, when both
 * `monthIso` (YYYY-MM) and `series` are provided, every transaction in that
 * month + series — used by the bar-chart drill-down.
 */
export async function getDashboardTransactions(opts?: {
  monthIso?: string | null
  series?: 'contributions' | 'loanInterest' | 'bankInterest' | null
  limit?: number
}): Promise<DashboardTxn[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('dashboard')

  const supabase = createAdminClient()
  let query = supabase
    .from('dashboard_transactions')
    .select('*')
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })

  const monthIso = opts?.monthIso ?? null
  const series   = opts?.series   ?? null

  if (monthIso && series && /^\d{4}-\d{2}$/.test(monthIso)) {
    const [yStr, mStr] = monthIso.split('-')
    const y = Number(yStr)
    const m = Number(mStr)
    // Inclusive first-of-month, exclusive first-of-next-month.
    const start = `${yStr}-${mStr}-01`
    const nextY = m === 12 ? y + 1 : y
    const nextM = m === 12 ? 1 : m + 1
    const end = `${nextY}-${String(nextM).padStart(2, '0')}-01`
    query = query.gte('transaction_date', start).lt('transaction_date', end)

    if (series === 'contributions') {
      query = query.eq('transaction_type', 'contribution')
    } else if (series === 'loanInterest') {
      query = query.eq('transaction_type', 'interest').neq('interest_source', 'bank')
    } else if (series === 'bankInterest') {
      query = query.eq('transaction_type', 'interest').eq('interest_source', 'bank')
    }
  } else {
    query = query.limit(opts?.limit ?? 10)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as DashboardTxn[]
}

/**
 * Donation-eligibility tile data — single row from the
 * `donation_eligibility_summary` view (see migration 012).
 *
 * Pure read; safe to cache with `cacheTag('dashboard')`. Write actions in
 * transactions/loans/eligibility call `updateTag('dashboard')` after a
 * mutation so this refreshes on the next request.
 */
export async function getDashboardEligibilitySummary(): Promise<DashboardEligibilitySummary> {
  'use cache'
  cacheLife('hours')
  cacheTag('dashboard')

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('donation_eligibility_summary')
    .select('*')
    .maybeSingle()
  if (error) throw new Error(error.message)
  const row = (data ?? {}) as Partial<{
    total_earned: number | string
    total_donated: number | string
    total_bad_debt: number | string
    available_now: number | string
  }>
  return {
    totalEarned:  asNum(row.total_earned),
    totalDonated: asNum(row.total_donated),
    totalBadDebt: asNum(row.total_bad_debt),
    availableNow: asNum(row.available_now),
  }
}

/**
 * Per-month eligibility ledger rows, ordered newest-first. Read from the
 * `donation_eligibility_ledger` view (see migration 012). Consumers that
 * want yearly aggregates group these by `period_end.getUTCFullYear()`.
 */
export async function getDashboardEligibilityLedger(): Promise<DashboardEligibilityRow[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('dashboard')

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('donation_eligibility_ledger')
    .select('*')
    .order('period_end', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as Partial<DashboardEligibilityRow>
    return {
      period_end:           String(row.period_end ?? ''),
      contributions_basis:  asNum(row.contributions_basis),
      pct_used:             asNum(row.pct_used),
      threshold_used:       asNum(row.threshold_used),
      corpus_at_period_end: asNum(row.corpus_at_period_end),
      threshold_met:        Boolean(row.threshold_met),
      amount_earned:        asNum(row.amount_earned),
      donations_in_period:  asNum(row.donations_in_period),
      bad_debts_in_period:  asNum(row.bad_debts_in_period),
      carry_balance:        asNum(row.carry_balance),
    }
  })
}
