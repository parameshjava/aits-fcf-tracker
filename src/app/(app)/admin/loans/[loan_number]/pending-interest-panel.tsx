'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  payLoanInterest,
  type LoanInterestAccrual,
  type InterestAllocation,
} from '@/lib/actions/loan-interest'
import type { ActionResult } from '@/lib/actions/action-result'
import { formatRupees, todayISO } from '@/lib/format'

type Props = {
  loanId: string
  accruals: LoanInterestAccrual[]
}

function periodLabel(a: LoanInterestAccrual): string {
  if (a.is_opening_balance) return 'Opening balance'
  return a.period_end
}

export function PendingInterestPanel({ loanId, accruals }: Props) {
  const router = useRouter()
  const pending = accruals.filter(
    (a) => a.status === 'pending' || a.status === 'partially_paid',
  )

  // Local UI state: per-accrual checkbox + amount.
  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(pending.map((a) => [a.id, true])),
  )
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(
      pending.map((a) => [a.id, (a.amount_due - a.paid_amount).toFixed(2)]),
    ),
  )
  const [txnDate, setTxnDate] = useState<string>(todayISO())
  const [notes, setNotes] = useState<string>('')

  const allocations: InterestAllocation[] = pending
    .filter((a) => selected[a.id])
    .map((a) => ({ accrualId: a.id, amount: Number(amounts[a.id] ?? 0) }))
    .filter((a) => Number.isFinite(a.amount) && a.amount > 0)

  const total = allocations.reduce((s, a) => s + a.amount, 0)

  const [state, formAction, isPending] = useActionState<
    ActionResult<{ transactionId: string }> | null
  >(
    async (_prev) =>
      payLoanInterest(loanId, allocations, txnDate, notes || undefined),
    null,
  )

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? 'Interest payment recorded')
      router.refresh()
    }
  }, [state, router])

  if (pending.length === 0) {
    return (
      <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900">Pending interest</h3>
        <p className="mt-2 text-sm text-gray-500">
          All interest accruals are settled.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Pending interest</h3>
        <button
          type="button"
          className="text-xs font-medium text-blue-600 hover:underline"
          onClick={() => {
            const allOn = pending.every((a) => selected[a.id])
            const next = Object.fromEntries(pending.map((a) => [a.id, !allOn]))
            setSelected(next)
          }}
        >
          Toggle all
        </button>
      </div>

      <form action={formAction} className="mt-4 space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-gray-400">
              <tr>
                <th className="py-2 pr-2">Pay</th>
                <th className="py-2 pr-2">Period</th>
                <th className="py-2 pr-2">Due</th>
                <th className="py-2 pr-2">Already paid</th>
                <th className="py-2 pr-2">Apply</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((a) => {
                const remaining = Math.max(a.amount_due - a.paid_amount, 0)
                return (
                  <tr key={a.id} className="border-t border-gray-100">
                    <td className="py-2 pr-2">
                      <input
                        type="checkbox"
                        checked={!!selected[a.id]}
                        onChange={(e) =>
                          setSelected((prev) => ({
                            ...prev,
                            [a.id]: e.target.checked,
                          }))
                        }
                      />
                    </td>
                    <td className="py-2 pr-2 text-gray-700">{periodLabel(a)}</td>
                    <td className="py-2 pr-2 text-gray-900">
                      {formatRupees(a.amount_due)}
                    </td>
                    <td className="py-2 pr-2 text-gray-700">
                      {formatRupees(a.paid_amount)}
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={remaining}
                        value={amounts[a.id] ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value
                          // Clamp to [0, remaining] when a finite number is typed.
                          let next = raw
                          const n = Number(raw)
                          if (raw !== '' && Number.isFinite(n)) {
                            if (n < 0) next = '0'
                            else if (n > remaining) next = remaining.toFixed(2)
                          }
                          setAmounts((prev) => ({ ...prev, [a.id]: next }))
                        }}
                        disabled={!selected[a.id]}
                        className="w-28 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-end gap-3 pt-2">
          <label className="flex flex-col text-xs">
            <span className="text-gray-500">Transaction date</span>
            <input
              type="date"
              value={txnDate}
              onChange={(e) => setTxnDate(e.target.value)}
              required
              max={todayISO()}
              className="mt-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <label className="flex min-w-[200px] flex-1 flex-col text-xs">
            <span className="text-gray-500">Notes (optional)</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <div className="ml-auto text-right">
            <div className="text-[11px] uppercase tracking-wider text-gray-400">
              Total
            </div>
            <div className="text-base font-semibold text-gray-900">
              {formatRupees(total)}
            </div>
          </div>
          <button
            type="submit"
            disabled={isPending || total <= 0}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending ? 'Recording…' : 'Pay selected'}
          </button>
        </div>

        {/* Success → toast (see useEffect); error stays inline. */}
        {state && !state.ok && (
          <p className="text-sm text-red-600">{state.error}</p>
        )}
      </form>
    </section>
  )
}
