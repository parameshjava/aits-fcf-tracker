'use client'

import { useEffect, useRef, useState } from 'react'
import { useActionState } from 'react'
import { saveBankAccount, deleteBankAccount, type MemberOption } from '@/lib/actions/bank-accounts'
import { IfscField } from '@/components/ifsc-field'

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

const ACCOUNT_TYPES = ['savings', 'current', 'salary', 'fixed_deposit', 'recurring', 'other']

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

  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      const result = await saveBankAccount(formData)
      if (result.success) {
        setEditing(null)
        setShowForm(false)
      }
      return result
    },
    null
  )

  return (
    <div className="space-y-4">
      {!editing && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Add bank account
        </button>
      )}

      {(showForm || editing) && (
        <AccountForm
          account={editing}
          members={members}
          isAdmin={isAdmin}
          action={action}
          state={state}
          pending={pending}
          onCancel={() => { setEditing(null); setShowForm(false) }}
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
                  <td className="px-3 py-3 text-gray-900">
                    {acc.member?.name || '—'}
                  </td>
                  <td className="px-3 py-3 font-medium text-gray-900">{acc.full_name}</td>
                  <td className="px-3 py-3 text-gray-700">{acc.bank_name}</td>
                  <td className="px-3 py-3 font-mono text-xs text-gray-700">
                    {maskAccount(acc.account_number)}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-gray-700">{acc.ifsc_code}</td>
                  <td className="px-3 py-3 capitalize text-gray-500">{acc.account_type}</td>
                  <td className="px-3 py-3 text-center">
                    {acc.is_primary ? (
                      <span className="text-green-600 text-xs font-medium">Yes</span>
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

function AccountForm({
  account,
  members,
  isAdmin,
  action,
  state,
  pending,
  onCancel,
}: {
  account: BankAccount | null
  members: MemberOption[]
  isAdmin: boolean
  action: (formData: FormData) => void
  state: unknown
  pending: boolean
  onCancel: () => void
}) {
  const s = state as { error?: string; success?: string } | null
  const lockedMember = !isAdmin && members.length === 1 ? members[0] : null

  const fullNameRef = useRef<HTMLInputElement>(null)
  const bankNameRef = useRef<HTMLInputElement>(null)
  const branchRef = useRef<HTMLInputElement>(null)

  // If the form is locked to a single member (non-admin case), autofill the
  // account-holder name on mount when the field is empty (creating new).
  useEffect(() => {
    if (lockedMember && fullNameRef.current && fullNameRef.current.value === '') {
      fullNameRef.current.value = lockedMember.name
    }
  }, [lockedMember])

  return (
    <form action={action} className="rounded-lg border bg-white p-5 space-y-4">
      <h3 className="font-semibold text-gray-900">
        {account ? 'Edit bank account' : 'Add bank account'}
      </h3>

      <input type="hidden" name="id" value={account?.id || ''} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">Member</label>
          {lockedMember ? (
            <>
              <input type="hidden" name="member_id" value={lockedMember.id} />
              <div className="mt-1 block w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                {lockedMember.name}
              </div>
            </>
          ) : (
            <select
              name="member_id"
              required
              defaultValue={account?.member_id || lockedMember || ''}
              onChange={(e) => {
                const memberId = e.target.value
                const member = members.find((m) => m.id === memberId)
                if (member && fullNameRef.current) {
                  fullNameRef.current.value = member.name
                }
              }}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select member</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Account holder full name
          </label>
          <input
            ref={fullNameRef}
            name="full_name"
            type="text"
            required
            defaultValue={account?.full_name || ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">IFSC code</label>
          <div className="mt-1">
            <IfscField
              name="ifsc_code"
              defaultValue={account?.ifsc_code || ''}
              required
              onAutofill={(bank, branch) => {
                if (bankNameRef.current) bankNameRef.current.value = bank
                if (branchRef.current) branchRef.current.value = branch
              }}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Account number</label>
          <input
            name="account_number"
            type="text"
            required
            defaultValue={account?.account_number || ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Bank name</label>
          <input
            ref={bankNameRef}
            name="bank_name"
            type="text"
            required
            defaultValue={account?.bank_name || ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Account type</label>
          <select
            name="account_type"
            required
            defaultValue={account?.account_type || 'savings'}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Branch (optional)</label>
          <input
            ref={branchRef}
            name="branch"
            type="text"
            defaultValue={account?.branch || ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">UPI ID (optional)</label>
          <input
            name="upi_id"
            type="text"
            defaultValue={account?.upi_id || ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 sm:col-span-2">
          <input
            id="is_primary"
            name="is_primary"
            type="checkbox"
            defaultChecked={account?.is_primary || false}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="is_primary" className="text-sm text-gray-700">
            Primary account
          </label>
        </div>
      </div>

      {s?.error && <p className="text-sm text-red-600">{s.error}</p>}
      {s?.success && <p className="text-sm text-green-600">{s.success}</p>}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Saving...' : account ? 'Update' : 'Add account'}
        </button>
      </div>
    </form>
  )
}

function DeleteButton({ accountId }: { accountId: string }) {
  const [state, action, pending] = useActionState(
    async () => deleteBankAccount(accountId),
    null
  )

  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
      >
        {state?.success ? 'Deleted' : 'Delete'}
      </button>
    </form>
  )
}

function maskAccount(num: string): string {
  if (num.length <= 4) return num
  return `xxxx${num.slice(-4)}`
}
