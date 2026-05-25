import { getTransactions } from '@/lib/actions/transactions'
import { createClient } from '@/lib/supabase/server'
import type { RawTxn } from '@/lib/aggregate'
import { SECTION_TYPES } from '@/lib/transaction-groups'
import { ContributionsFilters } from './contributions-filters'
import { ContributionsTable } from './contributions-table'

type TypeKey = 'contribution' | 'interest_loans' | 'interest_bank'

type Row = RawTxn & {
  id: string
  transaction_id: string
  description?: string | null
  member_id?: string | null
  member_name?: string | null
}

function rowMatchesType(row: Row, t: TypeKey): boolean {
  if (t === 'contribution') return row.transaction_type === 'contribution'
  if (t === 'interest_loans') return row.transaction_type === 'interest' && row.interest_source === 'loans'
  if (t === 'interest_bank')  return row.transaction_type === 'interest' && row.interest_source === 'bank'
  return false
}

export default async function ContributionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    members?: string
    types?: string
    from?: string
    to?: string
  }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  // Fetch the canonical 22 members for the filter dropdown.
  const { data: membersData } = await supabase
    .from('members')
    .select('id, name')
    .order('name', { ascending: true })
  const members = membersData ?? []

  // Defaults — current calendar year, all members, all types.
  const now = new Date()
  const currentYear = now.getUTCFullYear()
  const defaultFrom = `${currentYear}-01-01`
  const defaultTo = `${currentYear}-12-31`

  const from = params.from || defaultFrom
  const to = params.to || defaultTo
  const memberIds: string[] = params.members
    ? params.members.split(',').filter(Boolean)
    : []
  const typeKeys: TypeKey[] = params.types
    ? (params.types.split(',').filter(Boolean) as TypeKey[])
    : []

  // Load and filter transactions.
  const all = (await getTransactions()) as Row[]
  const allowed = new Set(SECTION_TYPES.contributions)
  const rows = all
    .filter((t) => allowed.has(t.transaction_type))
    .filter((t) => {
      // Date range (inclusive)
      if (t.transaction_date < from) return false
      if (t.transaction_date > to)   return false
      // Member multi-select
      if (memberIds.length > 0) {
        if (!t.member_id || !memberIds.includes(t.member_id)) return false
      }
      // Type chips
      if (typeKeys.length > 0) {
        if (!typeKeys.some((tk) => rowMatchesType(t, tk))) return false
      }
      return true
    })
    .sort(
      (a, b) =>
        new Date(b.transaction_date).getTime() -
        new Date(a.transaction_date).getTime(),
    )

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">Contributions</h1>
      <p className="text-sm text-gray-500">
        Member contributions and interest earned.
      </p>

      <ContributionsFilters
        members={members}
        defaultMemberIds={memberIds}
        defaultTypes={typeKeys}
        defaultFrom={from}
        defaultTo={to}
      />

      <ContributionsTable rows={rows} />
    </div>
  )
}
