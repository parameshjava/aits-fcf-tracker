'use client'

import { useActionState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createLoan } from '@/lib/actions/loans'
import { todayISO } from '@/lib/format'
import { BankBalanceUpdater } from '@/components/bank-balance-updater'
import { LOAN_DISBURSEMENT_DEFAULT } from '@/lib/balance-direction'

type Member = { id: string; name: string }

export function NewLoanForm({
  members,
  interestPerLakh,
}: {
  members: Member[]
  interestPerLakh: number
}) {
  const router = useRouter()
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => createLoan(formData),
    null,
  )

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Loan created')
      router.push('/dashboard/loans')
      router.refresh()
    }
  }, [state, router])

  return (
    <form action={action} className="space-y-4 rounded-lg border bg-white p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="member_id" className="block text-sm font-medium text-gray-700">
            Member
          </label>
          <select
            id="member_id"
            name="member_id"
            required
            defaultValue=""
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Select member</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="principal_amount" className="block text-sm font-medium text-gray-700">
            Principal (₹)
          </label>
          <input
            id="principal_amount"
            name="principal_amount"
            type="number"
            step="0.01"
            min="0"
            required
            placeholder="e.g. 100000"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="start_date" className="block text-sm font-medium text-gray-700">
            Start date
          </label>
          <input
            id="start_date"
            name="start_date"
            type="date"
            required
            max={todayISO()}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="interest_per_lakh_display" className="block text-sm font-medium text-gray-700">
            Interest rate
            <span className="ml-1 text-xs font-normal text-gray-400">(₹ / lakh / month — global setting)</span>
          </label>
          <input
            id="interest_per_lakh_display"
            type="text"
            readOnly
            value={`₹${interestPerLakh.toLocaleString('en-IN')} / lakh / month`}
            className="mt-1 block w-full cursor-not-allowed rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 shadow-sm"
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="interest_waiver_months" className="block text-sm font-medium text-gray-700">
            Interest waiver
            <span className="ml-1 text-xs font-normal text-gray-400">
              (months from start with no interest — e.g. medical-benefit loans)
            </span>
          </label>
          <input
            id="interest_waiver_months"
            name="interest_waiver_months"
            type="number"
            min="0"
            step="1"
            defaultValue={0}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
            Notes (optional)
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <BankBalanceUpdater
        defaultDirection={LOAN_DISBURSEMENT_DEFAULT}
        label="Update FCF bank balance with this disbursement"
      />

      <p className="text-xs text-gray-400">
        Loan number is auto-generated as <code className="font-mono">YYYYMM-NNN</code> from the start date — the 3-digit serial resets every calendar year.
      </p>

      {/* Success → toast (see useEffect); error stays inline. */}
      {state && !state.ok && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      <div className="flex justify-end gap-3">
        <Link
          href="/dashboard/loans"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {pending ? 'Saving...' : 'Create loan'}
        </button>
      </div>
    </form>
  )
}
