import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'
import { getMembersForAliasAdmin } from '@/lib/actions/aliases'
import { suggestAliases } from '@/lib/member-alias'
import { AliasesTable } from './aliases-table'

export default async function AdminAliasesPage() {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    redirect('/dashboard')
  }

  const members = await getMembersForAliasAdmin()
  // Computed on the server so the table renders pre-filled on first paint —
  // the admin's job is to correct a few, not to type twenty-two.
  const suggestions = Object.fromEntries(suggestAliases(members))

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Aliases</h1>
        <p className="mt-1 text-sm text-gray-500">
          The short name the batch actually uses for someone. Once set, the alias
          replaces the full name in charts, tables and poll results — and you can
          search by either when recording a loan or contribution. Members can
          change their own alias later from their profile.
        </p>
      </header>

      <AliasesTable members={members} suggestions={suggestions} />
    </div>
  )
}
