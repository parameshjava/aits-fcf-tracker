import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  getLoans,
  getInterestPerLakh,
  getPendingInterestByLoan,
} from '@/lib/actions/loans'
import { LoansListTable, type LoansListRow } from '@/components/loans-list-table'
import { LoansTabs, type LoansTabKey } from '@/components/loans-tabs'
import { computeLoanFinancials, type LoanTxnInput } from '@/lib/loan-math'
import { RefreshButton } from '@/components/ui/refresh-button'
import { LoansFilters } from './loans-filters'

type EmiBalRow = {
  loan_id: string
  next_due_date: string | null
  past_due_count: number | null
  oldest_past_due_date: string | null
}

export default async function LoansListPage({
  searchParams,
}: {
  searchParams: Promise<{
    members?: string
    tab?: string
  }>
}) {
  const params = await searchParams
  const memberFilter = params.members ? params.members.split(',').filter(Boolean) : []
  const initialTab: LoansTabKey = params.tab === 'past' ? 'past' : 'active'

  const supabase = await createClient()
  const interestPerLakh = await getInterestPerLakh()
  const allLoans = await getLoans()

  const loans = allLoans.filter((l) => {
    if (memberFilter.length > 0) {
      if (!l.member_id || !memberFilter.includes(l.member_id)) return false
    }
    return true
  })

  const { data: membersData } = await supabase
    .from('members')
    .select('id, name')
    .order('name', { ascending: true })
  const members = membersData ?? []

  const loanIds = loans.map((l) => l.id)
  const emiLoanIds = loans.filter((l) => l.repayment_model === 'emi').map((l) => l.id)
  const [{ data: txnsRaw }, pendingInterestByLoan, { data: emiBalRaw }] = await Promise.all([
    loanIds.length
      ? supabase
          .from('transactions')
          .select('loan_id, amount, transaction_type, interest_source, transaction_date')
          .in('loan_id', loanIds)
      : Promise.resolve({ data: [] as unknown[] }),
    getPendingInterestByLoan(loanIds),
    emiLoanIds.length
      ? supabase
          .from('loan_emi_balances')
          .select('loan_id, next_due_date, past_due_count, oldest_past_due_date')
          .in('loan_id', emiLoanIds)
      : Promise.resolve({ data: [] as EmiBalRow[] }),
  ])

  const nextDueByLoan = new Map<string, string | null>()
  const overdueByLoan = new Map<string, { count: number; oldest: string | null }>()
  for (const b of (emiBalRaw ?? []) as EmiBalRow[]) {
    nextDueByLoan.set(b.loan_id, b.next_due_date)
    overdueByLoan.set(b.loan_id, {
      count: Number(b.past_due_count ?? 0),
      oldest: b.oldest_past_due_date,
    })
  }

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
    const accrualPending = pendingInterestByLoan.get(l.id) ?? 0
    return {
      id: l.id,
      loan_number: l.loan_number,
      member_name: l.member?.name ?? null,
      principal_amount: f.principal,
      start_date: l.start_date,
      end_date: l.end_date,
      status: l.status,
      loan_type: l.loan_type,
      repayment_model: l.repayment_model,
      next_due_date: l.repayment_model === 'emi' ? nextDueByLoan.get(l.id) ?? null : null,
      overdue_count: l.repayment_model === 'emi' ? overdueByLoan.get(l.id)?.count ?? 0 : 0,
      oldest_overdue_date:
        l.repayment_model === 'emi' ? overdueByLoan.get(l.id)?.oldest ?? null : null,
      paid_interest: f.paidInterestTotal,
      // Interest due reflects the accrual ledger (loan_interest_accruals),
      // not legacy on-the-fly math — keeps the list in lockstep with the
      // Pending-interest panel on the detail page.
      interest_due: f.isClosed ? 0 : accrualPending,
      balance: f.balance,
      detail_href: `/dashboard/loans/${encodeURIComponent(l.loan_number)}`,
    }
  })

  const activeRows = tableRows.filter((r) => r.status === 'active')
  const pastRows = tableRows.filter((r) => r.status !== 'active')
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">Loans</h1>
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

      <LoansFilters members={members} defaultMemberIds={memberFilter} />

      <LoansTabs
        initialTab={initialTab}
        activeCount={activeRows.length}
        pastCount={pastRows.length}
        activeTable={
          <LoansListTable loans={activeRows} expandable mode="active" todayIso={todayIso} />
        }
        pastTable={<LoansListTable loans={pastRows} expandable mode="past" todayIso={todayIso} />}
      />
    </div>
  )
}
