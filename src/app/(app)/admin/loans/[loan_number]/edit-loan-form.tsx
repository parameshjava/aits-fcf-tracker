'use client'

import { useActionState, useState } from 'react'
import { updateLoan } from '@/lib/actions/loans'
import { todayISO } from '@/lib/format'

type Props = {
  loanId: string
  principal: number
  startDate: string
  historicalInterestPaid: number
  notes: string | null
}

export function EditLoanForm({
  loanId,
  principal,
  startDate,
  historicalInterestPaid,
  notes,
}: Props) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      const result = await updateLoan(formData)
      if (result.success) setOpen(false)
      return result
    },
    null,
  )

  if (!open) {
    return (
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Edit the principal, start date, or record historical interest paid (pre-tracking).
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Edit loan
          </button>
        </div>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-gray-200/80 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Edit loan</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>

      <input type="hidden" name="loan_id" value={loanId} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="principal_amount" className="block text-xs font-medium text-gray-700">
            Principal (₹)
          </label>
          <input
            id="principal_amount"
            name="principal_amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={principal}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="start_date" className="block text-xs font-medium text-gray-700">
            Start date
          </label>
          <input
            id="start_date"
            name="start_date"
            type="date"
            defaultValue={startDate}
            max={todayISO()}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="historical_interest_paid" className="block text-xs font-medium text-gray-700">
            Historical interest paid (₹)
          </label>
          <input
            id="historical_interest_paid"
            name="historical_interest_paid"
            type="number"
            step="0.01"
            min="0"
            defaultValue={historicalInterestPaid}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="sm:col-span-3">
          <label htmlFor="notes" className="block text-xs font-medium text-gray-700">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            defaultValue={notes ?? ''}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <p className="text-xs text-gray-400">
        For a partial repayment, add a <strong>Loan repayment</strong> transaction tied to this loan. To mark the loan fully paid, use the <strong>Close loan</strong> button below.
      </p>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-600">{state.success}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}
