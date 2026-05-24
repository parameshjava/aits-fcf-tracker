import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getLoans, getInterestPerLakh } from '@/lib/actions/loans'
import { LoansListTable, type LoansListRow } from '@/components/loans-list-table'
import { computeLoanFinancials, type LoanTxnInput } from '@/lib/loan-math'
import { RefreshButton } from '@/components/ui/refresh-button'
import { LoansFilters } from './loans-filters'

type StatusKey = 'active' | 'paid' | 'write_off'

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
        .select('loan_id, amount, transaction_type, interest_source, transaction_date')
        .in('loan_id', loanIds)
    : { data: [] as unknown[] }

  type TxnAgg = LoanTxnInput & { loan_id: string }
  const txns = (txnsRaw ?? []) as TxnAgg[]

  const txnsByLoan = new Map<string, LoanTxnInput[]>()
  for (const t of txns) {
    if (!t.loan_id) continue
    const list = txnsByLoan.get(t.loan_id) ?? []
    list.push(t)
    txnsByLoan.set(t.loan_id, list)
  }

  const tableRows: LoansListRow[] = loans.map((l) => {
    const f = computeLoanFinancials(l, txnsByLoan.get(l.id) ?? [], interestPerLakh)
    return {
      id: l.id,
      loan_number: l.loan_number,
      member_name: l.member?.name ?? null,
      principal_amount: f.principal,
      start_date: l.start_date,
      status: l.status,
      paid_interest: f.paidInterestTotal,
      interest_due: f.interestDue,
      balance: f.balance,
      detail_href: `/dashboard/loans/${encodeURIComponent(l.loan_number)}`,
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-gray-500">
          One row per loan. Interest accrues at{' '}
          <strong>₹{interestPerLakh.toLocaleString('en-IN')}</strong> per ₹1L on the{' '}
          <em>pending principal</em>, so partial repayments lower future interest. Closed
          loans (paid or written off) show no pending interest. Read-only — admins manage
          loans via{' '}
          <Link href="/admin/loans" className="text-blue-600 hover:underline">
            Admin → Manage loans
          </Link>
          .
        </p>
        <RefreshButton label="Refresh loans list" />
      </div>

      <LoansFilters
        members={members}
        defaultMemberIds={memberFilter}
        defaultStatuses={statusFilter}
      />

      <LoansListTable loans={tableRows} expandable />
    </div>
  )
}
