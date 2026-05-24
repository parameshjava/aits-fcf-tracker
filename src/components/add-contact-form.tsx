'use client'

import { useActionState, useState } from 'react'
import { addMemberContact } from '@/lib/actions/members'
import { PhoneInput } from '@/components/ui/phone-input'

export function AddContactForm({
  memberId,
  onSubmitted,
  onCancel,
}: {
  memberId: string
  /** Fires after a successful add (used by the toggle wrapper to collapse). */
  onSubmitted?: () => void
  /** When supplied, renders a Cancel button alongside Submit. */
  onCancel?: () => void
}) {
  // `formKey` forces a fresh `PhoneInput` (and email input) after a successful
  // add so the previously-typed number doesn't linger on the screen.
  const [formKey, setFormKey] = useState(0)
  const [kind, setKind] = useState<'phone' | 'email'>('phone')

  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      const result = await addMemberContact(formData)
      if (result.success) {
        setFormKey((k) => k + 1)
        onSubmitted?.()
      }
      return result
    },
    null,
  )

  const successKey =
    state && 'success' in state && state.success ? `${state.success}-${formKey}` : null

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="member_id" value={memberId} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="kind" className="block text-xs font-medium text-gray-700">
            Kind
          </label>
          <select
            id="kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'phone' | 'email')}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="phone">Phone</option>
            <option value="email">Email</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="value" className="block text-xs font-medium text-gray-700">
            {kind === 'phone' ? 'Phone number' : 'Email address'}
          </label>
          <div className="mt-1">
            {kind === 'phone' ? (
              <PhoneInput key={`phone-${formKey}`} id="value" name="value" required />
            ) : (
              <input
                key={`email-${formKey}`}
                id="value"
                name="value"
                type="email"
                required
                placeholder="someone@example.com"
                className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            )}
          </div>
        </div>

        <div>
          <label htmlFor="label" className="block text-xs font-medium text-gray-700">
            Label (optional)
          </label>
          <input
            id="label"
            name="label"
            type="text"
            placeholder={kind === 'phone' ? 'Personal' : 'Work'}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-xs text-gray-700">
        <input
          type="checkbox"
          name="is_primary"
          className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        Mark as primary {kind === 'phone' ? 'phone' : 'email'}
      </label>

      {state && 'error' in state && state.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      {successKey && <p className="text-sm text-green-600">Contact added.</p>}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add contact'}
        </button>
      </div>
    </form>
  )
}
