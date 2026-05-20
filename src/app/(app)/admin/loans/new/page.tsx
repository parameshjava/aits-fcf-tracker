import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getInterestPerLakh } from '@/lib/actions/loans'
import { NewLoanForm } from './new-loan-form'

export default async function NewLoanPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const { data: members } = await supabase
    .from('members')
    .select('id, name')
    .order('name', { ascending: true })

  const interestPerLakh = await getInterestPerLakh()

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <p className="text-sm text-gray-500">
        Create a new loan. The loan number is auto-generated.
      </p>
      <NewLoanForm members={members ?? []} interestPerLakh={interestPerLakh} />
    </div>
  )
}
