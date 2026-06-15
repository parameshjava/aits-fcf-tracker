import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTransactionStats } from '@/lib/actions/transactions'
import { formatRupees } from '@/lib/format'
import Link from 'next/link'

export default async function AdminPage() {
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

  const stats = await getTransactionStats()
  const { count: pendingCount } = await supabase
    .from('pending_payments')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')

  return (
    <div className="space-y-8">
      <h1 className="text-lg font-semibold text-gray-900">Admin panel</h1>
      <p className="text-sm text-gray-500">
        Manage contributions and verify payments
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-white p-5">
          <p className="text-sm text-gray-500">Total transactions</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{stats.total}</p>
        </div>
        <div className="rounded-lg border bg-white p-5">
          <p className="text-sm text-gray-500">Total amount</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {formatRupees(stats.totalAmount)}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-5">
          <p className="text-sm text-gray-500">Pending verifications</p>
          <p className="mt-1 text-2xl font-bold text-yellow-600">
            {pendingCount ?? 0}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/admin/transactions/new"
          className="flex items-center justify-between rounded-lg border bg-white p-5 transition hover:border-blue-300"
        >
          <div>
            <h3 className="font-semibold text-gray-900">Add transaction</h3>
            <p className="text-sm text-gray-500">
              Record a new contribution or payment
            </p>
          </div>
          <span className="text-2xl text-blue-600">+</span>
        </Link>

        <Link
          href="/admin/transactions"
          className="flex items-center justify-between rounded-lg border bg-white p-5 transition hover:border-indigo-300"
        >
          <div>
            <h3 className="font-semibold text-gray-900">Manage transactions</h3>
            <p className="text-sm text-gray-500">
              Edit or delete recorded transactions
            </p>
          </div>
          <span className="text-2xl text-indigo-600">&rarr;</span>
        </Link>

        <Link
          href="/admin/pending"
          className="flex items-center justify-between rounded-lg border bg-white p-5 transition hover:border-yellow-300"
        >
          <div>
            <h3 className="font-semibold text-gray-900">
              Verify payments
              {pendingCount && pendingCount > 0 ? (
                <span className="ml-2 inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                  {pendingCount} pending
                </span>
              ) : null}
            </h3>
            <p className="text-sm text-gray-500">
              Approve or reject user-submitted payments
            </p>
          </div>
          <span className="text-2xl text-yellow-600">&rarr;</span>
        </Link>

        <Link
          href="/admin/bank-accounts"
          className="flex items-center justify-between rounded-lg border bg-white p-5 transition hover:border-green-300"
        >
          <div>
            <h3 className="font-semibold text-gray-900">Bank accounts</h3>
            <p className="text-sm text-gray-500">
              Manage member bank account details
            </p>
          </div>
          <span className="text-2xl text-green-600">&rarr;</span>
        </Link>

        <Link
          href="/admin/polls/new"
          className="flex items-center justify-between rounded-lg border bg-white p-5 transition hover:border-purple-300"
        >
          <div>
            <h3 className="font-semibold text-gray-900">Create poll</h3>
            <p className="text-sm text-gray-500">
              Ask the membership for input
            </p>
          </div>
          <span className="text-2xl text-purple-600">🗳️</span>
        </Link>

        <Link
          href="/admin/donations"
          className="flex items-center justify-between rounded-lg border bg-white p-5 transition hover:border-rose-300"
        >
          <div>
            <h3 className="font-semibold text-gray-900">Manage donations</h3>
            <p className="text-sm text-gray-500">
              Edit donations and link approval polls
            </p>
          </div>
          <span className="text-2xl text-rose-600">❤️</span>
        </Link>

        <Link
          href="/admin/exits"
          className="flex items-center justify-between rounded-lg border bg-white p-5 transition hover:border-teal-300"
        >
          <div>
            <h3 className="font-semibold text-gray-900">Member Exits</h3>
            <p className="text-sm text-gray-500">
              Review and approve member exit requests
            </p>
          </div>
          <span className="text-2xl text-teal-600">👋</span>
        </Link>
      </div>

      <div className="rounded-lg border bg-white p-5">
        <h3 className="mb-3 font-semibold text-gray-900">
          Breakdown by type
        </h3>
        <div className="space-y-2">
          {Object.entries(stats.typeBreakdown).map(([type, amount]) => (
            <div
              key={type}
              className="flex items-center justify-between text-sm"
            >
              <span className="capitalize text-gray-600">
                {type.replace(/_/g, ' ')}
              </span>
              <span className="font-medium text-gray-900">
                {formatRupees(amount)}
              </span>
            </div>
          ))}
          {Object.keys(stats.typeBreakdown).length === 0 && (
            <p className="text-sm text-gray-400">No data yet</p>
          )}
        </div>
      </div>
    </div>
  )
}
