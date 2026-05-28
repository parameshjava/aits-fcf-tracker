import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getTransactionByTxnId,
  getPollsForDonationPicker,
} from '@/lib/actions/transactions'
import { EditTransactionForm } from './edit-transaction-form'
import { DeleteTransactionForm } from './delete-transaction-form'

export default async function AdminTransactionManagePage({
  params,
}: {
  params: Promise<{ transaction_id: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const { transaction_id: rawTxnId } = await params
  const transactionId = decodeURIComponent(rawTxnId)
  const txn = await getTransactionByTxnId(transactionId)
  if (!txn) notFound()

  const [{ data: members }, { data: loansRaw }] = await Promise.all([
    supabase.from('members').select('id, name').order('name', { ascending: true }),
    supabase
      .from('loans')
      .select('id, loan_number, principal_amount, status, member_id, member:member_id (name)')
      .order('loan_number', { ascending: false }),
  ])

  type RawLoanRow = {
    id: string
    loan_number: string
    principal_amount: number
    status: string
    member_id: string | null
    member: { name: string } | { name: string }[] | null
  }
  const loans = ((loansRaw ?? []) as unknown as RawLoanRow[]).map((l) => {
    const member = Array.isArray(l.member) ? l.member[0] : l.member
    return {
      id: l.id,
      loan_number: l.loan_number,
      principal_amount: Number(l.principal_amount),
      status: l.status,
      member_id: l.member_id,
      member_name: member?.name ?? '—',
    }
  })

  const donationPolls = await getPollsForDonationPicker({ excludeTxnId: txn.id })

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/admin/transactions" className="text-xs font-medium text-blue-600 hover:underline">
          ← All transactions
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-gray-900">
          <span className="font-mono">{txn.transaction_id}</span>
        </h1>
      </div>

      <EditTransactionForm
        txn={{
          id: txn.id,
          transaction_id: txn.transaction_id,
          transaction_date: txn.transaction_date,
          amount: Number(txn.amount),
          transaction_type: txn.transaction_type,
          interest_source: txn.interest_source ?? null,
          member_id: txn.member_id ?? null,
          loan_id: txn.loan_id ?? null,
          beneficiary_name: txn.beneficiary_name ?? null,
          poll_id: txn.poll_id ?? null,
          description: txn.description ?? null,
        }}
        members={members ?? []}
        loans={loans}
        polls={donationPolls}
      />

      <DeleteTransactionForm id={txn.id} transactionId={txn.transaction_id} />
    </div>
  )
}
