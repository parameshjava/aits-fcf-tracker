'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Dashboard data accessors. All of these read from the dashboard_* views
 * created by scripts/create-dashboard-views.sql — never from the raw
 * `transactions` table — so aggregation happens in Postgres, not JS.
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
}

function asNum(x: unknown): number {
  return typeof x === 'number' ? x : Number(x ?? 0)
}

export async function getDashboardOverall(): Promise<DashboardOverall> {
  const supabase = await createClient()
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
  const supabase = await createClient()
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
  const supabase = await createClient()
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
  const supabase = await createClient()
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
  const supabase = await createClient()
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
  const supabase = await createClient()
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
