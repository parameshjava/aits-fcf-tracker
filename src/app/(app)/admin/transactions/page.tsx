import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getDbTransactions } from '@/lib/actions/transactions'
import { TransactionsTable, type TxnRow } from '@/components/transactions-table'

export default async function AdminTransactionsListPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const dbRows = (await getDbTransactions()) as TxnRow[]
  const rows: TxnRow[] = dbRows.map((r) => ({
    ...r,
    manage_href: `/admin/transactions/${encodeURIComponent(r.transaction_id)}`,
  }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Admin view — edit or delete any recorded transaction. Historical Excel
          rows are read-only and not shown here.
        </p>
        <Link
          href="/admin/transactions/new"
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          + New transaction
        </Link>
      </div>

      <TransactionsTable
        rows={rows}
        emptyLabel="No transactions recorded yet"
      />
    </div>
  )
}
