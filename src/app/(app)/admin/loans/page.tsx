import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getLoans, getInterestPerLakh } from '@/lib/actions/loans'
import { LoansListTable, type LoansListRow } from '@/components/loans-list-table'

function monthsBetween(start: string, endOrNow: Date): number {
  const s = new Date(start)
  const diff =
    (endOrNow.getUTCFullYear() - s.getUTCFullYear()) * 12 +
    (endOrNow.getUTCMonth() - s.getUTCMonth())
  return Math.max(diff, 0)
}

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
      detail_href: `/admin/loans/${encodeURIComponent(l.loan_number)}`,
    }
  })

  return (
    <div className="space-y-6">
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
