'use client'

import { useActionState, useState } from 'react'
import { updateLoan } from '@/lib/actions/loans'
import {
  MAX_INTEREST_WAIVER_MONTHS,
  type LoanType,
} from '@/lib/loan-type'
import { todayISO } from '@/lib/format'
import { AmountInput } from '@/components/amount-input'

type Props = {
  loanId: string
  principal: number
  startDate: string
  loanType: LoanType
  interestWaiverMonths: number
  notes: string | null
}

export function EditLoanForm({
  loanId,
  principal,
  startDate,
  loanType: initialLoanType,
  interestWaiverMonths,
  notes,
}: Props) {
  const [open, setOpen] = useState(false)
  const [loanType, setLoanType] = useState<LoanType>(initialLoanType)
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      const result = await updateLoan(formData)
      if (result.ok) setOpen(false)
      return result
    },
    null,
  )

  if (!open) {
    return (
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Edit the principal, start date, interest waiver, or notes. Pre-tracking interest
            payments should be recorded as ordinary transactions tagged to this loan.
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

      <fieldset>
        <legend className="text-xs font-medium text-gray-700">Loan type</legend>
        <div className="mt-2 flex gap-3">
          {(['personal', 'medical'] as const).map((t) => {
            const checked = loanType === t
            return (
              <label
                key={t}
                className={
                  'flex flex-1 cursor-pointer items-start gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ' +
                  (checked
                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                    : 'border-gray-300 hover:bg-gray-50')
                }
              >
                <input
                  type="radio"
                  name="loan_type"
                  value={t}
                  checked={checked}
                  onChange={() => setLoanType(t)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium text-gray-900">
                    {t === 'personal' ? 'Personal' : 'Medical'}
                  </span>
                  <span className="block text-[11px] text-gray-500">
                    {t === 'personal'
                      ? 'Standard loan — waiver optional.'
                      : 'Medical-benefit loan — typically with waiver.'}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="principal_amount" className="block text-xs font-medium text-gray-700">
            Principal
          </label>
          <AmountInput
            id="principal_amount"
            name="principal_amount"
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
          <label htmlFor="interest_waiver_months" className="block text-xs font-medium text-gray-700">
            Interest waiver (months)
          </label>
          <input
            id="interest_waiver_months"
            name="interest_waiver_months"
            type="number"
            min="0"
            max={MAX_INTEREST_WAIVER_MONTHS}
            step="1"
            defaultValue={interestWaiverMonths}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-[11px] text-gray-400">
            No interest accrues for this many months from start date (0–
            {MAX_INTEREST_WAIVER_MONTHS}).
          </p>
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

      {state && !state.ok && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && state.message && <p className="text-sm text-green-600">{state.message}</p>}

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
