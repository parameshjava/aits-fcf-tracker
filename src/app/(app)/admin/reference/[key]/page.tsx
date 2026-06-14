import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'
import {
  getReferenceRow,
  listReferenceHistory,
} from '@/lib/actions/reference'
import { ReferenceHistoryEditor } from './history-editor'

export default async function ReferenceHistoryPage({
  params,
}: {
  params: Promise<{ key: string }>
}) {
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') redirect('/dashboard')

  const { key } = await params
  const current = await getReferenceRow(key)
  if (!current) notFound()
  const history = await listReferenceHistory(key)

  return (
    <div className="space-y-6 p-6">
      <header>
        <Link
          href="/admin/reference"
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          ← All references
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">
          {current.name}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Time-windowed values for key{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs">{key}</code>
          . The value in effect on any given date is the row whose window
          covers that date. Use this page to backdate, plan a future change,
          or split an existing period.
        </p>
      </header>

      <ReferenceHistoryEditor
        referenceKey={key}
        datatype={current.datatype}
        rows={history}
      />
    </div>
  )
}
