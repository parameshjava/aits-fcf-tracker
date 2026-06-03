import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPollsForDonationPicker } from '@/lib/actions/transactions'
import { TRANSACTION_TYPES, type TransactionType } from '@/lib/constants'
import { NewTransactionForm } from './new-transaction-form'

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
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

  // Only active members can pay — inactive/archived members never contribute,
  // so keep them out of the picker.
  const { data: members } = await supabase
    .from('members')
    .select('id, name')
    .eq('status', 'active')
    .order('name', { ascending: true })

  // Only feed active loans into the dropdown — admins can re-open a closed
  // loan from its detail page if they really need to log against it.
  const { data: loansRaw } = await supabase
    .from('loans')
    .select('id, loan_number, principal_amount, status, member_id, member:member_id (name)')
    .eq('status', 'active')
    .order('loan_number', { ascending: false })

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

  const donationPolls = await getPollsForDonationPicker()

  const sp = await searchParams
  const initialType: TransactionType | '' =
    sp.type && (TRANSACTION_TYPES as readonly string[]).includes(sp.type)
      ? (sp.type as TransactionType)
      : ''

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">Add transaction</h1>
      <p className="text-sm text-gray-500">
        Record a verified financial transaction
      </p>
      <NewTransactionForm
        members={members ?? []}
        loans={loans}
        polls={donationPolls}
        initialType={initialType}
      />
    </div>
  )
}
