import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPollsForLoanPicker } from '@/lib/actions/loans'
import { getReference } from '@/lib/actions/reference'
import { NewLoanForm } from './new-loan-form'

export default async function NewLoanPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const [
    { data: members },
    polls,
    maxTermMonths,
    interestRatePct,
    medicalWaiverDefault,
  ] = await Promise.all([
    // Only active members can take a new loan — inactive/archived members are
    // kept out of the borrower picker (mirrors the Add transaction form).
    supabase
      .from('members')
      .select('id, name')
      .eq('status', 'active')
      .order('name', { ascending: true }),
    getPollsForLoanPicker(),
    // Reference-driven limits/rate for the live EMI preview. Defaults mirror
    // the createLoan server action so the client preview matches the server.
    getReference('loan_max_term_months').catch(() => 30),
    getReference('loan_interest_rate_pct').catch(() => 8),
    getReference('loan_default_waiver_medical').catch(() => 6),
  ])

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">New loan</h1>
      <p className="text-sm text-gray-500">
        Create a new loan. The loan number is auto-generated.
      </p>
      <NewLoanForm
        members={members ?? []}
        polls={polls}
        maxTermMonths={maxTermMonths}
        interestRatePct={interestRatePct}
        medicalWaiverDefault={medicalWaiverDefault}
      />
    </div>
  )
}
