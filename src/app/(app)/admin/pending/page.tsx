import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPendingPayments } from '@/lib/actions/payments'
import { PendingPaymentRow } from './pending-payment-row'

export default async function PendingPaymentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    redirect('/dashboard')
  }

  const [payments, membersData] = await Promise.all([
    getPendingPayments(),
    supabase.from('members').select('id, name').order('name', { ascending: true }),
  ])
  const members = membersData.data ?? []

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">Pending payments</h1>
      <p className="text-sm text-gray-500">
        Review and approve or reject user-submitted payments
      </p>

      <div className="space-y-4">
        {payments.length === 0 ? (
          <div className="rounded-lg border bg-white p-8 text-center text-gray-400">
            No pending payments to verify
          </div>
        ) : (
          payments.map((payment) => (
            <PendingPaymentRow key={payment.id} payment={payment} members={members} />
          ))
        )}
      </div>
    </div>
  )
}
