import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getLoans, getInterestPerLakh } from '@/lib/actions/loans'
import { LoansListTable, type LoansListRow } from '@/components/loans-list-table'
import { computeLoanFinancials, type LoanTxnInput } from '@/lib/loan-math'

export default async function AdminLoansListPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const [loans, interestPerLakh] = await Promise.all([
    getLoans(),
    getInterestPerLakh(),
  ])

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
      detail_href: `/admin/loans/${encodeURIComponent(l.loan_number)}`,
    }
  })

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">Manage loans</h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Admin view — create, edit, close, or reopen any loan. Members see a read-only list at{' '}
          <Link href="/dashboard/loans" className="text-blue-600 hover:underline">
            Transactions → Loans
          </Link>
          .
        </p>
        <Link
          href="/admin/loans/new"
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          + New loan
        </Link>
      </div>

      <LoansListTable
        loans={tableRows}
        linkLabel="Manage →"
        emptyMessage={
          <>
            No loans yet. Use{' '}
            <Link href="/admin/loans/new" className="text-blue-600 hover:underline">
              + New loan
            </Link>
            .
          </>
        }
      />
    </div>
  )
}
