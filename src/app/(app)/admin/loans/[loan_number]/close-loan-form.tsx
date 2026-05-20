'use client'

import { useActionState, useState } from 'react'
import { closeLoan, reopenLoan } from '@/lib/actions/loans'
import { todayISO } from '@/lib/format'
import { BankBalanceUpdater } from '@/components/bank-balance-updater'
import { LOAN_WRITE_OFF_DEFAULT } from '@/lib/balance-direction'

type Props = {
  loanId: string
  status: 'active' | 'paid' | 'write_off'
}

export function CloseLoanForm({ loanId, status }: Props) {
  const [open, setOpen] = useState(false)
  const [finalStatus, setFinalStatus] = useState<'paid' | 'write_off'>('paid')

  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => closeLoan(formData),
    null
  )

  const [reopenState, reopenAction, reopening] = useActionState(
    async () => reopenLoan(loanId),
    null
  )

  if (status !== 'active') {
    return (
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-gray-600">
            This loan is closed{' '}
            <span className="font-medium text-gray-900">
              ({status === 'paid' ? 'Paid' : 'Write off'})
            </span>
            .
          </p>
          <form action={reopenAction}>
            <button
              type="submit"
              disabled={reopening}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {reopening ? 'Reopening…' : 'Reopen loan'}
            </button>
          </form>
        </div>
        {reopenState?.success && <p className="mt-2 text-xs text-green-600">{reopenState.success}</p>}
        {reopenState?.error && <p className="mt-2 text-xs text-red-600">{reopenState.error}</p>}
      </div>
    )
  }

  if (!open) {
    return (
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Marking the loan as paid (or write-off) closes it and records the end date.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Close loan
          </button>
        </div>
      </div>
    )
  }

  const today = todayISO()

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-gray-200/80 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Close this loan</h3>
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
          <label htmlFor="status" className="block text-xs font-medium text-gray-700">
            Final status
          </label>
          <select
            id="status"
            name="status"
            value={finalStatus}
            onChange={(e) => setFinalStatus(e.target.value as 'paid' | 'write_off')}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="paid">Paid</option>
            <option value="write_off">Write off</option>
          </select>
        </div>

        <div>
          <label htmlFor="end_date" className="block text-xs font-medium text-gray-700">
            End date
          </label>
          <input
            id="end_date"
            name="end_date"
            type="date"
            required
            defaultValue={today}
            max={today}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="bad_debt" className="block text-xs font-medium text-gray-700">
            Bad debt (₹)
            {finalStatus === 'write_off' && (
              <span className="ml-1 text-xs font-normal text-gray-400">(required for write-off)</span>
            )}
          </label>
          <input
            id="bad_debt"
            name="bad_debt"
            type="number"
            step="0.01"
            min="0"
            defaultValue={0}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {finalStatus === 'write_off' && (
        <BankBalanceUpdater
          defaultDirection={LOAN_WRITE_OFF_DEFAULT}
          label="Update FCF bank balance with this write-off"
        />
      )}

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-600">{state.success}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Closing…' : 'Confirm close'}
        </button>
      </div>
    </form>
  )
}
