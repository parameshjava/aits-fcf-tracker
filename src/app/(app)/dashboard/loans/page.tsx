import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getLoans, getInterestPerLakh } from '@/lib/actions/loans'
import { LoansListTable, type LoansListRow } from '@/components/loans-list-table'
import { LoansFilters } from './loans-filters'

type StatusKey = 'active' | 'paid' | 'write_off'

function monthsBetween(start: string, endOrNow: Date): number {
  const s = new Date(start)
  const diff =
    (endOrNow.getUTCFullYear() - s.getUTCFullYear()) * 12 +
    (endOrNow.getUTCMonth() - s.getUTCMonth())
  return Math.max(diff, 0)
}

export default async function LoansListPage({
  searchParams,
}: {
  searchParams: Promise<{
    members?: string
    statuses?: string
  }>
}) {
  const params = await searchParams
  const memberFilter = params.members ? params.members.split(',').filter(Boolean) : []
  const statusFilter: StatusKey[] = params.statuses
    ? (params.statuses.split(',').filter(Boolean) as StatusKey[])
    : []

  const supabase = await createClient()
  const interestPerLakh = await getInterestPerLakh()
  const allLoans = await getLoans()

  const loans = allLoans.filter((l) => {
    if (memberFilter.length > 0) {
      if (!l.member_id || !memberFilter.includes(l.member_id)) return false
    }
    if (statusFilter.length > 0) {
      if (!statusFilter.includes(l.status as StatusKey)) return false
    }
    return true
  })

  const { data: membersData } = await supabase
    .from('members')
    .select('id, name')
    .order('name', { ascending: true })
  const members = membersData ?? []

  const loanIds = loans.map((l) => l.id)
  const { data: txnsRaw } = loanIds.length
    ? await supabase
        .from('transactions')
        .select('loan_id, amount, contribution_type, interest_source')
        .in('loan_id', loanIds)
    : { data: [] as unknown[] }

  type TxnAgg = { loan_id: string; amount: number; contribution_type: string; interest_source: 'loans' | 'bank' | null }
  const txns = (txnsRaw ?? []) as TxnAgg[]

  const paidPrincipalByLoan = new Map<string, number>()
  const paidInterestByLoan = new Map<string, number>()
  for (const t of txns) {
    if (!t.loan_id) continue
    const amt = Number(t.amount) || 0
    if (t.contribution_type === 'loan_repayment') {
      paidPrincipalByLoan.set(t.loan_id, (paidPrincipalByLoan.get(t.loan_id) ?? 0) + amt)
    } else if (t.contribution_type === 'interest' && t.interest_source === 'loans') {
      paidInterestByLoan.set(t.loan_id, (paidInterestByLoan.get(t.loan_id) ?? 0) + amt)
    }
  }

  const tableRows: LoansListRow[] = loans.map((l) => {
    const paidPrincipal = paidPrincipalByLoan.get(l.id) ?? 0
    const paidInterest =
      (paidInterestByLoan.get(l.id) ?? 0) + Number(l.historical_interest_paid || 0)
    const balance = Math.max(
      Number(l.principal_amount) - paidPrincipal - Number(l.bad_debt || 0),
      0,
    )
    const endOrNow = l.end_date ? new Date(l.end_date) : new Date()
    const months = monthsBetween(l.start_date, endOrNow)
    const expectedInterest =
      (Number(l.principal_amount) / 100000) * interestPerLakh * months
    const interestDue = Math.max(expectedInterest - paidInterest, 0)

    return {
      id: l.id,
      loan_number: l.loan_number,
      member_name: l.member?.name ?? null,
      principal_amount: Number(l.principal_amount),
      start_date: l.start_date,
      status: l.status,
      paid_interest: paidInterest,
      interest_due: interestDue,
      balance,
      detail_href: `/dashboard/loans/${encodeURIComponent(l.loan_number)}`,
    }
  })

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        One row per loan. Monthly interest is computed at{' '}
        <strong>₹{interestPerLakh.toLocaleString('en-IN')}</strong> per ₹1L. Read-only — admins manage loans via{' '}
        <Link href="/admin/loans" className="text-blue-600 hover:underline">
          Admin → Manage loans
        </Link>
        .
      </p>

      <LoansFilters
        members={members}
        defaultMemberIds={memberFilter}
        defaultStatuses={statusFilter}
      />

      <LoansListTable loans={tableRows} linkLabel="View →" />
    </div>
  )
}
