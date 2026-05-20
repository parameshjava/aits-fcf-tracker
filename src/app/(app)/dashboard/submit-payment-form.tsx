'use client'

import { useActionState } from 'react'
import { CONTRIBUTION_TYPES } from '@/lib/constants'
import { submitPayment } from '@/lib/actions/payments'
import { todayISO } from '@/lib/format'

export function SubmitPaymentForm() {
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      return await submitPayment(formData)
    },
    null
  )

  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Submit a payment
      </h2>

      <form action={action} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="transaction_date"
              className="block text-sm font-medium text-gray-700"
            >
              Transaction date
            </label>
            <input
              id="transaction_date"
              name="transaction_date"
              type="date"
              required
              max={todayISO()}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="transaction_id"
              className="block text-sm font-medium text-gray-700"
            >
              Transaction ID
            </label>
            <input
              id="transaction_id"
              name="transaction_id"
              type="text"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="e.g., TXN-001"
            />
          </div>

          <div>
            <label
              htmlFor="amount"
              className="block text-sm font-medium text-gray-700"
            >
              Amount (₹)
            </label>
            <input
              id="amount"
              name="amount"
              type="number"
              step="0.01"
              min="0"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="0.00"
            />
          </div>

          <div>
            <label
              htmlFor="contribution_type"
              className="block text-sm font-medium text-gray-700"
            >
              Contribution type
            </label>
            <select
              id="contribution_type"
              name="contribution_type"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select type</option>
              {CONTRIBUTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700"
            >
              Description (optional)
            </label>
            <textarea
              id="description"
              name="description"
              rows={2}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {state?.success && (
          <p className="text-sm text-green-600">{state.success}</p>
        )}
        {state && 'error' in state && (
          <p className="text-sm text-red-600">{state.error}</p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {pending ? 'Submitting...' : 'Submit payment'}
          </button>
        </div>
      </form>
    </section>
  )
}
