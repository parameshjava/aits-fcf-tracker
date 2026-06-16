'use client'

import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { TRANSACTION_TYPES } from '@/lib/constants'
import { submitPayment } from '@/lib/actions/payments'
import { getActiveLoansWithBalance, type ActiveLoanOption } from '@/lib/actions/loans'
import { formatRupees, todayISO } from '@/lib/format'
import { numberToIndianWords } from '@/lib/number-to-words'
import { PrDropdown, type SelectOption } from '@/components/ui/pr/dropdown'
import { PrAmountInput } from '@/components/ui/pr/amount-input'
import { Field } from '@/components/ui/pr/field'
import { Button } from '@/components/ui/pr/button'

export function SubmitPaymentForm() {
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      return await submitPayment(formData)
    },
    null
  )

  useEffect(() => {
    if (state?.ok)
      toast.success(state.message ?? 'Payment submitted for review', {
        description: "An admin will verify it shortly — you'll see it move to the ledger once approved.",
      })
  }, [state])

  const [transactionType, setTransactionType] = useState<string>('')
  const [loanId, setLoanId] = useState<string>('')
  // Controlled amount (PrAmountInput is controlled). Picking a loan prefills
  // the full pending principal; the member can lower it for a partial payment.
  const [amount, setAmount] = useState<number | null>(null)
  const [loans, setLoans] = useState<ActiveLoanOption[]>([])
  const [loansLoading, setLoansLoading] = useState(false)

  const isLoanRepayment = transactionType === 'loan_repayment'
  const selectedLoan = loans.find((l) => l.id === loanId) ?? null

  const TYPE_OPTIONS: SelectOption[] = TRANSACTION_TYPES.map((type) => ({
    value: type,
    label: type.replace(/_/g, ' '),
  }))

  const loanOptions: SelectOption[] = loans.map((l) => ({
    value: l.id,
    label:
      `${l.loan_number}` +
      (l.member_name ? ` · ${l.member_name}` : '') +
      ` — pending ${formatRupees(l.balance)}`,
  }))

  const amountWords = numberToIndianWords(amount)

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
      setAmount(picked.balance > 0 ? picked.balance : null)
    }
  }

  return (
    <section className="rounded-lg border bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Submit a payment
      </h2>

      <form action={action} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Transaction date" htmlFor="transaction_date" required>
            <input
              id="transaction_date"
              name="transaction_date"
              type="date"
              required
              max={todayISO()}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </Field>

          <Field
            label="Bank Transaction ID"
            htmlFor="bank_transaction_id"
            hint="optional · UPI ref / NEFT UTR"
          >
            <input
              id="bank_transaction_id"
              name="bank_transaction_id"
              type="text"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="e.g. UPI ref / NEFT UTR"
            />
          </Field>

          <Field label="Contribution type" htmlFor="transaction_type" required>
            <PrDropdown
              id="transaction_type"
              name="transaction_type"
              options={TYPE_OPTIONS}
              value={transactionType || null}
              onChange={(v) => handleTransactionTypeChange(v ?? '')}
              required
              placeholder="Select type"
            />
          </Field>

          <Field
            label="Amount"
            htmlFor="amount"
            required
            hint={
              isLoanRepayment && selectedLoan
                ? `Pending principal: ${formatRupees(selectedLoan.balance)} — edit to pay a partial amount.`
                : amountWords || undefined
            }
          >
            <PrAmountInput
              id="amount"
              name="amount"
              required
              value={amount}
              onChange={setAmount}
              placeholder="0.00"
            />
          </Field>

          {isLoanRepayment && (
            <Field
              label="Loan"
              htmlFor="loan_id"
              required
              className="sm:col-span-2"
              hint={
                !loansLoading && loans.length === 0
                  ? 'No active loans found.'
                  : undefined
              }
            >
              <PrDropdown
                id="loan_id"
                name="loan_id"
                options={loanOptions}
                value={loanId || null}
                onChange={(v) => handleLoanChange(v ?? '')}
                required
                placeholder={loansLoading ? 'Loading loans…' : 'Select a loan'}
              />
            </Field>
          )}

          <Field
            label="Description (optional)"
            htmlFor="description"
            className="sm:col-span-2"
          >
            <textarea
              id="description"
              name="description"
              rows={2}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </Field>
        </div>

        {/* Success → toast (see useEffect above); error stays inline with
            the form so the user can correlate it with the offending field. */}
        {state && !state.ok && (
          <p className="text-sm text-red-600">{state.error}</p>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? 'Submitting...' : 'Submit payment'}
          </Button>
        </div>
      </form>
    </section>
  )
}
