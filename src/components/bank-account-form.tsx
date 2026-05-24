'use client'

import { useActionState, useEffect, useRef } from 'react'
import { saveBankAccount, type MemberOption } from '@/lib/actions/bank-accounts'
import { IfscField } from '@/components/ifsc-field'

/**
 * Minimum shape needed to pre-fill the form for edit. Both the admin
 * BankAccountManager and the member-directory `MemberBankAccountsManager`
 * provide this from their own typed payloads.
 */
export type BankAccountFormRecord = {
  id: string
  member_id?: string | null
  full_name?: string
  account_number: string
  bank_name: string
  ifsc_code: string
  account_type: string
  branch: string | null
  upi_id: string | null
  is_primary: boolean | null
}

const ACCOUNT_TYPES = ['savings', 'current', 'salary', 'fixed_deposit', 'recurring', 'other']

/**
 * Shared add/edit form for a public.bank_accounts row.
 *
 *   - Admin path (admin/bank-accounts) passes `members` so the form renders a
 *     member dropdown.
 *   - Member-directory path passes `lockedMember` so the form hides the
 *     dropdown and pre-fills the account-holder full name from the row.
 *   - Either path can pass `account` to switch into edit mode.
 *
 * IFSC validation + lookup is handled by <IfscField>, which auto-fills
 * Bank name + Branch (via refs) when the lookup resolves.
 */
export function BankAccountForm({
  account,
  members,
  lockedMember,
  onSubmitted,
  onCancel,
  className,
}: {
  account?: BankAccountFormRecord | null
  /** Members to render in the dropdown. Ignored if `lockedMember` is set. */
  members?: MemberOption[]
  /** When set, hides the dropdown and binds the form to this member. */
  lockedMember?: { id: string; name: string } | null
  onSubmitted?: () => void
  onCancel?: () => void
  className?: string
}) {
  const fullNameRef = useRef<HTMLInputElement>(null)
  const bankNameRef = useRef<HTMLInputElement>(null)
  const branchRef = useRef<HTMLInputElement>(null)

  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      const result = await saveBankAccount(formData)
      if (result.success) onSubmitted?.()
      return result
    },
    null,
  )

  // Locked-member mode: pre-fill the account-holder full name once on mount.
  useEffect(() => {
    if (lockedMember && fullNameRef.current && fullNameRef.current.value === '') {
      fullNameRef.current.value = lockedMember.name
    }
  }, [lockedMember])

  const s = state as { error?: string; success?: string } | null

  return (
    <form
      action={action}
      className={'space-y-4 rounded-lg border bg-white p-5 ' + (className ?? '')}
    >
      <h3 className="text-sm font-semibold text-gray-900">
        {account ? 'Edit bank account' : 'Add bank account'}
      </h3>

      <input type="hidden" name="id" value={account?.id ?? ''} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Member — dropdown for admin, locked card for self-edit */}
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
              defaultValue={account?.member_id ?? ''}
              onChange={(e) => {
                const memberId = e.target.value
                const m = members?.find((x) => x.id === memberId)
                if (m && fullNameRef.current) fullNameRef.current.value = m.name
              }}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select member</option>
              {(members ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Account holder full name */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Account holder full name
          </label>
          <input
            ref={fullNameRef}
            name="full_name"
            type="text"
            required
            defaultValue={account?.full_name ?? ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* IFSC — first, with lookup that fills bank + branch below */}
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700">IFSC code</label>
          <div className="mt-1">
            <IfscField
              name="ifsc_code"
              defaultValue={account?.ifsc_code ?? ''}
              required
              onAutofill={(bank, branch) => {
                if (bankNameRef.current) bankNameRef.current.value = bank
                if (branchRef.current) branchRef.current.value = branch
              }}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Bank name</label>
          <input
            ref={bankNameRef}
            name="bank_name"
            type="text"
            required
            defaultValue={account?.bank_name ?? ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Branch (optional)</label>
          <input
            ref={branchRef}
            name="branch"
            type="text"
            defaultValue={account?.branch ?? ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Account number</label>
          <input
            name="account_number"
            type="text"
            required
            defaultValue={account?.account_number ?? ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Account type</label>
          <select
            name="account_type"
            required
            defaultValue={account?.account_type ?? 'savings'}
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
          <label className="block text-sm font-medium text-gray-700">UPI ID (optional)</label>
          <input
            name="upi_id"
            type="text"
            defaultValue={account?.upi_id ?? ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 sm:col-span-2">
          <input
            id="is_primary"
            name="is_primary"
            type="checkbox"
            defaultChecked={account?.is_primary === true}
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
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 disabled:opacity-50"
        >
          {pending ? 'Saving…' : account ? 'Update' : 'Add account'}
        </button>
      </div>
    </form>
  )
}
