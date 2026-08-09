import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getLoans, getInterestPerLakh } from '@/lib/actions/loans'
import { LoansListTable, type LoansListRow } from '@/components/loans-list-table'
import { LoansTabs, type LoansTabKey } from '@/components/loans-tabs'
import { computeLoanFinancials, type LoanTxnInput } from '@/lib/loan-math'
import { endOfMonth } from '@/lib/due'
import { tallyEmiSchedule, pctPending, type EmiScheduleRow } from '@/lib/emi-due'
import { memberDisplayName } from '@/lib/member-alias'

export default async function AdminLoansListPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const params = await searchParams
  const initialTab: LoansTabKey = params.tab === 'past' ? 'past' : 'active'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

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
  const emiLoanIds = loans.filter((l) => l.repayment_model === 'emi').map((l) => l.id)
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  const currentMonthEnd = endOfMonth(todayIso)
  type EmiBalRow = {
    loan_id: string
    next_due_date: string | null
    past_due_count: number | null
    oldest_past_due_date: string | null
  }
  const [{ data: txnsRaw }, { data: emiBalRaw }, { data: emiScheduleRaw }] = await Promise.all([
    loanIds.length
      ? supabase
          .from('transactions')
          .select('loan_id, amount, transaction_type, interest_source, transaction_date')
          .in('loan_id', loanIds)
      : Promise.resolve({ data: [] as unknown[] }),
    emiLoanIds.length
      ? supabase
          .from('loan_emi_balances')
          .select('loan_id, next_due_date, past_due_count, oldest_past_due_date')
          .in('loan_id', emiLoanIds)
      : Promise.resolve({ data: [] as EmiBalRow[] }),
    // The full schedule — `tallyEmiSchedule` derives all three EMI columns
    // from it in one pass: settled/total (Total EMI), installments payable as
    // of this month (Pending EMI), and the rupees they owe (Due EMI).
    emiLoanIds.length
      ? supabase
          .from('loan_emi_schedule')
          .select(
            'loan_id, status, due_date, principal_due, interest_due, principal_paid, interest_paid',
          )
          .in('loan_id', emiLoanIds)
      : Promise.resolve({ data: [] as EmiScheduleRow[] }),
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

  const emiByLoan = tallyEmiSchedule(
    (emiScheduleRaw ?? []) as EmiScheduleRow[],
    currentMonthEnd,
  )

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
    const emi = l.repayment_model === 'emi' ? emiByLoan.get(l.id) : undefined
    return {
      id: l.id,
      loan_number: l.loan_number,
      member_name: l.member ? memberDisplayName(l.member) : null,
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
      emi_amount: l.repayment_model === 'emi' ? l.emi_amount : null,
      pending_emi_count: emi ? emi.pendingCount : null,
      pending_emi_due: emi ? emi.pendingDue : null,
      settled_emi_count: emi ? emi.settledCount : null,
      total_emi_count: emi ? emi.totalCount : null,
      pct_emi_pending: emi ? pctPending(emi) : null,
      balance: f.balance,
      detail_href: `/admin/loans/${encodeURIComponent(l.loan_number)}`,
    }
  })

  const activeRows = tableRows.filter((r) => r.status === 'active')
  const pastRows = tableRows.filter((r) => r.status !== 'active')

  const emptyMessage = (
    <>
      No loans yet. Use{' '}
      <Link href="/admin/loans/new" className="text-blue-600 hover:underline">
        + New loan
      </Link>
      .
    </>
  )

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

      <LoansTabs
        initialTab={initialTab}
        activeCount={activeRows.length}
        pastCount={pastRows.length}
        activeTable={
          <LoansListTable
            loans={activeRows}
            linkLabel="Manage →"
            mode="active"
            emptyMessage={emptyMessage}
            todayIso={todayIso}
          />
        }
        pastTable={
          <LoansListTable
            loans={pastRows}
            linkLabel="Manage →"
            mode="past"
            emptyMessage="No past loans yet."
            todayIso={todayIso}
          />
        }
      />
    </div>
  )
}
