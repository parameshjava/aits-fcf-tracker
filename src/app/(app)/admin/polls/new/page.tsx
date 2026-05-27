import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { NewPollForm } from './new-poll-form'

export default async function NewPollPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/polls')

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/polls" className="text-xs text-blue-600 hover:underline">
          ← All polls
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-gray-900">Create poll</h1>
        <p className="text-sm text-gray-500">
          Ask the membership a question. Members vote until the poll closes; results
          appear once it does.
        </p>
      </div>
      <NewPollForm />
    </div>
  )
}
