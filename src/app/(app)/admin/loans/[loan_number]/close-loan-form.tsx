'use client'

import { useActionState, useState } from 'react'
import { closeLoan, reopenLoan } from '@/lib/actions/loans'
import { formatRupees, todayISO } from '@/lib/format'

type Props = {
  loanId: string
  status: 'active' | 'paid' | 'write_off'
  /** Current pending principal as computed server-side. */
  pendingPrincipal: number
  /** Current pending interest as computed server-side. */
  pendingInterest: number
}

export function CloseLoanForm({
  loanId,
  status,
  pendingPrincipal,
  pendingInterest,
}: Props) {
  const [open, setOpen] = useState(false)
  // Default to Write off when anything is unsettled so the admin sees the
  // waive inputs immediately. Otherwise default to Paid (the happy path).
  const hasDues = pendingPrincipal > 0 || pendingInterest > 0
  const [finalStatus, setFinalStatus] = useState<'paid' | 'write_off'>(
    hasDues ? 'write_off' : 'paid',
  )

  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => closeLoan(formData),
    null,
  )

  const [reopenState, reopenAction, reopening] = useActionState(
    async () => reopenLoan(loanId),
    null,
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
            {hasDues
              ? `This loan still has ₹${pendingPrincipal.toFixed(0)} principal and ₹${pendingInterest.toFixed(0)} interest pending — a Paid close is blocked. Use Write off to waive the dues.`
              : 'No dues outstanding. Closing as Paid records the end date.'}
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
  const paidBlocked = finalStatus === 'paid' && hasDues

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

      {/* Pending snapshot — same numbers the server validates against. */}
      <div className="grid grid-cols-2 gap-3 rounded-md bg-gray-50/70 px-3 py-2 text-xs sm:grid-cols-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400">Pending principal</p>
          <p className="mt-0.5 font-semibold tabular-nums text-gray-900">
            {formatRupees(pendingPrincipal)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-400">Pending interest</p>
          <p className="mt-0.5 font-semibold tabular-nums text-gray-900">
            {formatRupees(pendingInterest)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <option value="paid" disabled={hasDues}>
              Paid {hasDues ? '— blocked, dues pending' : ''}
            </option>
            <option value="write_off">Write off / waive</option>
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

        {finalStatus === 'write_off' && (
          <>
            <div>
              <label htmlFor="bad_debt" className="block text-xs font-medium text-gray-700">
                Principal write-off (₹)
              </label>
              <input
                id="bad_debt"
                name="bad_debt"
                type="number"
                step="0.01"
                min="0"
                max={pendingPrincipal}
                key={`bad_debt-${pendingPrincipal}`}
                defaultValue={pendingPrincipal}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-[11px] text-gray-400">
                Cannot exceed pending principal ({formatRupees(pendingPrincipal)}).
              </p>
            </div>
            <div>
              <label htmlFor="interest_waived" className="block text-xs font-medium text-gray-700">
                Interest waived (₹)
              </label>
              <input
                id="interest_waived"
                name="interest_waived"
                type="number"
                step="0.01"
                min="0"
                max={pendingInterest}
                key={`interest_waived-${pendingInterest}`}
                defaultValue={pendingInterest}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-[11px] text-gray-400">
                Cannot exceed pending interest ({formatRupees(pendingInterest)}).
              </p>
            </div>
          </>
        )}
      </div>

      {finalStatus === 'write_off' && (
        <p className="rounded-md bg-gray-50 px-3 py-2 text-[11px] text-gray-500 ring-1 ring-gray-200">
          Bank balance is not adjusted on write-off — the principal already left the bank when
          the loan was disbursed, and the waived interest was never received.
        </p>
      )}

      {paidBlocked && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          A Paid close is blocked while dues remain. Switch to Write off to record what is being
          waived, then close.
        </p>
      )}

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-600">{state.success}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || paidBlocked}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Closing…' : 'Confirm close'}
        </button>
      </div>
    </form>
  )
}
