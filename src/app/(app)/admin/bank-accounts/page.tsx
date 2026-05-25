import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getAllBankAccounts,
  getMembersForBankAccountForm,
} from '@/lib/actions/bank-accounts'
import { BankAccountManager } from './bank-account-manager'

export default async function AdminBankAccountsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/dashboard')

  const [accounts, members] = await Promise.all([
    getAllBankAccounts(),
    getMembersForBankAccountForm(),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">Bank accounts</h1>
      <p className="text-sm text-gray-500">
        Manage member bank account details
      </p>

      <BankAccountManager
        accounts={accounts}
        members={members}
        isAdmin={true}
      />
    </div>
  )
}
