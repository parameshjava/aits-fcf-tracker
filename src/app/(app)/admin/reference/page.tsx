import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'
import { listReferences } from '@/lib/actions/reference'
import { ReferenceTable } from './reference-table'

export default async function ReferencePage() {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') {
    redirect('/dashboard')
  }
  const rows = await listReferences()

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Reference Values</h1>
        <p className="mt-1 text-sm text-gray-500">
          Edit existing keys inline or add new ones. Changes apply immediately, no deploy needed.
        </p>
      </header>

      <ReferenceTable rows={rows} />
    </div>
  )
}
