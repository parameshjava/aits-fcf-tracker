import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatRupees } from '@/lib/format'
import { LoanPollModal } from '@/components/loan-poll-modal'

type RawDonationRow = {
  id: string
  transaction_id: string
  transaction_date: string
  amount: number | string
  description: string | null
  beneficiary_name: string | null
  member: { name: string } | { name: string }[] | null
  poll: { id: string; question: string } | { id: string; question: string }[] | null
}

type DonationRow = {
  id: string
  transaction_id: string
  transaction_date: string
  amount: number
  description: string | null
  beneficiary_name: string | null
  referrer_name: string | null
  poll: { id: string; question: string } | null
}

export default async function AdminDonationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const { data, error } = await supabase
    .from('transactions')
    .select(
      'id, transaction_id, transaction_date, amount, description, beneficiary_name, member:member_id (name), poll:poll_id (id, question)',
    )
    .eq('transaction_type', 'donation')
    .order('transaction_date', { ascending: false })

  if (error) throw new Error(error.message)

  const rows: DonationRow[] = ((data ?? []) as unknown as RawDonationRow[]).map((r) => {
    const member = Array.isArray(r.member) ? r.member[0] : r.member
    const poll = Array.isArray(r.poll) ? r.poll[0] : r.poll
    return {
      id: r.id,
      transaction_id: r.transaction_id,
      transaction_date: r.transaction_date,
      amount: Number(r.amount),
      description: r.description,
      beneficiary_name: r.beneficiary_name,
      referrer_name: member?.name ?? null,
      poll: poll ?? null,
    }
  })

  const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0)

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">Manage donations</h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Admin view — edit or delete any donation transaction. Beneficiary,
          referrer, and approval poll all live on the row.
        </p>
        <Link
          href="/admin/transactions/new?type=donation"
          className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
        >
          + New donation
        </Link>
      </div>

      <div className="overflow-clip rounded-2xl border border-gray-200 bg-white">
        <div className="overflow-x-auto lg:overflow-x-visible">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Date
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Amount
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Beneficiary
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Referred by
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Poll
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Description
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400">
                    No donations recorded yet
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {new Date(r.transaction_date).toLocaleDateString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                      })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-gray-900">
                      {formatRupees(r.amount)}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {r.beneficiary_name || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {r.referrer_name || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {r.poll ? (
                        <LoanPollModal
                          pollId={r.poll.id}
                          pollQuestion={r.poll.question}
                        />
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="max-w-[280px] truncate px-4 py-3 text-gray-600">
                      {r.description || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Link
                        href={`/admin/transactions/${encodeURIComponent(r.transaction_id)}`}
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        Manage →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50/30 px-5 py-3 text-xs text-gray-500">
            <span>
              Showing{' '}
              <span className="font-medium text-gray-900">{rows.length}</span>{' '}
              {rows.length === 1 ? 'donation' : 'donations'}
            </span>
            <span className="font-medium text-gray-400">
              Total{' '}
              <span className="ml-1 tabular-nums text-gray-900">
                {formatRupees(totalAmount)}
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
