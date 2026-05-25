'use client'

import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { TRANSACTION_TYPES } from '@/lib/constants'
import { submitPayment } from '@/lib/actions/payments'
import { getActiveLoansWithBalance, type ActiveLoanOption } from '@/lib/actions/loans'
import { formatRupees, todayISO } from '@/lib/format'

export function SubmitPaymentForm() {
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      return await submitPayment(formData)
    },
    null
  )

  useEffect(() => {
    if (state?.ok) toast.success(state.message ?? 'Payment submitted for review')
  }, [state])

  const [transactionType, setTransactionType] = useState<string>('')
  const [loanId, setLoanId] = useState<string>('')
  const [amount, setAmount] = useState<string>('')
  const [loans, setLoans] = useState<ActiveLoanOption[]>([])
  const [loansLoading, setLoansLoading] = useState(false)

  const isLoanRepayment = transactionType === 'loan_repayment'
  const selectedLoan = loans.find((l) => l.id === loanId) ?? null

  function handleTransactionTypeChange(value: string) {
    setTransactionType(value)
    if (value === 'loan_repayment') {
      // Lazy-load active loans the first time the picker is needed.
      if (loans.length === 0 && !loansLoading) {
        setLoansLoading(true)
        getActiveLoansWithBalance()
          .then((rows) => setLoans(rows))
          .catch((e) => {
            console.error('Failed to load active loans:', e)
          })
          .finally(() => setLoansLoading(false))
      }
    } else {
      setLoanId('')
    }
  }

  function handleLoanChange(id: string) {
    setLoanId(id)
    const picked = loans.find((l) => l.id === id)
    if (picked) {
      // Prefill the full pending principal. The member can lower it for a
      // partial payment — that's the whole reason we surfaced this number.
      setAmount(picked.balance > 0 ? String(picked.balance) : '')
    }
  }

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
              htmlFor="transaction_type"
              className="block text-sm font-medium text-gray-700"
            >
              Contribution type
            </label>
            <select
              id="transaction_type"
              name="transaction_type"
              required
              value={transactionType}
              onChange={(e) => handleTransactionTypeChange(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select type</option>
              {TRANSACTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
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
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="0.00"
            />
            {isLoanRepayment && selectedLoan && (
              <p className="mt-1 text-xs text-gray-500">
                Pending principal: <span className="font-medium text-gray-700">{formatRupees(selectedLoan.balance)}</span>
                {' '}— edit to pay a partial amount.
              </p>
            )}
          </div>

          {isLoanRepayment && (
            <div className="sm:col-span-2">
              <label
                htmlFor="loan_id"
                className="block text-sm font-medium text-gray-700"
              >
                Loan
              </label>
              <select
                id="loan_id"
                name="loan_id"
                required
                value={loanId}
                onChange={(e) => handleLoanChange(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">
                  {loansLoading ? 'Loading loans…' : 'Select a loan'}
                </option>
                {loans.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.loan_number}
                    {l.member_name ? ` · ${l.member_name}` : ''}
                    {' '}— pending {formatRupees(l.balance)}
                  </option>
                ))}
              </select>
              {!loansLoading && loans.length === 0 && (
                <p className="mt-1 text-xs text-gray-500">
                  No active loans found.
                </p>
              )}
            </div>
          )}

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

        {/* Success → toast (see useEffect above); error stays inline with
            the form so the user can correlate it with the offending field. */}
        {state && !state.ok && (
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
