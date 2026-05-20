import { createClient } from '@/lib/supabase/server'

export async function BankAccountsSection({ email }: { email: string | null }) {
  if (!email) return null
  const supabase = await createClient()

  // Resolve the user to their member row by email; bank accounts then hang
  // off member_id (since members are the canonical "person" in the schema).
  const { data: member } = await supabase
    .from('members')
    .select('id')
    .ilike('email', email)
    .maybeSingle()
  if (!member) return null

  const { data: accounts } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('member_id', member.id)
    .order('is_primary', { ascending: false })

  if (!accounts?.length) return null

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-gray-900">My bank accounts</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {accounts.map((acc) => (
          <div key={acc.id} className="rounded-lg border bg-white p-4">
            <div className="flex items-start justify-between">
              <p className="font-medium text-gray-900">{acc.full_name}</p>
              {acc.is_primary && (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                  Primary
                </span>
              )}
            </div>
            <div className="mt-2 space-y-1 text-sm text-gray-500">
              <p>
                <span className="font-medium text-gray-700">Bank:</span> {acc.bank_name}
              </p>
              <p>
                <span className="font-medium text-gray-700">Account:</span>{' '}
                <span className="font-mono">{maskAccount(acc.account_number)}</span>
              </p>
              <p>
                <span className="font-medium text-gray-700">IFSC:</span>{' '}
                <span className="font-mono">{acc.ifsc_code}</span>
              </p>
              <p className="capitalize">
                <span className="font-medium text-gray-700">Type:</span> {acc.account_type}
              </p>
              {acc.branch && (
                <p>
                  <span className="font-medium text-gray-700">Branch:</span> {acc.branch}
                </p>
              )}
              {acc.upi_id && (
                <p>
                  <span className="font-medium text-gray-700">UPI:</span> {acc.upi_id}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function maskAccount(num: string): string {
  if (num.length <= 4) return num
  return `xxxx${num.slice(-4)}`
}
