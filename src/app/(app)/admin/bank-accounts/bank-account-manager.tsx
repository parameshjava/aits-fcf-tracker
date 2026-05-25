'use client'

import { useActionState, useState } from 'react'
import { deleteBankAccount, type MemberOption } from '@/lib/actions/bank-accounts'
import { BankAccountForm } from '@/components/bank-account-form'
import { DeleteIconButton } from '@/components/ui/delete-icon-button'

interface BankAccount {
  id: string
  member_id: string | null
  full_name: string
  account_number: string
  bank_name: string
  ifsc_code: string
  account_type: string
  branch: string | null
  upi_id: string | null
  is_primary: boolean
  member: { name: string | null } | null
}

export function BankAccountManager({
  accounts,
  members,
  isAdmin,
}: {
  accounts: BankAccount[]
  members: MemberOption[]
  isAdmin: boolean
}) {
  const [editing, setEditing] = useState<BankAccount | null>(null)
  const [showForm, setShowForm] = useState(false)

  // Non-admins are restricted to a single member (their own), enforced by
  // `getMembersForBankAccountForm`. Lock the form to that row when present.
  const lockedMember =
    !isAdmin && members.length === 1
      ? { id: members[0].id, name: members[0].name }
      : null

  function closeForm() {
    setEditing(null)
    setShowForm(false)
  }

  return (
    <div className="space-y-4">
      {!editing && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
        >
          + Add bank account
        </button>
      )}

      {(showForm || editing) && (
        <BankAccountForm
          account={editing}
          members={lockedMember ? undefined : members}
          lockedMember={lockedMember}
          onSubmitted={closeForm}
          onCancel={closeForm}
        />
      )}

      {accounts.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-gray-400">
          No bank accounts added yet
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left font-medium text-gray-500">Member</th>
                <th className="px-3 py-3 text-left font-medium text-gray-500">Full name</th>
                <th className="px-3 py-3 text-left font-medium text-gray-500">Bank</th>
                <th className="px-3 py-3 text-left font-medium text-gray-500">Account number</th>
                <th className="px-3 py-3 text-left font-medium text-gray-500">IFSC</th>
                <th className="px-3 py-3 text-left font-medium text-gray-500">Type</th>
                <th className="px-3 py-3 text-center font-medium text-gray-500">Primary</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {accounts.map((acc) => (
                <tr key={acc.id} className="hover:bg-gray-50">
                  <td className="px-3 py-3 text-gray-900">{acc.member?.name || '—'}</td>
                  <td className="px-3 py-3 font-medium text-gray-900">{acc.full_name}</td>
                  <td className="px-3 py-3 text-gray-700">{acc.bank_name}</td>
                  <td className="px-3 py-3 font-mono text-xs text-gray-700">
                    {maskAccount(acc.account_number)}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-gray-700">{acc.ifsc_code}</td>
                  <td className="px-3 py-3 capitalize text-gray-500">{acc.account_type}</td>
                  <td className="px-3 py-3 text-center">
                    {acc.is_primary ? (
                      <span className="text-xs font-medium text-green-600">Yes</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setEditing(acc); setShowForm(true) }}
                        className="text-xs font-medium text-blue-600 hover:text-blue-800"
                      >
                        Edit
                      </button>
                      <DeleteButton accountId={acc.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function DeleteButton({ accountId }: { accountId: string }) {
  const [state, action, pending] = useActionState(
    async () => deleteBankAccount(accountId),
    null,
  )
  return (
    <form action={action}>
      <DeleteIconButton
        type="submit"
        disabled={pending}
        label={state?.ok ? 'Deleted' : 'Delete bank account'}
      />
    </form>
  )
}

function maskAccount(num: string): string {
  if (num.length <= 4) return num
  return `xxxx${num.slice(-4)}`
}
