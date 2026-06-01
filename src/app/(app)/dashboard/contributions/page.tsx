import { getTransactions, type TransactionFilters } from '@/lib/actions/transactions'
import { createClient } from '@/lib/supabase/server'
import type { RawTxn } from '@/lib/aggregate'
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

// Map a UI type chip to a server-side `getTransactions` type clause. With no
// chips selected we fall back to the full section whitelist (contributions +
// interest, either source) — see the call site.
function chipToClause(t: TypeKey): NonNullable<TransactionFilters['typeClauses']>[number] {
  if (t === 'interest_loans') return { type: 'interest', interestSource: 'loans' }
  if (t === 'interest_bank') return { type: 'interest', interestSource: 'bank' }
  return { type: 'contribution' }
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

  // Build server-side filters. Type clauses default to the full section
  // whitelist (contributions + interest from either source) when no chip is
  // selected; otherwise each chip becomes one OR'd clause. The DB returns rows
  // already ordered by date desc, so no client-side sort/filter is needed.
  const typeClauses: NonNullable<TransactionFilters['typeClauses']> =
    typeKeys.length > 0
      ? typeKeys.map(chipToClause)
      : [
          { type: 'contribution' },
          { type: 'interest', interestSource: 'loans' },
          { type: 'interest', interestSource: 'bank' },
        ]

  const rows = (await getTransactions({
    from,
    to,
    memberIds,
    typeClauses,
  })) as Row[]

  // Applied filters, recorded atop any CSV/PDF export so the download is
  // self-describing.
  const TYPE_LABELS: Record<TypeKey, string> = {
    contribution: 'Contribution',
    interest_loans: 'Loan interest',
    interest_bank: 'Bank interest',
  }
  const memberNames = memberIds
    .map((id) => members.find((m) => m.id === id)?.name)
    .filter(Boolean) as string[]
  const exportCriteria = [
    { label: 'Members', value: memberNames.length > 0 ? memberNames.join(', ') : 'All members' },
    { label: 'Types', value: typeKeys.length > 0 ? typeKeys.map((t) => TYPE_LABELS[t]).join(', ') : 'All types' },
    { label: 'From', value: from },
    { label: 'To', value: to },
  ]

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

      <ContributionsTable rows={rows} exportCriteria={exportCriteria} />
    </div>
  )
}
